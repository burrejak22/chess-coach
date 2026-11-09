// What real players do, by rating: the numbers behind the "typical move".
//
// Sources (see README "How the typical move is chosen"):
// - Opening choices by rating: Lichess blitz & rapid games via the Lichess opening explorer, as published by
//   Chessiverse ("Move Trends by Rating"), given at 400 and 2500. In between we interpolate linearly; a few
//   values the source gives as "about" are approximate.
// - How often players match the engine's first choice: Ken Regan's FIDE-rated data (move-match % rises about
//   1.5 points per 100 Elo, 45.8% at 2000 to 57.8% at 2800).

import { Chess } from './chess.js';

/**
 * Opening positions (as move sequences) and each move's share of games: [at 400, at 2500].
 * Shares are of all games reaching the position; the rest are other moves.
 */
const OPENING_TRENDS = [
  { line: [], moves: { e4: [0.658, 0.446], d4: [0.202, 0.345], Nf3: [0.027, 0.104] } },
  { line: ['e4'], moves: { e5: [0.625, 0.194], c5: [0.05, 0.381], e6: [0.057, 0.119] } },
  { line: ['e4', 'e5'], moves: { Nf3: [0.517, 0.831], Bc4: [0.116, 0.028], Qh5: [0.10, 0.0] } },
  { line: ['e4', 'e5', 'Nf3'], moves: { Nc6: [0.504, 0.814], Nf6: [0.172, 0.123], d6: [0.116, 0.034] } },
  { line: ['e4', 'e5', 'Nf3', 'Nc6'], moves: { Bb5: [0.136, 0.46], Bc4: [0.363, 0.292], Nc3: [0.242, 0.107] } },
  { line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], moves: { Nf6: [0.401, 0.477], Bc5: [0.225, 0.46], h6: [0.087, 0.0] } },
  {
    line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
    moves: { c3: [0.149, 0.483], d3: [0.253, 0.213], 'O-O': [0.224, 0.186], Nc3: [0.14, 0.02], Ng5: [0.10, 0.005] },
  },
  { line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], moves: { a6: [0.263, 0.648], Nf6: [0.303, 0.202], d6: [0.094, 0.007] } },
  {
    line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'],
    moves: { Be7: [0.048, 0.559], b5: [0.316, 0.271], Nxe4: [0.268, 0.09], Bc5: [0.19, 0.05] },
  },
  { line: ['e4', 'e5', 'Nf3', 'Nf6'], moves: { Nxe5: [0.285, 0.512], Nc3: [0.309, 0.244], Bc4: [0.184, 0.03], d4: [0.06, 0.17] } },
];

const key = (fen) => fen.split(' ').slice(0, 2).join(' ');

let index = null;

const buildIndex = () => {
  index = new Map();
  OPENING_TRENDS.forEach((entry) => {
    const chess = new Chess();

    entry.line.forEach((san) => chess.move(san));
    index.set(key(chess.fen()), entry.moves);
  });
};

/**
 * Real-game shares of the moves people play here at this rating ({ san: share }), or null when we have
 * no data for the position. Ratings outside 400-2500 use the nearest end.
 */
export const openingShares = (fen, level) => {
  if (!index) {
    buildIndex();
  }

  const moves = index.get(key(fen));

  if (!moves) {
    return null;
  }

  const t = (Math.max(400, Math.min(2500, Number(level) || 1600)) - 400) / 2100;

  return Object.fromEntries(Object.entries(moves).map(([san, [low, high]]) => [san, low + ((high - low) * t)]));
};

/**
 * How often players at this rating play the engine's first choice (0-1), from Regan's data: 45.8% at 2000,
 * +1.5 points per 100 Elo. Below 2000 the same slope is extended, with a floor.
 */
export const engineMatchRate = (level) => Math.max(0.25, Math.min(0.65, 0.458 + (0.015 * ((Number(level) - 2000) / 100))));
