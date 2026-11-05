# Chess Coach

A Chrome extension for **studying** on Lichess and Chess.com. Open an analysis board, a finished game, a solved
puzzle, or a game vs the computer, and the side panel shows:

- **Human move**: a strong move a player at your chosen level (800–2400) would actually find, with plain-English
  reasons (wins material, fork, stops their threat, develops, takes the open file…) and the plan that follows.
- **Engine's best**, when it differs, and a couple of other good moves.
- **Their threat**: what the opponent would do if it were their move.
- **Last move review**: step through a game and each move gets graded (Best / Good / Inaccuracy / Mistake /
  Blunder), with what was better and how the mistake gets punished.
- Arrows on the site's board: green = human move, blue = engine best, red dashed = their threat.
- **Badges**: *Brilliant!!* (a sound sacrifice that isn't obvious), *Only move* (everything else is much worse),
  *Trap* (their most tempting reply loses, and it tells you how you punish it).
- **Puzzle mode**: when there's a tactic, it tells you there's one (and the theme), hides the answer, and gives a
  hint or the solution when you ask.
- **Keeps up with fast moves**: waits for pieces to finish sliding before reading the board, and cancels any
  search in progress the moment a new position appears. Premove highlights aren't mistaken for the last move.
- **To move: Auto / White / Black**: Auto reads whose turn it is from the last-move highlight (or, if that's
  unclear, from the previous position); pick White or Black to set it yourself, e.g. for a set-up position.
- **Opening card**: names the opening you're in and the next book move with why.
- **Openings tab**: recommended openings for White and Black at your level, each with a clickable move list on a
  mini board, notes on the key moves, the ideas, the plans after the opening, and famous traps (to set or avoid).
  "Open on Lichess" opens the position on Lichess' analysis board.

**It turns itself off during live and daily games**, and in unsolved puzzles. While it's off, it doesn't read or
send the position at all.

## Install

1. Download `chess-coach-v3.zip` from the Releases page and unzip it.
2. In Chrome, go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the
   unzipped `chess-coach` folder.
3. Pin the extension, open e.g. `lichess.org/analysis`, and click the icon to open the side panel.

Stockfish is already included in `engine\`, so there is nothing else to install.

## Development

- `node test/turn.test.mjs`: whose-turn logic.
- `npm test`: coach logic tests (uses the built-in engine); also `node test/tactics.test.mjs` and
  `node test/openings.test.mjs` (checks every opening line and trap move by move).
- `node test/browser.test.mjs`: loads the extension in Chrome against fake Lichess / Chess.com pages.

Third-party: chess.js (BSD-2-Clause, `lib/chess.js.LICENSE`); Stockfish (GPLv3), included in `engine\` (`engine/STOCKFISH-LICENSE.txt`; source at https://github.com/nmrugg/stockfish.js).
