import { Engine } from './lib/engine.js';
import {
  coachPosition,
  describeTrap,
  findMoveBetween,
  nullMoveFen,
  playUci,
  resolveTurn,
  reviewLastMove,
  temptingReplies,
} from './lib/coach.js';
import { detectOpening, formatMoves } from './lib/openings.js';
import { mountOpenings } from './openings-ui.js';

const $ = (id) => document.getElementById(id);
const engine = new Engine();

const state = {
  tabId: null,
  gate: null,
  fen: null,
  settings: { level: 1600, think: 2500, arrows: true, puzzle: false, turn: 'auto' },
  revealed: new Set(), // positions where you asked to see the puzzle answer
  hinted: new Set(),
  lastResult: null,
  cache: new Map(), // fen -> { deep, shallow, nullLine }
  prevFen: null,
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

const BADGE_LABEL = { Brilliant: 'Brilliant!!', 'Only move': 'Only move', Trap: 'Trap' };

const badges = (card) => (card?.badges || []).map((b) => el('span', { class: `badge ${b.split(' ')[0]}` }, BADGE_LABEL[b] || b));

const renderOpening = () => {
  const hit = state.fen ? detectOpening(state.fen) : null;

  if (!hit) {
    fill('opening');

    return;
  }

  fill(
    'opening',
    el('h3', {}, 'Opening'),
    el('div', {}, el('span', { class: 'name' }, hit.opening.name), hit.also?.length ? el('span', { class: 'muted' }, ` (also: ${hit.also.join(', ')})`) : ''),
    hit.next
      ? el('div', { class: 'plan' }, 'Book move: ', el('b', {}, hit.next), hit.note ? `: ${hit.note}` : '')
      : el('div', { class: 'plan' }, 'End of the book line. Time for the plans.'),
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
    ['human', 'best', 'alts', 'threat'].forEach((id) => fill(id));

    return;
  }

  const { human, best, alternatives, threat } = result;

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
    );
  }

  fill('best', human?.isBest ? [] : [
    el('h3', {}, 'Engine\'s best'),
    el('div', { class: 'move' }, el('span', { class: 'san' }, best.san), badges(best), el('span', { class: 'tag' }, best.eval)),
    list(best.reasons),
    best.plan?.length ? el('div', { class: 'plan' }, 'Plan: ', el('b', {}, best.plan.join(' → '))) : null,
  ]);

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
      arrows.push({ ...sq(result.best.uci), kind: 'best' });
    }

    if (result.threat) {
      arrows.push({ from: result.threat.from, to: result.threat.to, kind: 'threat' });
    }
  }

  chrome.tabs.sendMessage(state.tabId, { type: 'cc:arrows', arrows }).catch(() => {});
};

// ---------------------------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------------------------

const positionKey = (fen) => fen.split(' ').slice(0, 2).join(' ');

const analyzeFen = async (fen) => {
  const seq = ++state.seq;
  const stale = () => seq !== state.seq;
  const key = positionKey(fen);
  const cached = state.cache.get(key);
  const level = Number(state.settings.level);

  const show = (data, thinking) => {
    const result = coachPosition(fen, { ...data, level });

    state.lastResult = { fen, data };
    renderEval(result, thinking);
    renderMoves(result);
    sendArrows(result);

    return result;
  };

  const reviewFrom = (prevFen, deep) => {
    const prev = prevFen ? state.cache.get(positionKey(prevFen)) : null;

    if (!prev?.deep?.length || !findMoveBetween(prevFen, fen)) {
      renderReview(null);

      return;
    }

    renderReview(reviewLastMove(prevFen, prev.deep, fen, deep));
  };

  const prevFen = state.prevFen;

  if (cached?.deep?.length) {
    show(cached);
    reviewFrom(prevFen, cached.deep);
    state.prevFen = fen;

    return;
  }

  renderReview(null);
  renderEval(null, 'thinking…');
  renderMoves(null);

  // 1) quick look so something shows up right away
  const shallow = await engine.analyze(fen, { multipv: 5, depth: 6 });

  if (stale() || !shallow?.length) {
    return;
  }

  show({ deep: shallow, shallow }, 'thinking…');

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

  // 4) traps: do their most tempting replies to our top moves lose?
  const traps = {};
  const basic = /Basic engine/.test(engine.name || '');
  const candidates = [...new Set(deep.slice(0, basic ? 2 : 3).map((l) => l.pv[0]))];

  for (const uci of candidates) {
    const line = deep.find((l) => l.pv[0] === uci);
    const afterOurs = playUci(fen, uci)?.chess.fen();

    for (const reply of temptingReplies(fen, uci, basic ? 2 : 3)) {
      if (stale()) {
        return;
      }

      const afterReply = afterOurs ? playUci(afterOurs, reply.uci)?.chess.fen() : null;

      if (!afterReply) {
        continue;
      }

      const punish = (await engine.analyze(afterReply, { multipv: 1, depth: basic ? 6 : 12 }))?.[0];
      const trap = describeTrap(fen, line, reply, punish);

      if (trap) {
        traps[uci] = trap;
        break;
      }
    }
  }

  if (stale()) {
    return;
  }

  const data = { deep, shallow, nullLine, traps };

  state.cache.set(key, data);

  if (state.cache.size > 400) {
    state.cache.delete(state.cache.keys().next().value);
  }

  show(data);
  reviewFrom(prevFen, deep);
  state.prevFen = fen;
};

const onBoard = (message) => {
  if (message?.fen) {
    message = { ...message, fen: resolveTurn(message, state.fen, state.settings.turn) };
  }

  state.gate = message.gate;
  renderGate(message.gate);

  if (!message.gate?.allowed || !message.fen) {
    state.fen = null;
    state.seq += 1; // cancel anything in flight

    if (message.gate?.allowed && !message.fen) {
      $('thinking').textContent = 'Waiting for a board…';
    }

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

void formatMoves;

// ---------------------------------------------------------------------------------------------
// tabs & messages
// ---------------------------------------------------------------------------------------------

// tests open the panel as a normal page with ?tab=<id> to point it at a specific tab
const forcedTab = Number(new URLSearchParams(location.search).get('tab')) || null;

const requestBoard = async () => {
  const [tab] = forcedTab ? [{ id: forcedTab }] : await chrome.tabs.query({ active: true, currentWindow: true });

  state.tabId = tab?.id ?? null;
  state.fen = null;
  state.prevFen = null;

  if (!state.tabId) {
    return;
  }

  try {
    const snapshot = await chrome.tabs.sendMessage(state.tabId, { type: 'cc:request' });

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

// ---------------------------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------------------------

const bindSettings = async () => {
  const saved = await chrome.storage.local.get(['level', 'think', 'arrows', 'puzzle', 'turn']);

  Object.assign(state.settings, Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));

  $('level').value = String(state.settings.level);
  $('think').value = String(state.settings.think);
  $('arrows').checked = !!state.settings.arrows;
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

  const save = () => chrome.storage.local.set(state.settings);

  $('level').addEventListener('change', () => {
    state.settings.level = Number($('level').value);
    save();

    // the human pick depends on the level, but the analysis doesn't: re-render from the cache
    if (state.fen) {
      state.prevFen = null;
      analyzeFen(state.fen);
    }
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

    if (state.fen) {
      const cached = state.cache.get(positionKey(state.fen));

      sendArrows(cached ? coachPosition(state.fen, { ...cached, level: state.settings.level }) : null);
    }
  });
};

(async () => {
  await bindSettings();

  const name = await engine.start();

  $('engine-name').textContent = `Engine: ${name}`;
  await requestBoard();
})();
