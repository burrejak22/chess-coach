# Chess Coach

Chrome extension for **studying** on Lichess and Chess.com. Open an analysis board, a finished game, a solved puzzle, or a game vs the computer. The side panel tells you:

- **Human move**. A move a player at your chosen level (800 to 2400) would actually find, with plain-English reasons (wins material, fork, stops their threat, develops, takes the open file) and the plan that follows.
- **Engine's best** when it differs, plus a couple of other good moves.
- **Their threat**. What the opponent would do if it were their move.
- **Last move review**. Each move you play gets graded (Best / Good / Inaccuracy / Mistake / Blunder) with what was better and how the mistake gets punished.
- **Arrows on the board**. Green for the human move, blue for engine best, purple dotted for a tempting inaccuracy (what a normal player might fall into), gold for a Brilliant / Great / Only-move find, red dashed for the opponent's threat.
- **Badges**. *Brilliant!!* (sound sacrifice that isn't obvious), *Great!* (the top move is clearly ahead of the pack and not obvious), *Only move* (everything else is much worse), *Trap* (their most tempting reply loses, with the punishment).
- **Puzzle mode**. When there's a tactic, it tells you one is there (and the theme), hides the answer, hands you a hint or the solution when you ask.
- **Keeps up with fast moves**. Waits for pieces to finish sliding before reading the board, cancels any search in progress the moment a new position appears. Premove highlights aren't mistaken for the last move.
- **To move: Auto / White / Black**. Auto reads whose turn it is from the last-move highlight (or, if that's unclear, from the previous position). Pick White or Black to override, e.g. for a set-up position.
- **Opening card**. Names the opening you're in and the next book move with why.
- **Openings tab**. Recommended openings for White and Black at your level, each with a clickable move list on a mini board, notes on the key moves, the ideas, the plans after the opening, and famous traps (to set or avoid). "Open on Lichess" opens the position on Lichess' analysis board.

**It turns itself off during live and daily games**, and in unsolved puzzles. While it's off, it doesn't read or send the position at all.

## How it's fast

Stockfish runs across a small Web Worker pool, so trap and mistake probes chew through the position in parallel instead of queueing behind each other. Decided positions (forced mate or eval past +/-4.00) skip the probe stage entirely.

## Install

1. Download the latest release zip from the Releases page and unzip it.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the unzipped folder (the one that actually contains `manifest.json`, not a wrapper folder around it).
3. Pin the extension, open e.g. `lichess.org/analysis`, click the icon to open the side panel.

Stockfish is bundled in `engine/`. Nothing else to install.

## Development

- `node test/turn.test.mjs`. Whose-turn logic.
- `npm test`. Coach logic tests (uses the built-in engine). Also runs `node test/tactics.test.mjs` and `node test/openings.test.mjs` (checks every opening line and trap move by move).
- `node test/browser.test.mjs`. Loads the extension in Chrome against fake Lichess / Chess.com pages.

## Third-party

chess.js (BSD-2-Clause, see `lib/chess.js.LICENSE`). Stockfish (GPLv3), bundled in `engine/` (`engine/STOCKFISH-LICENSE.txt`, source at https://github.com/nmrugg/stockfish.js).
