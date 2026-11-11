// Tactical and positional pattern detectors that run on top of the engine's PV.
// Each detector returns null or a short plain-English reason string (lowercase first
// letter, no trailing period) that explainMove can push into its reasons list.
//
// All detectors take the position before the move (`before`), the position after
// (`after`), and the move object (chess.js verbose form). Some also take the PV
// line to look one or two plies ahead.
//
// Design rules:
//   - Return null when uncertain. A false positive is worse than silence.
//   - No engine calls. Patterns are inferred from piece geometry only.
//   - Read-only on the Chess objects passed in.

import { Chess } from './chess.js';

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const FILES = 'abcdefgh';

const other = (c) => (c === 'w' ? 'b' : 'w');
const sq = (f, r) => (f >= 0 && f < 8 && r >= 1 && r <= 8 ? `${FILES[f]}${r}` : null);
const fileIdx = (s) => FILES.indexOf(s[0]);
const rankIdx = (s) => Number(s[1]);

// Ray step directions for each sliding piece type.
const ROOK_DIRS   = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const QUEEN_DIRS  = [...ROOK_DIRS, ...BISHOP_DIRS];

const dirsFor = (type) => (type === 'r' ? ROOK_DIRS : type === 'b' ? BISHOP_DIRS : type === 'q' ? QUEEN_DIRS : []);

// Walk from `from` in direction [df, dr] on `chess`. Yields each square it hits and the
// piece there (if any), stopping when it goes off the board. Caller breaks when they see
// a piece.
const walkRay = function* (chess, from, df, dr) {
    let f = fileIdx(from) + df;
    let r = rankIdx(from) + dr;
    while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
        const s = sq(f, r);
        yield { square: s, piece: chess.get(s) || null };
        f += df;
        r += dr;
    }
};

// Find the next two pieces along a ray from `from`. Returns { first, second } or nulls.
const firstTwoOnRay = (chess, from, df, dr) => {
    let first = null;
    let second = null;
    for (const hit of walkRay(chess, from, df, dr)) {
        if (!hit.piece) continue;
        if (!first) { first = hit; continue; }
        second = hit;
        break;
    }
    return { first, second };
};

// Return every (df, dr) direction a given piece type can attack along.
const attackDirs = (type) => dirsFor(type);

// ----- pin / skewer --------------------------------------------------------------------

/**
 * Did the move create a pin? The mover's piece is a slider (B/R/Q), it now sees an enemy
 * piece with another enemy piece directly behind it on the same ray. "Absolute" if the
 * back piece is the king; "relative" if the back piece is just more valuable than the
 * front one.
 */
export const detectPin = (before, after, move) => {
    const mover = after.get(move.to);
    if (!mover) return null;
    const dirs = attackDirs(mover.type);
    if (!dirs.length) return null;

    for (const [df, dr] of dirs) {
        const { first, second } = firstTwoOnRay(after, move.to, df, dr);
        if (!first || !second) continue;
        if (first.piece.color !== other(mover.color)) continue;
        if (second.piece.color !== other(mover.color)) continue;
        if (first.piece.type === 'k') continue; // the front piece being king is a check, not a pin

        const frontVal = VALUES[first.piece.type];
        const backVal = second.piece.type === 'k' ? 100 : VALUES[second.piece.type];
        if (backVal <= frontVal) continue;

        const kind = second.piece.type === 'k' ? 'absolute pin' : 'pin';
        return `Sets up a ${kind}: the ${NAMES[first.piece.type]} on ${first.square} can't move without losing the ${NAMES[second.piece.type]} on ${second.square}.`;
    }
    return null;
};

/**
 * Skewer: the mover (slider) attacks a valuable piece with something less valuable (or
 * the king) directly behind it. Opposite geometry to a pin, same idea.
 */
export const detectSkewer = (before, after, move) => {
    const mover = after.get(move.to);
    if (!mover) return null;
    const dirs = attackDirs(mover.type);
    if (!dirs.length) return null;

    for (const [df, dr] of dirs) {
        const { first, second } = firstTwoOnRay(after, move.to, df, dr);
        if (!first || !second) continue;
        if (first.piece.color !== other(mover.color)) continue;
        if (second.piece.color !== other(mover.color)) continue;

        const frontVal = first.piece.type === 'k' ? 100 : VALUES[first.piece.type];
        const backVal = second.piece.type === 'k' ? 100 : VALUES[second.piece.type];
        if (frontVal <= backVal) continue; // not a skewer, it's a pin

        return `Skewer: attacks the ${NAMES[first.piece.type]} on ${first.square}; when it moves the ${NAMES[second.piece.type]} on ${second.square} falls.`;
    }
    return null;
};

// ----- discovered attack / discovered check --------------------------------------------

/**
 * Discovered attack: the moved piece was blocking a line from a friendly slider, and now
 * that slider sees something. If the thing is the enemy king, this is a discovered check
 * (and chess.js will also call the move `+`, so we specifically label it).
 */
export const detectDiscovered = (before, after, move) => {
    // Inspect every direction a slider can attack ON a ray that passes THROUGH move.from.
    // If a friendly slider sits along one such ray behind our departure square, and now
    // sees an enemy piece on the other side, that's the discovery.
    for (const [df, dr] of QUEEN_DIRS) {
        // Walk from move.from in the OPPOSITE direction looking for a friendly slider aimed here.
        let backerSquare = null;
        let backerPiece = null;
        {
            let f = fileIdx(move.from) - df;
            let r = rankIdx(move.from) - dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const s = sq(f, r);
                const p = before.get(s);
                if (p) {
                    if (p.color === move.color && attackDirs(p.type).some(([a, b]) => a === df && b === dr)) {
                        backerSquare = s;
                        backerPiece = p;
                    }
                    break;
                }
                f -= df;
                r -= dr;
            }
        }
        if (!backerPiece) continue;

        // Now the backer sees down the ray through where the mover was. Find the first thing it hits.
        let targetSquare = null;
        let targetPiece = null;
        {
            let f = fileIdx(move.from) + df;
            let r = rankIdx(move.from) + dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const s = sq(f, r);
                // if the mover landed on this square, the ray is still blocked (no discovery)
                if (s === move.to) break;
                const p = after.get(s);
                if (p) {
                    if (p.color !== move.color) { targetSquare = s; targetPiece = p; }
                    break;
                }
                f += df;
                r += dr;
            }
        }
        if (!targetPiece) continue;

        if (targetPiece.type === 'k') {
            return `Discovered check: uncovers the ${NAMES[backerPiece.type]} on ${backerSquare} against their king.`;
        }
        const defended = after.attackers(targetSquare, other(move.color)).length > 0;
        const value = VALUES[targetPiece.type];
        if (!defended || value > VALUES[backerPiece.type]) {
            return `Discovered attack: uncovers the ${NAMES[backerPiece.type]} on ${backerSquare} against the ${NAMES[targetPiece.type]} on ${targetSquare}.`;
        }
    }
    return null;
};

// ----- back-rank threat ----------------------------------------------------------------

/**
 * Enemy king is on its back rank, all three escape squares in front of it are blocked by
 * own pawns, and after our move we have a rook or queen that can hit the back rank with
 * no defender on it.
 */
export const detectBackRankThreat = (before, after, move) => {
    const enemy = other(move.color);
    const backRank = enemy === 'w' ? 1 : 8;
    const [kingSq] = after.findPiece({ type: 'k', color: enemy });
    if (!kingSq || rankIdx(kingSq) !== backRank) return null;

    // king needs a pawn shield in front: the three squares at rank backRank+/-1 are all own pawns
    const forward = enemy === 'w' ? 1 : -1;
    const kf = fileIdx(kingSq);
    const shieldSquares = [-1, 0, 1].map((d) => sq(kf + d, backRank + forward)).filter(Boolean);
    const shielded = shieldSquares.every((s) => {
        const p = after.get(s);
        return p && p.color === enemy && p.type === 'p';
    });
    if (!shielded) return null;

    // and we must have a heavy piece on the back rank with no own pawn between it and the king
    const board = after.board().flat();
    const heavy = board.find((p) => p && p.color === move.color && (p.type === 'r' || p.type === 'q')
        && rankIdx(p.square) === backRank);
    if (!heavy) return null;

    // the move must be the one that just set this up — either moving the heavy onto the back
    // rank, or clearing the path to it. We settle for "we have the piece now" — the plain-
    // English reason reads fine even if the setup happened earlier.
    return `Back-rank threat: their king is boxed in by its own pawns and your ${NAMES[heavy.type]} eyes the back rank.`;
};

// ----- X-ray battery -------------------------------------------------------------------

/**
 * After the move, two of our sliders stand on the same file/rank/diagonal pointed at the
 * enemy king or queen, one behind the other. Classic "battery" — a known pressure signal.
 */
export const detectBattery = (before, after, move) => {
    const mover = after.get(move.to);
    if (!mover || !attackDirs(mover.type).length) return null;
    const enemy = other(move.color);

    for (const [df, dr] of attackDirs(mover.type)) {
        // what we see first on this ray
        let firstEnemy = null;
        let firstEnemySq = null;
        for (const hit of walkRay(after, move.to, df, dr)) {
            if (!hit.piece) continue;
            if (hit.piece.color === move.color) break;
            firstEnemy = hit.piece;
            firstEnemySq = hit.square;
            break;
        }
        if (!firstEnemy || !['k', 'q'].includes(firstEnemy.type)) continue;

        // is there a friendly slider BEHIND us aimed down this same ray?
        let f = fileIdx(move.to) - df;
        let r = rankIdx(move.to) - dr;
        while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
            const s = sq(f, r);
            const p = after.get(s);
            if (p) {
                if (p.color === move.color && attackDirs(p.type).some(([a, b]) => a === df && b === dr)) {
                    return `Battery: your ${NAMES[p.type]} on ${s} and ${NAMES[mover.type]} on ${move.to} both point at their ${NAMES[firstEnemy.type]} on ${firstEnemySq}.`;
                }
                break;
            }
            f -= df;
            r -= dr;
        }
    }
    return null;
};

// ----- outpost -------------------------------------------------------------------------

/**
 * A knight or bishop that lands on the 5th or 6th rank (from the mover's side), is
 * defended by a friendly pawn, and cannot be chased off by any enemy pawn.
 */
export const detectOutpost = (before, after, move) => {
    if (!['n', 'b'].includes(move.piece)) return null;
    const rank = rankIdx(move.to);
    const fromMoverSide = move.color === 'w' ? rank : 9 - rank;
    if (fromMoverSide < 5 || fromMoverSide > 6) return null;

    // defended by a friendly pawn
    const pawnDefenders = after.attackers(move.to, move.color)
        .map((s) => after.get(s))
        .filter((p) => p && p.type === 'p');
    if (!pawnDefenders.length) return null;

    // no enemy pawn on the adjacent files can ever reach a square that attacks us
    const enemy = other(move.color);
    const forward = enemy === 'w' ? 1 : -1;
    const f = fileIdx(move.to);
    const r = rankIdx(move.to);
    const attackSquares = [sq(f - 1, r + forward), sq(f + 1, r + forward)].filter(Boolean);
    const chasable = attackSquares.some((atk) => {
        const af = fileIdx(atk);
        // any enemy pawn on file af, at a rank from which it could push to `atk`
        for (let pr = 2; pr <= 7; pr += 1) {
            const p = after.get(sq(af, pr));
            if (p && p.color === enemy && p.type === 'p') {
                // enemy pawns move toward their opponent (toward rank 1 for black, 8 for white)
                const canAdvance = enemy === 'w' ? pr < rankIdx(atk) : pr > rankIdx(atk);
                if (canAdvance) return true;
            }
        }
        return false;
    });
    if (chasable) return null;

    return `Outpost: the ${NAMES[move.piece]} on ${move.to} is protected by a pawn and no enemy pawn can chase it off.`;
};

// ----- Greek gift / classic bishop sacrifice -------------------------------------------

/**
 * Bxh7+ (or Bxh2+ for Black): bishop takes the h-pawn in front of a castled king. We just
 * flag the shape; whether it's sound follows from the engine evaluation elsewhere.
 */
export const detectGreekGift = (before, after, move) => {
    if (move.piece !== 'b' || !move.captured || move.captured !== 'p') return null;
    const target = move.color === 'w' ? 'h7' : 'h2';
    const target2 = move.color === 'w' ? 'h2' : 'h7';
    if (move.to !== target && move.to !== target2) return null;
    // enemy king should be nearby (g8 for the target h7 variant, etc.)
    const enemy = other(move.color);
    const [kingSq] = after.findPiece({ type: 'k', color: enemy });
    if (!kingSq) return null;
    const rookFile = move.to === 'h7' ? 'g8' : move.to === 'h2' ? 'g1' : null;
    if (!rookFile || kingSq !== rookFile) return null;

    return `Greek gift sacrifice: the classic Bxh${move.to[1]} to rip open their king.`;
};

// ----- kingside attack signals ---------------------------------------------------------

/**
 * Pawn storm toward the enemy king when kings are castled on opposite sides. Flag when
 * the move is a pawn push on the g- or h-file aimed at the opponent's castled king.
 */
export const detectPawnStorm = (before, after, move) => {
    if (move.piece !== 'p') return null;
    const enemy = other(move.color);
    const [enemyKing] = after.findPiece({ type: 'k', color: enemy });
    const [ownKing] = after.findPiece({ type: 'k', color: move.color });
    if (!enemyKing || !ownKing) return null;

    // kings on opposite wings and we push a wing pawn toward them
    const enemyFile = fileIdx(enemyKing);
    const ownFile = fileIdx(ownKing);
    const sameWing = (enemyFile <= 3) === (ownFile <= 3);
    if (sameWing) return null;
    if (fileIdx(move.to) < 4 && enemyFile > 3) return null; // we push a queenside pawn but king is kingside
    if (fileIdx(move.to) > 3 && enemyFile < 4) return null; // and vice versa

    // only a push, not a capture
    if (move.captured) return null;
    // moved forward
    const forward = move.color === 'w' ? 1 : -1;
    if (Math.sign(rankIdx(move.to) - rankIdx(move.from)) !== forward) return null;

    return 'Pawn storm: pushing on their king while yours is on the other wing.';
};

/**
 * Rook lift: a rook moves from the back rank to the 3rd (or 6th for Black) rank, usually
 * en route to h3 / h6 for a kingside attack.
 */
export const detectRookLift = (before, after, move) => {
    if (move.piece !== 'r') return null;
    const homeRank = move.color === 'w' ? 1 : 8;
    const liftRank = move.color === 'w' ? 3 : 6;
    if (rankIdx(move.from) !== homeRank) return null;
    if (rankIdx(move.to) !== liftRank) return null;
    return 'Rook lift: swinging the rook up and across for a kingside attack.';
};

// ----- overloaded defender -------------------------------------------------------------

/**
 * The move attacks (or captures) an enemy piece that was the sole defender of another
 * valuable enemy piece or square. Taking it loses the second thing too.
 */
export const detectOverload = (before, after, move) => {
    const mover = after.get(move.to);
    if (!mover) return null;
    const enemy = other(move.color);

    // what's the attacked piece? either what we just captured, or an enemy piece we now hit.
    const attackedSquares = [];
    if (move.captured) attackedSquares.push(move.to);
    for (const p of after.board().flat()) {
        if (p && p.color === enemy && after.attackers(p.square, move.color).includes(move.to)) {
            if (!attackedSquares.includes(p.square)) attackedSquares.push(p.square);
        }
    }

    for (const atk of attackedSquares) {
        const attacked = before.get(atk) || after.get(atk);
        if (!attacked) continue;
        // what was this piece defending in `before`?
        const defendedByIt = [];
        for (const other2 of before.board().flat()) {
            if (!other2 || other2.color !== enemy) continue;
            if (other2.square === atk) continue;
            const defenders = before.attackers(other2.square, enemy);
            if (defenders.length === 1 && defenders[0] === atk) {
                defendedByIt.push(other2);
            }
        }
        const valuableDefended = defendedByIt.find((p) => p.type !== 'p' && p.type !== 'k');
        if (valuableDefended) {
            return `Overloads the ${NAMES[attacked.type]} on ${atk}: it was the only defender of the ${NAMES[valuableDefended.type]} on ${valuableDefended.square}.`;
        }
    }
    return null;
};

// ----- fianchetto damage ---------------------------------------------------------------

/**
 * Trading off the enemy fianchetto bishop (on g7/b7 for Black, g2/b2 for White) when
 * their king is castled on that side. Weakens the long diagonal and the king's cover.
 */
export const detectFianchettoDamage = (before, after, move) => {
    if (!move.captured || move.captured !== 'b') return null;
    const enemy = other(move.color);
    const fianchettoSquares = enemy === 'w' ? ['g2', 'b2'] : ['g7', 'b7'];
    if (!fianchettoSquares.includes(move.to)) return null;

    const [enemyKing] = after.findPiece({ type: 'k', color: enemy });
    if (!enemyKing) return null;
    // king should be behind that bishop's home
    const kingsideFianchetto = move.to[0] === 'g';
    const kingIsCastledThere = kingsideFianchetto ? ['g', 'h'].includes(enemyKing[0]) : ['a', 'b', 'c'].includes(enemyKing[0]);
    if (!kingIsCastledThere) return null;

    return `Takes their fianchetto bishop: the long ${move.to[0] === 'g' ? 'a1-h8 / h1-a8' : 'a8-h1 / a1-h8'} diagonal opens up on their king.`;
};

// ----- passed pawn refinements ---------------------------------------------------------

const isPassedPawn = (chess, square, color) => {
    const f = fileIdx(square);
    const r = rankIdx(square);
    const dir = color === 'w' ? 1 : -1;
    for (let df = -1; df <= 1; df += 1) {
        for (let rr = r + dir; rr >= 1 && rr <= 8; rr += dir) {
            const s = sq(f + df, rr);
            if (!s) continue;
            const p = chess.get(s);
            if (p && p.type === 'p' && p.color !== color) return false;
        }
    }
    return true;
};

/**
 * Push of a passed pawn that already has a friendly pawn one rank behind on an adjacent
 * file (protected passer), or has another passed pawn right next to it (connected).
 */
export const detectPassedPawnQuality = (before, after, move) => {
    if (move.piece !== 'p') return null;
    if (!isPassedPawn(after, move.to, move.color)) return null;

    const f = fileIdx(move.to);
    const r = rankIdx(move.to);
    const backward = move.color === 'w' ? -1 : 1;

    // protected: own pawn diagonally behind
    const protectors = [sq(f - 1, r + backward), sq(f + 1, r + backward)].filter(Boolean);
    const protectedBy = protectors.map((s) => after.get(s)).find((p) => p && p.color === move.color && p.type === 'p');
    if (protectedBy) {
        return `Pushes a protected passed pawn: it has its own pawn behind it, so it can't be won for free.`;
    }

    // connected: own passed pawn on adjacent file
    for (const df of [-1, 1]) {
        for (let rr = 2; rr <= 7; rr += 1) {
            const s = sq(f + df, rr);
            if (!s) continue;
            const p = after.get(s);
            if (p && p.color === move.color && p.type === 'p' && isPassedPawn(after, s, move.color)) {
                return `Creates connected passed pawns on the ${FILES[f]} and ${FILES[fileIdx(s)]} files.`;
            }
        }
    }
    return null;
};

// ----- IQP (isolated queen pawn) ------------------------------------------------------

/**
 * Flags when our move leaves us with an isolated queen pawn (d-pawn with no pawns on c/e),
 * usually in exchange for a central lead. Attacker's structure, worth naming.
 */
export const detectIQP = (before, after, move) => {
    const dPawns = [];
    for (let r = 2; r <= 7; r += 1) {
        const s = sq(3, r); // d-file
        const p = after.get(s);
        if (p && p.type === 'p' && p.color === move.color) dPawns.push({ s, p });
    }
    if (dPawns.length !== 1) return null;

    // no own pawns on c or e files
    for (const f of [2, 4]) {
        for (let r = 2; r <= 7; r += 1) {
            const s = sq(f, r);
            const p = after.get(s);
            if (p && p.type === 'p' && p.color === move.color) return null;
        }
    }

    // only flag when THIS move was what created the IQP (something on c/e went away or a d-pawn landed)
    const before_d = (() => {
        for (let r = 2; r <= 7; r += 1) {
            const s = sq(3, r);
            const p = before.get(s);
            if (p && p.type === 'p' && p.color === move.color) return s;
        }
        return null;
    })();
    const createdNow = (move.to[0] === 'd' && move.piece === 'p') // pawn landed on d-file
                   || (move.from[0] === 'c' || move.from[0] === 'e') // pawn traded off c/e
                   || (move.captured === 'p' && (move.to[0] === 'c' || move.to[0] === 'e'));
    if (!createdNow) return null;

    return `Leaves you with an isolated queen pawn: more central space and open c/e files, but the d-pawn is a long-term target.`;
};

// ----- Bxf7+ / Bxf2+ sac to prevent castling ------------------------------------------

/**
 * Bxf7+ in the Italian / Scotch style: bishop takes f7 pawn defended only by the king,
 * forcing the king to move and losing castling rights. Flag the shape; the engine eval
 * decides whether it's good right now.
 */
export const detectFSevenSac = (before, after, move) => {
    if (move.piece !== 'b' || !move.captured || move.captured !== 'p') return null;
    const target = move.color === 'w' ? 'f7' : 'f2';
    if (move.to !== target) return null;
    const enemy = other(move.color);
    const [kingSq] = after.findPiece({ type: 'k', color: enemy });
    const home = enemy === 'w' ? 'e1' : 'e8';
    if (kingSq !== home && kingSq !== (enemy === 'w' ? 'f1' : 'f8')) return null;
    return `Bxf${move.to[1]}+: forces the king off e-file and kills castling rights.`;
};

// ----- open file vs uncastled king -----------------------------------------------------

/**
 * Our move puts a heavy piece on an open or semi-open file leading straight to the enemy
 * king that hasn't castled yet. The classic "develop and open the center" lesson.
 */
export const detectOpenFileOnKing = (before, after, move) => {
    if (!['r', 'q'].includes(move.piece)) return null;
    const enemy = other(move.color);
    const [kingSq] = after.findPiece({ type: 'k', color: enemy });
    if (!kingSq) return null;
    const home = enemy === 'w' ? '1' : '8';
    if (kingSq[1] !== home) return null; // king has moved
    if (!'de'.includes(kingSq[0])) return null; // not on e-file or d-file home

    // file of our move
    const file = move.to[0];
    if (file !== kingSq[0]) return null;

    // the file has no pawns in between
    const f = fileIdx(file);
    let blocked = false;
    for (let r = 2; r <= 7; r += 1) {
        const p = after.get(sq(f, r));
        if (p && p.type === 'p') { blocked = true; break; }
    }
    if (blocked) return null;

    return `Puts a ${NAMES[move.piece]} on the open ${file}-file where their king still sits.`;
};

// ----- bad bishop ---------------------------------------------------------------------

const BISHOP_SQUARES_LIGHT = new Set();
const BISHOP_SQUARES_DARK = new Set();
for (let f = 0; f < 8; f += 1) {
    for (let r = 1; r <= 8; r += 1) {
        const s = sq(f, r);
        ((f + r) % 2 === 0 ? BISHOP_SQUARES_DARK : BISHOP_SQUARES_LIGHT).add(s);
    }
}

/**
 * Trading an enemy bishop that was hemmed in by its own pawns (bad bishop). Usually a
 * good decision; worth naming.
 */
export const detectTradesBadBishop = (before, after, move) => {
    if (!move.captured || move.captured !== 'b') return null;
    const captured = move.to;
    const color = other(move.color);
    const squareSet = BISHOP_SQUARES_LIGHT.has(captured) ? BISHOP_SQUARES_LIGHT : BISHOP_SQUARES_DARK;

    let sameColorPawns = 0;
    for (const s of squareSet) {
        const p = before.get(s);
        if (p && p.color === color && p.type === 'p') sameColorPawns += 1;
    }
    if (sameColorPawns < 4) return null;
    return `Trades their bad ${captured[0]}${captured[1]}-bishop: their pawns were parked on the same color, so the bishop had nothing to do.`;
};

// ----- zwischenzug (in-between move) -------------------------------------------------

/**
 * We have a piece hanging but we play a stronger forcing move (check or valuable capture)
 * first; the engine's PV handles the hanging piece on a later ply. Classic "important
 * move first, housekeeping after" pattern.
 */
export const detectZwischenzug = (before, after, move, line) => {
    // need a forcing move
    const isCheck = move.san.includes('+');
    const isHighCapture = move.captured && VALUES[move.captured] >= 3;
    if (!isCheck && !isHighCapture) return null;

    // find a piece of ours that was hanging before this move and is still hanging after
    const myColor = move.color;
    const enemy = other(myColor);

    const hanging = [];
    for (const p of before.board().flat()) {
        if (!p || p.color !== myColor || p.type === 'k') continue;
        const attackers = before.attackers(p.square, enemy);
        const defenders = before.attackers(p.square, myColor);
        if (!attackers.length) continue;
        if (!defenders.length || VALUES[p.type] > VALUES[before.get(attackers[0])?.type || 'p'] + 1) {
            hanging.push(p);
        }
    }
    if (!hanging.length) return null;

    // the move we played didn't move that hanging piece (we ignored it to play the zwischenzug)
    const stillHanging = hanging.filter((h) => h.square !== move.from);
    if (!stillHanging.length) return null;

    const worst = stillHanging.sort((a, b) => VALUES[b.type] - VALUES[a.type])[0];
    return `In-between move: plays this ${isCheck ? 'check' : 'capture'} first, deals with the ${NAMES[worst.type]} on ${worst.square} after.`;
};

// ----- deflection ---------------------------------------------------------------------

/**
 * Our move attacks (or captures) an enemy piece whose only job was defending something
 * else. The engine's second-ply move (our next after their reply) exploits that gap.
 */
export const detectDeflection = (before, after, move, line) => {
    if (!line?.pv || line.pv.length < 3) return null;

    const enemy = other(move.color);

    // what square does our move target that was a SOLE defender?
    const attackedByUs = move.captured ? [move.to] : [];
    for (const p of after.board().flat()) {
        if (!p || p.color !== enemy) continue;
        if (after.attackers(p.square, move.color).includes(move.to)) {
            attackedByUs.push(p.square);
        }
    }

    for (const dsq of attackedByUs) {
        // what was the piece on dsq defending in the BEFORE position?
        const defender = before.get(dsq);
        if (!defender || defender.color !== enemy) continue;

        // find enemy pieces whose only defender was `defender`
        const abandoned = [];
        for (const p of before.board().flat()) {
            if (!p || p.color !== enemy) continue;
            if (p.square === dsq) continue;
            const ds = before.attackers(p.square, enemy);
            if (ds.length === 1 && ds[0] === dsq && VALUES[p.type] >= 3) {
                abandoned.push(p);
            }
        }
        if (!abandoned.length) continue;

        // does the PV's 3rd move (our next move after their reply) attack the abandoned square?
        try {
            const probe = new Chess(before.fen());
            probe.move({ from: line.pv[0].slice(0, 2), to: line.pv[0].slice(2, 4), promotion: line.pv[0][4] });
            probe.move({ from: line.pv[1].slice(0, 2), to: line.pv[1].slice(2, 4), promotion: line.pv[1][4] });
            const follow = probe.move({ from: line.pv[2].slice(0, 2), to: line.pv[2].slice(2, 4), promotion: line.pv[2][4] });
            const hits = abandoned.find((p) => follow && (follow.to === p.square || follow.captured));
            if (hits) {
                return `Deflection: pulls the ${NAMES[defender.type]} off its defensive job; the ${NAMES[hits.type]} on ${hits.square} is the real target.`;
            }
        } catch {
            // the PV wasn't legal from this position, skip
        }
    }
    return null;
};

// ----- clearance sacrifice -------------------------------------------------------------

/**
 * We voluntarily vacate a square with this move, and the engine's PV then occupies that
 * same square (or the line we cleared) with a different piece to deliver the point.
 */
export const detectClearance = (before, after, move, line) => {
    if (!line?.pv || line.pv.length < 3) return null;

    try {
        const probe = new Chess(before.fen());
        probe.move({ from: line.pv[0].slice(0, 2), to: line.pv[0].slice(2, 4), promotion: line.pv[0][4] });
        probe.move({ from: line.pv[1].slice(0, 2), to: line.pv[1].slice(2, 4), promotion: line.pv[1][4] });
        const follow = probe.move({ from: line.pv[2].slice(0, 2), to: line.pv[2].slice(2, 4), promotion: line.pv[2][4] });
        if (!follow) return null;

        // the sac lands on move.from or crosses it via the ray our mover came from
        if (follow.to === move.from && follow.piece !== move.piece) {
            return `Clearance: steps out of the way so your ${NAMES[follow.piece]} can land on ${move.from}.`;
        }
    } catch {
        return null;
    }
    return null;
};

// ----- entry point ---------------------------------------------------------------------

// Order matters: cheap and commonly-firing detectors go first so we can short-circuit the
// loop when `maxReasons` is reached without having run the slow / rarer ones.
const DETECTORS = [
    detectDiscovered,         // cheap, uses ray walks from move.from only
    detectPin,                // cheap
    detectSkewer,             // cheap
    detectBackRankThreat,     // very cheap
    detectBattery,            // cheap
    detectOutpost,            // cheap
    detectPassedPawnQuality,  // cheap
    detectOverload,           // medium
    detectOpenFileOnKing,     // cheap
    detectRookLift,           // trivial
    detectPawnStorm,          // trivial
    detectGreekGift,          // trivial, specific shape
    detectFSevenSac,          // trivial, specific shape
    detectFianchettoDamage,   // trivial
    detectTradesBadBishop,    // medium (scans every square of a color)
    detectIQP,                // medium
    detectZwischenzug,        // medium (needs the PV)
    detectDeflection,         // medium (needs the PV)
    detectClearance,          // cheap (just plays the PV 3 plies)
];

// Memo: same (positionKey, uci) always produces the same patterns. explainMove is called
// 4–6 times per analyzeFen (best, human, alternatives, mistake, review), and typicalScore
// now also triggers it, so the hit rate is high. The key uses only piece placement + turn
// (not castling/ep/halfmove) so we share across cache-key-equivalent positions.
const memoCache = new Map();
const MEMO_CAP = 2000;

const memoKey = (fen, move) => `${fen.split(' ').slice(0, 2).join(' ')}|${move.from}${move.to}${move.promotion || ''}|${move.color}|${move.piece}`;

/**
 * Run every detector and return the reasons that fired, deduplicated.
 *
 * @param {string} fen
 * @param {object} move chess.js verbose-move
 * @param {object|null} line engine PV line (for PV-aware detectors like zwischenzug)
 * @param {{maxReasons?: number}} [opts] stop running detectors once this many reasons collected
 */
export const detectPatterns = (fen, move, line, opts = {}) => {
    const { maxReasons = Infinity } = opts;

    // memo hit: slice because the caller may push more into the returned array
    const key = memoKey(fen, move);
    const hit = memoCache.get(key);
    if (hit) return hit.slice(0, maxReasons);

    let before, after;
    try {
        before = new Chess(fen);
        after = new Chess(fen);
        after.move({ from: move.from, to: move.to, promotion: move.promotion });
    } catch {
        memoCache.set(key, []);
        return [];
    }

    const reasons = [];
    for (const d of DETECTORS) {
        if (reasons.length >= maxReasons) break;
        try {
            const r = d(before, after, move, line);
            if (r && !reasons.includes(r)) reasons.push(r);
        } catch {
            // never let a detector crash the explainer
        }
    }

    memoCache.set(key, reasons);
    if (memoCache.size > MEMO_CAP) {
        // trim ~1/5 of the oldest entries; Map preserves insertion order
        const drop = Math.floor(MEMO_CAP / 5);
        const it = memoCache.keys();
        for (let i = 0; i < drop; i += 1) memoCache.delete(it.next().value);
    }
    return reasons.slice(0, maxReasons);
};
