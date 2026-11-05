// Basic engine: a small alpha-beta search used as a backup when Stockfish isn't installed
// (and for testing). Much weaker than Stockfish, but it understands tactics a few moves deep.

import { Chess } from './chess.js';

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// piece-square tables from White's point of view, a8..h1 (index 0 = a8)
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const MATE = 100000;

/** Static evaluation from the side to move's point of view, in centipawns. */
export const evaluate = (chess) => {
  let score = 0;
  const board = chess.board();

  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      const piece = board[r][f];

      if (!piece) {
        continue;
      }

      const index = piece.color === 'w' ? (r * 8) + f : ((7 - r) * 8) + f;
      const value = VALUES[piece.type] + PST[piece.type][index];

      score += piece.color === 'w' ? value : -value;
    }
  }

  return chess.turn() === 'w' ? score : -score;
};

const uciOf = (move) => `${move.from}${move.to}${move.promotion || ''}`;

// captures first (most valuable victim, least valuable attacker), then checks & promotions
const orderMoves = (moves) => moves.sort((a, b) => {
  const score = (m) => (m.captured ? (10 * VALUES[m.captured]) - VALUES[m.piece] + 10000 : 0)
    + (m.promotion ? 9000 : 0)
    + (m.san.includes('+') ? 500 : 0);

  return score(b) - score(a);
});

/**
 * Searches `fen` and returns the top `multipv` root moves with scores (side to move's view) and lines.
 *
 * @param {string} fen
 * @param {{ depth?: number, multipv?: number, nodeLimit?: number }} [options]
 */
export const searchPosition = (fen, options = {}) => {
  const { depth = 3, multipv = 3, nodeLimit = 200000 } = options;
  const chess = new Chess(fen);
  let nodes = 0;

  const quiesce = (alpha, beta, ply) => {
    nodes += 1;

    const stand = evaluate(chess);

    if (stand >= beta) {
      return { score: beta, pv: [] };
    }

    let a = Math.max(alpha, stand);
    let bestPv = [];

    if (ply > 5 || nodes > nodeLimit) {
      return { score: a, pv: [] };
    }

    const captures = orderMoves(chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion));

    for (const move of captures) {
      chess.move(move);
      const child = quiesce(-beta, -a, ply + 1);
      chess.undo();

      const score = -child.score;

      if (score >= beta) {
        return { score: beta, pv: [] };
      }

      if (score > a) {
        a = score;
        bestPv = [uciOf(move), ...child.pv];
      }
    }

    return { score: a, pv: bestPv };
  };

  const negamax = (d, alpha, beta, ply) => {
    nodes += 1;

    if (chess.isCheckmate()) {
      return { score: -MATE + ply, pv: [] };
    }

    if (chess.isDraw() || chess.isStalemate()) {
      return { score: 0, pv: [] };
    }

    if (d <= 0) {
      return quiesce(alpha, beta, ply);
    }

    let a = alpha;
    let bestPv = [];
    const moves = orderMoves(chess.moves({ verbose: true }));

    for (const move of moves) {
      chess.move(move);
      const child = negamax(d - 1, -beta, -a, ply + 1);
      chess.undo();

      const score = -child.score;

      if (score >= beta) {
        return { score: beta, pv: [uciOf(move), ...child.pv] };
      }

      if (score > a) {
        a = score;
        bestPv = [uciOf(move), ...child.pv];
      }
    }

    return { score: a, pv: bestPv };
  };

  // root: only the top `multipv` moves need exact scores, so anything that can't beat the current
  // `multipv`-th best gets cut off early
  const rootMoves = orderMoves(chess.moves({ verbose: true }));
  const lines = [];

  for (const move of rootMoves) {
    const floor = lines.length >= multipv ? lines[multipv - 1].score : -MATE;

    chess.move(move);
    const child = negamax(depth - 1, -MATE, -floor, 1);
    chess.undo();

    const score = -child.score;

    if (lines.length < multipv || score > floor) {
      lines.push({ move: uciOf(move), score, pv: [uciOf(move), ...child.pv] });
      lines.sort((x, y) => y.score - x.score);
    }
  }

  return lines.slice(0, multipv).map((line, i) => {
    const mateIn = Math.abs(line.score) > MATE - 1000
      ? Math.sign(line.score) * Math.ceil((MATE - Math.abs(line.score)) / 2)
      : null;

    return {
      multipv: i + 1,
      depth,
      scoreCp: mateIn === null ? line.score : null,
      mate: mateIn,
      pv: line.pv,
    };
  });
};
