import { searchPosition } from '../lib/basic-engine.js';
import { LEVELS, coachPosition, describeTypical, findMoveBetween, pickHumanMove, typicalMoves, typicalScore } from '../lib/coach.js';
import { engineMatchRate, openingShares } from '../lib/human-data.js';
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

// --- research-based behaviour, 1500-3000 ---

// real opening statistics by rating (Lichess blitz & rapid)
const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const at = (fen, level) => typicalMoves(fen, { shallowLines: [], level, book: bookMoves(fen) });
check('vs 1.e4: e5 is most common at 1500', at(afterE4, 1500)[0].san === 'e5' && at(afterE4, 1500)[0].source === 'games', at(afterE4, 1500));
check('vs 1.e4: the Sicilian takes over at 2500', at(afterE4, 2500)[0].san === 'c5', at(afterE4, 2500));
const morphy = 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 3 5';
check('Ruy Lopez: 5...Be7 is the main move at 2500', at(morphy, 2500)[0].san === 'Be7' && Math.abs(at(morphy, 2500)[0].share - 0.559) < 0.001, at(morphy, 2500));
check('Ruy Lopez: weaker players are more spread out (b5 / Nxe4)', at(morphy, 1000)[0].san !== 'Be7', at(morphy, 1000));
check('opening shares interpolate between 400 and 2500', Math.abs(openingShares(afterE4, 1450).e5 - ((0.625 + 0.194) / 2)) < 0.001);

// how often players match the engine (Regan): 45.8% at 2000, +1.5 per 100
check('engine match rate follows Regan\'s data', Math.abs(engineMatchRate(2000) - 0.458) < 1e-9 && Math.abs(engineMatchRate(2800) - 0.578) < 1e-9 && engineMatchRate(1500) < engineMatchRate(3000));
const quiet = 'r2q1rk1/pp2bppp/2n1pn2/3p4/3P1B2/2PB1N2/PP3PPP/RN1Q1RK1 w - - 0 10';
const engineLines = [
  { scoreCp: 40, mate: null, pv: ['b1d2'] },
  { scoreCp: 30, mate: null, pv: ['d1e2'] },
  { scoreCp: 25, mate: null, pv: ['f1e1'] },
  { scoreCp: 20, mate: null, pv: ['a2a4'] },
  { scoreCp: -180, mate: null, pv: ['d3h7'] },
];
const bestShare = (level) => (typicalMoves(quiet, { deepLines: engineLines, level, max: 40 }).find((m) => m.uci === 'b1d2')?.share || 0);
check('stronger players pick the engine\'s move more often', bestShare(1500) < bestShare(2200) && bestShare(2200) < bestShare(3000), [bestShare(1500), bestShare(2200), bestShare(3000)]);
const greekShare = (level) => (typicalMoves(quiet, { deepLines: engineLines, level, max: 40 }).find((m) => m.san === 'Bxh7+')?.share || 0);
check('the unsound Bxh7+ fades with rating', greekShare(1500) > 2 * greekShare(2800), [greekShare(1500), greekShare(2800)]);

// blind spots: a backward diagonal move is less likely than the same move forward
const lone = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 40';
check('backward diagonal moves are seen less', typicalScore(lone, 'c4b3', { level: 1500 }) < typicalScore(lone, 'c4b5', { level: 1500 }));

// the new strong levels exist and hug the engine
['2600', '2800', '3000'].forEach((l) => check(`level ${l} is available`, !!LEVELS[l]));
const strong = pickHumanMove(quiet, engineLines, [], 3000);
check('at 3000 the human move is the engine move', strong.isBest, strong);

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
