// Builds fake Lichess (chessground) & Chess.com board pages from a FEN, matching how each site renders pieces.
const FILES = 'abcdefgh';
const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const squares = (fen) => {
  const out = [];
  fen.split(' ')[0].split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      out.push({ square: `${FILES[f]}${8 - i}`, color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() });
      f += 1;
    }
  });
  return out;
};

export const lichessPage = (fen, { orientation = 'white', lastMove = [], extra = '' } = {}) => {
  const size = 64;
  const pos = (sq) => {
    const f = FILES.indexOf(sq[0]); const r = Number(sq[1]) - 1;
    const x = orientation === 'white' ? f : 7 - f; const y = orientation === 'white' ? 7 - r : r;
    return `transform: translate(${x * size}px, ${y * size}px);`;
  };
  const pieces = squares(fen).map((p) => `<piece class="${p.color === 'w' ? 'white' : 'black'} ${ROLE[p.type]}" style="${pos(p.square)}"></piece>`).join('');
  const marks = lastMove.map((sq) => `<square class="last-move" style="${pos(sq)}"></square>`).join('');
  return `<!doctype html><html><body>${extra}<div class="cg-wrap orientation-${orientation}" style="width:512px;height:512px;position:relative">
    <cg-container style="width:512px;height:512px;display:block"><cg-board style="width:512px;height:512px;display:block;position:relative">${marks}${pieces}</cg-board></cg-container></div></body></html>`;
};

export const chessComPage = (fen, { flipped = false, lastMove = [], extra = '' } = {}) => {
  const code = (sq) => `square-${FILES.indexOf(sq[0]) + 1}${sq[1]}`;
  const pieces = squares(fen).map((p) => `<div class="piece ${p.color}${p.type} ${code(p.square)}"></div>`).join('');
  const marks = lastMove.map((sq) => `<div class="highlight ${code(sq)}"></div>`).join('');
  return `<!doctype html><html><body>${extra}<wc-chess-board class="board${flipped ? ' flipped' : ''}" style="display:block;width:480px;height:480px">${marks}${pieces}</wc-chess-board></body></html>`;
};
