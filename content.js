(() => {
  if (window.__chessCoachLoaded) {
    return;
  }

  window.__chessCoachLoaded = true;

  const FILES = 'abcdefgh';
  const ROLE = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

  // ---------------------------------------------------------------------------------------------
  // page gate: on for any recognisable board, unknown pages stay off so a site redesign fails safe
  // ---------------------------------------------------------------------------------------------

  const on = (site, mode) => ({ site, allowed: true, mode });
  const off = (site, reason) => ({ site, allowed: false, reason });

  const lichessGate = (doc, path) => {
    const site = 'Lichess';

    if (/^\/analysis(\/|$)/.test(path)) {
      return on(site, 'Analysis board');
    }

    if (/^\/(study|broadcast)(\/|$)/.test(path)) {
      return on(site, 'Study');
    }

    if (/^\/editor(\/|$)/.test(path)) {
      return on(site, 'Board editor');
    }

    if (/^\/training(\/|$)/.test(path)) {
      return on(site, 'Puzzle');
    }

    // game pages: /<8 or 12 char id>, optionally /white or /black
    if (/^\/[A-Za-z0-9]{8}(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?$/.test(path)) {
      return on(site, 'Game');
    }

    return off(site, 'Open an analysis board, a study or a game.');
  };

  const chessComGate = (doc, path) => {
    const site = 'Chess.com';

    if (/^\/(analysis|explorer)(\/|$)/.test(path)) {
      return on(site, 'Analysis board');
    }

    if (/^\/play\/computer(\/|$)/.test(path)) {
      return on(site, 'Vs computer');
    }

    if (/^\/(puzzles?|daily-chess-puzzle|puzzle-rush|puzzle-battle)(\/|$)/.test(path)) {
      return on(site, 'Puzzles');
    }

    if (/^\/game\//.test(path)) {
      return on(site, 'Game');
    }

    if (/^\/(play|live|daily)(\/|$)/.test(path)) {
      return on(site, 'Game');
    }

    return off(site, 'Open an analysis board or a game.');
  };

  const gate = (doc = document, loc = location) => {
    if (/(^|\.)lichess\.org$/.test(loc.hostname)) {
      return lichessGate(doc, loc.pathname);
    }

    if (/(^|\.)chess\.com$/.test(loc.hostname)) {
      return chessComGate(doc, loc.pathname);
    }

    return off(null, 'This site isn\'t supported yet.');
  };

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
    const colors = { human: '#2e9e5b', best: '#2f6fd6', mistake: '#8b5cf6', threat: '#d64545', brilliant: '#d4a017' };
    const dashes = { threat: `${sq * 0.2} ${sq * 0.15}`, mistake: `${sq * 0.01} ${sq * 0.24}` };
    // later arrows are drawn on top: the move we recommend should never be hidden by the others
    const layer = { mistake: 0, threat: 1, best: 2, human: 3, brilliant: 4 };
    let svg = '<defs>';

    Object.entries(colors).forEach(([key, color]) => {
      svg += `<marker id="cc-head-${key}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`;
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

      svg += `<line data-kind="${kind}" x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${colors[kind]}" stroke-width="${sq * 0.16}" stroke-linecap="round" opacity="0.8" ${dash} marker-end="url(#cc-head-${kind})"/>`;
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

    if (!force && key === lastSent) {
      return;
    }

    lastSent = key;

    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // the extension was reloaded; this script is orphaned
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => publish(false), 80);
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'],
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
    }
  });

  publish(true);
})();
