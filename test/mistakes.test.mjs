import { searchPosition } from '../lib/basic-engine.js';
import {
  coachPosition, describeMistake, lineAfterFirstMove, mistakeCandidates, MISTAKE_MAX, MISTAKE_MIN,
} from '../lib/coach.js';

let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${JSON.stringify(detail)}`}`); if (!cond) fails += 1; };

// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 (White to move). 4.Nxe5? looks like a free pawn but 4...Qg5! is strong.
const shilling = 'r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const deep = [
  { depth: 20, multipv: 1, scoreCp: 40, mate: null, pv: ['f3d4', 'e5d4', 'c2c3'] },
  { depth: 20, multipv: 2, scoreCp: 30, mate: null, pv: ['e1g1', 'd7d6'] },
  { depth: 20, multipv: 3, scoreCp: 25, mate: null, pv: ['b1c3', 'g8f6'] },
];

const candidates = mistakeCandidates(shilling, deep, [], 4);
check('Nxe5 is one of the tempting moves', candidates.some((c) => c.uci === 'f3e5'), candidates);
check('good moves are never candidates', !candidates.some((c) => ['f3d4', 'e1g1', 'b1c3'].includes(c.uci)), candidates);
check('candidates are sorted by how tempting they look', candidates.every((c, i) => i === 0 || candidates[i - 1].temptation >= c.temptation), candidates);

// after 4.Nxe5 the engine (Black's view) likes 4...Qg5 at about +1.5 for Black
const reply = { depth: 18, multipv: 1, scoreCp: 150, mate: null, pv: ['d8g5', 'e5f7', 'g5g2', 'h1f1'] };
const m = describeMistake(shilling, 'f3e5', reply, deep[0]);
check('Nxe5 is described as a mistake', m?.grade === 'Mistake' && m.loss === 190, m);
check('says why it is tempting', m?.lure === 'Grabs the pawn on e5.', m?.lure);
check('says what goes wrong with Qg5', /^They answer Qg5/.test(m?.wrong || ''), m?.wrong);
check('arrow squares are the move', m?.from === 'f3' && m?.to === 'e5', m);
check('eval is from White\'s view', m?.eval === '-1.5', m?.eval);
console.log('     ', m?.san, '|', m?.lure, '|', m?.wrong);

// size limits: too small isn't a mistake, game-losing isn't "tempting mistake" material, nor is walking into mate
check('a tiny loss is not shown', describeMistake(shilling, 'f3e5', { ...reply, scoreCp: -40 + MISTAKE_MIN - 1 }, deep[0]) === null);
check('an inaccuracy-sized loss is an Inaccuracy', describeMistake(shilling, 'f3e5', { ...reply, scoreCp: 40 }, deep[0])?.grade === 'Inaccuracy');
check('a game-losing loss is not shown', describeMistake(shilling, 'f3e5', { ...reply, scoreCp: MISTAKE_MAX + 1 }, deep[0]) === null);
check('walking into mate is not shown', describeMistake(shilling, 'f3e5', { ...reply, scoreCp: null, mate: 4 }, deep[0]) === null);

// reusing a line from the main search
const flipped = lineAfterFirstMove({ depth: 12, scoreCp: -120, mate: null, pv: ['f3e5', 'd8g5', 'e5f7'] });
check('lineAfterFirstMove drops the move and flips the score', flipped.scoreCp === 120 && flipped.pv[0] === 'd8g5', flipped);
check('lineAfterFirstMove flips mates', lineAfterFirstMove({ mate: -3, scoreCp: null, pv: ['a', 'b'] }).mate === 3);

// coachPosition never shows the same move as the human pick and the mistake
const fen = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3';
const lines = searchPosition(fen, { depth: 3, multipv: 4 });
const r = coachPosition(fen, { deep: lines, shallow: lines, level: 1600, mistake: { uci: lines[0].pv[0], san: 'x' } });
check('a mistake equal to the best move is dropped', r.mistake === null, r.mistake);
const r2 = coachPosition(fen, { deep: lines, shallow: lines, level: 1600, mistake: m });
check('a real mistake passes through', r2.mistake?.uci === 'f3e5', r2.mistake);

// with the backup engine on a real position, every candidate is a legal move & the search doesn't crash
const real = searchPosition(shilling, { depth: 3, multipv: 5 });
const realCandidates = mistakeCandidates(shilling, real, searchPosition(shilling, { depth: 1, multipv: 3 }), 3);
check('real candidates are legal moves', realCandidates.every((c) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(c.uci)), realCandidates);

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
