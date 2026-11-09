# Chess Coach

A Chrome extension for **studying** on Lichess and Chess.com. Open an analysis board, a finished game, a solved
puzzle, or a game vs the computer, and the side panel shows:

- **Human move**: a strong move a player at your chosen level (800–2400) would actually find, with plain-English
  reasons (wins material, fork, stops their threat, develops, takes the open file…) and the plan that follows.
- **Engine's best**, when it differs, and a couple of other good moves.
- **Their threat**: what the opponent would do if it were their move.
- **Tempting mistake**: a natural-looking move a weaker player might play (grabs a pawn, gives check, attacks
  something) that's worse, with why it's tempting and what goes wrong. Only inaccuracies and mistakes
  (0.6 to 2.5 pawns worse) are shown; game-losing blunders and moves that walk into mate aren't. Turn it off with
  the **Mistakes** checkbox.
- **Accuracy**: a running score for each side as the game goes (the same idea as Chess.com's and Lichess'
  accuracy: how much of your winning chances each move kept), with a colored square per move and counts of
  best / good / inaccuracies / mistakes / blunders. It follows the line on the board: step back and it shows the
  score up to that move, step forward and the later moves come back. Works while you play the computer and while
  you go through a game or an analysis line. Like the rest of the coach, it's off during live games.
- **Last move review**: step through a game and each move gets graded (Best / Good / Inaccuracy / Mistake /
  Blunder), with what was better and how the mistake gets punished.
- Arrows on the site's board: green = human move, blue = engine best, orange dotted = tempting mistake,
  red dashed = their threat. Each one has its own line style as well as its own color, so they can be told apart
  even with red-green color blindness.
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
send the position at all. It's on for analysis boards, studies, the board editor, finished games, solved Lichess
puzzles, and games vs the computer. Any page it doesn't recognise stays off.

To debug the board reader, use an analysis board or a finished game: they use the same board markup as live
games. `test/mock-pages.mjs` builds fake pages from any FEN for the browser test.

## Install

1. Download the latest `chess-coach` zip from the Releases page and unzip it.
2. In Chrome, go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the
   unzipped `chess-coach` folder.
3. Pin the extension, open e.g. `lichess.org/analysis`, and click the icon to open the side panel.

Stockfish is already included in `engine\`, so there is nothing else to install.

## iPhone

There's no side panel on iPhone, so there the panel slides up from the bottom of the Lichess / Chess.com page
instead. A green **♞** button in the bottom-right corner opens it (it only shows where the coach is allowed to
run, never in a live game). The bar on top of the panel has **▴** (bigger / smaller), **–** (tuck it away while
it keeps analysing) and **✕** (close it; that also stops the engine to save battery). On phones it runs one
Stockfish worker with a small hash table, since iOS closes extensions that use a lot of memory. Desktop Chrome
is unchanged.

Two ways to install it:

**Orion browser (no Mac needed).** Orion is a free iPhone browser from Kagi that can run Chrome extensions.
Its extension support is still in beta, so some things may not work.
1. Install **Orion Browser by Kagi** from the App Store.
2. Get the iPhone zip (`chess-coach-iphone-v0.5.0.zip`) onto the phone, e.g. save it to the Files app.
3. In Orion: **•••** > **Extensions** > **+** and pick the zip. If it asks, first turn on installing
   third-party extensions in Orion's settings.
4. Open lichess.org in Orion and tap the **♞** button.

**Safari (needs a Mac with Xcode).** Apple only installs Safari extensions as part of an app.
1. On the Mac: `sh scripts/build-ios.sh`, then follow what it prints (open the Xcode project, choose your Apple
   ID under Signing, plug in the iPhone, press Run).
2. On the iPhone: **Settings > Apps > Safari > Extensions > Chess Coach**, turn it on and allow it on lichess.org
   and chess.com.
3. In Safari, open lichess.org and tap the **♞** button (or the extension in Safari's menu).
With a free Apple ID the app has to be re-run from Xcode every 7 days; a paid developer account ($99/year) lasts
a year and allows TestFlight.

To try the iPhone layout in desktop Chrome, run `chrome.storage.local.set({ forceInPagePanel: true })` in the
extension's service worker console and reload the page.

## Development

- `npm test`: all the logic tests (whose turn, coach, tactics, tempting mistakes, and every opening line and trap
  move by move). They use the built-in backup engine, so they run without a browser.
- `npm run test:browser`: loads the extension in Chrome against fake Lichess / Chess.com pages, on desktop and
  in the iPhone layout (`test/iphone.test.mjs`, Chrome pretending to be an iPhone). Needs Playwright;
  set `CHROME=/path/to/chrome` and/or `PLAYWRIGHT=/path/to/playwright` if they aren't in the default places.
  `SHOT=out/panel.png` also saves screenshots.

Third-party: chess.js (BSD-2-Clause, `lib/chess.js.LICENSE`); Stockfish (GPLv3), included in `engine\` (`engine/STOCKFISH-LICENSE.txt`; source at https://github.com/nmrugg/stockfish.js).
