// Chess Coach content script: reads the board on Lichess & Chess.com.
// It never makes moves; it only reads the position and draws arrows the side panel asks for.

(() => {
  // some iPhone browsers only provide the extension API as `browser`
  // eslint-disable-next-line no-shadow
  const chrome = globalThis.chrome?.runtime?.getURL ? globalThis.chrome : globalThis.browser;

  if (window.__chessCoachLoaded) {
    return;
  }

  window.__chessCoachLoaded = true;

  const FILES = 'abcdefgh';
  const ROLE = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

  // Unicode escapes so the icons can never be mangled by file encoding: ♞ ▲ ▼ – ✕
  const ICON = {
    knight: '\u265E',
    up: '\u25B2',
    down: '\u25BC',
    min: '\u2013',
    close: '\u2715',
  };

  // ---------------------------------------------------------------------------------------------
// page gate: ALWAYS ON. The coach stays active on every Lichess / Chess.com page;
// if no board is present, snapshot simply reports no FEN until one appears.
// ---------------------------------------------------------------------------------------------

const on = (site, mode) => ({ site, allowed: true, mode });

const gate = (doc = document, loc = location) => {
  if (/(^|\.)lichess\.org$/.test(loc.hostname)) {
    return on('Lichess', 'Any page');
  }

  if (/(^|\.)chess\.com$/.test(loc.hostname)) {
    return on('Chess.com', 'Any page');
  }

  return off(null, 'This site isn\'t supported yet.');
};

const off = (site, reason) => ({ site, allowed: false, reason });


  // ---------------------------------------------------------------------------------------------
  // board readers
  // ---------------------------------------------------------------------------------------------

  const largest = (elements) => [...elements].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();

    return (rb.width * rb.height) - (ra.width * ra.height);
  })[0] || null;

  const parseTranslate = (style) => {
    const m = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(style || '');

    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  };

  // chessground (Lichess): pieces are positioned with transform: translate(x, y)
  const readLichess = (doc) => {
    const board = largest(doc.querySelectorAll('cg-board'));

    if (!board) {
      return null;
    }

    const wrap = board.closest('.cg-wrap');
    const orientation = wrap?.classList.contains('orientation-black') ? 'black' : 'white';
    const size = (board.getBoundingClientRect().width || board.clientWidth || 0) / 8;

    if (!size) {
      return null;
    }

    const toSquare = (el) => {
      const xy = parseTranslate(el.style.transform || el.getAttribute('style'));

      if (!xy) {
        return null;
      }

      const fx = Math.round(xy[0] / size);
      const ry = Math.round(xy[1] / size);
      const file = orientation === 'white' ? fx : 7 - fx;
      const rank = orientation === 'white' ? 7 - ry : ry;

      if (file < 0 || file > 7 || rank < 0 || rank > 7) {
        return null;
      }

      return `${FILES[file]}${rank + 1}`;
    };

    const pieces = [];
    let moving = false;

    board.querySelectorAll('piece').forEach((el) => {
      const cls = el.classList;

      // mid-animation or being dragged: its square isn't final yet
      if (cls.contains('anim') || cls.contains('dragging')) {
        moving = true;
      }

      if (cls.contains('ghost') || cls.contains('fading') || cls.contains('dragging')) {
        return;
      }

      const color = cls.contains('white') ? 'w' : (cls.contains('black') ? 'b' : null);
      const role = Object.keys(ROLE).find((r) => cls.contains(r));
      const square = toSquare(el);

      if (color && role && square) {
        pieces.push({ square, color, type: ROLE[role] });
      }
    });

    // premove squares use their own class (current-premove), so they don't count as the last move
    const lastMove = [...board.querySelectorAll('square.last-move')].map(toSquare).filter(Boolean);

    return { pieces, lastMove, orientation, element: board, moving };
  };

  // Chess.com: pieces carry classes like "piece wp square-52" (file 5 = e, rank 2)
  const readChessCom = (doc) => {
    const board = largest(doc.querySelectorAll('wc-chess-board, chess-board'));

    if (!board) {
      return null;
    }

    const orientation = board.classList.contains('flipped') ? 'black' : 'white';
    const squareOf = (el) => {
      const cls = [...el.classList].find((c) => /^square-\d\d$/.test(c));

      if (!cls) {
        return null;
      }

      const file = parseInt(cls[7], 10) - 1;
      const rank = parseInt(cls[8], 10);

      return file >= 0 && file < 8 && rank >= 1 && rank <= 8 ? `${FILES[file]}${rank}` : null;
    };

    const pieces = [];
    let moving = false;

    board.querySelectorAll('.piece').forEach((el) => {
      if (el.classList.contains('dragging')) {
        moving = true;

        return;
      }

      const code = [...el.classList].find((c) => /^[wb][pnbrqk]$/.test(c));
      const square = squareOf(el);

      if (code && square) {
        pieces.push({ square, color: code[0], type: code[1] });
      }
    });

    // premoves add extra highlights; with more than two, which pair is the last move is ambiguous
    const lastMove = [...board.querySelectorAll('.highlight')].map(squareOf).filter(Boolean);

    return { pieces, lastMove, orientation, element: board, moving };
  };

  /**
   * Builds a FEN from what's on the board. Side to move comes from the last-move highlight (the piece
   * that just moved belongs to the side that just played). Castling rights assume an unmoved king & rook.
   */
  const toFen = (read) => {
    if (!read?.pieces?.length) {
      return null;
    }

    const at = {};

    read.pieces.forEach((p) => { at[p.square] = p; });

    const kings = read.pieces.filter((p) => p.type === 'k');

    if (kings.length !== 2 || kings[0].color === kings[1].color) {
      return null;
    }

    const rows = [];

    for (let rank = 8; rank >= 1; rank -= 1) {
      let row = '';
      let empty = 0;

      for (let f = 0; f < 8; f += 1) {
        const p = at[`${FILES[f]}${rank}`];

        if (!p) {
          empty += 1;
        } else {
          if (empty) {
            row += empty;
            empty = 0;
          }

          row += p.color === 'w' ? p.type.toUpperCase() : p.type;
        }
      }

      rows.push(row + (empty || ''));
    }

    // who moved last: the piece sitting on one of the two highlighted squares
    let turn = 'w';
    let enPassant = '-';
    const highlights = read.lastMove || [];
    const moved = highlights.length === 2
      ? highlights.map((sq) => (at[sq] ? { sq, piece: at[sq] } : null)).filter(Boolean)
      : [];
    const dest = moved.length === 1 ? moved[0] : null;

    read.turnKnown = !!dest;

    if (dest) {
      turn = dest.piece.color === 'w' ? 'b' : 'w';

      // double pawn push -> en passant square
      const from = (read.lastMove || []).find((sq) => sq !== dest.sq);

      if (dest.piece.type === 'p' && from && from[0] === dest.sq[0] && Math.abs(Number(from[1]) - Number(dest.sq[1])) === 2) {
        enPassant = `${dest.sq[0]}${(Number(from[1]) + Number(dest.sq[1])) / 2}`;
      }
    }

    const has = (sq, code) => at[sq] && `${at[sq].color}${at[sq].type}` === code;
    let castling = '';

    if (has('e1', 'wk')) {
      castling += has('h1', 'wr') ? 'K' : '';
      castling += has('a1', 'wr') ? 'Q' : '';
    }

    if (has('e8', 'bk')) {
      castling += has('h8', 'br') ? 'k' : '';
      castling += has('a8', 'br') ? 'q' : '';
    }

    // the move number isn't on the board; count it as an opening only if lots of pieces are home
    const homePieces = read.pieces.filter((p) => (p.color === 'w' && p.square[1] === '1') || (p.color === 'b' && p.square[1] === '8')).length;
    const moveNumber = homePieces >= 12 ? 6 : 20;

    return `${rows.join('/')} ${turn} ${castling || '-'} ${enPassant} 0 ${moveNumber}`;
  };

  const readBoard = (doc = document, loc = location) => {
    if (/(^|\.)lichess\.org$/.test(loc.hostname)) {
      return readLichess(doc);
    }

    if (/(^|\.)chess\.com$/.test(loc.hostname)) {
      return readChessCom(doc);
    }

    return null;
  };

  // ---------------------------------------------------------------------------------------------
  // arrows drawn over the site's board
  // ---------------------------------------------------------------------------------------------

  let overlay = null;
  let arrows = [];
  let lastRead = null;

  const drawArrows = () => {
    if (!overlay) {
      overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.setAttribute('data-chess-coach', 'arrows');
      Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: 2147483646, overflow: 'visible' });
      document.documentElement.appendChild(overlay);
    }

    const board = lastRead?.element;

    if (!board || !arrows.length || !currentGate.allowed) {
      overlay.style.display = 'none';

      return;
    }

    const rect = board.getBoundingClientRect();
    const sq = rect.width / 8;

    Object.assign(overlay.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });

    overlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);

    const center = (square) => {
      const f = FILES.indexOf(square[0]);
      const r = Number(square[1]) - 1;
      const x = lastRead.orientation === 'white' ? f : 7 - f;
      const y = lastRead.orientation === 'white' ? 7 - r : r;

      return [(x + 0.5) * sq, (y + 0.5) * sq];
    };

    // green = human move, blue = engine best, orange dotted = tempting mistake, red dashed = their threat
    const colors = { human: '#2e9e5b', best: '#2f6fd6', mistake: '#8b5cf6', threat: '#d64545', brilliant: '#d4a017', typical: '#0ea5b7' };
    const dashes = { threat: `${sq * 0.2} ${sq * 0.15}`, mistake: `${sq * 0.01} ${sq * 0.24}` };
    // later arrows are drawn on top: the move we recommend should never be hidden by the others
    const layer = { typical: -1, mistake: 0, threat: 1, best: 2, human: 3, brilliant: 4 };
    // the typical move is a wide see-through band under everything, so it still shows when it's the same
    // move as another arrow
    const width = { typical: 0.38 };
    const opacity = { typical: 0.5 };
    const head = { typical: 1.9 };
    let svg = '<defs>';

    Object.entries(colors).forEach(([key, color]) => {
      svg += `<marker id="cc-head-${key}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="${head[key] || 3}" markerHeight="${head[key] || 3}" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`;
    });

    svg += '</defs>';

    [...arrows].sort((a, b) => (layer[a?.kind] ?? 2) - (layer[b?.kind] ?? 2)).forEach((a) => {
      if (!/^[a-h][1-8]$/.test(a?.from || '') || !/^[a-h][1-8]$/.test(a?.to || '')) {
        return;
      }

      const kind = a.kind in colors ? a.kind : 'best';
      const [x1, y1] = center(a.from);
      const [x2, y2] = center(a.to);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const shorten = sq * 0.3;
      const ex = x2 - (((x2 - x1) / len) * shorten);
      const ey = y2 - (((y2 - y1) / len) * shorten);
      const dash = dashes[kind] ? `stroke-dasharray="${dashes[kind]}"` : '';

      svg += `<line data-kind="${kind}" x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${colors[kind]}" stroke-width="${sq * (width[kind] || 0.16)}" stroke-linecap="round" opacity="${opacity[kind] || 0.8}" ${dash} marker-end="url(#cc-head-${kind})"/>`;
    });

    overlay.innerHTML = svg;
  };

  // ---------------------------------------------------------------------------------------------
  // watch the page & talk to the side panel
  // ---------------------------------------------------------------------------------------------

  let currentGate = { allowed: false };
  let lastSent = '';
  let timer = null;

  const snapshot = () => {
    currentGate = gate();
    lastRead = currentGate.allowed ? readBoard() : null;

    const fen = currentGate.allowed ? toFen(lastRead) : null;

    return {
      type: 'cc:board',
      gate: currentGate,
      fen,
      turnKnown: !!lastRead?.turnKnown,
      moving: !!lastRead?.moving,
      orientation: lastRead?.orientation || 'white',
      url: location.href,
    };
  };

  // ---------------------------------------------------------------------------------------------
  // In-page panel, for browsers without a side panel (Safari and Orion on iPhone). Desktop Chrome
  // never builds any of this: the background script tells us which mode we're in.
  // The panel is the same sidepanel.html in an iframe that slides up from the bottom, and it talks to
  // this script with postMessage.
  // ---------------------------------------------------------------------------------------------

  const PANEL_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  let inPage = false;
  let ui = null; // { launcher, sheet, frame }
  let sheetSize = 'closed'; // closed | half | full | min

  const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  const SHEET_CSS = `
    .launcher { position: fixed; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); z-index: 2147483646;
      width: 50px; height: 50px; border-radius: 50%; border: 0; padding: 0; background: #2e9e5b; color: #fff;
      font: 28px/50px system-ui, -apple-system, sans-serif; text-align: center; box-shadow: 0 4px 14px rgba(0,0,0,.35);
      cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .launcher[hidden], .sheet[hidden] { display: none; }
    .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647; display: flex; flex-direction: column;
      height: 50vh; height: 50dvh; background: #f6f5f1; border-radius: 14px 14px 0 0; overflow: hidden;
      box-shadow: 0 -6px 24px rgba(0,0,0,.3); padding-bottom: env(safe-area-inset-bottom, 0px); transition: height .2s ease; }
    .sheet[data-size="full"] { height: 88vh; height: 88dvh; }
    .sheet[data-size="min"] { height: calc(44px + env(safe-area-inset-bottom, 0px)); }
    .bar { flex: 0 0 44px; display: flex; align-items: center; border-bottom: 1px solid rgba(0,0,0,.12); }
    .bar button { all: unset; box-sizing: border-box; height: 44px; padding: 0 14px; cursor: pointer; color: #1f2328;
      font: 600 15px/44px system-ui, -apple-system, sans-serif; -webkit-tap-highlight-color: transparent; }
    .bar .title { flex: 1; }
    .bar .title::before { content: ''; display: inline-block; width: 34px; height: 5px; margin-right: 10px; border-radius: 3px;
      vertical-align: middle; background: rgba(0,0,0,.25); }
    iframe { flex: 1; width: 100%; border: 0; background: transparent; }
    .sheet[data-size="min"] iframe { visibility: hidden; }
    @media (prefers-color-scheme: dark) {
      .sheet { background: #1c1d20; } .bar { border-color: rgba(255,255,255,.12); } .bar button { color: #e9e9ea; }
      .bar .title::before { background: rgba(255,255,255,.3); }
    }`;

  const toPanel = (message) => {
    if (ui?.frame.contentWindow && sheetSize !== 'closed') {
      ui.frame.contentWindow.postMessage({ __cc: true, ...message }, PANEL_ORIGIN);
    }
  };

  const render = () => {
    if (!ui) {
      return;
    }

    ui.sheet.hidden = sheetSize === 'closed';
    ui.sheet.dataset.size = sheetSize;
    // the button only shows where the coach can run
    ui.launcher.hidden = sheetSize !== 'closed' || !currentGate.allowed;
    ui.full.textContent = sheetSize === 'full' ? ICON.down : ICON.up;
    ui.full.setAttribute('aria-label', sheetSize === 'full' ? 'Smaller' : 'Bigger');
  };

  const setSize = (next) => {
    if (next === 'closed') {
      // unloading the panel stops the engine, which saves battery
      ui.frame.removeAttribute('src');
    } else if (!ui.frame.getAttribute('src')) {
      ui.frame.src = chrome.runtime.getURL('sidepanel.html?embedded=1');
    }

    sheetSize = next;
    render();
  };

  const buildPanel = () => {
    const host = document.createElement('div');

    host.setAttribute('data-chess-coach-panel', '');
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;';

    // a closed shadow root keeps the site's CSS (and scripts) away from the panel's controls
    const root = host.attachShadow({ mode: 'closed' });

    root.innerHTML = `<style>${SHEET_CSS}</style>
      <button type="button" class="launcher" aria-label="Open Chess Coach" hidden>${ICON.knight}</button>
      <div class="sheet" hidden>
        <div class="bar">
          <button type="button" class="title">Chess Coach</button>
          <button type="button" class="full" aria-label="Bigger">${ICON.up}</button>
          <button type="button" class="min" aria-label="Minimize">${ICON.min}</button>
          <button type="button" class="close" aria-label="Close">${ICON.close}</button>
        </div>
        <iframe title="Chess Coach"></iframe>
      </div>`;

    ui = {
      launcher: root.querySelector('.launcher'),
      sheet: root.querySelector('.sheet'),
      frame: root.querySelector('iframe'),
      full: root.querySelector('.full'),
    };

    ui.launcher.addEventListener('click', () => setSize('half'));
    root.querySelector('.title').addEventListener('click', () => setSize(sheetSize === 'min' ? 'half' : (sheetSize === 'full' ? 'half' : 'full')));
    ui.full.addEventListener('click', () => setSize(sheetSize === 'full' ? 'half' : 'full'));
    root.querySelector('.min').addEventListener('click', () => setSize(sheetSize === 'min' ? 'half' : 'min'));
    root.querySelector('.close').addEventListener('click', () => setSize('closed'));

    document.documentElement.appendChild(host);
    render();
  };

  // the panel asks for the board and sends arrows; only messages from our own iframe count
  window.addEventListener('message', (event) => {
    if (!ui || event.source !== ui.frame.contentWindow || event.origin !== PANEL_ORIGIN || !event.data?.__cc) {
      return;
    }

    const { data } = event;

    if (data.type === 'cc:request') {
      ui.frame.contentWindow.postMessage({ __cc: true, type: 'cc:snapshot', id: data.id, snapshot: snapshot() }, PANEL_ORIGIN);
      publish(true);
    } else if (data.type === 'cc:arrows') {
      arrows = currentGate.allowed ? (data.arrows || []) : [];
      drawArrows();
    }
  });

  const startInPagePanel = async () => {
    // phones never have a side panel, so don't wait on the background script: in some iPhone browsers
    // (Orion) it may never answer
    if (isPhone()) {
      inPage = true;
      buildPanel();

      return;
    }

    let answer = null;

    try {
      answer = await Promise.race([
        chrome.runtime.sendMessage({ type: 'cc:mode' }),
        new Promise((resolve) => { setTimeout(() => resolve(null), 1500); }),
      ]);
    } catch {
      // no background script answering: a desktop browser without one keeps the old behaviour
    }

    inPage = answer?.inPage === true;

    if (inPage) {
      buildPanel();
    }
  };

  const publish = (force = false) => {
    const message = snapshot();

    // a piece is still sliding into place (fast replies, premoves): read again once it lands
    if (message.moving && !force) {
      clearTimeout(timer);
      timer = setTimeout(() => publish(false), 60);

      return;
    }

    const key = JSON.stringify([message.gate, message.fen, message.orientation]);

    if (!message.gate.allowed) {
      arrows = [];
    }

    drawArrows();
    render();

    if (!force && key === lastSent) {
      return;
    }

    lastSent = key;

    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // the extension was reloaded; this script is orphaned
    }

    toPanel(message);
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => publish(false), 80);
  };

  // Observer scope: the board element when we can find one (way fewer mutation records),
  // document.documentElement as a fallback that catches SPA navigations / board replacements.
  // Rebinds on a cadence in case the board element gets swapped out by the site's framework.
  let boardObserver = null;
  let boardObserverTarget = null;

  const bindBoardObserver = () => {
    const board = lastRead?.element;
    if (!board) return;
    if (board === boardObserverTarget) return;
    boardObserver?.disconnect();
    boardObserver = new MutationObserver(schedule);
    boardObserver.observe(board, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'transform'],
    });
    boardObserverTarget = board;
  };

  // A lightweight document-level observer catches board appearance / SPA navigation; cost is
  // minimal because we filter on attributes we actually care about only at the root level.
  new MutationObserver(() => { schedule(); bindBoardObserver(); }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: false,
  });

  window.addEventListener('resize', drawArrows);
  window.addEventListener('scroll', drawArrows, { passive: true });
  setInterval(() => publish(false), 1500); // catches SPA navigation

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'cc:request') {
      sendResponse(snapshot());
      publish(true);
    } else if (message?.type === 'cc:arrows') {
      arrows = currentGate.allowed ? (message.arrows || []) : [];
      drawArrows();
    } else if (message?.type === 'cc:toggle-panel' && ui) {
      // the extension's entry in the browser menu (Safari) opens or closes the in-page panel
      setSize(sheetSize === 'closed' ? 'half' : 'closed');
    }
  });

  // exposed for tests
  window.__chessCoach = { gate, readBoard, toFen, snapshot };

  publish(true);
  startInPagePanel();
})();
