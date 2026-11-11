import { EnginePool } from './lib/engine.js';

// some iPhone browsers only provide the extension API as `browser`
// eslint-disable-next-line no-shadow
const chrome = globalThis.chrome?.runtime?.getURL ? globalThis.chrome : globalThis.browser;
import {
  coachPosition,
  describeMistake,
  describeTypical,
  describeTrap,
  findMoveBetween,
  findPositionBetween,
  isPlausiblePosition,
  lineAfterFirstMove,
  lineCp,
  mistakeCandidates,
  nullMoveFen,
  overallAccuracy,
  playUci,
  typicalMoves,
  resolveTurn,
  reviewLastMove,
  temptingReplies,
} from './lib/coach.js';
import { bookMoves, detectOpening } from './lib/openings.js';
import { planFor } from './lib/opening-plans.js';
import { mountOpenings } from './openings-ui.js';
import { Chess } from './lib/chess.js';

const $ = (id) => document.getElementById(id);

// Inside the page (iPhone: Safari / Orion have no side panel) the panel is an iframe that talks to the
// page's content script with postMessage. In Chrome's side panel nothing here changes.
const EMBEDDED = new URLSearchParams(location.search).get('embedded') === '1';
const PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// a small pool of Stockfish workers so trap/mistake probes can run in parallel after the main eval lands.
// Phones get one worker with a small hash table: iOS closes extensions that use a lot of memory.
const engine = PHONE ? new EnginePool(1, { hash: 16 }) : new EnginePool(3);

if (EMBEDDED) {
  document.documentElement.classList.add('embedded');
}

const PAGE_ORIGINS = ['https://lichess.org', 'https://www.chess.com'];
const pageOrigin = () => {
  const origin = location.ancestorOrigins?.[0] || (document.referrer ? new URL(document.referrer).origin : '');

  return PAGE_ORIGINS.includes(origin) ? origin : '*';
};
const pending = new Map();
let requestId = 0;

/** Sends a message to the board's content script (Chrome: through the tabs API; in-page: postMessage). */
const tabSend = (message) => {
  if (!EMBEDDED) {
    return chrome.tabs.sendMessage(state.tabId, message);
  }

  if (message.type !== 'cc:request') {
    window.parent.postMessage({ __cc: true, ...message }, pageOrigin());

    return Promise.resolve();
  }

  const id = ++requestId;

  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    window.parent.postMessage({ __cc: true, ...message, id }, pageOrigin());
    setTimeout(() => {
      if (pending.delete(id)) {
        reject(new Error('the page didn\'t answer'));
      }
    }, 4000);
  });
};

const state = {
  tabId: null,
  gate: null,
  fen: null,
  settings: { level: 1600, think: 2500, arrows: true, mistakes: true, puzzle: false, turn: 'auto' },
  revealed: new Set(), // positions where you asked to see the puzzle answer
  hinted: new Set(),
  lastResult: null,
  cache: new Map(), // position -> { deep, shallow, nullLine, traps, mistake }; most recently used last
  prevFen: null,
  orientation: 'white',
  // graded moves, keyed by the position they led to, each pointing back at the position before it.
  // Walking back from the current position gives the line that was played to reach it.
  reviews: new Map(), // position -> { from: position, review }
  seq: 0,
};

// ---------------------------------------------------------------------------------------------
// small DOM helpers (textContent only; nothing from the page is parsed as HTML)
// ---------------------------------------------------------------------------------------------

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);

  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') {
      node.className = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else {
      node.setAttribute(k, v);
    }
  });

  children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false).forEach((c) => {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  });

  return node;
};

const fill = (id, ...children) => {
  const node = $(id);

  node.replaceChildren(...children.flat(Infinity).filter(Boolean));
  node.hidden = !children.flat(Infinity).filter(Boolean).length;
};

const list = (items) => (items?.length ? el('ul', {}, items.map((t) => el('li', {}, t))) : null);

// ---------------------------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------------------------

const renderGate = (gate) => {
  const status = $('status');

  if (gate?.allowed) {
    status.textContent = `${gate.site} · ${gate.mode}`;
    status.className = 'pill on';
    $('off').hidden = true;
    $('on').hidden = false;
  } else {
    status.textContent = gate?.site ? `${gate.site} · off` : 'Off';
    status.className = 'pill off';
    $('off-reason').textContent = gate?.reason || 'Open Lichess or Chess.com in this tab.';
    $('off').hidden = false;
    $('on').hidden = true;
  }
};

const renderEval = (result, thinking) => {
  $('eval').textContent = result?.eval ?? '…';
  $('turn').textContent = result ? `${result.turn === 'w' ? 'White' : 'Black'} to move` : '';
  $('thinking').textContent = thinking || (result?.depth ? `depth ${result.depth}` : '');

  // white's share of the bar, squashed so +5 is nearly full
  const cp = result?.evalCpWhite ?? 0;
  const share = 50 + (50 * (2 / (1 + Math.exp(-cp / 250)) - 1));

  $('bar-fill').style.height = `${Math.max(2, Math.min(98, share))}%`;
};

const BADGE_LABEL = { Brilliant: 'Brilliant!!', Great: 'Great!', 'Only move': 'Only move', Trap: 'Trap' };

const badges = (card) => (card?.badges || []).map((b) => el('span', { class: `badge ${b.split(' ')[0]}` }, BADGE_LABEL[b] || b));

// Small "predicted reply + pre-move" block rendered under a move card. Shows the top 1-2
// opponent responses with their shares, plus the pre-move the user can queue up safely.
const predictionBlock = (card) => {
  if (!card?.replies?.length) return null;
  const shareLabel = (share) => `${Math.max(1, Math.round(share * 100))}%`;
  const children = [];
  const replyBits = card.replies.map((r, i) => [
    i ? ', ' : '',
    el('b', {}, r.san),
    ` (${shareLabel(r.share)})`,
  ]);
  children.push(el('div', { class: 'plan muted small' }, 'They probably play: ', replyBits));

  if (card.premove) {
    const level = card.premove.confidence;
    const label = level === 'strong' ? 'Safe pre-move: '
      : level === 'conditional' ? 'Likely-safe pre-move: '
        : 'Pre-move (only if they play the expected reply): ';
    children.push(el('div', { class: 'plan muted small' },
      label,
      el('b', {}, card.premove.san),
      card.premove.note ? el('span', { class: 'muted' }, ` (${card.premove.note})`) : null,
    ));
  }
  return children;
};

const renderOpening = () => {
  const hit = state.fen ? detectOpening(state.fen) : null;

  if (!hit) {
    fill('opening');

    return;
  }

  const plan = planFor(hit.opening.name);

  fill(
    'opening',
    el('h3', {}, 'Opening'),
    el('div', {}, el('span', { class: 'name' }, hit.opening.name), hit.also?.length ? el('span', { class: 'muted' }, ` (also: ${hit.also.join(', ')})`) : ''),
    hit.next
      ? el('div', { class: 'plan' }, 'Book move: ', el('b', {}, hit.next), hit.note ? `: ${hit.note}` : '')
      : el('div', { class: 'plan' }, 'End of the book line. Time for the plans.'),
    plan ? el('div', { class: 'plan muted' }, el('b', {}, 'Plan: '), plan) : null,
    el('div', { class: 'btnrow' }, el('button', { type: 'button', class: 'btn', onclick: () => { showTab('openings'); openings.open(hit.opening.id); } }, 'Learn this opening')),
  );
};

// puzzle mode: when there's a tactic, hide the answer until you ask for it
const puzzleHides = (result) => state.settings.puzzle && result?.tactic && !state.revealed.has(state.fen);

const renderPuzzle = (result) => {
  if (!puzzleHides(result)) {
    fill('puzzle-card');

    return;
  }

  const { tactic } = result;
  const hinted = state.hinted.has(state.fen);

  fill(
    'puzzle-card',
    el('h3', {}, 'Puzzle'),
    el('div', { class: 'q' }, `There's ${tactic.theme} here for ${result.turn === 'w' ? 'White' : 'Black'}. Can you find it?`),
    hinted && tactic.pieceHint ? el('div', { class: 'plan' }, `Hint: ${tactic.pieceHint}`) : null,
    el(
      'div',
      { class: 'btnrow' },
      hinted ? null : el('button', { type: 'button', class: 'btn', onclick: () => { state.hinted.add(state.fen); rerender(); } }, 'Hint'),
      el('button', { type: 'button', class: 'btn primary', onclick: () => { state.revealed.add(state.fen); rerender(); } }, 'Show answer'),
    ),
  );
};

const renderMoves = (result) => {
  renderOpening();
  renderPuzzle(result);

  if (!result || puzzleHides(result)) {
    ['human', 'best', 'alts', 'threat', 'mistake', 'typical'].forEach((id) => fill(id));

    return;
  }

  const { human, best, alternatives, threat, mistake } = result;

  fill('threat', threat ? [el('h3', {}, 'Their threat'), el('div', { class: 'txt' }, threat.text)] : []);

  if (human) {
    fill(
      'human',
      el('h3', {}, `Human move · plays like ${state.settings.level}`),
      el(
        'div',
        { class: 'move' },
        el('span', { class: 'san' }, human.san),
        badges(human),
        el('span', { class: 'tag' }, human.eval),
        el('span', { class: 'tag' }, human.isBest
          ? 'also the engine\'s top move'
          : `engine prefers ${best.san} (${(human.loss / 100).toFixed(1)} better)`),
      ),
      list(human.reasons),
      human.plan?.length ? el('div', { class: 'plan' }, 'Plan: ', el('b', {}, human.plan.join(' → '))) : null,
      predictionBlock(human),
    );
  }

  fill('best', human?.isBest ? [] : [
    el('h3', {}, 'Engine\'s best'),
    el('div', { class: 'move' }, el('span', { class: 'san' }, best.san), badges(best), el('span', { class: 'tag' }, best.eval)),
    list(best.reasons),
    best.plan?.length ? el('div', { class: 'plan' }, 'Plan: ', el('b', {}, best.plan.join(' → '))) : null,
    predictionBlock(best),
  ]);

  const { typical } = result;
  const pct = (share) => `~${Math.max(1, Math.round(share * 100))}%`;

  fill('typical', typical ? [
    el('h3', {}, 'Typical move · what most players would play'),
    el(
      'div',
      { class: 'move' },
      el('span', { class: 'san' }, typical.san),
      el('span', { class: 'tag' }, `${pct(typical.share)} of players`),
      typical.grade ? el('span', { class: `grade ${typical.grade}` }, typical.grade) : null,
      typical.eval ? el('span', { class: 'tag' }, typical.loss > 15 ? `${typical.eval} (−${(typical.loss / 100).toFixed(1)})` : typical.eval) : null,
    ),
    el(
      'ul',
      {},
      typical.why ? el('li', {}, el('b', {}, 'Why people play it: '), typical.why) : null,
      typical.wrong ? el('li', {}, el('b', {}, 'What goes wrong: '), typical.wrong) : null,
    ),
    typical.others?.length
      ? el('div', { class: 'plan' }, 'Also common: ', typical.others.map((o, i) => [i ? ', ' : '', el('b', {}, o.san), ` (${pct(o.share)})`]))
      : null,
    el('div', { class: 'muted small' }, typical.source === 'games'
      ? `Shares from Lichess games at about your "Play like" rating.`
      : 'Estimated from how players at this rating choose moves, not counted from games.'),
  ] : []);

  fill('mistake', mistake && state.settings.mistakes ? [
    el('h3', {}, 'Tempting mistake · what a weaker player might play'),
    el(
      'div',
      { class: 'move' },
      el('span', { class: 'san' }, `${mistake.san}?`),
      el('span', { class: `grade ${mistake.grade}` }, mistake.grade),
      el('span', { class: 'tag' }, `${mistake.eval} (−${(mistake.loss / 100).toFixed(1)})`),
    ),
    el('ul', {}, el('li', {}, el('b', {}, 'Why it\'s tempting: '), mistake.lure), el('li', {}, el('b', {}, 'What goes wrong: '), mistake.wrong)),
    mistake.line?.length ? el('div', { class: 'plan' }, 'Line: ', el('b', {}, `${mistake.san} ${mistake.line.join(' ')}`)) : null,
  ] : []);

  fill('alts', alternatives.length ? [
    el('h3', {}, 'Other good moves'),
    alternatives.map((a) => el(
      'div',
      { class: 'row' },
      el('span', {}, el('b', {}, a.san), ' ', badges(a)),
      el('span', { class: 'muted' }, a.eval),
      el('span', {}, a.reasons[0] || ''),
    )),
  ] : []);
};

const renderReview = (review) => {
  if (!review) {
    fill('review');

    return;
  }

  const who = review.color === 'w' ? 'White' : 'Black';
  const children = [
    el('h3', {}, 'Last move'),
    el(
      'div',
      { class: 'move' },
      el('span', {}, `${who} played `, el('b', {}, review.san)),
      el('span', { class: `grade ${review.grade.split(' ')[0]}` }, review.grade),
      review.loss > 15 ? el('span', { class: 'tag' }, `(−${(review.loss / 100).toFixed(1)})`) : null,
      Number.isFinite(review.accuracy) ? el('span', { class: 'tag' }, `${Math.round(review.accuracy)}% accuracy`) : null,
    ),
  ];

  if (review.better) {
    children.push(el('div', { class: 'plan' }, 'Better was ', el('b', {}, review.better.san), review.better.reasons[0] ? `: ${review.better.reasons[0]}` : ''));
  }

  if (review.punish) {
    children.push(el('div', { class: 'plan' }, 'Now ', el('b', {}, review.punish.san), review.punish.reasons[0] ? `: ${review.punish.reasons[0]}` : ' is the answer.'));
  }

  fill('review', children);
};

// ---------------------------------------------------------------------------------------------
// accuracy for the line played so far
// ---------------------------------------------------------------------------------------------

const positionKey = (fen) => fen.split(' ').slice(0, 2).join(' ');

const cacheSet = (key, data) => {
  state.cache.delete(key);
  state.cache.set(key, data);

  while (state.cache.size > 400) {
    state.cache.delete(state.cache.keys().next().value);
  }
};

const recordReview = (fromFen, toFen, review) => {
  if (!review) {
    return;
  }

  const key = positionKey(toFen);

  state.reviews.delete(key);
  state.reviews.set(key, { from: positionKey(fromFen), review });

  if (state.reviews.size > 3000) {
    state.reviews.delete(state.reviews.keys().next().value);
  }
};

/** The graded moves that led to `fen`, oldest first. */
const lineReviews = (fen) => {
  const out = [];
  const seen = new Set();
  let key = positionKey(fen);

  while (state.reviews.has(key) && !seen.has(key) && out.length < 1000) {
    seen.add(key);

    const { from, review } = state.reviews.get(key);

    out.push(review);
    key = from;
  }

  return out.reverse();
};

const GRADE_ORDER = ['Best', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
const PLURAL = { Best: 'best', Good: 'good', Inaccuracy: 'inaccuracies', Mistake: 'mistakes', Blunder: 'blunders' };
const SINGULAR = { Best: 'best', Good: 'good', Inaccuracy: 'inaccuracy', Mistake: 'mistake', Blunder: 'blunder' };
const bucket = (grade) => (grade === 'Missed mate' ? 'Mistake' : grade);

const renderAccuracy = (fen) => {
  const reviews = fen ? lineReviews(fen) : [];

  if (!reviews.length) {
    fill('accuracy');

    return;
  }

  const row = (color) => {
    const mine = reviews.filter((r) => r.color === color);
    const name = color === 'w' ? 'White' : 'Black';
    const you = (color === 'w') === (state.orientation === 'white');

    if (!mine.length) {
      return el('div', { class: 'acc-row' }, el('div', { class: 'acc-name' }, name, you ? el('span', { class: 'muted' }, ' (you)') : ''), el('div', { class: 'acc-pct muted' }, '–'));
    }

    const pct = overallAccuracy(mine.map((r) => r.accuracy));
    const counts = GRADE_ORDER
      .map((g) => [g, mine.filter((r) => bucket(r.grade) === g).length])
      .filter(([, n]) => n)
      .map(([g, n]) => `${n} ${n === 1 ? SINGULAR[g] : PLURAL[g]}`)
      .join(' · ');

    return el(
      'div',
      { class: 'acc-row' },
      el('div', { class: 'acc-name' }, name, you ? el('span', { class: 'muted' }, ' (you)') : ''),
      el('div', { class: `acc-pct ${pct >= 85 ? 'hi' : (pct >= 65 ? 'mid' : 'lo')}` }, `${pct.toFixed(1)}%`),
      el('div', { class: 'acc-dots' }, mine.map((r) => el('span', { class: `dot ${bucket(r.grade)}`, title: `${r.san}: ${r.grade} (${Math.round(r.accuracy)}%)` }))),
      el('div', { class: 'acc-counts muted' }, counts),
    );
  };

  fill(
    'accuracy',
    el('h3', {}, `Accuracy · ${reviews.length} move${reviews.length === 1 ? '' : 's'} so far`),
    row('w'),
    row('b'),
  );
};

const sendArrows = (result) => {
  if (!state.tabId) {
    return;
  }

  const arrows = [];

  if (state.settings.arrows && result && !puzzleHides(result)) {
    const sq = (uci) => (uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null);

    if (result.human) {
      arrows.push({ ...sq(result.human.uci), kind: 'human' });
    }

    if (result.best && !result.human?.isBest) {
      const wow = (result.best.badges || []).some((b) => ['Brilliant', 'Great', 'Only move'].includes(b));

      arrows.push({ ...sq(result.best.uci), kind: wow ? 'brilliant' : 'best' });
    } else if (result.best && result.human?.isBest) {
      // the human IS the best; if it's also a wow-move, swap the green arrow for the gold one
      const wow = (result.best.badges || []).some((b) => ['Brilliant', 'Great', 'Only move'].includes(b));

      if (wow && arrows.length) {
        arrows[arrows.length - 1].kind = 'brilliant';
      }
    }

    if (result.typical) {
      arrows.push({ from: result.typical.from, to: result.typical.to, kind: 'typical' });
    }

    // pre-move arrow: the move you can safely queue up on the site. Two cases:
    //
    //   A) It's YOUR turn to move: the pre-move is the follow-up you'd play AFTER your current
    //      move and their reply. We only draw this arrow when your piece is already sitting on
    //      the pre-move's from-square (otherwise it looks like an arrow from the wrong piece).
    //
    //   B) It's the OPPONENT'S turn: this is the main case the user asked for. The engine's
    //      best reply to the opponent's expected move is pv[1] of the best line. Queue THAT as
    //      your pre-move while they're thinking.
    //
    // Which case we're in is decided by comparing board orientation (your side) to the side to
    // move. When orientation isn't known (yet), we fall back to case A.
    const userColor = state.orientation?.[0];
    const opponentsTurn = userColor && result.turn && result.turn !== userColor;
    const primaryCard = result.human || result.best;

    const drawPremoveArrow = (uci) => {
      if (!uci || uci.length < 4 || !state.fen) return;
      const fromSq = uci.slice(0, 2);
      try {
        const chess = new Chess(state.fen);
        const piece = chess.get(fromSq);
        // our color = whichever color's move this is (userColor if known, else turn)
        const ourColor = userColor || result.turn;
        if (piece && piece.color === ourColor) {
          arrows.push({ from: fromSq, to: uci.slice(2, 4), kind: 'premove' });
        }
      } catch { /* ignore */ }
    };

    if (opponentsTurn) {
      // best line pv[1] = our engine-best response to the opponent's expected move
      const userResponseUci = (result.best?.pv || [])[1];
      drawPremoveArrow(userResponseUci);
    } else {
      // our turn: use the safe pre-move computed against opponent's likely replies
      const pm = primaryCard?.premove;
      if (pm && (pm.confidence === 'strong' || pm.confidence === 'conditional')) {
        drawPremoveArrow(pm.uci);
      }
    }

    if (result.threat) {
      arrows.push({ from: result.threat.from, to: result.threat.to, kind: 'threat' });
    }

    if (result.mistake && state.settings.mistakes) {
      arrows.push({ from: result.mistake.from, to: result.mistake.to, kind: 'mistake' });
    }
  }

  tabSend({ type: 'cc:arrows', arrows }).catch(() => {});
};

// ---------------------------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------------------------

const analyzeFen = async (fen) => {
  const seq = ++state.seq;
  const stale = () => seq !== state.seq;
  // stop any search still running in a helper worker from the previous position — its result would
  // be discarded by the stale check anyway, but the worker needs to free up for THIS position's probes
  engine.cancelAll();
  const key = positionKey(fen);
  const cached = state.cache.get(key);
  const level = Number(state.settings.level);

  // `arrows: false` lets us render the side-panel text (fast feedback) without drawing on the
  // board yet — we skip arrows during the shallow pass to avoid the flicker where the shallow
  // search's top move gets corrected by the deep search a second later.
  const show = (data, thinking, { arrows = true } = {}) => {
    const result = coachPosition(fen, { ...data, level });

    state.lastResult = { fen, data };
    renderEval(result, thinking);
    renderMoves(result);
    if (arrows) sendArrows(result);

    return result;
  };

  // grades the move(s) from the previous position, then shows the last move & accuracy for this line
  const reviewFrom = async (prevFen, deep) => {
    const prev = prevFen ? state.cache.get(positionKey(prevFen)) : null;

    if (prev?.deep?.length && !state.reviews.has(key)) {
      if (findMoveBetween(prevFen, fen)) {
        recordReview(prevFen, fen, reviewLastMove(prevFen, prev.deep, fen, deep));
      } else {
        // two moves happened while we were busy (a quick reply from the computer): grade both
        const mid = findPositionBetween(prevFen, fen);

        if (mid) {
          const midKey = positionKey(mid);
          let midLines = state.cache.get(midKey)?.deep;

          if (!midLines?.length) {
            const basic = /Basic engine/.test(engine.name || '');

            midLines = await engine.analyze(mid, { multipv: 1, depth: basic ? 6 : 14 });

            if (stale() || !midLines?.length) {
              return;
            }

            cacheSet(midKey, { deep: midLines, shallow: [], partial: true });
          }

          recordReview(prevFen, mid, reviewLastMove(prevFen, prev.deep, mid, midLines));
          recordReview(mid, fen, reviewLastMove(mid, midLines, fen, deep));
        }
      }
    }

    renderReview(state.reviews.get(key)?.review || null);
    renderAccuracy(fen);
  };

  const prevFen = state.prevFen;
  // the move that led here (for "takes back"), when we saw the position before it
  const lastMove = prevFen && fen !== prevFen ? findMoveBetween(prevFen, fen) : null;
  let picks = [];
  // the typical move card: the most likely move with the engine's verdict once we have one
  const typicalFrom = (reply = null, bestLine = null) => (picks.length ? {
    ...describeTypical(fen, picks[0], reply, bestLine, lastMove),
    others: picks.slice(1).map((p) => ({ san: p.san, share: p.share, source: p.source })),
  } : null);

  // a partial entry only has the main search (no traps etc.), so the position is searched again
  if (cached?.deep?.length && !cached.partial) {
    // keep recently viewed positions at the end so they're the last to be evicted
    cacheSet(key, cached);
    show(cached);
    state.prevFen = fen;
    await reviewFrom(prevFen, cached.deep);

    return;
  }

  renderReview(state.reviews.get(key)?.review || null);
  renderAccuracy(fen);
  renderEval(null, 'thinking…');
  renderMoves(null);
  sendArrows(null); // the old position's arrows would point at the wrong pieces

  // 1) quick look so something shows up right away
  // quick first pass: depth 4 gets the engine's top move + a usable PV in ~50-150ms, so the
  // arrows (including pink pre-move) appear fast. The deep search below still refines them.
  let shallow = await engine.analyze(fen, { multipv: 5, depth: 4 });

  // the engine was restarted mid-search: give the position one more try
  if (!stale() && !shallow?.length) {
    shallow = await engine.analyze(fen, { multipv: 5, depth: 4 });
  }

  if (stale()) {
    return;
  }

  if (!shallow?.length) {
    renderEval(null, 'The engine couldn\'t analyze this position.');

    return;
  }

  picks = typicalMoves(fen, { shallowLines: shallow, level, lastMove, book: bookMoves(fen) });
  // text only — no arrows yet. Deep search will replace this with the real picks and only then
  // do we touch the board overlay.
  show({ deep: shallow, shallow, typical: typicalFrom() }, 'thinking…', { arrows: false });

  // 2) what are they threatening if it were their move?
  const nf = nullMoveFen(fen);
  const nullLine = nf ? (await engine.analyze(nf, { multipv: 1, depth: 10 }))?.[0] || null : null;

  if (stale()) {
    return;
  }

  // 3) the real search
  const deep = await engine.analyze(fen, { multipv: 5, movetime: Number(state.settings.think) });

  if (stale() || !deep?.length) {
    return;
  }

  // with the engine's lines in hand, stronger players' choices lean toward the engine's (see typicalMoves)
  picks = typicalMoves(fen, { shallowLines: shallow, deepLines: deep, level, lastMove, book: bookMoves(fen) });
  const typicalKnown = deep.find((l) => l.pv[0] === picks[0]?.uci);
  const flip = (v) => (v === null || v === undefined ? null : -v);
  let typical = typicalFrom(typicalKnown
    ? lineAfterFirstMove(typicalKnown) || { scoreCp: flip(typicalKnown.scoreCp), mate: flip(typicalKnown.mate), pv: [] }
    : null, deep[0]);

  show({ deep, shallow, nullLine, typical }, 'checking traps…');

  // the main search is enough to grade moves: do it now, so a quick reply doesn't skip this move
  cacheSet(key, { deep, shallow, nullLine, typical, partial: true });
  state.prevFen = fen;
  await reviewFrom(prevFen, deep);

  if (stale()) {
    return;
  }

  // Short-circuit: when the position is already decided (forced mate, or eval beyond ±4.00), the
  // trap/mistake probes don't teach anything useful and just burn seconds. Skip straight to the final
  // render with empty traps/mistake.
  const best = deep[0];
  const decidedByEval = Math.abs(lineCp(best)) > 400 && Math.abs(lineCp(best)) < 90000;
  const decidedByMate = best.mate !== null && best.mate !== undefined;

  if (decidedByEval || decidedByMate) {
    const data = { deep, shallow, nullLine, traps: {}, mistake: null, typical };

    cacheSet(key, data);
    show(data);

    return;
  }

  // 4) traps and 5) tempting mistakes — both are independent probe batches that only depend on `deep`.
  // Run them in parallel across the pool; each batch's candidates also run in parallel.
  const basic = /Basic engine/.test(engine.name || '');
  const candidates = [...new Set(deep.slice(0, basic ? 2 : 3).map((l) => l.pv[0]))];

  const trapsPromise = Promise.all(candidates.map(async (uci) => {
    const line = deep.find((l) => l.pv[0] === uci);
    const afterOurs = playUci(fen, uci)?.chess.fen();

    for (const reply of temptingReplies(fen, uci, basic ? 2 : 3)) {
      if (stale()) {
        return null;
      }

      const afterReply = afterOurs ? playUci(afterOurs, reply.uci)?.chess.fen() : null;

      if (!afterReply) {
        continue;
      }

      const punish = (await engine.analyze(afterReply, { multipv: 1, depth: basic ? 6 : 12 }))?.[0];
      const trap = describeTrap(fen, line, reply, punish);

      if (trap) {
        return [uci, trap];
      }
    }

    return null;
  }));

  const mistakesPromise = Promise.all(mistakeCandidates(fen, deep, shallow, basic ? 2 : 4).map(async (candidate) => {
    let reply = lineAfterFirstMove(candidate.known);

    if (!reply) {
      const after = playUci(fen, candidate.uci)?.chess.fen();

      reply = after ? (await engine.analyze(after, { multipv: 1, depth: basic ? 6 : 11 }))?.[0] || null : null;
    }

    if (stale() || !reply) {
      return null;
    }

    return describeMistake(fen, candidate.uci, reply, deep[0]);
  }));

  // the typical move: when the main search didn't cover it, a quick look at the position after it
  const typicalPromise = (async () => {
    if (!picks.length || typical?.grade) {
      return typical;
    }

    const after = playUci(fen, picks[0].uci)?.chess.fen();
    const reply = after ? (await engine.analyze(after, { multipv: 1, depth: basic ? 6 : 11 }))?.[0] || null : null;

    return stale() || !reply ? typical : typicalFrom(reply, deep[0]);
  })();

  const [trapResults, mistakeResults, typicalResult] = await Promise.all([trapsPromise, mistakesPromise, typicalPromise]);

  typical = typicalResult;

  if (stale()) {
    return;
  }

  const traps = {};

  trapResults.filter(Boolean).forEach(([uci, trap]) => { traps[uci] = trap; });

  // the mistakes array came out in candidate-order (most tempting first) — take the first that qualified
  const mistake = mistakeResults.find(Boolean) || null;

  const data = { deep, shallow, nullLine, traps, mistake, typical };

  cacheSet(key, data);

  show(data);
};

const onBoard = (message) => {
  // a board that can't be real (a piece mid-capture, a half-drawn board) is ignored until it settles
  if (message?.fen && !isPlausiblePosition(message.fen)) {
    message = { ...message, fen: null };
  }

  if (message?.fen) {
    message = { ...message, fen: resolveTurn(message, state.fen, state.settings.turn) };
  }

  // While a piece is literally being dragged, DOM states are transient (the dragged piece is
  // detached from its square, ghost placeholders appear). Hold the current analysis instead of
  // thrashing arrows and re-running the engine on a position that isn't the real move.
  if (message.moving && state.fen) {
    return;
  }

  state.gate = message.gate;
  state.orientation = message.orientation || state.orientation;
  renderGate(message.gate);

  if (!message.gate?.allowed || !message.fen) {
    state.fen = null;
    state.seq += 1; // cancel anything in flight

    if (message.gate?.allowed && !message.fen) {
      $('thinking').textContent = 'Waiting for a board…';
    }

    sendArrows(null);

    return;
  }

  if (message.fen === state.fen) {
    return;
  }

  state.fen = message.fen;
  analyzeFen(message.fen);
};

const rerender = () => {
  if (!state.lastResult || state.lastResult.fen !== state.fen) {
    return;
  }

  const result = coachPosition(state.fen, { ...state.lastResult.data, level: Number(state.settings.level) });

  renderMoves(result);
  sendArrows(result);
};

// ---------------------------------------------------------------------------------------------
// panel tabs
// ---------------------------------------------------------------------------------------------

const openings = mountOpenings($('page-openings'), { el, getRating: () => Number(state.settings.level) });

const showTab = (name) => {
  $('tab-coach').classList.toggle('active', name === 'coach');
  $('tab-openings').classList.toggle('active', name === 'openings');
  $('page-coach').hidden = name !== 'coach';
  $('page-openings').hidden = name !== 'openings';
};

$('tab-coach').addEventListener('click', () => showTab('coach'));
$('tab-openings').addEventListener('click', () => { openings.refresh(); showTab('openings'); });

// ---------------------------------------------------------------------------------------------
// tabs & messages
// ---------------------------------------------------------------------------------------------

// tests open the panel as a normal page with ?tab=<id> to point it at a specific tab
const forcedTab = Number(new URLSearchParams(location.search).get('tab')) || null;

const requestBoard = async () => {
  const [tab] = EMBEDDED ? [{ id: 'page' }]
    : forcedTab ? [{ id: forcedTab }] : await chrome.tabs.query({ active: true, currentWindow: true });
  const newTab = (tab?.id ?? null) !== state.tabId;

  state.tabId = tab?.id ?? null;
  state.fen = null;

  // a reload of the same tab keeps the previous position, so a move made across a reload is still graded
  if (newTab) {
    state.prevFen = null;
  }

  if (!state.tabId) {
    return;
  }

  try {
    const snapshot = await tabSend({ type: 'cc:request' });

    if (snapshot) {
      onBoard(snapshot);
    }
  } catch {
    renderGate({ allowed: false, reason: 'Open Lichess or Chess.com in this tab (refresh the page if it was already open).' });
  }
};

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'cc:board' && sender.tab?.id === state.tabId) {
    onBoard(message);
  }
});

if (EMBEDDED) {
  // the page's content script answers requests and sends each new board
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !event.data?.__cc) {
      return;
    }

    const { data } = event;

    if (data.type === 'cc:snapshot') {
      pending.get(data.id)?.(data.snapshot);
      pending.delete(data.id);
    } else if (data.type === 'cc:board') {
      onBoard(data);
    }
  });
} else {
  chrome.tabs.onActivated.addListener(() => {
    if (!forcedTab) {
      requestBoard();
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.tabId && info.status === 'complete') {
      requestBoard();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------------------------

const bindSettings = async () => {
  // saved settings, but never wait long for them: some iPhone browsers don't answer storage calls,
  // and the defaults are fine
  let saved = {};

  try {
    saved = await Promise.race([
      chrome.storage.local.get(['level', 'think', 'arrows', 'mistakes', 'puzzle', 'turn']),
      new Promise((resolve) => { setTimeout(() => resolve({}), 1500); }),
    ]) || {};
  } catch {
    saved = {};
  }

  Object.assign(state.settings, Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));

  const save = () => {
    try {
      chrome.storage.local.set(state.settings)?.catch?.(() => {});
    } catch {
      // settings just won't be remembered
    }
  };

  $('level').value = String(state.settings.level);
  $('think').value = String(state.settings.think);
  $('arrows').checked = !!state.settings.arrows;
  $('mistakes').checked = !!state.settings.mistakes;
  $('puzzle').checked = !!state.settings.puzzle;
  $('turn-select').value = state.settings.turn || 'auto';

  $('turn-select').addEventListener('change', () => {
    state.settings.turn = $('turn-select').value;
    save();
    state.fen = null;
    state.prevFen = null;
    requestBoard();
  });

  $('puzzle').addEventListener('change', () => {
    state.settings.puzzle = $('puzzle').checked;
    save();
    rerender();
  });


  $('level').addEventListener('change', () => {
    state.settings.level = Number($('level').value);
    save();

    // the human pick depends on the level, but the analysis doesn't: redraw from what we have
    // (keeps the last-move review, and an unfinished search carries on with the new level)
    rerender();
  });

  $('think').addEventListener('change', () => {
    state.settings.think = Number($('think').value);
    state.cache.clear();
    save();

    if (state.fen) {
      analyzeFen(state.fen);
    }
  });

  $('arrows').addEventListener('change', () => {
    state.settings.arrows = $('arrows').checked;
    save();
    rerender();
  });

  $('mistakes').addEventListener('change', () => {
    state.settings.mistakes = $('mistakes').checked;
    save();
    rerender();
  });
};

(async () => {
  await bindSettings();

  const name = await engine.start();

  $('engine-name').textContent = `Engine: ${name}`;
  await requestBoard();
})();
