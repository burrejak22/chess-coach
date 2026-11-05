// The Openings tab: recommended openings by side & level, each with a clickable move list on a mini board,
// key ideas, plans and the traps to know.

import { Chess } from './lib/chess.js';
import { OPENINGS, formatMoves, lichessAnalysisUrl, playLine } from './lib/openings.js';

const GLYPHS = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

const levelFor = (rating) => (rating <= 1200 ? 'Beginner' : (rating <= 1600 ? 'Intermediate' : 'Advanced'));

/**
 * @param {HTMLElement} root
 * @param {{ el: Function, getRating: () => number }} deps
 */
export const mountOpenings = (root, { el, getRating }) => {
  const view = { side: 'w', level: 'For you', openingId: null, line: null, ply: -1, trapIndex: null };

  const board = (fen, highlight = []) => {
    const chess = new Chess(fen);
    const flip = view.side === 'b';
    const cells = [];

    for (let r = 0; r < 8; r += 1) {
      for (let f = 0; f < 8; f += 1) {
        const rank = flip ? r + 1 : 8 - r;
        const file = flip ? 7 - f : f;
        const square = `${'abcdefgh'[file]}${rank}`;
        const piece = chess.get(square);
        const light = (file + rank) % 2 === 1;

        cells.push(el(
          'div',
          { class: `${light ? 'l' : 'd'}${highlight.includes(square) ? ' hl' : ''}${piece ? ` p${piece.color}` : ''}`, title: square },
          piece ? GLYPHS[`${piece.color}${piece.type}`] : '',
        ));
      }
    }

    return el('div', { class: 'mini' }, cells);
  };

  const seg = (options, value, onPick) => el('div', { class: 'seg' }, options.map(([v, label]) => el(
    'button',
    { type: 'button', class: v === value ? 'on' : '', onclick: () => onPick(v) },
    label,
  )));

  const renderList = () => {
    const rating = getRating();
    const level = view.level === 'For you' ? levelFor(rating) : view.level;
    // "for you": your level and anything easier, with your level starred
    const ORDER = ['Beginner', 'Intermediate', 'Advanced'];
    const items = OPENINGS
      .filter((o) => o.side === view.side && (view.level === 'All' || ORDER.indexOf(o.level) <= ORDER.indexOf(level)))
      .sort((a, b) => Number(b.level === level) - Number(a.level === level));

    root.replaceChildren(...[
      el(
        'div',
        { class: 'filters' },
        seg([['w', 'As White'], ['b', 'As Black']], view.side, (v) => { view.side = v; renderList(); }),
        seg([['For you', `For you (${levelFor(rating)})`], ['All', 'All levels']], view.level, (v) => { view.level = v; renderList(); }),
      ),
      el(
        'div',
        { class: 'olist' },
        items.length ? items.map((o) => el(
          'button',
          { type: 'button', class: 'item', onclick: () => open(o.id) },
          el('div', {}, el('b', {}, o.name), o.level === levelFor(rating) ? el('span', { class: 'rec' }, '  ★ recommended') : ''),
          el('div', { class: 'meta' }, `${o.level} · ${o.style}${o.against ? ` · vs ${o.against}` : ''}`),
          el('div', { class: 'meta' }, formatMoves(o.moves, 6)),
        )) : el('div', { class: 'muted' }, 'Nothing at this level for this side yet. Try "All levels".'),
      ),
    ].filter(Boolean));
  };

  const renderOpening = () => {
    const o = OPENINGS.find((x) => x.id === view.openingId);
    const trap = view.trapIndex === null ? null : o.traps[view.trapIndex];
    const moves = trap ? trap.moves : o.moves;
    const steps = view.line;
    const current = view.ply >= 0 ? steps[view.ply] : null;
    const fen = current ? current.fen : new Chess().fen();
    const note = trap
      ? (view.ply === steps.length - 1 ? trap.note : '')
      : (o.notes[view.ply] || (view.ply === -1 ? 'Start position. Step through the moves.' : ''));

    const go = (ply) => {
      view.ply = Math.max(-1, Math.min(steps.length - 1, ply));
      renderOpening();
    };

    const moveButtons = [];

    moves.forEach((san, i) => {
      if (i % 2 === 0) {
        moveButtons.push(el('span', { class: 'num' }, `${(i / 2) + 1}.`));
      }

      moveButtons.push(el('button', { type: 'button', class: i === view.ply ? 'cur' : '', onclick: () => go(i) }, san));
    });

    root.replaceChildren(...[
      el('div', { class: 'btnrow' }, el('button', { type: 'button', class: 'btn', onclick: () => { view.openingId = null; renderList(); } }, '← All openings')),
      el(
        'section',
        { class: 'card' },
        el('h3', {}, trap ? `Trap · ${o.name}` : `${o.side === 'w' ? 'White' : 'Black'} · ${o.level} · ${o.style}`),
        el('div', { class: 'san' }, trap ? trap.name : o.name),
        board(fen, current ? [current.from, current.to] : []),
        el(
          'div',
          { class: 'btnrow' },
          el('button', { type: 'button', class: 'btn', onclick: () => go(-1) }, '⏮'),
          el('button', { type: 'button', class: 'btn', onclick: () => go(view.ply - 1) }, '◀'),
          el('button', { type: 'button', class: 'btn primary', onclick: () => go(view.ply + 1) }, 'Next ▶'),
          el('button', { type: 'button', class: 'btn', onclick: () => go(steps.length - 1) }, '⏭'),
          el('button', { type: 'button', class: 'btn', onclick: () => chrome.tabs.create({ url: lichessAnalysisUrl(fen) }) }, 'Open on Lichess'),
        ),
        el('div', { class: 'moves' }, moveButtons),
        el('div', { class: 'note' }, note || ''),
        trap ? el('div', { class: trap.good === 'you' ? 'good-you' : 'good-them' }, trap.good === 'you' ? 'A trap you can set.' : 'A trap to avoid.') : null,
        trap ? el('div', { class: 'btnrow' }, el('button', { type: 'button', class: 'btn', onclick: () => openLine(o, null) }, 'Back to the main line')) : null,
      ),
      trap ? null : el(
        'section',
        { class: 'card' },
        el('h3', {}, 'Key ideas'),
        el('ul', {}, o.ideas.map((t) => el('li', {}, t))),
        el('h3', {}, 'After the opening'),
        el('ul', {}, o.plans.map((t) => el('li', {}, t))),
      ),
      trap || !o.traps.length ? null : el(
        'section',
        { class: 'card' },
        el('h3', {}, 'Traps'),
        o.traps.map((t, i) => el(
          'div',
          { class: 'trap' },
          el('div', {}, el('b', {}, t.name), '  ', el('span', { class: t.good === 'you' ? 'good-you' : 'good-them' }, t.good === 'you' ? 'you can set it' : 'avoid it')),
          el('div', { class: 'muted' }, t.note),
          el('div', { class: 'btnrow' }, el('button', { type: 'button', class: 'btn', onclick: () => openLine(o, i) }, 'Show it on the board')),
        )),
      ),
    ].filter(Boolean));
  };

  const openLine = (o, trapIndex) => {
    view.openingId = o.id;
    view.side = o.side;
    view.trapIndex = trapIndex;
    view.line = playLine(trapIndex === null ? o.moves : o.traps[trapIndex].moves);
    view.ply = -1;
    renderOpening();
  };

  const open = (id) => {
    const o = OPENINGS.find((x) => x.id === id);

    if (o) {
      openLine(o, null);
    }
  };

  renderList();

  return {
    open,
    refresh: () => (view.openingId ? renderOpening() : renderList()),
  };
};
