// Multiplayer Wordle race using PeerJS (browser-to-browser WebRTC).
//
// How players find each other (no links to share):
//   Everyone tries to claim the same fixed PeerJS ID (HOST_ID).
//   - The first person gets it and becomes the HOST.
//   - Everyone after that is told the ID is taken, so they join as a
//     GUEST by connecting to HOST_ID.
//
// The host runs the game: it picks the secret word, checks and scores
// every guess, and sends each player the current state. Guests only
// send guesses and draw what the host sends back. Guests never receive
// the secret word until the round is over.
//
// Messages (plain objects):
//   guest -> host  {type: "guess", word}
//   host -> guest  {type: "state", ...}    see HostGame.viewFor()
//   host -> guest  {type: "error", message} bad guess, e.g. not a word
//   both ways      {type: "ping"}           "I'm still here", every 3 s
//   both ways      {type: "bye"}            sent when a page is closed
//
// Closed tabs aren't always reported right away, so anyone not heard
// from for 10 s is treated as gone. If the host leaves, the game ends
// for everyone; reloading the page starts a new one.
//
// Optional URL settings:
//   ?room=name           separate game (default "main")
//   ?peerserver=host:port use your own PeerJS server instead of the
//                        free public one (used for local testing)

"use strict";

const params = new URLSearchParams(location.search);
const ROOM = (params.get("room") || "main").toLowerCase().replace(/[^a-z0-9]/g, "") || "main";
const HOST_ID = "jdwarr3n-wordle-f26-" + ROOM;

const PEER_OPTIONS = {};
if (params.get("peerserver")) {
  const [host, port] = params.get("peerserver").split(":");
  Object.assign(PEER_OPTIONS, {
    host,
    port: Number(port) || 9000,
    path: "/",
    secure: location.protocol === "https:",
  });
}

const PING_EVERY_MS = 3000;   // heartbeat, both directions
const SILENCE_LIMIT_MS = 10000; // treat a player as gone after this
const JOIN_TIMEOUT_MS = 8000;  // guest gives up connecting after this

// ------------------------------------------------------------------ host

/** The game as the host sees it. Only the host's browser has one. */
class HostGame {
  constructor(hostId, sendTo) {
    this.hostId = hostId;
    this.sendTo = sendTo; // (playerId, message) => void
    this.players = new Map(); // id -> {name, history}, in join order
    this.joinCount = 0;
    this.phase = "lobby"; // "lobby" | "playing" | "over"
    this.target = null;
    this.winner = null;
    this.addPlayer(hostId);
  }

  addPlayer(id) {
    this.joinCount += 1;
    // Someone joining mid-round starts with an empty board and can play.
    this.players.set(id, { name: "Player " + this.joinCount, history: [] });
    this.broadcast();
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    if (this.phase === "playing" && this.everyoneDone()) this.phase = "over";
    this.broadcast();
  }

  start() {
    this.target = randomWord();
    this.winner = null;
    this.phase = "playing";
    for (const p of this.players.values()) p.history = [];
    this.broadcast();
  }

  isDone(p) {
    return p.history.length >= MAX_GUESSES ||
      p.history.some(([, score]) => score === GREEN.repeat(WORD_LENGTH));
  }

  everyoneDone() {
    return [...this.players.values()].every((p) => this.isDone(p));
  }

  /** Handle a guess from a player. Returns an error message, or null. */
  guess(id, word) {
    const p = this.players.get(id);
    if (!p) return "You're not in the game";
    if (this.phase !== "playing") return "Round hasn't started";
    if (this.isDone(p)) return "You're out of guesses";
    word = String(word).toLowerCase();
    const error = checkWord(word);
    if (error) return error;

    const score = scoreGuess(word, this.target);
    p.history.push([word, score]);
    if (score === GREEN.repeat(WORD_LENGTH)) {
      this.winner = id; // first to solve it wins the race
      this.phase = "over";
    } else if (this.everyoneDone()) {
      this.phase = "over"; // nobody solved it
    }
    this.broadcast();
    return null;
  }

  /** What one player is allowed to see. */
  viewFor(id) {
    const winner = this.players.get(this.winner);
    return {
      type: "state",
      you: id,
      hostId: this.hostId,
      phase: this.phase,
      winner: this.winner,
      winnerName: winner ? winner.name : null,
      winnerGuesses: winner ? winner.history.length : 0,
      target: this.phase === "over" ? this.target : null,
      // Your own letters. A copy, so the host's own view doesn't share
      // (and silently change along with) the game's real history.
      history: this.players.get(id).history.map((row) => [...row]),
      players: [...this.players].map(([pid, p]) => ({
        id: pid,
        name: p.name,
        // Other players' colors only, never their letters.
        scores: p.history.map(([, score]) => score),
        done: this.isDone(p),
      })),
    };
  }

  broadcast() {
    for (const id of this.players.keys()) this.sendTo(id, this.viewFor(id));
  }
}

// ------------------------------------------------------------------ app

class MultiplayerApp {
  constructor() {
    this.roleEl = document.getElementById("role");
    this.readyBtn = document.getElementById("ready");
    this.playersEl = document.getElementById("players");
    this.messageEl = document.getElementById("message");
    this.board = new Board(
      document.getElementById("grid"),
      document.getElementById("keyboard"),
      (label) => this.press(label)
    );

    this.view = null;    // latest state from the host
    this.current = "";   // letters typed but not yet sent
    this.pending = false; // waiting for the host to answer a guess
    this.error = "";     // last error from the host
    this.ended = false;  // host left; nothing more can happen

    this.readyBtn.addEventListener("click", (e) => {
      e.currentTarget.blur();
      if (this.hostGame) this.hostGame.start();
    });

    this.board.draw([], "");
    this.connect();
  }

  // ---- finding the game: become host, or join as a guest

  connect() {
    this.setStatus("Connecting…", "Looking for a game…");
    const peer = new Peer(HOST_ID, PEER_OPTIONS);
    let isHost = false;
    peer.on("open", () => {
      isHost = true;
      this.becomeHost(peer);
    });
    peer.on("error", (err) => {
      if (!isHost && err.type === "unavailable-id") {
        peer.destroy(); // someone else is the host
        this.joinAsGuest();
      } else if (!isHost) {
        peer.destroy();
        this.retry("Can't reach the game server (" + err.type + ")");
      }
    });
  }

  retry(why) {
    if (this.ended) return;
    this.setStatus("Connecting…", why + ". Retrying…");
    setTimeout(() => this.connect(), 2000);
  }

  becomeHost(peer) {
    this.peer = peer;
    this.guests = new Map(); // peerId -> DataConnection
    this.hostGame = new HostGame(peer.id, (id, msg) => {
      if (id === peer.id) this.receive(msg); // the host's own view
      else if (this.guests.has(id)) this.guests.get(id).send(msg);
    });

    const lastHeard = new Map(); // peerId -> time of last message

    const dropGuest = (conn) => {
      if (this.guests.get(conn.peer) !== conn) return; // already dropped
      this.guests.delete(conn.peer);
      lastHeard.delete(conn.peer);
      conn.close();
      this.hostGame.removePlayer(conn.peer);
    };

    peer.on("connection", (conn) => {
      const drop = () => dropGuest(conn);
      conn.on("open", () => {
        this.guests.set(conn.peer, conn);
        lastHeard.set(conn.peer, Date.now());
        this.hostGame.addPlayer(conn.peer);
      });
      conn.on("data", (msg) => {
        lastHeard.set(conn.peer, Date.now());
        if (!msg) return;
        if (msg.type === "bye") drop();
        if (msg.type === "guess") {
          const error = this.hostGame.guess(conn.peer, msg.word);
          if (error) conn.send({ type: "error", message: error });
        }
      });
      conn.on("close", drop);
      conn.on("error", drop);
    });

    // Lost touch with the PeerJS server: existing players stay connected,
    // but reconnect so new players can still find us.
    peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });

    setInterval(() => {
      for (const [id, conn] of this.guests) {
        if (Date.now() - lastHeard.get(id) > SILENCE_LIMIT_MS) dropGuest(conn);
        else conn.send({ type: "ping" });
      }
    }, PING_EVERY_MS);

    window.addEventListener("pagehide", () => {
      for (const conn of this.guests.values()) conn.send({ type: "bye" });
    });
  }

  joinAsGuest() {
    const peer = new Peer(PEER_OPTIONS); // random ID
    this.peer = peer;
    let opened = false;

    peer.on("open", () => {
      const conn = peer.connect(HOST_ID, { reliable: true });
      this.conn = conn;

      // The host's ID can stay claimed for a while after the host has
      // gone. If we can't connect, start over (and maybe become host).
      const giveUp = setTimeout(() => {
        if (!opened) { peer.destroy(); this.retry("No answer from the host"); }
      }, JOIN_TIMEOUT_MS);

      conn.on("open", () => {
        opened = true;
        clearTimeout(giveUp);
        this.lastHeard = Date.now();
        this.watchdog = setInterval(() => {
          if (Date.now() - this.lastHeard > SILENCE_LIMIT_MS) this.hostLeft();
        }, 1000);
        this.heartbeat = setInterval(() => conn.send({ type: "ping" }), PING_EVERY_MS);
        window.addEventListener("pagehide", () => conn.send({ type: "bye" }));
      });
      conn.on("data", (msg) => {
        this.lastHeard = Date.now();
        if (msg && msg.type === "bye") this.hostLeft();
        else this.receive(msg);
      });
      conn.on("close", () => { if (opened) this.hostLeft(); });
    });

    peer.on("error", (err) => {
      if (opened) return;
      peer.destroy();
      // "peer-unavailable": the host left before we connected.
      this.retry(err.type === "peer-unavailable" ? "The host left" : "Connection problem (" + err.type + ")");
    });
  }

  hostLeft() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.watchdog);
    clearInterval(this.heartbeat);
    if (this.peer) this.peer.destroy();
    this.view = null;
    this.setStatus("Disconnected", "The host left. Reload the page to start a new game.");
    this.renderPlayers([]);
  }

  // ---- messages from the host (or, for the host, from its own HostGame)

  receive(msg) {
    if (!msg || this.ended) return;
    if (msg.type === "state") {
      const before = this.view ? this.view.history.length : 0;
      const newRound = this.view && msg.phase === "playing" && this.view.phase !== "playing";
      if (msg.history.length > before) { this.current = ""; this.error = ""; }
      if (newRound) { this.current = ""; this.error = ""; }
      if (msg.history.length > before || newRound) this.pending = false;
      this.view = msg;
      this.render();
    } else if (msg.type === "error") {
      this.pending = false;
      this.error = msg.message;
      this.render();
    }
  }

  // ---- your own typing

  press(label) {
    const v = this.view;
    if (!v || this.ended || v.phase !== "playing" || this.pending) return;
    if (this.myself().done) return;

    if (label === "DEL") {
      this.current = this.current.slice(0, -1);
      this.error = "";
    } else if (label === "ENTER") {
      this.pending = true;
      if (this.hostGame) {
        const error = this.hostGame.guess(this.peer.id, this.current);
        if (error) this.receive({ type: "error", message: error });
      } else {
        this.conn.send({ type: "guess", word: this.current });
      }
      return;
    } else if (this.current.length < WORD_LENGTH) {
      this.current += label.toLowerCase();
      this.error = "";
    }
    this.render();
  }

  myself() {
    return this.view.players.find((p) => p.id === this.view.you);
  }

  // ---- drawing

  setStatus(role, message) {
    this.roleEl.textContent = role;
    this.messageEl.textContent = message;
    this.readyBtn.hidden = true;
  }

  render() {
    const v = this.view;
    if (!v) return;
    const me = this.myself();
    const isHost = v.you === v.hostId;

    this.roleEl.textContent = (isHost ? "Host" : "Guest") + " · " + me.name;
    this.roleEl.classList.toggle("is-host", isHost);
    this.readyBtn.hidden = !isHost || v.phase === "playing";
    this.readyBtn.textContent = v.phase === "lobby" ? "Start game" : "New round";

    this.board.draw(v.history, this.current);
    this.messageEl.textContent = this.messageFor(v, me, isHost);
    this.renderPlayers(v.players);
  }

  messageFor(v, me, isHost) {
    if (v.phase === "lobby") {
      return isHost ? "Press Start game when everyone's here." : "Waiting for the host to start…";
    }
    if (v.phase === "over") {
      const word = " The word was " + v.target.toUpperCase() + ".";
      const next = isHost ? " Press New round." : " Waiting for the host…";
      if (!v.winner) return "Nobody got it." + word + next;
      const who = v.winner === v.you ? "You" : v.winnerName;
      return who + " won in " + v.winnerGuesses + "!" + word + next;
    }
    if (this.error) return this.error;
    if (me.done) return "Out of guesses. Waiting for the others…";
    return "";
  }

  renderPlayers(players) {
    this.playersEl.textContent = "";
    for (const p of players) {
      const li = document.createElement("li");
      li.className = "player";

      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = p.name +
        (p.id === this.view.hostId ? " (host)" : "") +
        (p.id === this.view.you ? " (you)" : "");
      li.appendChild(name);

      // A tiny board of colors only.
      const mini = document.createElement("div");
      mini.className = "mini";
      for (let row = 0; row < MAX_GUESSES; row++) {
        for (let col = 0; col < WORD_LENGTH; col++) {
          const cell = document.createElement("span");
          const score = p.scores[row];
          cell.className = score ? "cell " + SCORE_CLASS[score[col]] : "cell";
          mini.appendChild(cell);
        }
      }
      li.appendChild(mini);
      this.playersEl.appendChild(li);
    }
  }
}

// ------------------------------------------------------------------ startup

new Music(document.getElementById("music"));

if (typeof Peer === "undefined") {
  document.getElementById("message").textContent =
    "Could not load PeerJS, so multiplayer can't start.";
} else {
  loadWords()
    .then(() => new MultiplayerApp())
    .catch((err) => {
      document.getElementById("message").textContent =
        "Could not load words.txt (" + err.message + ")";
    });
}
