// A small, curated openings library: what to play, why, the plans that follow, and the traps to know.
// Every line is checked move by move in test/openings.test.mjs.

import { Chess } from './chess.js';

/**
 * @typedef {{ name: string, moves: string[], note: string, good: 'you' | 'them', kind?: 'attack' }} Trap
 * `good` is who comes out ahead: 'you' = a trap you can set, 'them' = one to avoid falling into.
 * `kind: 'attack'` = the payoff is a king hunt rather than material.
 *
 * @typedef {{
 *   id: string, name: string, side: 'w' | 'b', level: 'Beginner' | 'Intermediate' | 'Advanced',
 *   style: string, against?: string, moves: string[], notes: Record<number, string>,
 *   ideas: string[], plans: string[], traps: Trap[],
 * }} Opening
 */

/** @type {Opening[]} */
export const OPENINGS = [
  // ------------------------------------------------------------------ White
  {
    id: 'italian',
    name: 'Italian Game',
    side: 'w',
    level: 'Beginner',
    style: 'Classical',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Re1', 'a6', 'Bb3'],
    notes: {
      0: 'Take the center and open lines for the queen and bishop.',
      2: 'Develop with a threat: the knight attacks e5.',
      4: 'The bishop aims at f7, the weakest square near Black\'s king.',
      6: 'Prepares d4 to build a big center.',
      8: 'The slow, modern way: keep e4 solid and build up first.',
      10: 'King to safety before anything sharp happens.',
      12: 'The rook backs up e4 and gets ready for a later d4.',
      14: 'Tuck the bishop away from ...Na5 or ...d5 hits.',
    },
    ideas: [
      'Quick development and castling: a great first opening.',
      'The light-squared bishop on c4/b3 pressures f7 the whole game.',
      'Play for d3-d4 in the right moment to open the center.',
    ],
    plans: [
      'Reroute the b1 knight via d2 and f1 to g3, then push for a kingside attack.',
      'Once everything is developed, strike with d4.',
    ],
    traps: [
      {
        name: 'Fried Liver Attack',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3'],
        note: 'If Black answers 3.Bc4 with ...Nf6 and later recaptures 5...Nxd5?, the knight sacrifice on f7 drags the king into the open.',
        good: 'you',
        kind: 'attack',
      },
      {
        name: 'Blackburne Shilling Gambit',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+', 'Be2', 'Nf3#'],
        note: 'After 3...Nd4, don\'t grab the e5 pawn. 4.Nxe5? Qg5! leads to disaster. Play 4.Nxd4 or simply 4.O-O.',
        good: 'them',
      },
    ],
  },
  {
    id: 'london',
    name: 'London System',
    side: 'w',
    level: 'Beginner',
    style: 'Solid system',
    moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'Bg3', 'O-O', 'Bd3'],
    notes: {
      0: 'Take the center with the d-pawn.',
      2: 'Get the dark-squared bishop out before playing e3, so it isn\'t locked in.',
      4: 'Solid pawn chain; the f1 bishop can now come out.',
      8: 'The c3-d4-e3 pyramid makes the center very hard to break.',
      10: 'The knight goes to d2 so the c-pawn stays on c3.',
      12: 'Keep the bishop when Black offers to trade it with ...Bd6.',
      14: 'Aim the bishop at h7 for a later kingside attack.',
    },
    ideas: [
      'The same setup against almost anything Black does, so there\'s little theory to learn.',
      'Very solid: it\'s hard to lose quickly with it.',
    ],
    plans: [
      'Put a knight on e5 and attack with Qf3 or Qh5, sometimes pushing the h-pawn.',
      'If Black plays passively, expand with e4.',
    ],
    traps: [],
  },
  {
    id: 'queens-gambit',
    name: 'Queen\'s Gambit',
    side: 'w',
    level: 'Intermediate',
    style: 'Positional',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'Nbd7', 'Rc1'],
    notes: {
      2: 'Offers a pawn to pull Black\'s d-pawn away from the center. It\'s not a real gambit; the pawn is easy to win back.',
      4: 'Adds pressure on d5.',
      6: 'Pins the knight that defends d5.',
      12: 'The rook prepares play on the half-open c-file.',
    },
    ideas: [
      'Fight for the center with pawns on c4 and d4.',
      'Pressure Black\'s d5 pawn and the queenside.',
    ],
    plans: [
      'The minority attack: push b4-b5 to create a weak pawn in Black\'s queenside.',
      'Trade on d5 at the right moment to open the c-file for your rook.',
    ],
    traps: [
      {
        name: 'Elephant Trap',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Nbd7', 'cxd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd8', 'Bb4+', 'Qd2', 'Bxd2+', 'Kxd2', 'Kxd8'],
        note: 'The d5 pawn looks free after the pin, but 6.Nxd5? Nxd5! wins a piece: if 7.Bxd8, ...Bb4+ gets the queen back with interest.',
        good: 'them',
      },
    ],
  },
  {
    id: 'scotch',
    name: 'Scotch Game',
    side: 'w',
    level: 'Intermediate',
    style: 'Open',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nxc6', 'bxc6', 'e5', 'Qe7', 'Qe2', 'Nd5', 'c4'],
    notes: {
      4: 'Strike the center right away instead of slow development.',
      6: 'Recapture with a strong, central knight.',
      8: 'Trade knights to damage Black\'s pawns.',
      10: 'Kick the f6 knight and grab space.',
      14: 'Chase the knight from d5 again.',
    },
    ideas: [
      'Open the center early and play with active pieces.',
      'Leaves Black with doubled c-pawns in many lines.',
    ],
    plans: ['Develop quickly and use your space advantage; aim at Black\'s weak c-pawns.'],
    traps: [],
  },
  {
    id: 'vienna',
    name: 'Vienna Game',
    side: 'w',
    level: 'Beginner',
    style: 'Aggressive',
    moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Nf3', 'Be7', 'd4'],
    notes: {
      2: 'Develops and keeps the f-pawn free to push.',
      4: 'The Vienna Gambit: attack the e5 pawn and open the f-file.',
      6: 'Grab space with tempo.',
      10: 'A big center and a kingside attack to come.',
    },
    ideas: ['A fun attacking opening where the f-pawn pushes early.', 'Good if you like sharp positions.'],
    plans: ['Castle kingside and use the open f-file with your rook.'],
    traps: [],
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez',
    side: 'w',
    level: 'Advanced',
    style: 'Positional',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3'],
    notes: {
      4: 'Pressures the knight that defends e5.',
      6: 'Keep the bishop: it will sit on b3 aiming at f7.',
      8: 'Castle first; e4 is safe for now.',
      14: 'Prepares d4 for a big center.',
      16: 'Stops ...Bg4 from pinning your knight.',
    },
    ideas: ['The most classical opening there is: slow pressure on e5 and the center.', 'Deep theory, but rewards understanding.'],
    plans: ['Play d4, then often reroute a knight via d2-f1-g3.', 'Squeeze Black slowly; break with d5 or a4.'],
    traps: [
      {
        name: 'Noah\'s Ark Trap',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'd6', 'd4', 'b5', 'Bb3', 'Nxd4', 'Nxd4', 'exd4', 'Qxd4', 'c5', 'Qd5', 'Be6', 'Qc6+', 'Bd7', 'Qd5', 'c4', 'Bxc4', 'bxc4'],
        note: 'Grabbing d4 with the queen lets Black trap your bishop on b3 with ...c5 and ...c4. Watch out for it!',
        good: 'them',
      },
    ],
  },

  // ------------------------------------------------------------------ Black vs 1.e4
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defense',
    side: 'b',
    level: 'Beginner',
    style: 'Solid',
    against: '1.e4',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
    notes: {
      1: 'Prepares ...d5 with a pawn backing it up.',
      3: 'Challenge the center right away.',
      7: 'Develop the light-squared bishop before playing ...e6.',
      9: 'Keep the bishop; it\'s Black\'s best minor piece here.',
      11: 'Give the bishop a retreat square on h7.',
      13: 'Develop the knight to d7, ready for ...Ngf6 without allowing a doubled pawn.',
    },
    ideas: ['Very solid pawn structure with few weaknesses.', 'Your bad bishop gets out before the pawns lock it in.'],
    plans: ['Finish development with ...e6, ...Ngf6, ...Be7 and castle; then break with ...c5.'],
    traps: [
      {
        name: 'Smothered mate trap',
        moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Qe2', 'Ngf6', 'Nd6#'],
        note: 'In the ...Nd7 line, if White plays Qe2, don\'t play ...Ngf6?? because Nd6 is mate (the e-pawn is pinned). Play ...Ndf6 or ...e6 first.',
        good: 'them',
      },
    ],
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian Defense',
    side: 'b',
    level: 'Beginner',
    style: 'Direct',
    against: '1.e4',
    moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5'],
    notes: {
      1: 'Hit e4 immediately; very little theory.',
      3: 'Take back with the queen.',
      5: 'The queen is safe on a5 and pins nothing yet, but watches the a5-e1 diagonal.',
      9: 'Gives the queen a retreat to c7 and controls d5.',
      11: 'The light-squared bishop comes out actively.',
    },
    ideas: ['You choose the game from move one.', 'Easy development: ...Nf6, ...c6, ...Bf5, ...e6.'],
    plans: ['Castle and play ...Nbd7, ...e6; your structure is like a Caro-Kann with active pieces.'],
    traps: [],
  },
  {
    id: 'french',
    name: 'French Defense',
    side: 'b',
    level: 'Intermediate',
    style: 'Counterattacking',
    against: '1.e4',
    moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7', 'f4', 'c5', 'Nf3', 'Nc6', 'Be3'],
    notes: {
      1: 'Prepares ...d5 with a sturdy pawn chain.',
      7: 'The knight steps back to support ...c5.',
      9: 'Attack the base of White\'s pawn chain.',
      11: 'Add pressure on d4.',
    },
    ideas: ['Let White grab space, then hit the pawn chain with ...c5 and ...f6.', 'Your light-squared bishop is the problem piece; aim to trade it or free it with ...b6 and ...Ba6.'],
    plans: ['Pile up on d4 (...Qb6, ...cxd4), then break with ...f6 at the right time.'],
    traps: [],
  },
  {
    id: 'two-knights',
    name: 'Two Knights Defense',
    side: 'b',
    level: 'Intermediate',
    style: 'Active',
    against: '1.e4',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5', 'Bb5+', 'c6', 'dxc6', 'bxc6', 'Be2', 'h6'],
    notes: {
      5: 'Counterattack e4 instead of defending passively.',
      7: 'Block the f7 attack and open lines.',
      9: 'The key move! Recapturing with ...Nxd5? walks into the Fried Liver.',
      13: 'You\'re a pawn down, but way ahead in development.',
      15: 'Kick the knight and keep the initiative.',
    },
    ideas: ['A real fight against the Italian: you give a pawn for fast, active play.'],
    plans: ['Push ...e4 to gain space, develop with ...Bd6 and ...O-O, and attack.'],
    traps: [
      {
        name: 'Fried Liver Attack',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3'],
        note: 'This is why 5...Na5 matters: 5...Nxd5? lets White sacrifice on f7 and hunt your king.',
        good: 'them',
        kind: 'attack',
      },
    ],
  },
  {
    id: 'sicilian-najdorf',
    name: 'Sicilian Defense (Najdorf)',
    side: 'b',
    level: 'Advanced',
    style: 'Sharp',
    against: '1.e4',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    notes: {
      1: 'Fight for d4 from the side and unbalance the game.',
      5: 'Trade a wing pawn for White\'s center pawn.',
      7: 'Develop with tempo on e4.',
      9: 'The Najdorf move: controls b5 and prepares ...e5 or ...e6 and ...b5.',
    },
    ideas: ['Unbalanced positions where you play to win.', 'Queenside counterplay with ...b5 and the half-open c-file.'],
    plans: ['Choose ...e5 or ...e6, castle, and push ...b5-b4 to attack White\'s queenside.'],
    traps: [],
  },

  // ------------------------------------------------------------------ Black vs 1.d4
  {
    id: 'qgd',
    name: 'Queen\'s Gambit Declined',
    side: 'b',
    level: 'Beginner',
    style: 'Solid',
    against: '1.d4',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4', 'b6'],
    notes: {
      3: 'Hold the center with ...e6 instead of taking on c4.',
      7: 'Unpins the knight.',
      11: 'Ask the bishop a question.',
      13: 'Prepares ...Bb7 to fix the problem bishop.',
    },
    ideas: ['Rock solid: one of the most respected defenses ever.', 'Know the Elephant Trap; it\'s your trick here.'],
    plans: ['Finish development with ...Bb7 and ...Nbd7, then free your game with ...c5.'],
    traps: [
      {
        name: 'Elephant Trap',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Nbd7', 'cxd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd8', 'Bb4+', 'Qd2', 'Bxd2+', 'Kxd2', 'Kxd8'],
        note: 'After 4...Nbd7 the d5 pawn looks free. If White grabs it with 6.Nxd5?, take back and answer Bxd8 with ...Bb4+: you win a piece.',
        good: 'you',
      },
    ],
  },
  {
    id: 'slav',
    name: 'Slav Defense',
    side: 'b',
    level: 'Intermediate',
    style: 'Solid',
    against: '1.d4',
    moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6', 'Bxc4', 'Bb4'],
    notes: {
      3: 'Support d5 with the c-pawn and keep the light bishop free.',
      7: 'Take the pawn now that White can\'t easily win it back with b3.',
      9: 'The bishop comes out before ...e6.',
      13: 'Pin the knight and develop.',
    },
    ideas: ['Like the Queen\'s Gambit Declined, but your light bishop gets out.'],
    plans: ['Castle, play ...Nbd7, and break with ...e5 or ...c5.'],
    traps: [],
  },
  {
    id: 'kings-indian',
    name: 'King\'s Indian Defense',
    side: 'b',
    level: 'Advanced',
    style: 'Hypermodern, sharp',
    against: '1.d4',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7'],
    notes: {
      3: 'Fianchetto the bishop instead of fighting for the center right away.',
      7: 'Let White build a big center; you\'ll attack it later.',
      11: 'The key strike at the center.',
      15: 'The knight heads to the kingside for ...f5.',
    },
    ideas: ['Give White the center, then counterattack it and White\'s king.', 'Races: White attacks on the queenside, you on the kingside.'],
    plans: ['Play ...Nd7 (or ...Ne8), ...f5, ...f4 and ...g5 for a kingside pawn storm.'],
    traps: [],
  },
];

const placementKey = (fen) => fen.split(' ').slice(0, 2).join(' ');

/**
 * Plays out a list of SAN moves from the start. Returns the FEN after each move and the SAN.
 * Throws on an illegal move (the tests rely on that).
 */
export const playLine = (moves) => {
  const chess = new Chess();

  return moves.map((san) => {
    const move = chess.move(san);

    return { san: move.san, from: move.from, to: move.to, fen: chess.fen() };
  });
};

let index = null;

const buildIndex = () => {
  index = new Map();

  OPENINGS.forEach((opening) => {
    playLine(opening.moves).forEach((step, ply) => {
      const key = placementKey(step.fen);

      index.set(key, [...(index.get(key) || []), { opening, ply }]);
    });
  });
};

/**
 * Which library opening the position belongs to, if any, and the next book move.
 *
 * @returns {{ opening: Opening, ply: number, next: string | null } | null}
 */
/**
 * Every book continuation from this position across all the openings here, with how many lines use it
 * ({ san: count }). Used as a rough guide to what people actually play in the opening.
 */
export const bookMoves = (fen) => {
  if (!index) {
    buildIndex();
  }

  const counts = {};
  const add = (san) => {
    if (san) {
      counts[san] = (counts[san] || 0) + 1;
    }
  };
  const key = placementKey(fen);

  if (key === placementKey(new Chess().fen())) {
    OPENINGS.filter((o) => o.side === 'w' || o.moves.length).forEach((o) => add(o.moves[0]));
  }

  (index.get(key) || []).forEach((hit) => add(hit.opening.moves[hit.ply + 1]));

  return counts;
};

export const detectOpening = (fen) => {
  if (!index) {
    buildIndex();
  }

  const hits = index.get(placementKey(fen));

  if (!hits?.length) {
    return null;
  }

  // prefer the opening of the side to move (that's who's being coached), then the longer line
  const turn = fen.split(' ')[1];
  const [hit] = [...hits].sort((a, b) => (
    (Number(b.opening.side === turn) - Number(a.opening.side === turn))
      || (b.opening.moves.length - a.opening.moves.length)
  ));

  return {
    ...hit,
    next: hit.opening.moves[hit.ply + 1] || null,
    note: hit.opening.notes[hit.ply + 1] || null,
    also: hits.filter((h) => h.opening !== hit.opening).map((h) => h.opening.name),
  };
};

/** "1.e4 e5 2.Nf3" from a list of SAN moves. */
export const formatMoves = (moves, upTo = moves.length) => moves.slice(0, upTo).map((san, i) => (
  i % 2 === 0 ? `${(i / 2) + 1}.${san}` : san
)).join(' ');

/** Lichess analysis board link for a FEN. */
export const lichessAnalysisUrl = (fen) => `https://lichess.org/analysis/standard/${fen.replace(/ /g, '_')}`;
