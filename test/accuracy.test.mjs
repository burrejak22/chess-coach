import { searchPosition } from '../lib/basic-engine.js';
import {
  findPositionBetween, isPlausiblePosition, moveAccuracy, overallAccuracy, reviewLastMove, winPercent,
} from '../lib/coach.js';

let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${JSON.stringify(detail)}`}`); if (!cond) fails += 1; };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// winning chances
check('equal position is 50%', near(winPercent(0), 50, 0.01), winPercent(0));
check('+1 pawn is about 59%', near(winPercent(100), 59.1, 0.3), winPercent(100));
check('mates are capped like ±10 pawns', winPercent(100000) === winPercent(1000) && winPercent(-100000) < 3, [winPercent(100000), winPercent(-100000)]);
check('symmetric', near(winPercent(300) + winPercent(-300), 100, 0.001));

// one move
check('keeping your chances is 100%', moveAccuracy(60, 60) === 100, moveAccuracy(60, 60));
check('gaining chances is still 100%', moveAccuracy(50, 70) === 100);
check('losing 10 points of chances is about 65%', near(moveAccuracy(60, 50), 64.6, 0.5), moveAccuracy(60, 50));
check('throwing a won game away is near 0', moveAccuracy(95, 5) < 3, moveAccuracy(95, 5));
check('accuracy falls as the drop grows', moveAccuracy(60, 55) > moveAccuracy(60, 45) && moveAccuracy(60, 45) > moveAccuracy(60, 30));

// a run of moves
check('no moves, no score', overallAccuracy([]) === null);
check('all perfect is 100', near(overallAccuracy([100, 100, 100]), 100, 0.001));
const withBlunder = overallAccuracy([95, 95, 95, 95, 10]);
check('one blunder pulls it below the plain average', withBlunder < (95 * 4 + 10) / 5, withBlunder);
check('stays between 0 and 100', withBlunder > 0 && withBlunder < 100, withBlunder);

// reviews carry an accuracy
const prev = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/3P4/PPP2PPP/RNBQKBNR b KQkq - 0 2';
const after = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3';
const blunder = reviewLastMove(prev, searchPosition(prev, { depth: 3, multipv: 3 }), after, searchPosition(after, { depth: 3, multipv: 3 }));
check('hanging the queen scores very low', blunder?.grade === 'Blunder' && blunder.accuracy < 20, blunder && { grade: blunder.grade, accuracy: blunder.accuracy });
const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const e4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const startLines = [{ depth: 20, multipv: 1, scoreCp: 30, mate: null, pv: ['e2e4', 'e7e5'] }];
const good = reviewLastMove(start, startLines, e4, [{ depth: 20, multipv: 1, scoreCp: -30, mate: null, pv: ['e7e5'] }]);
check('playing the engine move is 100%', good?.accuracy === 100, good);

// two moves at once (the computer replied before the coach looked at your move)
const e4e5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const mid = findPositionBetween(start, e4e5);
check('finds the position between two moves', mid?.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b'), mid);
check('no position between unrelated boards', findPositionBetween(start, after) === null);

// boards Stockfish would crash on are rejected before they reach it
check('a normal position is plausible', isPlausiblePosition(start) && isPlausiblePosition(after));
check('33 pieces is rejected', !isPlausiblePosition('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKBNR b KQkq - 1 2'));
check('two white kings is rejected', !isPlausiblePosition('4k3/8/8/8/8/8/8/K3K3 w - - 0 1'));
check('a pawn on the back rank is rejected', !isPlausiblePosition('P3k3/8/8/8/8/8/8/4K3 w - - 0 1'));
check('a broken row is rejected', !isPlausiblePosition('4k3/8/8/8/8/8/9/4K3 w - - 0 1'));
check('extra queens from promotion are fine', isPlausiblePosition('QQQ1k3/8/8/8/8/8/8/4K3 b - - 0 1'));

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
