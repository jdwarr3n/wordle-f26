// Single-player Wordle for the web, ported from wordle_tkinter.py.
// Game rules, board and music live in common.js.

"use strict";

class WordleApp {
  constructor() {
    this.messageEl = document.getElementById("message");
    this.board = new Board(
      document.getElementById("grid"),
      document.getElementById("keyboard"),
      (label) => this.press(label)
    );

    document.getElementById("new-game").addEventListener("click", (e) => {
      e.currentTarget.blur(); // so Enter doesn't re-press the button
      this.newGame();
    });

    this.newGame();
  }

  newGame() {
    this.game = new WordleGame();
    this.current = "";
    this.message = "";
    this.draw();
  }

  press(label) {
    if (this.game.over()) return;
    if (label === "DEL") {
      this.current = this.current.slice(0, -1);
      this.message = "";
    } else if (label === "ENTER") {
      const error = this.game.guess(this.current);
      if (error) {
        this.message = error;
      } else {
        this.current = "";
        if (this.game.won) {
          this.message = "Solved in " + this.game.history.length + "!";
        } else if (this.game.over()) {
          this.message = "The word was " + this.game.target.toUpperCase();
        } else {
          this.message = "";
        }
      }
    } else if (this.current.length < WORD_LENGTH) {
      this.current += label.toLowerCase();
      this.message = "";
    }
    this.draw();
  }

  draw() {
    this.board.draw(this.game.history, this.current);
    this.messageEl.textContent = this.message;
  }
}

// ------------------------------------------------------------------ startup

new Music(document.getElementById("music"));

loadWords()
  .then(() => new WordleApp())
  .catch((err) => {
    document.getElementById("message").textContent =
      "Could not load words.txt (" + err.message + ")";
  });
