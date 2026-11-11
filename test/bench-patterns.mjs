import { Chess } from '../lib/chess.js';
import { detectPatterns } from '../lib/patterns.js';

const fen = 'r1bqkb1r/pp3ppp/2n1pn2/3p4/2PP4/4PN2/PP3PPP/RNBQKB1R w KQkq - 0 1';
const chess = new Chess(fen);
const moves = chess.moves({ verbose: true });

const t0 = process.hrtime.bigint();
for (const m of moves) detectPatterns(fen, m, null);
const t1 = process.hrtime.bigint();
for (let i = 0; i < 50; i += 1) for (const m of moves) detectPatterns(fen, m, null);
const t2 = process.hrtime.bigint();

console.log('legal moves:', moves.length);
console.log('cold pass:', (Number(t1 - t0) / 1e6).toFixed(2), 'ms');
console.log('50 warm passes:', (Number(t2 - t1) / 1e6).toFixed(2), 'ms total,',
    (Number(t2 - t1) / 1e6 / 50).toFixed(3), 'ms/pass');
console.log('cache speedup:', (Number(t1 - t0) / (Number(t2 - t1) / 50)).toFixed(1), 'x');
