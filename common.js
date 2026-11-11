// Code shared by the single-player page (wordle.js) and the
// multiplayer page (multiplayer.js): game rules, the board and
// keyboard display, word list loading, and background music.

"use strict";

// ------------------------------------------------------------------ engine
// (same rules and scoring as wordle_tkinter.py)

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const STRICT_WORDS = true; // Reject guesses that are not in WORDS

const GREEN = "G";
const YELLOW = "Y";
const GRAY = ".";

let WORDS = [];
let WORD_SET = new Set();

/** Return a 5-char string of G/Y/. for guess against target. */
function scoreGuess(guess, target) {
  const result = new Array(WORD_LENGTH).fill(GRAY);
  const remaining = target.split("");
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === target[i]) {
      result[i] = GREEN;
      remaining[i] = null;
    }
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === GREEN) continue;
    const j = remaining.indexOf(guess[i]);
    if (j !== -1) {
      result[i] = YELLOW;
      remaining[j] = null;
    }
  }
  return result.join("");
}

function randomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

/** Return an error message for an unacceptable guess, or null. */
function checkWord(guess) {
  if (guess.length !== WORD_LENGTH || !/^[a-z]+$/.test(guess)) {
    return "Need " + WORD_LENGTH + " letters";
  }
  if (STRICT_WORDS && !WORD_SET.has(guess)) return "Not in word list";
  return null;
}

class WordleGame {
  constructor(target) {
    this.target = target || randomWord();
    this.history = []; // list of [guess, score]
    this.won = false;
  }

  over() {
    return this.won || this.history.length >= MAX_GUESSES;
  }

  validate(guess) {
    if (this.over()) return "Game over";
    return checkWord(guess);
  }

  guess(guess) {
    const error = this.validate(guess);
    if (error) return error;
    const score = scoreGuess(guess, this.target);
    this.history.push([guess, score]);
    if (score === GREEN.repeat(WORD_LENGTH)) this.won = true;
    return null;
  }
}

async function loadWords() {
  const response = await fetch("words.txt");
  if (!response.ok) throw new Error("HTTP " + response.status);
  const text = await response.text();
  WORDS = text
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
  WORD_SET = new Set(WORDS);
}

// ------------------------------------------------------------------ board

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "DEL"],
];

// CSS class for each score letter ("." is not a valid class name)
const SCORE_CLASS = { [GREEN]: "G", [YELLOW]: "Y", [GRAY]: "gray" };

/** Best result seen for each letter: 3 = green, 2 = yellow, 1 = gray. */
function letterStatus(history) {
  const rank = { [GREEN]: 3, [YELLOW]: 2, [GRAY]: 1 };
  const status = {};
  for (const [word, score] of history) {
    for (let i = 0; i < WORD_LENGTH; i++) {
      status[word[i]] = Math.max(status[word[i]] || 0, rank[score[i]]);
    }
  }
  return status;
}

/**
 * The 6x5 grid and on-screen keyboard. Calls onPress(label) for each
 * key ("A".."Z", "ENTER", "DEL"), whether clicked or typed.
 */
class Board {
  constructor(gridEl, keyboardEl, onPress) {
    this.gridEl = gridEl;
    this.keyboardEl = keyboardEl;
    this.onPress = onPress;
    this.tiles = this.buildGrid();
    this.keys = this.buildKeyboard();
    document.addEventListener("keydown", (e) => this.onKeydown(e));
  }

  buildGrid() {
    const tiles = [];
    for (let row = 0; row < MAX_GUESSES; row++) {
      const rowTiles = [];
      for (let col = 0; col < WORD_LENGTH; col++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        this.gridEl.appendChild(tile);
        rowTiles.push(tile);
      }
      tiles.push(rowTiles);
    }
    return tiles;
  }

  buildKeyboard() {
    const keys = {};
    for (const row of KEY_ROWS) {
      const rowEl = document.createElement("div");
      rowEl.className = "key-row";
      for (const label of row) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = label.length > 1 ? "key wide" : "key";
        key.textContent = label;
        key.addEventListener("click", (e) => {
          e.currentTarget.blur();
          this.onPress(label);
        });
        rowEl.appendChild(key);
        keys[label] = key;
      }
      this.keyboardEl.appendChild(rowEl);
    }
    return keys;
  }

  onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      this.onPress("DEL");
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.onPress("ENTER");
    } else if (/^[a-zA-Z]$/.test(e.key)) {
      this.onPress(e.key.toUpperCase());
    }
  }

  /** history: list of [word, score]; current: letters typed so far. */
  draw(history, current) {
    for (let row = 0; row < MAX_GUESSES; row++) {
      for (let col = 0; col < WORD_LENGTH; col++) {
        const tile = this.tiles[row][col];
        if (row < history.length) {
          const [word, score] = history[row];
          tile.className = "tile " + SCORE_CLASS[score[col]];
          tile.textContent = word[col];
        } else if (row === history.length && col < current.length) {
          tile.className = "tile typed";
          tile.textContent = current[col];
        } else {
          tile.className = "tile";
          tile.textContent = "";
        }
      }
    }

    const status = letterStatus(history);
    const rankClass = { 3: "G", 2: "Y", 1: "gray" };
    for (const [label, key] of Object.entries(this.keys)) {
      const base = label.length > 1 ? "key wide" : "key";
      const cls = rankClass[status[label.toLowerCase()]];
      key.className = cls ? base + " " + cls : base;
    }
  }
}

// ------------------------------------------------------------------ music

const MUSIC_CLIPS = [
  "audio/claw-ingame-part1.mp3",
  "audio/claw-ingame-part2.mp3",
];

class Music {
  constructor(button) {
    const clip = MUSIC_CLIPS[Math.floor(Math.random() * MUSIC_CLIPS.length)];
    this.audio = new Audio(clip);
    this.audio.loop = true;
    this.button = button;
    this.started = false;

    // Try to play right away. Most browsers block sound until the player
    // clicks, taps or presses a key, so if that fails, start on the first
    // interaction instead.
    const start = () => {
      if (this.started) return;
      this.started = true;
      this.audio.play().catch(() => { this.started = false; });
    };
    start();
    for (const type of ["keydown", "pointerdown", "pointerup", "touchend", "click"]) {
      document.addEventListener(type, start);
    }

    button.addEventListener("click", (e) => {
      e.currentTarget.blur();
      this.audio.muted = !this.audio.muted;
      this.updateButton();
    });
    this.updateButton();
  }

  updateButton() {
    this.button.textContent = this.audio.muted ? "Music: off" : "Music: on";
    this.button.setAttribute("aria-pressed", String(!this.audio.muted));
  }
}
