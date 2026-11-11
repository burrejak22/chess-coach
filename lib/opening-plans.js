// Short strategic plan notes for named openings. These sit alongside the move-by-move
// opening notes in openings.js. The idea: when the book runs out (or anytime the opening
// is identified), show a one-line plan the player should be thinking about.
//
// Each entry keyed by substring-match on the opening name (case-insensitive), so a
// detected opening of "Sicilian Defense, Dragon Variation, Yugoslav Attack" matches
// both "Dragon" and "Yugoslav Attack" (whichever hits first wins, so put the more
// specific keys first).

// Order matters. Longer / more specific names first.
const PLANS = [
    ['Yugoslav Attack',
        'White: trade dark-squared bishops with Bh6, open the h-file with h4-h5, and sacrifice if needed. Black: counter-attack on the queenside with ...Rc8, ...Nc4, ...a6-b5, and the exchange sac on c3 when the moment is right.'],
    ['Dragon',
        'Black: fianchetto bishop aims at the queenside, play ...Rc8, challenge on the c-file, trade off the Bg7 only when forced. White: usually goes Yugoslav or English attack.'],
    ['Najdorf',
        'Black has flexible central options: either ...e6 (Scheveningen-ish) or ...e5 (locking the center). The ...a6 reserves the queenside for expansion. White typically plays Be3 + f3 + Qd2 + O-O-O for a kingside pawn storm.'],
    ['Sveshnikov',
        'Black: trade the bad bishop with ...Bxc3, accept weak dark squares, use the knight on d5 as an outpost. White: play Bg5-xf6 or Nd5 trades to highlight the dark-square weaknesses.'],
    ['Panov',
        'White: central pawn majority, aim pieces at d5 and f5, often an IQP structure. Plan: Bd3, O-O, Rc1, hit the queenside and kingside simultaneously.'],
    ['French Defense',
        'Classic: Black has the bad light-squared bishop blocked by its own pawns; White has more space. Black breaks with ...c5 or ...f6. White attacks on the kingside or clamps with Nb5.'],
    ['Caro-Kann',
        'Black: solid pawn structure, no bad pieces, slow development. Plan: ...Bf5 or ...Bg4 to trade the problem bishop, then ...e6 and ...Nd7. White gets more space; Black waits for the endgame.'],
    ['Pirc',
        'Black invites White to overextend. Hypermodern: let White build a big center, then break it with ...e5 or ...c5. Watch for the Austrian Attack with f4.'],
    ['King\'s Indian',
        'Mainline: locked center with pawns on d5/e4 (White) vs d6/e5 (Black). White attacks on the queenside with c4-c5, b4-b5. Black attacks on the kingside with ...f5-f4, ...g5-g4, ...h5. Whoever breaks through first wins.'],
    ['Nimzo-Indian',
        'Black pins the Nc3 with ...Bb4, often trades it for the structural damage (doubled c-pawns), then clamps with ...c5 and ...d5. Classical plan: ...b6, ...Bb7, ...c5.'],
    ['Queen\'s Indian',
        'Black fianchettos both bishops, especially the queen\'s bishop to b7. Classical: ...e6, ...b6, ...Bb7, then ...d5 or ...Ne4. Solid, flexible, no weaknesses.'],
    ['Grunfeld',
        'Black lets White build a big center with pawns on c4/d4/e4, then attacks it with pieces. ...Bg7, ...c5, ...Qa5, ...Rd8. White tries to prove the center is strong, not weak.'],
    ['Queen\'s Gambit Declined',
        'White: minority attack with b4-b5 against Black\'s queenside, or Carlsbad plan on the kingside. Black: free the bad bishop with ...b6 and ...Bb7, or ...c5 break, defend solidly.'],
    ['Queen\'s Gambit Accepted',
        'White: use the extra tempo for central/kingside expansion with e4, Bd3. Black: hold the pawn or return it, play ...c5 to challenge the center, develop quickly.'],
    ['Slav',
        'Black: Solid; the Bc8 problem-bishop gets out via ...Bf5 before ...e6. Classical plan: ...dxc4, ...Bf5, ...e6, ...Nbd7, ...Be7, ...O-O.'],
    ['Ruy Lopez',
        'White: build a slow kingside attack, keep the bishop pair, play on both wings with d4 at the right moment. Black: either ...d6 (Steinitz / Russian) for solid defense, or the Open with ...Nxe4, or Marshall gambit with ...d5.'],
    ['Italian',
        'Slow build-up: c3 + d3 ("Giuoco Pianissimo") preparing d4 later, Nbd2-f1-g3 reroute, O-O. Attacks on the kingside once set up.'],
    ['Two Knights',
        'White: Ng5! hits f7, or 4.d4 the Scotch way, or quiet 4.d3. Black has to defend f7 and keep the tension.'],
    ['Scotch',
        'White: opens the center early, often loses the bishop pair but gets fast development. The Scotch Gambit (4.Bc4) is sharp.'],
    ['English',
        'Reversed Sicilian with White having a tempo. c4 fights for d5 and prepares a queenside expansion with b4-b5. Flexible move order.'],
    ['Reti',
        'Hypermodern: Nf3, g3, Bg2, let Black have the center then undermine it. Transposes into English, King\'s Indian Attack, or Catalan setups.'],
    ['King\'s Indian Attack',
        'White plays a reversed KID: Nf3, g3, Bg2, O-O, d3, e4, Nbd2. Slow kingside attack regardless of what Black does.'],
    ['London',
        'Solid system: Bf4, e3, c3, Nf3, Nbd2, Bd3. No theory required, no sharp lines, goal is a playable middlegame.'],
    ['Catalan',
        'White fianchettos the Bg2 and plays c4. Pressure on the long diagonal and on Black\'s queenside. Open or Closed depending on whether Black takes on c4.'],
    ['Alekhine',
        'Black tempts White to chase the knight with e4-e5, d4. Plan: ...d6, ...dxe5, break the center with ...Bg4, ...Nc6, pressure the e-pawn.'],
    ['Scandinavian',
        'Black: ...d5 immediately, recapture with the queen (or knight via ...Nf6). Fast development, no complicated theory. Plan: ...Bf5 or ...Bg4, ...Nf6, ...e6, ...c6.'],
    ['Dutch',
        'Black: ...f5 immediately, aim at the kingside. Leningrad (Bg7) or Stonewall (pawns on d5-e6-f5) setups. White often goes 2.g3 for the long diagonal.'],
    ['Benoni',
        'Black: accept the space disadvantage for piece activity. Plan: ...g6, ...Bg7, ...O-O, ...Re8, ...Nbd7, ...a6, ...b5. Attack the center from both wings.'],
    ['Benko Gambit',
        'Black sacrifices a queenside pawn for long-term pressure on the a- and b-files. Plan: ...Rxa6, ...Qa5, ...Nbd7, ...Rfb8. Patient positional attack.'],
    ['Evans Gambit',
        'White sacrifices b4 for a rapid attack, dark-square control and the c-file. Plan: c3, d4, O-O, blow the center open while Black is underdeveloped.'],
];

/**
 * Get the plan for a detected opening, if we know one.
 * @param {string} openingName e.g. "Sicilian Defense, Dragon Variation, Yugoslav Attack"
 * @returns {string|null}
 */
export const planFor = (openingName) => {
    if (!openingName) return null;
    const needle = openingName.toLowerCase();
    for (const [key, plan] of PLANS) {
        if (needle.includes(key.toLowerCase())) return plan;
    }
    return null;
};
