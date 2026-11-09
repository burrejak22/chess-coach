// Loads the real extension in Chrome, serves fake Lichess / Chess.com pages, and checks what the coach does.
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lichessPage, chessComPage } from './mock-pages.mjs';

// Playwright & Chrome locations can be overridden: PLAYWRIGHT=/path/to/playwright CHROME=/path/to/chrome
const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const id of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(id); } catch { /* try the next one */ }
  }
  throw new Error('Playwright not found. Run "npm i -D playwright" or set PLAYWRIGHT=/path/to/playwright');
};
const { chromium } = loadPlaywright();

const extension = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${JSON.stringify(detail)?.slice(0, 400)}`}`);
  if (!cond) fails += 1;
};

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'cc-')), {
  executablePath: process.env.CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined),
  headless: true,
  args: [
    '--headless=new',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
  ],
});

let [worker] = context.serviceWorkers();
worker = worker || await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = worker.url().split('/')[2];

// collect every board message the content scripts send
await worker.evaluate(() => {
  globalThis.boardMessages = [];
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (m?.type === 'cc:board') globalThis.boardMessages.push({ ...m, tabUrl: sender.tab?.url });
  });
});

const pages = new Map();
await context.route(/^https:\/\/(lichess\.org|www\.chess\.com)\/.*/, (route) => {
  const url = route.request().url();
  route.fulfill({ status: 200, contentType: 'text/html', body: pages.get(url) || '<html><body>not mocked</body></html>' });
});

const latestFor = async (url) => {
  for (let i = 0; i < 40; i += 1) {
    const msgs = await worker.evaluate(() => globalThis.boardMessages);
    const mine = msgs.filter((m) => m.url === url);
    if (mine.length) return mine[mine.length - 1];
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};

const visit = async (url, html) => {
  pages.set(url, html);
  const page = await context.newPage();
  await page.goto(url);
  return { page, msg: await latestFor(url) };
};

// --- Lichess analysis board, after 1.e4 e5 2.Qh5 (Black to move; the last move was Qh5)
const fen1 = 'rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2';
let { page: lichess, msg } = await visit('https://lichess.org/analysis', lichessPage(fen1, { lastMove: ['d1', 'h5'] }));
check('Lichess analysis: allowed', msg?.gate?.allowed === true, msg?.gate);
check('Lichess analysis: reads the position & side to move', msg?.fen?.startsWith('rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq -'), msg?.fen);

// --- flipped board reads the same
({ msg } = await visit('https://lichess.org/analysis/flipped', lichessPage(fen1, { orientation: 'black', lastMove: ['d1', 'h5'] })));
check('Lichess flipped board: same FEN', msg?.fen?.startsWith('rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b'), msg?.fen);

// --- Lichess live game: must be blocked and must not leak the FEN
({ msg } = await visit('https://lichess.org/abcdEFGH', lichessPage(fen1, { lastMove: ['d1', 'h5'], extra: '<div class="rclock running"></div>' })));
check('Lichess live game: blocked', msg?.gate?.allowed === false, msg?.gate);
check('Lichess live game: no position sent', msg?.fen === null, msg?.fen);

// --- Lichess finished game: allowed
({ msg } = await visit('https://lichess.org/zyxwVUTS', lichessPage(fen1, { lastMove: ['d1', 'h5'], extra: '<div class="result-wrap"><span class="result">1-0</span></div>' })));
check('Lichess finished game: allowed', msg?.gate?.allowed === true && msg?.gate?.mode === 'Finished game', msg?.gate);

// --- Lichess puzzle not solved yet: blocked
({ msg } = await visit('https://lichess.org/training/abc12', lichessPage(fen1, {})));
check('Lichess unsolved puzzle: blocked', msg?.gate?.allowed === false, msg?.gate);

// --- Chess.com analysis, flipped, en passant after ...d5
const fen2 = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
({ msg } = await visit('https://www.chess.com/analysis', chessComPage(fen2, { flipped: true, lastMove: ['d7', 'd5'] })));
check('Chess.com analysis: allowed', msg?.gate?.allowed === true, msg?.gate);
check('Chess.com analysis: reads position, side to move & en passant', msg?.fen?.startsWith('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6'), msg?.fen);

// --- Chess.com live game in progress: blocked
({ msg } = await visit('https://www.chess.com/game/live/123456', chessComPage(fen2, { lastMove: ['d7', 'd5'], extra: '<div class="clock-component clock-player-turn"></div>' })));
check('Chess.com live game: blocked', msg?.gate?.allowed === false && msg?.fen === null, msg);

// --- Chess.com live game that's over: allowed
({ msg } = await visit('https://www.chess.com/game/live/999', chessComPage(fen2, { lastMove: ['d7', 'd5'], extra: '<div class="game-over-modal-content">White won</div>' })));
check('Chess.com finished game: allowed', msg?.gate?.allowed === true, msg?.gate);

// --- Chess.com puzzles: blocked
({ msg } = await visit('https://www.chess.com/puzzles/rated', chessComPage(fen2, {})));
check('Chess.com puzzles: blocked', msg?.gate?.allowed === false, msg?.gate);

// --- Lichess vs the built-in AI: allowed
({ msg } = await visit('https://lichess.org/aiGame12', lichessPage(fen1, { lastMove: ['d1', 'h5'], extra: '<div class="ruser-top ruser"><name>Stockfish level 3</name></div>' })));
check('Lichess vs Stockfish: allowed', msg?.gate?.allowed === true && msg?.gate?.mode === 'Vs computer', msg?.gate);

// --- Chess.com online play: blocked
({ msg } = await visit('https://www.chess.com/play/online', chessComPage(fen2, { lastMove: ['d7', 'd5'] })));
check('Chess.com online play: blocked', msg?.gate?.allowed === false && msg?.fen === null, msg?.gate);

// --- fast moves: nothing is read while a piece is mid-animation, then the final square is picked up
const animUrl = 'https://lichess.org/analysis/anim';
const { page: animPage } = await visit(animUrl, lichessPage('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {}));
const countFor = async (url) => (await worker.evaluate(() => globalThis.boardMessages)).filter((m) => m.url === url).length;
const before = await countFor(animUrl);
await animPage.evaluate(() => {
  // e2 pawn starts sliding toward e4 (chessground adds the "anim" class during the slide)
  const pawn = [...document.querySelectorAll('cg-board piece.white.pawn')].find((p) => p.style.transform.includes('translate(256px, 384px)'));
  pawn.classList.add('anim');
  pawn.style.transform = 'translate(256px, 330px)';
});
await new Promise((r) => setTimeout(r, 400));
const midAnim = await countFor(animUrl);
await animPage.evaluate(() => {
  const pawn = document.querySelector('cg-board piece.anim');
  pawn.style.transform = 'translate(256px, 256px)';
  pawn.classList.remove('anim');
  const sq = (x, y) => { const s = document.createElement('square'); s.className = 'last-move'; s.style.transform = `translate(${x}px, ${y}px)`; return s; };
  document.querySelector('cg-board').prepend(sq(256, 384), sq(256, 256));
});
const landed = await latestFor(animUrl).then(async () => {
  for (let i = 0; i < 20; i += 1) {
    const msgs = (await worker.evaluate(() => globalThis.boardMessages)).filter((m) => m.url === animUrl);
    const last = msgs[msgs.length - 1];
    if (last?.fen?.startsWith('rnbqkbnr/pppppppp/8/8/4P3/')) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
});
check('nothing is sent mid-animation', midAnim === before, { before, midAnim });
check('picks up the move once it lands (Black to move)', landed?.fen?.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b') && landed.turnKnown, landed?.fen);

// --- premove highlights (more than two) aren't trusted for whose turn it is
({ msg } = await visit('https://www.chess.com/play/computer', chessComPage('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { lastMove: ['e2', 'e4', 'g1', 'f3'] })));
check('premove highlights: turn marked unknown', msg?.gate?.allowed && msg?.turnKnown === false, msg);

// --- end to end: side panel analyzes the Lichess analysis board and draws arrows on it
await lichess.bringToFront();
const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://lichess.org/analysis' }))[0]?.id);
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);

await panel.waitForFunction(() => !document.getElementById('human').hidden && !/thinking/.test(document.getElementById('thinking').textContent), null, { timeout: 90000 }).catch(() => {});

const panelState = await panel.evaluate(() => ({
  status: document.getElementById('status').textContent,
  eval: document.getElementById('eval').textContent,
  human: document.getElementById('human').innerText,
  threat: document.getElementById('threat').hidden ? null : document.getElementById('threat').innerText,
  engine: document.getElementById('engine-name').textContent,
}));

console.log('\n--- side panel ---\n', JSON.stringify(panelState, null, 2), '\n');
check('panel is on for the analysis board', panelState.status.includes('Lichess') && panelState.status.includes('Analysis'), panelState.status);
check('panel suggests a human move with reasons', /human move/i.test(panelState.human) && panelState.human.split('\n').length > 2, panelState.human);
check('panel spots the threat on e5 (Qxe5+)', /Qxe5/.test(panelState.threat || ''), panelState.threat);

if (process.env.SHOT) {
  await panel.setViewportSize({ width: 380, height: 760 });
  await panel.screenshot({ path: process.env.SHOT, fullPage: true });
  await lichess.screenshot({ path: process.env.SHOT.replace('.png', '-board.png') });
}

const arrowCount = await lichess.evaluate(() => document.querySelectorAll('svg[data-chess-coach] line').length);
check('arrows drawn on the board', arrowCount >= 1, arrowCount);

// --- tempting mistake: after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4, grabbing e5 with 4.Nxe5? is the classic one
const shillingFen = 'r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
pages.set('https://lichess.org/analysis/shilling', lichessPage(shillingFen, { lastMove: ['c6', 'd4'] }));
await lichess.goto('https://lichess.org/analysis/shilling');
await panel.waitForFunction(() => !document.getElementById('mistake').hidden, null, { timeout: 90000 }).catch(() => {});
const mistakeCard = await panel.evaluate(() => (document.getElementById('mistake').hidden ? null : document.getElementById('mistake').innerText));
console.log('\n--- tempting mistake ---\n', mistakeCard, '\n');
check('panel shows a tempting mistake with why & what goes wrong', /Why it's tempting/.test(mistakeCard || '') && /What goes wrong/.test(mistakeCard || ''), mistakeCard);
const kinds = await lichess.evaluate(() => [...document.querySelectorAll('svg[data-chess-coach] line')].map((l) => [l.dataset.kind, l.getAttribute('stroke')]));
check('purple mistake arrow drawn', kinds.some(([k, c]) => k === 'mistake' && c === '#8b5cf6'), kinds);
check('cyan typical-move band drawn under the other arrows', kinds.some(([k, c]) => k === 'typical' && c === '#0ea5b7'), kinds);
const typicalCard = await panel.evaluate(() => (document.getElementById('typical').hidden ? null : document.getElementById('typical').innerText));
console.log('\n--- typical move ---\n', typicalCard, '\n');
check('panel shows the typical move with a share and a verdict', /of players/.test(typicalCard || '') && /(Best|Good|Inaccuracy|Mistake|Blunder)/.test(typicalCard || ''), typicalCard);
if (process.env.SHOT) {
  await panel.screenshot({ path: process.env.SHOT.replace('.png', '-mistake.png'), fullPage: true });
  await lichess.screenshot({ path: process.env.SHOT.replace('.png', '-mistake-board.png') });
}
await panel.uncheck('#mistakes');
await new Promise((r) => setTimeout(r, 300));
const afterToggle = await lichess.evaluate(() => document.querySelectorAll('svg[data-chess-coach] line[data-kind="mistake"]').length);
check('Mistakes toggle removes the orange arrow', afterToggle === 0, afterToggle);
await panel.check('#mistakes');

// --- opening detection: Italian Game after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 (White to move)
const italianFen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
pages.set('https://lichess.org/analysis/italian', lichessPage(italianFen, { lastMove: ['f8', 'c5'] }));
await lichess.goto('https://lichess.org/analysis/italian');
await panel.waitForFunction(() => !document.getElementById('opening').hidden, null, { timeout: 60000 }).catch(() => {});
const openingCard = await panel.evaluate(() => document.getElementById('opening').innerText);
check('opening card names the Italian Game & the book move c3', /Italian Game/.test(openingCard) && /c3/.test(openingCard), openingCard);

// --- Openings tab: list, open one, step through it
await panel.click('#tab-openings');
const listText = await panel.evaluate(() => document.getElementById('page-openings').innerText);
check('openings tab lists White openings', /Italian Game/.test(listText) && /London System/.test(listText), listText);
await panel.click('text=Learn this opening').catch(() => {});
await panel.click('#tab-coach');
await panel.click('text=Learn this opening');
await panel.click('text=Next ▶');
await panel.click('text=Next ▶');
await panel.click('text=Next ▶');
const detail = await panel.evaluate(() => ({
  text: document.getElementById('page-openings').innerText,
  pieces: document.querySelectorAll('#page-openings .mini div').length,
  highlighted: document.querySelectorAll('#page-openings .mini .hl').length,
}));
check('opening detail shows a board, moves & a note', detail.pieces === 64 && detail.highlighted === 2 && /attacks e5/.test(detail.text), detail);
await panel.click('text=Show it on the board');
const trapText = await panel.evaluate(() => document.getElementById('page-openings').innerText);
check('trap view opens', /Trap · Italian Game/i.test(trapText) && /Fried Liver/.test(trapText), trapText.slice(0, 200));
if (process.env.SHOT) await panel.screenshot({ path: process.env.SHOT.replace('.png', '-openings.png'), fullPage: true });
await panel.click('#tab-coach');

// --- accuracy: play 1.e4, then 1...e5 2.Nf3 arrive together (as when the computer replies quickly)
const idle = () => panel.waitForFunction(() => !/thinking|checking/.test(document.getElementById('thinking').textContent)
  && !document.getElementById('human').hidden, null, { timeout: 90000 }).catch(() => {});
const playTo = async (path, fen, lastMove) => {
  pages.set(`https://lichess.org/analysis/${path}`, lichessPage(fen, { lastMove }));
  await lichess.goto(`https://lichess.org/analysis/${path}`);
  await new Promise((r) => setTimeout(r, 400));
  await idle();
};
await playTo('acc0', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', []);
await playTo('acc1', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e2', 'e4']);
await playTo('acc3', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2', ['g1', 'f3']);
await panel.waitForFunction(() => /3 moves/i.test(document.getElementById('accuracy').innerText), null, { timeout: 30000 }).catch(() => {});
const acc = await panel.evaluate(() => ({
  hidden: document.getElementById('accuracy').hidden,
  text: document.getElementById('accuracy').innerText,
  dots: document.querySelectorAll('#accuracy .dot').length,
  review: document.getElementById('review').innerText,
}));
console.log('\n--- accuracy ---\n', acc.text, '\n', acc.review, '\n');
check('accuracy card counts all 3 moves, including the 2 that arrived together', !acc.hidden && /3 moves/i.test(acc.text) && acc.dots === 3, acc);
check('both sides get a percentage', (acc.text.match(/\d+\.\d%/g) || []).length === 2, acc.text);
check('last move card shows its accuracy', /Nf3/.test(acc.review) && /% accuracy/.test(acc.review), acc.review);
if (process.env.SHOT) await panel.screenshot({ path: process.env.SHOT.replace('.png', '-accuracy.png'), fullPage: true });
// stepping back shows the line up to that point, and forward brings it back
await playTo('acc1', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e2', 'e4']);
const back = await panel.evaluate(() => document.getElementById('accuracy').innerText);
check('stepping back shows accuracy up to that move', /1 move so far/i.test(back), back);
await playTo('acc3', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2', ['g1', 'f3']);
const fwd = await panel.evaluate(() => document.getElementById('accuracy').innerText);
check('stepping forward brings the later moves back', /3 moves/i.test(fwd), fwd);

// --- puzzle mode: a free queen is a tactic, so the answer is hidden until asked
await panel.check('#puzzle');
const tacticFen = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3';
pages.set('https://lichess.org/analysis/tactic', lichessPage(tacticFen, { lastMove: ['d8', 'g5'] }));
await lichess.goto('https://lichess.org/analysis/tactic');
await panel.waitForFunction(() => !document.getElementById('puzzle-card').hidden, null, { timeout: 90000 }).catch(() => {});
const hidden = await panel.evaluate(() => ({
  puzzle: document.getElementById('puzzle-card').innerText,
  humanHidden: document.getElementById('human').hidden,
}));
check('puzzle mode: says there is a tactic and hides the answer', /Can you find it/.test(hidden.puzzle) && hidden.humanHidden, hidden);
await panel.click('text=Hint');
const hint = await panel.evaluate(() => document.getElementById('puzzle-card').innerText);
check('puzzle mode: hint names the piece', /Look at your bishop/.test(hint), hint);
await panel.click('text=Show answer');
const revealed = await panel.evaluate(() => ({ human: document.getElementById('human').innerText, puzzleHidden: document.getElementById('puzzle-card').hidden }));
check('puzzle mode: reveals Bxg5 with an Only move badge', /Bxg5/.test(revealed.human) && /only move/i.test(revealed.human) && revealed.puzzleHidden, revealed);
if (process.env.SHOT) await panel.screenshot({ path: process.env.SHOT.replace('.png', '-tactic.png'), fullPage: true });
await panel.uncheck('#puzzle');

// --- the panel goes dark when the tab moves to a live game
pages.set('https://lichess.org/QQQQqqqq', lichessPage(fen1, { lastMove: ['d1', 'h5'] }));
await lichess.goto('https://lichess.org/QQQQqqqq');
await panel.waitForFunction(() => !document.getElementById('off').hidden, null, { timeout: 15000 }).catch(() => {});
const off = await panel.evaluate(() => ({ off: !document.getElementById('off').hidden, reason: document.getElementById('off-reason').textContent }));
check('panel turns off on a live game', off.off && /Live game/.test(off.reason), off);
const arrowsAfter = await lichess.evaluate(() => document.querySelectorAll('svg[data-chess-coach] line').length);
check('no arrows on the live game', arrowsAfter === 0, arrowsAfter);

await context.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
