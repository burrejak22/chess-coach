// The iPhone layout: Chrome pretends to be an iPhone (screen size, touch, user agent) with the in-page panel
// turned on, the way Safari / Orion get it (they have no side panel). Same fake pages as browser.test.mjs.
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


const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const W = 390;
const H = 844;
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'cc-ios-')), {
  executablePath: process.env.CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined),
  headless: true,
  viewport: { width: W, height: H },
  userAgent: IPHONE_UA,
  hasTouch: true,
  isMobile: true,
  args: [
    '--headless=new',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
  ],
});

let [worker] = context.serviceWorkers();
worker = worker || await context.waitForEvent('serviceworker', { timeout: 15000 });
await worker.evaluate(() => chrome.storage.local.set({ forceInPagePanel: true }));

// the real sites are mobile-friendly (width=device-width); the fake pages get the same viewport tag
const mobile = (html) => html.replace('<html>', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1"></head><style>html,body{overflow-x:hidden}</style>');
const pages = new Map();
await context.route(/^https:\/\/(lichess\.org|www\.chess\.com)\/.*/, (route) => {
  route.fulfill({ status: 200, contentType: 'text/html', body: pages.get(route.request().url()) || '<html><body>not mocked</body></html>' });
});

const page = await context.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const panelFrame = () => page.frames().find((f) => /sidepanel\.html\?embedded=1/.test(f.url()));
const waitFor = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
    const v = await fn();
    if (v) return v;
  }
  return null;
};
const LAUNCHER = [W - 14 - 25, H - 14 - 25];

// --- analysis board: the Chess Coach button shows; tapping it slides the panel up
const fen = 'rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2';
pages.set('https://lichess.org/analysis/ios', mobile(lichessPage(fen, { lastMove: ['d1', 'h5'] })));
await page.goto('https://lichess.org/analysis/ios');
const host = await waitFor(() => page.evaluate(() => !!document.querySelector('[data-chess-coach-panel]')));
check('in-page panel is set up on an iPhone', host, host);
await sleep(500);
check('panel isn\'t loaded until you open it (saves battery)', !panelFrame());
await page.touchscreen.tap(...LAUNCHER);
const frame = await waitFor(panelFrame);
check('tapping the button opens the panel', !!frame);
const ready = frame && await waitFor(() => frame.evaluate(() => !document.getElementById('human').hidden
  && !/thinking/.test(document.getElementById('thinking').textContent)), 90000);
const panel = frame && await frame.evaluate(() => ({
  status: document.getElementById('status').textContent,
  human: document.getElementById('human').innerText,
  threat: document.getElementById('threat').hidden ? '' : document.getElementById('threat').innerText,
  engine: document.getElementById('engine')?.textContent || '',
  embedded: document.documentElement.classList.contains('embedded'),
}));
console.log('\n--- iPhone panel ---\n', JSON.stringify(panel, null, 2), '\n');
check('panel analyses the position', ready && /Analysis/.test(panel.status) && /Nc6|Qe7|Qf6|g6|Nf6|d6/.test(panel.human), panel);
check('panel uses the compact in-page layout', panel?.embedded === true, panel);
const lines = await waitFor(() => page.evaluate(() => document.querySelectorAll('svg[data-chess-coach] line').length));
check('arrows are drawn on the board from the in-page panel', lines >= 1, lines);
const typicalBand = await waitFor(() => page.evaluate(() => document.querySelectorAll('svg[data-chess-coach] line[data-kind="typical"]').length), 30000);
check('typical-move band shows on the phone too', typicalBand === 1, typicalBand);

const box = async () => (await (await frame.frameElement()).boundingBox()) || {};
const half = await box();
check('panel opens at about half the screen', Math.abs(half.y - (H / 2 + 44)) < 30, half);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace('.png', '-iphone-half.png') });

// tap the title bar: full height; tap again: back to half
await page.touchscreen.tap(80, H / 2 + 22);
await sleep(500);
const full = await box();
check('tapping the title makes it bigger', full.y < 200, full);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace('.png', '-iphone-full.png') });
await page.touchscreen.tap(80, full.y - 22);
await sleep(500);
check('tapping it again goes back to half', Math.abs((await box()).y - half.y) < 5, await box());

// the browser-menu entry (Safari) toggles it closed and the engine is unloaded
const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://lichess.org/analysis/ios' }))[0]?.id);
await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cc:toggle-panel' }), tabId);
await sleep(500);
check('the extension menu entry closes the panel and unloads it', !panelFrame());

// --- a live game: no button, nothing read, and no panel even if you tap there
pages.set('https://lichess.org/abcdEFGH', mobile(lichessPage(fen, { lastMove: ['d1', 'h5'], extra: '<div class="rclock rclock-bottom running"></div>' })));
await page.goto('https://lichess.org/abcdEFGH');
await sleep(1500);
await page.touchscreen.tap(...LAUNCHER);
await sleep(1000);
check('live game: no Chess Coach button to open', !panelFrame());
const liveArrows = await page.evaluate(() => document.querySelectorAll('svg[data-chess-coach] line').length);
check('live game: no arrows', liveArrows === 0, liveArrows);
await worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://lichess.org/abcdEFGH' });
  await chrome.tabs.sendMessage(tab.id, { type: 'cc:toggle-panel' });
});
const liveFrame = await waitFor(panelFrame, 5000);
const liveOff = liveFrame && await waitFor(() => liveFrame.evaluate(() => !document.getElementById('off').hidden
  && document.getElementById('off-reason').textContent), 10000);
check('live game: opening it from the menu only shows "Coach is off"', /Live game/.test(liveOff || ''), liveOff);

await context.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
