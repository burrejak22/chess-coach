import { searchPosition } from '../lib/basic-engine.js';
import { coachPosition, describeTypical, findMoveBetween, typicalMoves } from '../lib/coach.js';
import { bookMoves } from '../lib/openings.js';

let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${JSON.stringify(detail)}`}`); if (!cond) fails += 1; };
const typical = (fen, { prev = null, level = 1600 } = {}) => typicalMoves(fen, {
  shallowLines: searchPosition(fen, { depth: 2, multipv: 5 }),
  level,
  lastMove: prev ? findMoveBetween(prev, fen) : null,
  book: bookMoves(fen),
});
const sans = (list) => list.map((m) => m.san);

// first move: the popular centre pawns
const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
check('start: e4 and d4 are the two most typical', sans(typical(start).slice(0, 2)).sort().join() === 'd4,e4', sans(typical(start)));

// after 4.Bxc6 almost everyone takes back
const beforeTake = 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
const afterTake = 'r1bqkbnr/1ppp1ppp/p1B5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4';
const recapture = typical(afterTake, { prev: beforeTake });
check('takes back after a capture', ['dxc6', 'bxc6'].includes(recapture[0].san) && recapture[0].share > 0.4, recapture);

// a queen attacked by a pawn gets moved, and not into a losing capture
const queenHit = 'rnb1kbnr/pppp1ppp/8/4p1q1/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 3';
const qh = typical(queenHit, { level: 800 });
check('saves the attacked queen', qh[0].san.startsWith('Q') && qh[0].san !== 'Qxc1+' && qh[0].san !== 'Qxc1', sans(qh));

// the Italian: the book moves
const italian = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
check('Italian: Nf6 and Bc5 lead', sans(typical(italian).slice(0, 2)).sort().join() === 'Bc5,Nf6', sans(typical(italian)));

// Bxh7+ dropping a bishop for a pawn is less tempting for stronger players
const greek = 'r2q1rk1/pp2bppp/2n1pn2/3p4/3P1B2/2PB1N2/PP3PPP/RN1Q1RK1 w - - 0 10';
const share = (list, san) => list.find((m) => m.san === san)?.share || 0;
check('stronger players fall for Bxh7+ less', share(typical(greek, { level: 2400 }), 'Bxh7+') < share(typical(greek, { level: 800 }), 'Bxh7+'));

check('shares are between 0 and 1 and sorted', typical(greek).every((m, i, a) => m.share > 0 && m.share <= 1 && (!i || a[i - 1].share >= m.share)));

// the engine's verdict on it
const pick = { uci: 'd3h7', san: 'Bxh7+', share: 0.4 };
const best = { scoreCp: 30, mate: null, pv: ['b1d2', 'a8c8'] };
const bad = describeTypical(greek, pick, { scoreCp: 180, mate: null, pv: ['f6h7', 'f3g5'] }, best);
check('a typical move that loses material is graded', bad.grade === 'Mistake' && bad.loss === 210 && /Nxh7|Better is/.test(bad.wrong || ''), bad);
check('says why people play it', bad.why === 'Grabs the pawn on h7.', bad.why);
const ok = describeTypical(start, { uci: 'e2e4', san: 'e4', share: 0.6 }, { scoreCp: -30, pv: ['e7e5'] }, { scoreCp: 30, pv: ['e2e4'] });
check('the best move is graded Best', ok.grade === 'Best' && ok.loss === 0 && !ok.wrong, ok);
const pending = describeTypical(start, { uci: 'e2e4', san: 'e4', share: 0.6 }, null, null);
check('without engine lines it still shows the move', pending.san === 'e4' && pending.grade === null, pending);

// coachPosition passes it through
const lines = searchPosition(start, { depth: 2, multipv: 3 });
check('coachPosition carries the typical move', coachPosition(start, { deep: lines, shallow: lines, typical: ok }).typical?.san === 'e4');

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
