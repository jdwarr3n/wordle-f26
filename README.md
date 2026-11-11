# Wordle F26: a game, music, and multiplayer

A small Wordle-style word game, built step by step with an AI coding assistant ("vibe coding"). It's meant as a worked example for students who want to see how a simple game grows:

1. **A basic game:** a desktop Python program turned into a web page.
2. **Music:** looping background music, plus the browser rules you have to work around.
3. **Multiplayer:** several people racing on the same word, with no server of your own.

**Play it:**
- Single player: https://jdwarr3n.github.io/wordle-f26/
- Multiplayer race: https://jdwarr3n.github.io/wordle-f26/multiplayer.html

---

## What's in the repo

| File | What it is |
| --- | --- |
| `wordle_tkinter.py` | The original desktop version in Python (tkinter). The starting point. |
| `words.txt` | 2,315 five-letter words, one per line. Used for both secret words and checking guesses. |
| `index.html` | The single-player page. |
| `multiplayer.html` | The multiplayer race page. |
| `common.js` | Code both pages share: scoring, the board and keyboard, loading the word list, music. |
| `wordle.js` | Single-player game logic. |
| `multiplayer.js` | Multiplayer logic: finding the game, host and guest roles, messages. |
| `style.css` | All the styling, including phone layouts. |
| `audio/` | Two 60-second music clips. One is picked at random. |

There's no build step and no framework: plain HTML, CSS and JavaScript. GitHub Pages serves the files exactly as they are.

---

## Make your own copy

1. **Copy the repo.** On GitHub, click **Fork** at the top of this repo to make a copy under your account. Or clone it and push it to a new repo of your own:

    ```bash
    git clone https://github.com/jdwarr3n/wordle-f26.git
    ```

2. **Change the multiplayer ID.** Open `multiplayer.js` and find this line near the top:

    ```js
    const GAME_ID = "jdwarr3n-wordle";
    ```

    Change `jdwarr3n` to **your** GitHub username, for example `"octocat-wordle"`. **Don't skip this step.** If you keep `jdwarr3n-wordle`, your players will join the original game instead of yours.

3. **Commit and push** the change. You can also edit the file right on GitHub: open it, click the pencil icon, then **Commit changes**.

4. **Turn on GitHub Pages** (see [Publishing with GitHub Pages](#publishing-with-github-pages)). Your game will be at `https://<username>.github.io/wordle-f26/`.

---

## Part 1: The basic game

### Porting Python to the web

The game started as `wordle_tkinter.py`. The web version keeps the same structure, so you can read the two side by side:

| Python (`wordle_tkinter.py`) | JavaScript (`common.js`, `wordle.js`) |
| --- | --- |
| `score_guess(guess, target)` | `scoreGuess(guess, target)` |
| `class WordleGame` | `class WordleGame` |
| `WordleApp.press()` | `WordleApp.press()` |
| `letter_status()` | `letterStatus()` |
| tkinter `Canvas` drawing | HTML `<div>` tiles and `<button>` keys, styled with CSS |

**Scoring is the one tricky part.** Repeated letters are where most Wordle clones go wrong. The function makes two passes: first it marks exact matches green, then it marks yellows only from the letters still unused. The JavaScript version was checked against the Python version on 20,000 random word pairs and gave the same answer every time.

### Publishing with GitHub Pages

1. Put `index.html` at the top level of the repo.
2. On GitHub, go to **Settings → Pages**, set Source to **Deploy from a branch**, and choose **main** and **/ (root)**.
3. A minute later the site is live at `https://<username>.github.io/<repo>/`.

### Running it on your own computer

Double-clicking `index.html` **won't work**. The page loads `words.txt` with `fetch()`, and browsers block that for pages opened as files. Run a tiny web server in the repo folder instead:

```bash
python3 -m http.server
```

Then open http://localhost:8000.

### Lesson: browser caching

After an update, the music button did nothing. The browser had loaded the **new** `index.html` with an **old, cached** copy of the JavaScript, which didn't have the music code yet. A hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on a Mac) fixed it, but your players won't know to do that.

The permanent fix is a version number on each file link:

```html
<script src="common.js?v=5"></script>
```

When a `.js` or `.css` file changes, bump its number. The browser sees a new address and downloads the new file.

---

## Part 2: Adding music

The original MP3 was 2 minutes 11 seconds: silence, a 60-second section, a gap, another 60-second section, then more silence. `ffmpeg` found the silent parts and cut out the two sections:

```bash
ffmpeg -i claw-ingame.mp3 -af silencedetect=n=-70dB:d=0.3 -f null -
ffmpeg -i claw-ingame.mp3 -ss 4.757 -to 64.795 -c:a libmp3lame -b:a 192k audio/claw-ingame-part1.mp3
```

Playing it takes only a few lines (see `Music` in `common.js`):

```js
const audio = new Audio(randomClip);
audio.loop = true;   // repeat forever
audio.play();        // only allowed after the player clicks or types
```

### Lesson: browsers block autoplay

Browsers won't let a page play sound until the person has clicked, tapped or pressed a key. Early versions tried to work around this by starting the music on the first key press. That got complicated, and Safari on iPhones has its own stricter rules. The final version is simpler and friendlier: **music starts off**, and a button turns it on.

> **About the music:** the clips here are placeholders. If you build your own game, use music you made or music whose license allows it, especially in a public repo.

---

## Part 3: Multiplayer

### The problem

GitHub Pages only serves files. There's no server running your code, so nothing can pass moves between players. The fix is **WebRTC**, a browser feature that lets browsers connect **directly to each other**. This project uses the [PeerJS](https://peerjs.com/) library, which makes WebRTC much easier and provides a free public server to help browsers find each other.

### Finding each other without sharing links

Every player tries to claim the same PeerJS ID:

```js
const peer = new Peer("jdwarr3n-wordle");  // same ID for everyone
peer.on("open", () => becomeHost());                 // I got it: I'm the host
peer.on("error", err => {
  if (err.type === "unavailable-id") joinAsGuest();  // taken: join the host
});
```

1. The first person to open the page gets the ID and becomes the **host**.
2. Everyone after that is told the ID is taken, so they connect to it as a **guest**.

Nobody shares a link. The catch is that everyone using the same ID shares one game. That's why **each copy of this project needs its own ID** (see [Make your own copy](#make-your-own-copy)). To run separate games from one copy, add `?room=name` to the address, for example `multiplayer.html?room=period3`. That uses the ID `jdwarr3n-wordle-period3`.

### The host is in charge

All guests connect to the host, and only to the host (a "star" layout):

```
Guest 2 ──"guess crane"──▶ Host  (checks the word and scores it)
Guest 3 ◀──new state───────┘
Guest 2 ◀──new state───────┘
```

- **The host decides everything.** It picks the secret word, checks each guess is a real word, scores it, and sends every player the updated game.
- **Guests only send guesses** and redraw whatever the host sends back.
- **Guests never get the secret word** until the round ends. They also see other players' colors but never their letters. (The host could peek, since the word lives in their browser. That's a trade-off of this simple design.)

The messages are plain JavaScript objects, listed at the top of `multiplayer.js`:

| Message | Direction | Meaning |
| --- | --- | --- |
| `{type: "guess", word}` | guest → host | "Here's my guess." |
| `{type: "state", ...}` | host → guest | The whole game, as this player is allowed to see it. |
| `{type: "error", message}` | host → guest | "Not in word list," and so on. |
| `{type: "ping"}` | both ways | "I'm still here," every 3 seconds. |
| `{type: "bye"}` | both ways | "I'm closing my tab." |

### How a game runs

- The host sees a **Host** label and a **Start game** button (**New round** after each round). Guests wait for the host.
- Everyone races on the same word. The first to solve it wins the round.
- Each player's record is shown as **Wins won/played**. A round counts as played only if the player guessed in it.
- **Joining mid-round is fine.** The new player gets an empty board and starts guessing.
- **When a guest leaves,** they disappear from the list. If the host leaves, the game ends, and the next person to load the page becomes host.

### Lessons from building it

These all came up while building this project, and they're worth knowing before you try your own:

1. **Two players is easy; three is where it breaks.** Two-player code usually keeps one connection in one variable (`let conn`). A third player overwrites it, and someone silently stops getting updates. The host here keeps a **`Map` of every connection** and sends updates to all of them, so 2 players or 8 work the same way.

2. **Closed tabs aren't always reported.** A browser may never tell you a connection closed, especially after a crash or a sleeping laptop. So everyone sends a `ping` every 3 seconds, anyone silent for 10 seconds is treated as gone, and a closing page sends `bye` so the others notice right away.

3. **The host-only bug.** At first, guests worked but the host could only enter one word. The host's screen was given the game's actual list of guesses, not a copy. When the list changed, the "before" and "after" were the same list, so the page never noticed the guess went through. The fix was to send the host a copy, like guests effectively get over the network. Watch out for **shared references** in JavaScript: two variables can point at the same array.

4. **Test with real multiple players.** The automated tests ran four browser windows at once against a local PeerJS server. Opening several tabs yourself is the quickest manual test. Before using it with a class, also try a phone on cellular data, since some school and work networks block direct browser connections.

### Things to try

- Let players pick a name instead of "Player 1."
- Show a countdown before each round.
- Add a "hard mode," where hints you've found must be used in later guesses.
- Keep the win records in the browser's `localStorage`, so they survive a reload.
- Move the host's job to the next player in line when the host leaves. (Hard! Read the comments in `multiplayer.js` first.)

---

## Tips for vibe coding a project like this

- **Start from something that works.** This project began with a working Python game and changed one thing at a time: port it, publish it, add music, add multiplayer.
- **Describe what you see, not just "it's broken."** "The music button doesn't toggle" and "the host can only enter one word" each led straight to the cause.
- **Ask the AI to test, not just write.** Most of the bugs here were caught by having the AI play the game in automated browser windows, with several players at once for multiplayer.
- **Ask "how would this work?" before "build it."** Talking through the multiplayer design first (who's the host, what happens when someone leaves) kept the result simple.
- **Push back when it's too complicated.** An early plan included moving the host role to another player when the host leaves. It was cut, because a simple version that works beats a clever one that doesn't.
