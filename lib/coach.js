// Coach: turns engine lines into a "human" move suggestion with plain-English reasons, a plan,
// the opponent's threat, and a review of the last move played.

import { Chess } from './chess.js';
import { engineMatchRate, openingShares } from './human-data.js';
import { detectPatterns } from './patterns.js';
import { explorerCached, explorerPrime } from './lichess-explorer.js';
import { predictReply, safePremove } from './premoves.js';

export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/**
 * How far from the engine's best a "human" pick may stray (centipawns), and how much "natural" moves are
 * favored, by the rating you're aiming to play like.
 */
export const LEVELS = {
  // simple: favor one-move ideas (captures, checks, direct threats) & avoid moves whose point is deep
  // stickToBest: take the engine's move unless an alternative is within this many centipawns
  800: { tolerance: 150, humanWeight: 1.6, simple: 1, maxReasons: 2 },
  1200: { tolerance: 100, humanWeight: 1.3, simple: 0.6, maxReasons: 3 },
  1600: { tolerance: 60, humanWeight: 1, simple: 0, maxReasons: 4 },
  2000: { tolerance: 30, humanWeight: 0.6, simple: 0, stickToBest: 12, maxReasons: 5 },
  2400: { tolerance: 12, humanWeight: 0.3, simple: 0, stickToBest: 6, maxReasons: 5 },
  // grandmaster to world-class: average error per move keeps shrinking (Regan), so the picks hug the engine
  2600: { tolerance: 8, humanWeight: 0.2, simple: 0, stickToBest: 4, maxReasons: 5 },
  2800: { tolerance: 5, humanWeight: 0.12, simple: 0, stickToBest: 3, maxReasons: 5 },
  3000: { tolerance: 3, humanWeight: 0.06, simple: 0, stickToBest: 1, maxReasons: 5 },
};

/** Whether a move's point is visible right away: a capture, a check, or a direct threat on something. */
export const isOneMoveIdea = (fen, uci) => {
  const played = playUci(fen, uci);

  if (!played) {
    return false;
  }

  const { chess: after, move } = played;

  if (move.captured || move.san.includes('+') || move.promotion) {
    return true;
  }

  // attacks an undefended piece or a more valuable one
  return after.board().flat().some((p) => p && p.color !== move.color && p.type !== 'k'
    && after.attackers(p.square, move.color).includes(move.to)
    && (!after.attackers(p.square, p.color).length || VALUES[p.type] > VALUES[move.piece]));
};

const MATE_CP = 100000;

/** Score of an engine line in centipawns from the side to move's view (mates become huge numbers). */
export const lineCp = (line) => {
  if (!line) {
    return 0;
  }

  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0 ? MATE_CP - (line.mate * 100) : -MATE_CP - (line.mate * 100);
  }

  return line.scoreCp || 0;
};

/** "+1.3", "-0.4", "#3", "-#2" from White's point of view. */
export const formatEval = (line, turn) => {
  if (!line) {
    return '?';
  }

  const sign = turn === 'w' ? 1 : -1;

  if (line.mate !== null && line.mate !== undefined) {
    const m = line.mate * sign;

    return m > 0 ? `#${m}` : `-#${Math.abs(m)}`;
  }

  const cp = (line.scoreCp || 0) * sign;

  return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
};

const parseUci = (uci) => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  promotion: uci.length > 4 ? uci[4] : undefined,
});

/** Plays `uci` on a copy of `fen`; returns the chess.js move (with SAN) & the new position, or null. */
export const playUci = (fen, uci) => {
  const chess = new Chess(fen);

  try {
    const move = chess.move(parseUci(uci));

    return { chess, move };
  } catch {
    return null;
  }
};

/** Turns a UCI line into SAN, stopping at the first illegal move. */
export const pvToSan = (fen, pv = [], max = 8) => {
  const chess = new Chess(fen);
  const out = [];

  for (const uci of pv.slice(0, max)) {
    try {
      out.push(chess.move(parseUci(uci)).san);
    } catch {
      break;
    }
  }

  return out;
};

/**
 * Plays the first `maxPlies` moves of a line, then keeps going while captures are still being traded (so a
 * line cut off right after they take, before we take back, doesn't read as a lost piece). Stops on our move
 * when it can, so both sides have had their say.
 */
export const settleLine = (fen, pv = [], maxPlies = 6) => {
  const probe = new Chess(fen);
  let plies = 0;
  let lastCapture = false;

  for (const step of pv) {
    if ((plies >= maxPlies && !lastCapture) || plies >= maxPlies + 6) {
      break;
    }

    try {
      lastCapture = !!probe.move(parseUci(step)).captured;
      plies += 1;
    } catch {
      break;
    }
  }

  // end on our move, unless the line ends with our capture going unanswered
  if (plies % 2 === 1 && plies > 1 && !lastCapture) {
    probe.undo();
    plies -= 1;
  }

  return { probe, plies };
};

const material = (chess, color) => chess.board().flat().reduce((sum, p) => (
  p && p.color === color ? sum + VALUES[p.type] : sum
), 0);

const other = (color) => (color === 'w' ? 'b' : 'w');

const pieceAt = (chess, square) => chess.get(square) || null;

const lowestAttacker = (chess, square, color) => {
  const squares = chess.attackers(square, color);

  if (!squares.length) {
    return null;
  }

  return squares
    .map((sq) => ({ sq, piece: chess.get(sq) }))
    .sort((a, b) => VALUES[a.piece.type] - VALUES[b.piece.type])[0];
};

/**
 * Pieces of `color` that are hanging: attacked, and either undefended or attacked by something cheaper.
 */
export const hangingPieces = (chess, color) => {
  const out = [];

  chess.board().flat().forEach((p) => {
    if (!p || p.color !== color || p.type === 'k') {
      return;
    }

    const attacker = lowestAttacker(chess, p.square, other(color));

    if (!attacker) {
      return;
    }

    const defended = chess.attackers(p.square, color).length > 0;

    if (!defended || VALUES[attacker.piece.type] < VALUES[p.type]) {
      out.push({ square: p.square, type: p.type, by: attacker.piece.type });
    }
  });

  return out;
};

const isPassedPawn = (chess, square, color) => {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const dir = color === 'w' ? 1 : -1;

  for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f += 1) {
    for (let r = rank + dir; r >= 1 && r <= 8; r += dir) {
      const p = chess.get(`${String.fromCharCode(97 + f)}${r}`);

      if (p && p.type === 'p' && p.color !== color) {
        return false;
      }
    }
  }

  return true;
};

const isOpenFile = (chess, file) => {
  for (let r = 1; r <= 8; r += 1) {
    const p = chess.get(`${file}${r}`);

    if (p && p.type === 'p') {
      return false;
    }
  }

  return true;
};

const CENTER = ['d4', 'd5', 'e4', 'e5'];

/**
 * Plain-English reasons a move is good (or what it's doing), most important first.
 *
 * @param {string} fen position before the move
 * @param {{ pv: string[], scoreCp?: number, mate?: number }} line engine line starting with the move
 * @param {{ threat?: { uci: string } }} [context]
 */
export const explainMove = (fen, line, context = {}) => {
  const uci = line?.pv?.[0];
  const played = uci ? playUci(fen, uci) : null;

  if (!played) {
    return { san: uci || '?', reasons: [], plan: [] };
  }

  const before = new Chess(fen);
  const { chess: after, move } = played;
  const me = move.color;
  const them = other(me);
  const reasons = [];
  const moveNumber = Number(fen.split(' ')[5]) || 1;

  // forced mate
  if (line.mate !== null && line.mate !== undefined && line.mate > 0) {
    reasons.push(line.mate === 1 ? 'Checkmate.' : `Forces mate in ${line.mate}.`);
  } else if (after.isCheckmate()) {
    reasons.push('Checkmate.');
  }

  // material over the next few moves of the line (with any trade in progress played out)
  const pv = line.pv || [];
  const { probe, plies } = settleLine(fen, pv);
  const swing = (material(probe, me) - material(probe, them)) - (material(before, me) - material(before, them));

  if (move.captured) {
    const capturedName = NAMES[move.captured];
    const recapture = after.attackers(move.to, them).length > 0;

    if (!recapture) {
      reasons.push(`Wins the ${capturedName} on ${move.to} for free.`);
    } else if (VALUES[move.captured] > VALUES[move.piece]) {
      reasons.push(`Takes the ${capturedName} with a cheaper piece.`);
    } else if (swing >= 0) {
      reasons.push(`Trades on ${move.to}${material(before, me) > material(before, them) ? ' (trading down while ahead)' : ''}.`);
    }
  }

  if (swing >= 2 && !reasons.some((r) => r.startsWith('Wins the'))) {
    const seq = pvToSan(fen, pv, Math.max(2, plies)).join(' ');

    reasons.push(`Wins material (about ${swing} point${swing === 1 ? '' : 's'}) after ${seq}.`);
  } else if (swing <= -2 && !(line.mate > 0) && (line.scoreCp ?? 0) > -150) {
    reasons.push(`A sacrifice: gives up ${-swing} points for the attack or position.`);
  }

  if (move.san.includes('+') && !after.isCheckmate()) {
    reasons.push('Check, so they have to respond.');
  }

  // what the moved piece now attacks
  const targets = after.board().flat().filter((p) => {
    if (!p || p.color !== them) {
      return false;
    }

    const attackedByMover = after.attackers(p.square, me).includes(move.to);

    if (!attackedByMover) {
      return false;
    }

    const defended = after.attackers(p.square, them).length > 0;

    return p.type === 'k' || !defended || VALUES[p.type] > VALUES[move.promotion || move.piece];
  });

  const valuable = targets.filter((p) => p.type !== 'k');

  if (targets.length >= 2) {
    reasons.push(`Fork: hits ${targets.map((p) => `the ${NAMES[p.type]}${p.type === 'k' ? '' : ` on ${p.square}`}`).join(' and ')} at once.`);
  } else if (valuable.length === 1 && !move.captured) {
    const [t] = valuable;
    const defended = after.attackers(t.square, them).length > 0;

    reasons.push(`Attacks the ${defended ? '' : 'undefended '}${NAMES[t.type]} on ${t.square}.`);
  }

  // saving our own stuff
  const hangingBefore = hangingPieces(before, me);
  const hangingAfter = hangingPieces(after, me);
  const saved = hangingBefore.filter((h) => !hangingAfter.some((x) => x.square === h.square)
    && !(h.square === move.from && hangingAfter.some((x) => x.square === move.to)));

  if (saved.length) {
    const s = saved.sort((a, b) => VALUES[b.type] - VALUES[a.type])[0];

    reasons.push(s.square === move.from
      ? `Moves your attacked ${NAMES[s.type]} to safety.`
      : `Protects your ${NAMES[s.type]} on ${s.square}.`);
  }

  // dealing with their threat (from a "what if I passed?" search)
  if (context.threat?.uci) {
    const threat = parseUci(context.threat.uci);
    const threatSan = context.threat.san || context.threat.uci;
    const stillWorks = (() => {
      const test = new Chess(after.fen());

      try {
        const reply = test.move(threat);

        return !!reply && (reply.captured ? VALUES[reply.captured] >= 1 : reply.san.includes('#'));
      } catch {
        return false;
      }
    })();

    if (!stillWorks) {
      reasons.push(`Stops their threat of ${threatSan}.`);
    }
  }

  // positional ideas
  if (move.flags.includes('k') || move.flags.includes('q')) {
    reasons.push('Castles: tucks the king away and connects the rooks.');
  }

  if (moveNumber <= 12) {
    const backRank = me === 'w' ? '1' : '8';

    if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === backRank && !move.captured) {
      reasons.push(`Develops the ${NAMES[move.piece]} toward the center.`);
    }

    if (move.piece === 'p' && CENTER.includes(move.to)) {
      reasons.push('Grabs space in the center.');
    }

    if (move.piece === 'q' && moveNumber <= 6 && !move.captured) {
      reasons.push('Note: early queen moves can lose time to attacks.');
    }
  }

  if (move.piece === 'p' && isPassedPawn(after, move.to, me) && !move.captured) {
    reasons.push(`Pushes the passed pawn${move.promotion ? ' and promotes' : ''}.`);
  }

  if (move.piece === 'r' && move.from[0] !== move.to[0] && isOpenFile(after, move.to[0])) {
    reasons.push(`Puts the rook on the open ${move.to[0]}-file.`);
  }

  // extended pattern detectors (pin, skewer, discovered, battery, outpost, rook lift,
  // pawn storm, Greek gift, Bxf7+, overload, bad-bishop trade, back-rank threat, etc.)
  // detectPatterns is memoized by (position, move), so it's free on hits.
  // Cap at 3 extra reasons so a position with many patterns doesn't bury the primary ones.
  for (const extra of detectPatterns(fen, move, line, { maxReasons: 3 })) {
    if (!reasons.includes(extra)) reasons.push(extra);
  }

  if (!reasons.length) {
    const centerControl = CENTER.filter((sq) => after.attackers(sq, me).includes(move.to)).length;

    reasons.push(centerControl
      ? 'Improves the piece and adds control of the center.'
      : 'A solid improving move; nothing tactical is going on.');
  }

  // plan: our next moves in the line, with what the first one is aiming for
  const plan = [];
  const san = pvToSan(fen, pv, 7);

  for (let i = 2; i < san.length && plan.length < 3; i += 2) {
    plan.push(san[i]);
  }

  return { san: move.san, reasons, plan, line: san };
};

/** How "natural" a move looks to a human: obvious recaptures, checks, development, no weird retreats. */
export const humanScore = (fen, uci, shallowRank = null) => {
  const played = playUci(fen, uci);

  if (!played) {
    return -100;
  }

  const before = new Chess(fen);
  const { chess: after, move } = played;
  const me = move.color;
  const moveNumber = Number(fen.split(' ')[5]) || 1;
  const forward = me === 'w' ? 1 : -1;
  let score = 0;

  if (move.captured) {
    score += 25 + (5 * VALUES[move.captured]);
  }

  if (move.san.includes('+')) {
    score += 12;
  }

  if (move.flags.includes('k') || move.flags.includes('q')) {
    score += 20;
  }

  if (moveNumber <= 12) {
    const backRank = me === 'w' ? '1' : '8';

    if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === backRank) {
      score += 15;
    }

    if (move.piece === 'p' && CENTER.includes(move.to)) {
      score += 12;
    }

    if (move.piece === 'q' && !move.captured) {
      score -= 10;
    }

    if (move.piece === 'k' && !move.flags.includes('k') && !move.flags.includes('q')) {
      score -= 20;
    }
  }

  // retreats & flank pawn shuffles look "engine-y"
  const advance = (Number(move.to[1]) - Number(move.from[1])) * forward;

  if (advance < 0 && !move.captured && move.piece !== 'k') {
    const wasAttacked = before.isAttacked(move.from, other(me));

    score -= wasAttacked ? 0 : 8;
  }

  if (move.piece === 'p' && ['a', 'b', 'g', 'h'].includes(move.to[0]) && !move.captured && moveNumber <= 20) {
    score -= 6;
  }

  // putting a piece where it can be taken for free looks like a blunder to most people, even if it works
  const hangsMover = hangingPieces(after, me).some((h) => h.square === move.to);

  if (hangsMover && !move.captured) {
    score -= 25;
  }

  // shallow searches find "obvious" moves; deep-only moves are hard to see
  if (shallowRank === 0) {
    score += 15;
  } else if (shallowRank === 1) {
    score += 8;
  } else if (shallowRank === null) {
    score -= 10;
  }

  return score;
};

/**
 * Picks the move a strong human at `level` would likely play: close enough to the engine's best,
 * and natural-looking.
 *
 * @param {string} fen
 * @param {Array} deepLines engine MultiPV lines (best first)
 * @param {Array} [shallowLines] lines from a quick, shallow search
 * @param {number} [level] rating to play like
 */
export const pickHumanMove = (fen, deepLines, shallowLines = [], level = 1600) => {
  const config = LEVELS[level] || LEVELS[1600];
  const lines = (deepLines || []).filter((l) => l?.pv?.length);

  if (!lines.length) {
    return null;
  }

  const best = lineCp(lines[0]);
  const shallowMoves = (shallowLines || []).map((l) => l?.pv?.[0]).filter(Boolean);

  const scored = lines.map((line) => {
    const uci = line.pv[0];
    const loss = Math.max(0, best - lineCp(line));
    const rank = shallowMoves.indexOf(uci);
    let human = humanScore(fen, uci, rank === -1 ? null : rank);

    // lower levels: one-move ideas are what people actually see; deep quiet moves get skipped
    if (config.simple) {
      if (isOneMoveIdea(fen, uci)) {
        human += 18 * config.simple;
      } else if (rank === -1) {
        human -= 15 * config.simple;
      }
    }

    return { line, uci, loss, human, value: (human * config.humanWeight) - loss };
  });

  // never trade a forced mate or a winning move for a "natural" one that throws it away
  const allowed = scored.filter((s) => s.loss <= config.tolerance
    && !(lines[0].mate > 0 && !(s.line.mate > 0)));

  let pick = (allowed.length ? allowed : scored.slice(0, 1)).sort((a, b) => b.value - a.value)[0];

  // strong levels: play the engine's move unless the alternative is basically equal
  if (config.stickToBest && pick.loss > config.stickToBest) {
    [pick] = scored;
  }

  return { ...pick, isBest: pick.uci === lines[0].pv[0] };
};

/** Flips the side to move (a "null move") to find out what the opponent is threatening. */
export const nullMoveFen = (fen) => {
  const parts = fen.split(' ');
  const chess = new Chess(fen);

  if (chess.inCheck()) {
    return null;
  }

  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';

  try {
    const test = new Chess(parts.join(' '));

    // a position where the side not to move is in check isn't legal
    return test.fen() ? parts.join(' ') : null;
  } catch {
    return null;
  }
};

/** Describes the opponent's threat from a null-move line, if it's a real one. */
export const describeThreat = (fen, nullLine, currentLine) => {
  const nf = nullMoveFen(fen);
  const uci = nullLine?.pv?.[0];

  if (!nf || !uci) {
    return null;
  }

  const played = playUci(nf, uci);

  if (!played) {
    return null;
  }

  // how much better they'd be if you passed, compared with the real position (both from their view)
  const theirGain = lineCp(nullLine) + lineCp(currentLine);
  const { move } = played;
  const big = (nullLine.mate > 0) || theirGain >= 150 || (move.captured && VALUES[move.captured] >= 3);

  if (!big) {
    return null;
  }

  let text;

  if (nullLine.mate > 0) {
    text = `They threaten mate with ${move.san}${nullLine.mate > 1 ? ` (mate in ${nullLine.mate})` : ''}.`;
  } else if (move.captured) {
    text = `They threaten ${move.san}, winning your ${NAMES[move.captured]}.`;
  } else {
    text = `They threaten ${move.san}.`;
  }

  return { uci, san: move.san, from: move.from, to: move.to, text };
};

/** Finds the legal move that turns `fromFen` into `toFen` (matching piece placement), or null. */
export const findMoveBetween = (fromFen, toFen) => {
  const target = toFen.split(' ')[0];
  const chess = new Chess(fromFen);

  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);

    if (chess.fen().split(' ')[0] === target) {
      chess.undo();

      return move;
    }

    chess.undo();
  }

  return null;
};

// ---------------------------------------------------------------------------------------------
// accuracy (the Lichess-style formula: how much of your winning chances each move kept)
// ---------------------------------------------------------------------------------------------

/** Winning chances (0-100) for the side whose view `cp` is from. Mates count as ±1000. */
export const winPercent = (cp) => {
  const c = Math.max(-1000, Math.min(1000, cp));

  return 50 + (50 * ((2 / (1 + Math.exp(-0.00368208 * c))) - 1));
};

/** Accuracy (0-100) of one move from the winning chances before and after it (both the mover's view). */
export const moveAccuracy = (winBefore, winAfter) => {
  const drop = Math.max(0, winBefore - winAfter);

  // the fitted curve, plus Lichess' +1 for engine uncertainty
  return Math.max(0, Math.min(100, (103.1668 * Math.exp(-0.04354 * drop)) - 3.1669 + 1));
};

/**
 * One number for a run of moves: the average of the plain mean and the harmonic mean, so a single blunder
 * drags it down more than a plain average would (a mean of 90s with one 10 shouldn't read as "great").
 */
export const overallAccuracy = (values) => {
  const list = (values || []).filter((v) => Number.isFinite(v));

  if (!list.length) {
    return null;
  }

  const mean = list.reduce((s, v) => s + v, 0) / list.length;
  const harmonic = list.length / list.reduce((s, v) => s + (1 / Math.max(v, 1)), 0);

  return (mean + harmonic) / 2;
};

/**
 * Whether a board could come from a real game: one king each, at most 16 pieces and 8 pawns a side, no pawns
 * on the first or last rank. Stockfish crashes on boards that break these rules (chess.js doesn't check them),
 * and a misread board (a captured piece still fading out, say) can break them.
 */
export const isPlausiblePosition = (fen) => {
  const rows = String(fen || '').split(' ')[0].split('/');

  if (rows.length !== 8 || rows.some((r) => r.replace(/\d/g, (n) => '.'.repeat(Number(n))).length !== 8)) {
    return false;
  }

  const count = (re) => (rows.join('').match(re) || []).length;

  return count(/K/g) === 1 && count(/k/g) === 1
    && count(/[PNBRQK]/g) <= 16 && count(/[pnbrqk]/g) <= 16
    && count(/P/g) <= 8 && count(/p/g) <= 8
    && !/[pP]/.test(rows[0]) && !/[pP]/.test(rows[7]);
};

/**
 * When two moves were played between `fromFen` and `toFen` (e.g. the computer replied before the coach
 * finished looking at your move), returns the position in between, or null.
 */
export const findPositionBetween = (fromFen, toFen) => {
  const chess = new Chess(fromFen);

  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    const mid = chess.fen();
    const second = findMoveBetween(mid, toFen);

    chess.undo();

    if (second) {
      return mid;
    }
  }

  return null;
};

/**
 * Grades the move that took `prevFen` to the current position.
 *
 * @param {string} prevFen position before the move
 * @param {Array} prevLines engine lines for `prevFen` (best first)
 * @param {string} fen position after the move
 * @param {Array} lines engine lines for `fen`
 */
export const reviewLastMove = (prevFen, prevLines, fen, lines) => {
  const move = findMoveBetween(prevFen, fen);

  if (!move || !prevLines?.length || !lines?.length) {
    return null;
  }

  const bestBefore = lineCp(prevLines[0]);
  // the new lines are from the opponent's view; flip them
  const afterForMover = -lineCp(lines[0]);
  const loss = Math.max(0, bestBefore - afterForMover);
  const bestUci = prevLines[0].pv[0];
  const playedUci = `${move.from}${move.to}${move.promotion || ''}`;
  const wasBest = bestUci === playedUci;
  const missedMate = prevLines[0].mate > 0 && !(lines[0].mate < 0);

  let grade;

  if (wasBest || loss <= 15) {
    grade = 'Best';
  } else if (loss <= 50) {
    grade = 'Good';
  } else if (loss <= 100) {
    grade = 'Inaccuracy';
  } else if (loss <= 250) {
    grade = 'Mistake';
  } else {
    grade = 'Blunder';
  }

  if (missedMate && !wasBest) {
    grade = loss > 250 ? 'Blunder' : 'Missed mate';
  }

  const accuracy = wasBest ? 100 : moveAccuracy(winPercent(bestBefore), winPercent(afterForMover));
  const result = { san: move.san, color: move.color, grade, loss, accuracy, better: null, punish: null };

  if (!['Best', 'Good'].includes(grade)) {
    const better = explainMove(prevFen, prevLines[0]);

    result.better = { san: better.san, reasons: better.reasons.slice(0, 2) };

    // the opponent's best reply now shows what the move allowed
    const reply = explainMove(fen, lines[0]);

    result.punish = { san: reply.san, reasons: reply.reasons.slice(0, 1) };
  }

  return result;
};

/** Material swing for the mover over the first few moves of a line, with any trade in progress played out. */
export const materialSwing = (fen, pv = [], maxPlies = 6) => {
  const before = new Chess(fen);
  const { probe } = settleLine(fen, pv, maxPlies);
  const me = before.turn();
  const them = other(me);

  return (material(probe, me) - material(probe, them)) - (material(before, me) - material(before, them));
};

/**
 * Badges for a candidate: "Brilliant" (a sound sacrifice that isn't obvious) and "Only move"
 * (everything else is much worse).
 *
 * @param {string} fen
 * @param {object} line the candidate's engine line
 * @param {Array} lines all engine lines, best first
 * @param {string[]} shallowMoves moves a quick search found (obvious moves)
 */
export const classifyMove = (fen, line, lines, shallowMoves = []) => {
  const badges = [];
  const uci = line?.pv?.[0];
  const played = uci ? playUci(fen, uci) : null;

  if (!played || !lines?.length) {
    return badges;
  }

  const { chess: after, move } = played;
  const best = lineCp(lines[0]);
  const value = lineCp(line);
  const loss = best - value;

  // sacrifice: gives up material (right away or over the line) but the engine still likes it
  const hangsItself = hangingPieces(after, move.color).some((h) => h.square === move.to)
    && !(move.captured && VALUES[move.captured] >= VALUES[move.piece]);
  const swing = materialSwing(fen, line.pv);
  const sacrifice = (hangsItself && VALUES[move.piece] >= 3) || swing <= -2;
  const obvious = shallowMoves.slice(0, 2).includes(uci);

  if (sacrifice && loss <= 30 && value >= -50 && !(line.mate < 0) && !obvious) {
    badges.push('Brilliant');
  }

  // only move: the best by a mile, in a position where it matters
  if (uci === lines[0].pv[0] && lines.length > 1 && best - lineCp(lines[1]) >= 150 && best > -400) {
    badges.push('Only move');
  }

  // great: the top move is clearly ahead of the pack AND hard to see (deep-only),
  // short of "only move" territory — the kind of find that would earn a ! in a game.
  const gap = lines.length > 1 ? best - lineCp(lines[1]) : 0;

  if (uci === lines[0].pv[0] && gap >= 70 && gap < 150 && !obvious && best > -400 && !badges.includes('Brilliant') && !badges.includes('Only move')) {
    badges.push('Great');
  }

  return badges;
};

/**
 * Whether the position has a tactic to find (one move clearly wins), and a hint for it.
 * Used by puzzle mode, which hides the answer until asked.
 */
export const findTactic = (fen, lines) => {
  if (!lines?.length) {
    return null;
  }

  const best = lines[0];
  const gap = lines.length > 1 ? lineCp(best) - lineCp(lines[1]) : 0;
  const swing = materialSwing(fen, best.pv);
  const mate = best.mate > 0;

  if (!(mate || (swing >= 2 && gap >= 150))) {
    return null;
  }

  const played = playUci(fen, best.pv[0]);
  const reasons = explainMove(fen, best).reasons;
  const theme = (mate && (best.mate === 1 ? 'mate in 1' : `mate in ${best.mate}`))
    || (reasons.some((r) => r.startsWith('Fork')) && 'a fork')
    || (reasons.some((r) => r.includes('for free')) && 'a free piece')
    || 'winning material';

  return {
    theme,
    pieceHint: played ? `Look at your ${NAMES[played.move.piece]}.` : null,
    uci: best.pv[0],
  };
};

/**
 * Tempting replies the opponent might play after `uci`: captures & checks, most natural first.
 * The panel checks each with a quick search to see whether it's a trap.
 */
export const temptingReplies = (fen, uci, max = 3) => {
  const played = playUci(fen, uci);

  if (!played) {
    return [];
  }

  const afterFen = played.chess.fen();

  return played.chess.moves({ verbose: true })
    .filter((m) => m.captured || m.san.includes('+'))
    .map((m) => {
      const r = `${m.from}${m.to}${m.promotion || ''}`;

      return { uci: r, san: m.san, human: humanScore(afterFen, r, 0) + (m.captured ? 10 * VALUES[m.captured] : 0) };
    })
    .sort((a, b) => b.human - a.human)
    .slice(0, max);
};

/**
 * Describes a trap: after our `uci`, their tempting `reply` loses to `punishLine`.
 *
 * @param {string} fen position before our move
 * @param {object} line our candidate's line (our view)
 * @param {{ uci: string, san: string }} reply their tempting reply
 * @param {object} punishLine engine line after our move + their reply (our view)
 */
export const describeTrap = (fen, line, reply, punishLine) => {
  const ours = line?.pv?.[0] ? playUci(fen, line.pv[0]) : null;

  if (!ours || !reply?.uci || !punishLine?.pv?.length) {
    return null;
  }

  const theirs = playUci(ours.chess.fen(), reply.uci);

  if (!theirs || reply.uci === line.pv[1]) {
    return null; // that's their best reply anyway, not a trap
  }

  const gain = lineCp(punishLine) - lineCp(line);

  if (!(punishLine.mate > 0) && gain < 200) {
    return null;
  }

  const afterReply = theirs.chess.fen();
  const punish = explainMove(afterReply, punishLine);
  const why = punish.reasons[0] ? ` ${punish.reasons[0].replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}` : '';

  return {
    reply: reply.san,
    punish: punish.san,
    text: `Sets a trap: if they play ${reply.san}?, ${punish.san}${why ? ` (${why.trim()})` : ''}.`,
  };
};

// ---------------------------------------------------------------------------------------------
// tempting mistakes: moves a weaker player would be drawn to that are worse, but don't lose the game
// ---------------------------------------------------------------------------------------------

/**
 * How much worse than the best move (centipawns) a move must be to count as a tempting mistake.
 * Below MIN it's basically fine; above MAX it's a game-losing blunder, which isn't what this shows.
 * The bounds match the review grades: Inaccuracy (51-100) and Mistake (101-250).
 */
export const MISTAKE_MIN = 25;
export const MISTAKE_MAX = 250;

/** How attractive a move looks at a glance: grabbing material, checks, direct attacks, natural development. */
export const temptationScore = (fen, uci, shallowRank = null) => {
  const base = humanScore(fen, uci, shallowRank);

  return base + (isOneMoveIdea(fen, uci) ? 18 : 0);
};

/**
 * The legal moves most likely to tempt a weaker player that aren't among the good moves, most tempting first.
 * Each comes with its engine line if the main search already covered it (`known`), so it needn't be searched again.
 */
export const mistakeCandidates = (fen, deepLines, shallowLines = [], max = 3) => {
  const lines = (deepLines || []).filter((l) => l?.pv?.length);

  if (!lines.length) {
    return [];
  }

  const best = lineCp(lines[0]);
  const good = new Set(lines.filter((l) => best - lineCp(l) < MISTAKE_MIN).map((l) => l.pv[0]));
  const shallowMoves = (shallowLines || []).map((l) => l?.pv?.[0]).filter(Boolean);

  return new Chess(fen).moves({ verbose: true })
    .map((m) => `${m.from}${m.to}${m.promotion || ''}`)
    .filter((uci) => !good.has(uci))
    .map((uci) => {
      const rank = shallowMoves.indexOf(uci);

      return { uci, temptation: temptationScore(fen, uci, rank === -1 ? null : rank), known: lines.find((l) => l.pv[0] === uci) || null };
    })
    // show even quiet-ish candidates so a purple "normal-human inaccuracy" appears on most moves
    .filter((c) => c.temptation >= 0)
    .sort((a, b) => b.temptation - a.temptation)
    .slice(0, max);
};

/** An engine line for the position after its first move, from the other side's point of view. */
export const lineAfterFirstMove = (line) => (line?.pv?.length > 1 ? {
  depth: line.depth ?? null,
  multipv: 1,
  scoreCp: line.scoreCp === null || line.scoreCp === undefined ? null : -line.scoreCp,
  mate: line.mate === null || line.mate === undefined ? null : -line.mate,
  pv: line.pv.slice(1),
} : null);

/** Why a move looks good at first sight (not whether it is). */
const whyTempting = (fen, played) => {
  const { chess: after, move } = played;
  const them = other(move.color);
  const moveNumber = Number(fen.split(' ')[5]) || 1;

  if (move.captured) {
    return `Grabs the ${NAMES[move.captured]} on ${move.to}.`;
  }

  if (move.promotion) {
    return 'Promotes the pawn.';
  }

  if (move.san.includes('+')) {
    return 'Gives check.';
  }

  const target = after.board().flat().find((p) => p && p.color === them && p.type !== 'k'
    && after.attackers(p.square, move.color).includes(move.to)
    && (!after.attackers(p.square, them).length || VALUES[p.type] > VALUES[move.piece]));

  if (target) {
    return `Attacks the ${NAMES[target.type]} on ${target.square}.`;
  }

  if (move.flags.includes('k') || move.flags.includes('q')) {
    return 'Castles.';
  }

  if (moveNumber <= 12 && (move.piece === 'n' || move.piece === 'b')) {
    return `Develops the ${NAMES[move.piece]}.`;
  }

  if (move.piece === 'p' && CENTER.includes(move.to)) {
    return 'Grabs space in the center.';
  }

  return 'Looks natural.';
};

const lowerFirst = (text) => text.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

/**
 * Describes a tempting mistake, or returns null if the move isn't one (too small a loss, or a game-losing blunder).
 *
 * @param {string} fen position before the move
 * @param {string} uci the tempting move
 * @param {object} replyLine engine line for the position after the move (the opponent's view)
 * @param {object} bestLine the engine's best line for `fen`
 */
export const describeMistake = (fen, uci, replyLine, bestLine) => {
  const played = playUci(fen, uci);

  if (!played || !bestLine || !replyLine?.pv?.length) {
    return null;
  }

  const value = -lineCp(replyLine);
  const loss = Math.max(0, lineCp(bestLine) - value);

  // walks into a forced mate, or throws the game away: that's a blunder, not a learning-sized mistake
  if (replyLine.mate > 0 || loss < MISTAKE_MIN || loss > MISTAKE_MAX) {
    return null;
  }

  const { move } = played;
  const afterFen = played.chess.fen();
  const turn = fen.split(' ')[1];
  const punish = explainMove(afterFen, replyLine);
  const generic = !punish.reasons[0] || /^(A solid improving move|Improves the piece|Trades on)/.test(punish.reasons[0]);
  const lure = whyTempting(fen, played);
  const drop = (loss / 100).toFixed(1);
  const wrong = generic
    ? `After ${punish.san} you're about ${drop} worse than with ${pvToSan(fen, bestLine.pv, 1)[0]}.`
    : `They answer ${punish.san} (${lowerFirst(punish.reasons[0])}).`;

  return {
    uci,
    san: move.san,
    from: move.from,
    to: move.to,
    loss,
    grade: loss <= 100 ? 'Inaccuracy' : 'Mistake',
    eval: formatEval(replyLine, other(turn)),
    lure,
    wrong,
    better: pvToSan(fen, bestLine.pv, 1)[0] || null,
    line: pvToSan(afterFen, replyLine.pv, 4),
  };
};

// ---------------------------------------------------------------------------------------------
// typical moves: what a real player would most likely play here, good or bad
// ---------------------------------------------------------------------------------------------

/**
 * How likely a real player is to play `uci`, as a score (higher = more likely). It models the usual
 * order of thought at the board: take back after a capture, save an attacked piece, grab what's loose,
 * look at checks, follow the opening you know, develop and castle, and don't drop pieces. Stronger
 * players lean more on calculation (the shallow search), weaker ones more on what looks natural.
 *
 * @param {string} fen
 * @param {string} uci
 * @param {{ shallowRank?: number|null, level?: number, lastMove?: object|null, book?: Object<string, number>|null }} context
 *   book: opening moves from here and how many known lines use each (see bookMoves in openings.js)
 */
// Memo for typicalScore. Scored per (position, uci, level, shallowRank, lastMove.to). The
// scorer is called for every legal move at every analyzeFen tick (via typicalMoves), and
// rerender() redoes the whole pass whenever a setting changes — so hit rate is high.
const TYPICAL_CACHE = new Map();
const TYPICAL_CAP = 4000;
const typicalKey = (fen, uci, level, rank, lastMove, book) => (
  `${fen.split(' ').slice(0, 2).join(' ')}|${uci}|${level}|${rank ?? -1}|${lastMove?.to || ''}|${book ? 'B' : ''}`
);

export const typicalScore = (fen, uci, { shallowRank = null, level = 1600, lastMove = null, book = null } = {}) => {
  const ck = typicalKey(fen, uci, level, shallowRank, lastMove, book);
  const hit = TYPICAL_CACHE.get(ck);
  if (hit !== undefined) return hit;

  const _result = _typicalScoreUncached(fen, uci, { shallowRank, level, lastMove, book });

  TYPICAL_CACHE.set(ck, _result);
  if (TYPICAL_CACHE.size > TYPICAL_CAP) {
    const drop = Math.floor(TYPICAL_CAP / 5);
    const it = TYPICAL_CACHE.keys();
    for (let i = 0; i < drop; i += 1) TYPICAL_CACHE.delete(it.next().value);
  }
  return _result;
};

const _typicalScoreUncached = (fen, uci, { shallowRank = null, level = 1600, lastMove = null, book = null } = {}) => {
  const played = playUci(fen, uci);

  if (!played) {
    return -100;
  }

  const before = new Chess(fen);
  const { chess: after, move } = played;
  const me = move.color;
  const them = other(me);
  // 0 at 800, 1 at 3000: how much calculation and knowledge drive the choice rather than first impressions
  const skill = Math.max(0, Math.min(1, (Number(level) - 800) / 2200));
  let score = humanScore(fen, uci, null);

  // weaker players play "hope chess": they don't check what the opponent can do after their move, so a
  // move that drops the piece isn't ruled out as firmly (humanScore's -25 is the strong-player view)
  if (!move.captured && hangingPieces(after, me).some((h) => h.square === move.to)) {
    score += 12 * (1 - skill);
  }

  // the forcing-move habit (checks, captures): lower-rated players capture more often per move
  if (move.captured) {
    score += 10 * (1 - skill);
  }

  // blind spots even strong players have: backward moves on diagonals, backward knight moves, long moves
  const forwardDir = me === 'w' ? 1 : -1;
  const back = (Number(move.to[1]) - Number(move.from[1])) * forwardDir < 0;
  const files = Math.abs(move.to.charCodeAt(0) - move.from.charCodeAt(0));
  const ranks = Math.abs(Number(move.to[1]) - Number(move.from[1]));

  if (!move.captured && !move.san.includes('+')) {
    if (back && ((files === ranks && ['b', 'q'].includes(move.piece)) || move.piece === 'n')) {
      score -= 6 * (1 - (0.5 * skill));
    }

    if (Math.max(files, ranks) >= 5 && ['b', 'r', 'q'].includes(move.piece)) {
      score -= 4 * (1 - skill);
    }
  }

  // 1. they just took something: taking back is the first thing almost everyone looks at
  if (lastMove?.captured && move.captured && move.to === lastMove.to) {
    score += 40;
  }

  // 2. one of our pieces is attacked and loose: moving it away (or defending it) comes next
  const loose = hangingPieces(before, me);
  const biggest = loose.sort((a, b) => VALUES[b.type] - VALUES[a.type])[0];

  if (biggest) {
    const savedByMoving = move.from === biggest.square && !hangingPieces(after, me).some((h) => h.square === move.to);
    const savedInPlace = !hangingPieces(after, me).some((h) => h.square === biggest.square);

    if (savedByMoving) {
      score += 18 + (6 * VALUES[biggest.type]);
    } else if (savedInPlace) {
      score += 8 + (3 * VALUES[biggest.type]);
    } else if (!move.captured) {
      // ignoring a loose piece: common at club level, rarer the stronger the player
      score -= 4 + (10 * skill);
    }
  }

  // 3. free material is hard to resist
  if (move.captured && hangingPieces(before, them).some((h) => h.square === move.to)) {
    score += 20 + (4 * VALUES[move.captured]);
  }

  // 4. the opening moves people know (the more lines use a move, the more popular it is). Stronger players
  //    follow theory much more closely (e.g. 5...Be7 in the Ruy Lopez: about 5% at 400, 56% at 2500)
  if (book?.[move.san]) {
    score += 20 + (25 * skill) + (3 * Math.min(book[move.san], 10));
  }

  // 4b. opening habits: centre pawns first (two squares), then the kingside pieces so you can castle
  const moveNumber = Number(fen.split(' ')[5]) || 1;

  if (moveNumber <= 10) {
    if (move.piece === 'p' && CENTER.includes(move.to) && Math.abs(Number(move.to[1]) - Number(move.from[1])) === 2) {
      score += 14;
    }

    if ((move.piece === 'n' || move.piece === 'b') && ['f', 'g'].includes(move.from[0])) {
      score += 6;
    }
  }

  // 4c. a capture that gets the capturing piece taken back for less: most people see the recapture
  if (move.captured && VALUES[move.piece] > VALUES[move.captured]
    && hangingPieces(after, me).some((h) => h.square === move.to)) {
    score -= 8 * (VALUES[move.piece] - VALUES[move.captured]);
  }

  // 5. weaker players love checks and grabbing; stronger ones check them first
  if (move.san.includes('+')) {
    score += 8 * (1 - skill);
  }

  // 6. what a quick calculation finds (players do look a few moves ahead)
  const seen = shallowRank === 0 ? 22 : shallowRank === 1 ? 14 : shallowRank === 2 ? 8 : shallowRank === null ? -4 : 3;

  score += seen * (0.5 + skill);

  // 7. pattern recognition: moves that FIT a known tactical pattern (pin, fork, discovered,
  //    Greek gift, back-rank) are "seen" more often by stronger players. Below 1200 these
  //    patterns barely help; at 2000+ a familiar shape leaps off the board.
  try {
    const patterns = detectPatterns(fen, move, null);
    if (patterns.length) {
      // weight scales with skill; one fired pattern = +6 at 2000, +3 at 1200, +0.5 at 800
      score += patterns.length * (2 + (8 * skill));
    }
  } catch { /* detectors are optional */ }

  // 8. threat parry: if the opponent's "what if I passed" line hits something nasty and our
  //    move prevents it, stronger players spot it. Weaker players tend to make their own move
  //    and only realize the problem the ply after. Needs the caller to pass `threat` in context.

  // 9. trade-when-ahead: same-value capture when we're already up material feels right to most
  //    players (even ones who shouldn't). Bonus scales with how far ahead we are.
  const myMat = before.board().flat().filter((p) => p && p.color === me).reduce((s, p) => s + VALUES[p.type], 0);
  const theirMat = before.board().flat().filter((p) => p && p.color === them).reduce((s, p) => s + VALUES[p.type], 0);
  const lead = myMat - theirMat;
  if (move.captured && VALUES[move.captured] === VALUES[move.piece] && lead >= 3) {
    score += 6 + (2 * Math.min(lead, 6));
  }

  // 10. worst-piece activation (Aagaard, strong-player idea): if the mover came from a square
  //    where it had almost no mobility and lands where it has much more, that's a known plan.
  //    Only applies to minor / major pieces and scales with skill.
  if (['n', 'b', 'r', 'q'].includes(move.piece)) {
    try {
      const beforeMobility = before.moves({ square: move.from, verbose: true }).length;
      const afterMobility = after.moves({ square: move.to, verbose: true }).length;
      if (beforeMobility <= 2 && afterMobility >= 6) {
        score += 4 + (8 * skill);
      }
    } catch { /* chess.js throws on some positions; ignore */ }
  }

  return score;
};

/**
 * The most likely moves, most likely first, each with an estimated share (0-1) of players who'd play it.
 * The shares are a model of how people choose moves, not counts from real games.
 */
export const typicalMoves = (fen, {
  shallowLines = [], deepLines = [], level = 1600, lastMove = null, book = null, max = 3,
} = {}) => {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });

  if (!moves.length) {
    return [];
  }

  const skill = Math.max(0, Math.min(1, (Number(level) - 800) / 2200));
  const shallowMoves = (shallowLines || []).map((l) => l?.pv?.[0]).filter(Boolean);
  const scored = moves.map((m) => {
    const uci = `${m.from}${m.to}${m.promotion || ''}`;
    const rank = shallowMoves.indexOf(uci);

    return { uci, san: m.san, from: m.from, to: m.to, score: typicalScore(fen, uci, { shallowRank: rank === -1 ? null : rank, level, lastMove, book }) };
  });

  // 1. the "first impression" model: scores to shares (about 10 points of score ≈ 2.7x as likely)
  const top = Math.max(...scored.map((s) => s.score));
  const natural = scored.map((s) => Math.exp((s.score - top) / 10));
  const naturalTotal = natural.reduce((a, b) => a + b, 0);
  let shares = natural.map((w) => w / naturalTotal);

  // 2. mix in the engine's ranking, more for stronger players, so the engine's first choice gets roughly the
  //    share Regan measured at this rating (about 38% at 1500, 46% at 2000, 58% at 2800)
  const lines = (deepLines || []).filter((l) => l?.pv?.length);

  if (lines.length) {
    const best = lineCp(lines[0]);
    const spread = 70 - (50 * skill); // how big a loss in centipawns still feels "about as good" at this level
    const engine = scored.map((s) => {
      const line = lines.find((l) => l.pv[0] === s.uci);

      return line ? Math.exp(-Math.max(0, best - lineCp(line)) / spread) : 0;
    });
    const engineTotal = engine.reduce((a, b) => a + b, 0) || 1;
    const mix = Math.max(0.05, Math.min(0.85, (engineMatchRate(level) - 0.3) / 0.4));

    shares = shares.map((share, i) => ((1 - mix) * share) + (mix * (engine[i] / engineTotal)));
  }

  // 3. live Lichess Opening Explorer data when we have it in the cache. This beats the hand-
  //    curated shares because it covers way more positions and is from real games at this
  //    rating. The call is sync (cache-only); the explorer module hydrates in the background
  //    via explorerPrime() called from analyzeFen.
  const lichess = explorerCached(fen, level);
  // kick off the background fetch for next time (no-op if already cached)
  explorerPrime(fen, level);

  // 4. fall back to the hand-curated shares in human-data.js for positions Lichess didn't
  //    cover (yet). measured[san] = fraction of games where that move was played.
  const measured = lichess
    ? Object.fromEntries(lichess.moves.map((m) => [m.san, m.share]))
    : openingShares(fen, level);
  const source = scored.map(() => 'model');

  if (measured) {
    const listed = scored.map((s) => (measured[s.san] !== undefined ? measured[s.san] : null));
    const listedTotal = listed.reduce((a, v) => a + (v || 0), 0);
    const restModel = shares.reduce((a, v, i) => a + (listed[i] === null ? v : 0), 0) || 1;
    const rest = Math.max(0, 1 - listedTotal);

    shares = shares.map((v, i) => {
      if (listed[i] !== null) {
        source[i] = 'games';

        return listed[i];
      }

      return (v / restModel) * rest;
    });
  }

  return scored
    .map((s, i) => ({ ...s, share: shares[i], source: source[i] }))
    .sort((a, b) => b.share - a.share)
    .slice(0, max);
};

/** Why people go for a move, in a few words. */
const whyTypical = (fen, uci, lastMove) => {
  const played = playUci(fen, uci);

  if (!played) {
    return '';
  }

  const { chess: after, move } = played;
  const before = new Chess(fen);

  if (lastMove?.captured && move.captured && move.to === lastMove.to) {
    return 'Takes back.';
  }

  if (hangingPieces(before, move.color).some((h) => h.square === move.from)
    && !hangingPieces(after, move.color).some((h) => h.square === move.to)) {
    return `Saves the ${NAMES[move.piece]}.`;
  }

  return whyTempting(fen, played);
};

/**
 * The engine's verdict on the most likely move.
 *
 * @param {string} fen
 * @param {{uci: string, san: string, share: number}} pick from typicalMoves
 * @param {object|null} replyLine engine line after the move (the opponent's view), or null if unknown
 * @param {object} bestLine the engine's best line for `fen`
 * @param {object|null} lastMove the move that led to `fen`, if known
 */
export const describeTypical = (fen, pick, replyLine, bestLine, lastMove = null) => {
  const played = playUci(fen, pick.uci);

  if (!played) {
    return null;
  }

  const turn = fen.split(' ')[1];
  const result = {
    uci: pick.uci,
    san: pick.san,
    from: played.move.from,
    to: played.move.to,
    share: pick.share,
    source: pick.source || 'model',
    why: whyTypical(fen, pick.uci, lastMove),
    grade: null,
    loss: null,
    eval: null,
    wrong: null,
  };

  if (!bestLine || !replyLine?.pv) {
    return result;
  }

  const isBest = bestLine.pv?.[0] === pick.uci;
  const loss = isBest ? 0 : Math.max(0, lineCp(bestLine) + lineCp(replyLine));

  result.loss = loss;
  result.eval = formatEval(replyLine, other(turn));
  result.grade = isBest ? 'Best' : loss <= 50 ? 'Good' : loss <= 100 ? 'Inaccuracy' : loss <= 250 ? 'Mistake' : 'Blunder';

  if (loss > 50 && replyLine.pv?.length) {
    const punish = explainMove(played.chess.fen(), replyLine);
    const reason = punish.reasons[0];
    const generic = !reason || /^(A solid improving move|Improves the piece|Trades on)/.test(reason);

    result.wrong = generic
      ? `Better is ${pvToSan(fen, bestLine.pv, 1)[0]} (about ${(loss / 100).toFixed(1)} better).`
      : `They answer ${punish.san} (${lowerFirst(reason)}).`;
  }

  return result;
};

/**
 * Everything the panel shows for one position.
 *
 * @param {string} fen
 * @param {{ deep: Array, shallow?: Array, nullLine?: object, level?: number }} analysis
 */
export const coachPosition = (fen, analysis) => {
  const {
    deep = [],
    shallow = [],
    nullLine = null,
    level = 1600,
    traps = {},
    mistake = null,
    typical = null,
  } = analysis || {};
  const turn = fen.split(' ')[1];

  if (!deep.length) {
    return null;
  }

  const threat = nullLine ? describeThreat(fen, nullLine, deep[0]) : null;
  const human = pickHumanMove(fen, deep, shallow, level);
  const best = deep[0];

  const config = LEVELS[level] || LEVELS[1600];
  const shallowMoves = shallow.map((l) => l?.pv?.[0]).filter(Boolean);

  const explain = (line) => {
    const card = explainMove(fen, line, { threat });
    const trap = traps[line.pv[0]] || null;

    // predict the opponent's likely reply + a safe pre-move the user can queue up on the site
    const replies = predictReply(fen, line.pv[0], { line, level, max: 2, typicalMovesFn: typicalMoves });
    const premove = replies.length ? safePremove(fen, line.pv[0], replies, { line }) : null;

    return {
      ...card,
      reasons: [...(trap ? [trap.text] : []), ...card.reasons].slice(0, config.maxReasons),
      uci: line.pv[0],
      pv: (line.pv || []).slice(0, 6), // raw UCIs so the UI can pick user-response moves during opponent turn
      eval: formatEval(line, turn),
      badges: [...classifyMove(fen, line, deep, shallowMoves), ...(trap ? ['Trap'] : [])],
      trap,
      replies,
      premove,
    };
  };

  const bestCard = explain(best);
  const humanCard = human ? { ...explain(human.line), loss: human.loss, isBest: human.isBest } : null;

  const alternatives = deep
    .filter((l) => l.pv[0] !== best.pv[0] && l.pv[0] !== humanCard?.uci)
    .slice(0, 2)
    .map((l) => {
      const card = explain(l);

      return { ...card, reasons: card.reasons.slice(0, 1) };
    });

  return {
    turn,
    eval: formatEval(best, turn),
    evalCpWhite: (best.mate ? Math.sign(best.mate) * MATE_CP : (best.scoreCp || 0)) * (turn === 'w' ? 1 : -1),
    depth: best.depth || null,
    best: bestCard,
    human: humanCard,
    alternatives,
    threat,
    // at low levels the "human" pick can itself be a slightly worse move; never show it as both
    mistake: mistake && mistake.uci !== humanCard?.uci && mistake.uci !== best.pv[0] ? mistake : null,
    tactic: findTactic(fen, deep),
    typical,
  };
};

/**
 * Works out whose turn it is: your choice, else the board's last-move highlight, else the previous position
 * (if one legal move from it gives this board, the other side is to move now).
 */
const legalFen = (fen) => {
  try {
    const chess = new Chess(fen);
    const toMove = chess.turn();
    const [king] = chess.findPiece({ type: 'k', color: toMove === 'w' ? 'b' : 'w' });

    // the side that just moved can't have left its own king in check
    return king && chess.isAttacked(king, toMove) ? null : fen;
  } catch {
    return null;
  }
};

const withTurn = (fen, turn) => {
  const parts = fen.split(' ');

  if (parts[1] !== turn) {
    parts[1] = turn;
    parts[3] = '-'; // the en passant square only makes sense for the side we guessed
  }

  return parts.join(' ');
};

export const resolveTurn = (message, prevFen, choice) => {
  const { fen } = message;

  if (choice === 'w' || choice === 'b') {
    return legalFen(withTurn(fen, choice)) || fen;
  }

  if (!message.turnKnown && prevFen) {
    const mover = prevFen.split(' ')[1];

    if (findMoveBetween(prevFen, withTurn(fen, mover === 'w' ? 'b' : 'w'))) {
      return legalFen(withTurn(fen, mover === 'w' ? 'b' : 'w')) || fen;
    }
  }

  // the side not to move can't be in check; if it is, it must be the other side's turn
  return legalFen(fen) || legalFen(withTurn(fen, fen.split(' ')[1] === 'w' ? 'b' : 'w')) || fen;
};

