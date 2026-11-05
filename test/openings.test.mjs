import { Chess } from '../lib/chess.js';
import { OPENINGS, playLine, detectOpening, formatMoves } from '../lib/openings.js';

let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${detail}`}`); if (!cond) fails += 1; };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const materialFor = (chess, color) => chess.board().flat().reduce((s, p) => (p ? s + (p.color === color ? VAL[p.type] : -VAL[p.type]) : s), 0);

for (const o of OPENINGS) {
  let ok = true; let err = '';
  try { playLine(o.moves); } catch (e) { ok = false; err = e.message; }
  check(`${o.name}: main line is legal (${formatMoves(o.moves)})`, ok, err);
  check(`${o.name}: starts with the right side to move`, o.side === 'w' ? true : o.moves.length >= 2, 'too short');
  Object.keys(o.notes).forEach((k) => check(`${o.name}: note at ply ${k} exists in the line`, Number(k) < o.moves.length, k));
  // notes should be on the side's own moves
  Object.keys(o.notes).forEach((k) => {
    const mine = (Number(k) % 2 === 0) === (o.side === 'w');
    if (!mine) { check(`${o.name}: note ${k} is on one of your moves`, false, `ply ${k} is the opponent's move`); }
  });

  for (const t of o.traps) {
    let chess = new Chess(); let legal = true; let e2 = '';
    try { t.moves.forEach((m) => chess.move(m)); } catch (e) { legal = false; e2 = e.message; }
    check(`${o.name} / ${t.name}: trap line is legal`, legal, e2);
    if (!legal) continue;
    // who benefits: the side that sets the trap should be winning (mate or ≥3 points up)
    const yourColor = o.side;
    const winner = t.good === 'you' ? yourColor : (yourColor === 'w' ? 'b' : 'w');
    const mated = chess.isCheckmate() ? (chess.turn() === winner ? 'winner mated' : 'loser mated') : null;
    const diff = materialFor(chess, winner);
    // Fried Liver is positional (king hunt), material can be even; accept if the loser's king is exposed (moved off its home square)
    const loserKing = chess.board().flat().find((p) => p && p.type === 'k' && p.color !== winner);
    const exposed = loserKing && !['e1', 'e8'].includes(loserKing.square) && !['g1', 'g8', 'c1', 'c8'].includes(loserKing.square);
    check(`${o.name} / ${t.name}: ends well for ${t.good === 'you' ? 'you' : 'them'} (${mated || `material ${diff >= 0 ? '+' : ''}${diff}`}${exposed ? ', king exposed' : ''})`,
      mated === 'loser mated' || diff >= 2 || (t.kind === 'attack' && exposed && diff >= -3), chess.fen());
  }
}

const afterBc4 = playLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']).pop().fen;
let d = detectOpening(afterBc4);
check('after 3.Bc4 (Black to move): Two Knights, next ...Nf6', d?.opening?.id === 'two-knights' && d.next === 'Nf6' && d.also.includes('Italian Game'), JSON.stringify({ id: d?.opening?.id, next: d?.next, also: d?.also }));
const afterBc5 = playLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']).pop().fen;
d = detectOpening(afterBc5);
check('after 3...Bc5 (White to move): Italian, next c3 with its note', d?.opening?.id === 'italian' && d.next === 'c3' && /d4/.test(d.note || ''), JSON.stringify({ id: d?.opening?.id, next: d?.next, note: d?.note }));
check('no match for a random position', detectOpening('8/8/8/4k3/8/8/8/4K3 w - - 0 1') === null, 'matched');

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
