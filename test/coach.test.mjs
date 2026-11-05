import { searchPosition } from '../lib/basic-engine.js';
import { coachPosition, reviewLastMove, nullMoveFen, explainMove } from '../lib/coach.js';

const analyze = (fen, multipv = 4, depth = 3) => searchPosition(fen, { depth, multipv });
let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${JSON.stringify(detail)}`}`); if (!cond) fails += 1; };

const full = (fen, level = 1600) => {
  const deep = analyze(fen, 4, 3);
  const shallow = analyze(fen, 3, 1);
  const nf = nullMoveFen(fen);
  const nullLine = nf ? analyze(nf, 1, 2)[0] : null;
  return coachPosition(fen, { deep, shallow, nullLine, level });
};

// 1. free queen
let r = full('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3');
check('takes the hanging queen', r.best.san === 'Bxg5', r.best);
check('explains it wins the queen for free', r.best.reasons[0].includes('queen on g5 for free'), r.best.reasons);
check('human pick agrees on an obvious capture', r.human.san === 'Bxg5', r.human);

// 2. mate in one
r = full('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
check('finds back-rank mate', r.best.san === 'Rd8#', r.best);
check('says checkmate', r.best.reasons[0] === 'Checkmate.', r.best.reasons);

// 3. knight fork
r = full('r3k2r/ppp2ppp/2n5/3q4/8/2N5/PPP2PPP/R1BQK2R w KQkq - 0 1');
check('takes the queen on d5', r.best.san.startsWith('Nxd5') || r.best.san.startsWith('Qxd5'), r.best);

// 4. their threat: Black threatens Qxf2# style mate ideas -> opponent threat detection
r = full('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 4 4');
check('sees White threatens Qxf7#', !!r.threat && r.threat.san.startsWith('Qxf7'), r.threat);
check('best move stops it', r.best.reasons.some((x) => x.startsWith('Stops their threat')) || r.best.reasons.some((x) => x.includes('Protects')), r.best.reasons);

// 5. last move review: hanging the queen is a blunder
const prev = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/3P4/PPP2PPP/RNBQKBNR b KQkq - 0 2';
const after = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3';
const review = reviewLastMove(prev, analyze(prev, 3, 3), after, analyze(after, 3, 3));
check('grades Qg5?? as a blunder', review?.grade === 'Blunder', review);
check('shows how it gets punished', review?.punish?.san === 'Bxg5', review?.punish);

// 6. opening: development is explained
const ex = explainMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { pv: ['g8f6'], scoreCp: 20 });
check('explains development', ex.reasons.some((x) => x.startsWith('Develops the knight')), ex.reasons);

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
