import { resolveTurn } from '../lib/coach.js';

let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${detail}`}`); if (!cond) fails += 1; };
const turnOf = (fen) => fen.split(' ')[1];

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';

// highlight was ambiguous (e.g. premove squares): the board shows 1.e4 but the reader guessed White
check('infers Black to move from the previous position', turnOf(resolveTurn({ fen: `${afterE4} w KQkq - 0 1`, turnKnown: false }, start, 'auto')) === 'b', 'wrong');

// a known highlight is trusted
check('keeps a turn read from the highlight', turnOf(resolveTurn({ fen: `${afterE4} b KQkq - 0 1`, turnKnown: true }, start, 'auto')) === 'b', 'wrong');

// manual choice wins & clears the en passant square
const forced = resolveTurn({ fen: `${afterE4} b KQkq e3 0 1`, turnKnown: true }, null, 'w');
check('your choice overrides it', turnOf(forced) === 'w' && forced.split(' ')[3] === '-', forced);

// a side that's giving check can't be the one to move... the side in check must move
const blackInCheck = '4k3/8/8/8/8/8/4Q3/4K3';
check('fixes an impossible turn (the side giving check is not to move)', turnOf(resolveTurn({ fen: `${blackInCheck} w - - 0 1`, turnKnown: false }, null, 'auto')) === 'b', 'wrong');

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
