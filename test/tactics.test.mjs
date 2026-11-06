import { searchPosition } from '../lib/basic-engine.js';
import { classifyMove, findTactic, temptingReplies, describeTrap, coachPosition, playUci, materialSwing, explainMove } from '../lib/coach.js';

let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` -> ${JSON.stringify(detail)}`}`); if (!cond) fails += 1; };
const lines = (fen, multipv = 4, depth = 3) => searchPosition(fen, { depth, multipv });

// tactic: knight fork of king & queen
const forkFen = '4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1';
let deep = lines(forkFen);
const tactic = findTactic(forkFen, deep);
check('finds a tactic in a fork position', !!tactic, { deep: deep.map((l) => [l.pv[0], l.scoreCp]) });

// mate in one is a tactic with a mate theme
deep = lines('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
const mateTactic = findTactic('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', deep);
check('mate-in-1 theme', mateTactic?.theme === 'mate in 1', mateTactic);
check('hint names the piece', mateTactic?.pieceHint === 'Look at your rook.', mateTactic);

// only move: taking the free queen is far better than anything else
const recap = 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3';
deep = lines(recap);
const badges = classifyMove(recap, deep[0], deep, []);
check('taking the free queen is the only move', deep[0].pv[0] === 'c1g5' && badges.includes('Only move'), { best: deep[0].pv[0], badges });

// a forced move (the only legal one) isn't labelled
const forced = 'rnb1kbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBqKBNR w KQkq - 0 3';
const forcedLines = lines(forced);
check('a forced move gets no badge', classifyMove(forced, forcedLines[0], forcedLines, []).length === 0, forcedLines);

// trap: after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4!? the knight on e5 looks free, but 4.Nxe5? Qg5 is strong
const shilling = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
const nd4 = searchPosition(shilling, { depth: 3, multipv: 5 }).find((l) => l.pv[0] === 'c6d4') || { pv: ['c6d4'], scoreCp: 0, depth: 3 };
const replies = temptingReplies(shilling, 'c6d4');
check('Nxe5 is a tempting reply to ...Nd4', replies.some((r) => r.san === 'Nxe5'), replies);
// the refutation (Stockfish finds it instantly; the backup engine is too shallow): 4...Qg5 5.Nxf7 Qxg2 6.Rf1 Qxe4+ 7.Be2 Nf3#
const punish = { depth: 20, multipv: 1, scoreCp: 600, mate: null, pv: ['d8g5', 'e5f7', 'g5g2', 'h1f1', 'g2e4', 'c4e2', 'd4f3'] };
const trap = describeTrap(shilling, nd4, replies.find((r) => r.san === 'Nxe5'), punish);
check('describes the Blackburne Shilling trap', !!trap && trap.text.startsWith('Sets a trap: if they play Nxe5?, Qg5'), { trap });
console.log('     ', trap?.text);

// a line cut off mid-trade (they took, we haven't taken back yet) isn't a sacrifice
const midTrade = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
const tradePv = ['b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6', 'd4c6', 'b7c6', 'e4e5'];
check('trade still in progress at the cut-off counts as even', materialSwing(midTrade, tradePv) === 0, materialSwing(midTrade, tradePv));
check('...and Nc6 is not called a sacrifice', !explainMove(midTrade, { pv: tradePv, scoreCp: -20 }).reasons.some((r) => r.startsWith('A sacrifice')));
check('...and gets no Brilliant badge', !classifyMove(midTrade, { pv: tradePv, scoreCp: -20 }, [{ pv: tradePv, scoreCp: -20 }], []).includes('Brilliant'));

// coachPosition carries badges & traps through
const r = coachPosition(recap, { deep: lines(recap), shallow: lines(recap, 3, 1), level: 1600 });
check('cards carry badges', Array.isArray(r.best.badges), r.best);

console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
