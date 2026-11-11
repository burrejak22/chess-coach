// Predict what the OPPONENT will play after each of our candidate moves, and suggest a
// safe pre-move the user can set up in advance on Lichess / Chess.com.
//
// Signals used (in order of trust):
//   1. The engine's PV continuation (line.pv[1] is the engine-best reply)
//   2. A caller-provided `typicalMovesFn` on the post-our-move position, for the human-y pick
//      (coach.js injects this; it uses Lichess Explorer data when available)
//
// Self-contained: no circular imports from coach.js. Takes optional dependencies as args.

import { Chess } from './chess.js';

const _playUci = (fen, uci) => {
  const chess = new Chess(fen);
  try {
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { chess, move };
  } catch {
    return null;
  }
};

/**
 * The opponent's most likely replies to our candidate `ourUci`, ranked. Each has a
 * probability share. If `typicalMovesFn` is provided, we use it to get human-realistic shares;
 * otherwise we fall back to just the engine's PV[1].
 *
 * @param {string} fen position BEFORE our move
 * @param {string} ourUci our candidate move
 * @param {{line?: object, level?: number, max?: number, typicalMovesFn?: Function}} opts
 */
export const predictReply = (fen, ourUci, {
  line = null, level = 1600, max = 2, typicalMovesFn = null,
} = {}) => {
  const played = _playUci(fen, ourUci);
  if (!played) return [];
  const afterFen = played.chess.fen();

  let replies = [];
  if (typicalMovesFn) {
    try {
      replies = typicalMovesFn(afterFen, { level, max }) || [];
    } catch { replies = []; }
  }

  // Always include the engine's PV[1] reply, even if the human model didn't surface it. If the
  // engine reply already made it into `replies` we skip; otherwise add it with the leftover
  // probability so the sum is 1.
  const engineReplyUci = line?.pv?.[1];
  if (engineReplyUci && !replies.some((r) => r.uci === engineReplyUci)) {
    try {
      const engineChess = new Chess(afterFen);
      const engineReply = engineChess.move({
        from: engineReplyUci.slice(0, 2),
        to: engineReplyUci.slice(2, 4),
        promotion: engineReplyUci[4],
      });
      if (engineReply) {
        const used = replies.reduce((s, r) => s + (r.share || 0), 0);
        replies.push({
          uci: engineReplyUci,
          san: engineReply.san,
          share: Math.max(0.05, 1 - used),
          source: 'engine',
        });
      }
    } catch { /* ignore */ }
  }

  // If we got nothing useful, at least return the engine's reply alone with share 1
  if (!replies.length && engineReplyUci) {
    try {
      const engineChess = new Chess(afterFen);
      const engineReply = engineChess.move({
        from: engineReplyUci.slice(0, 2), to: engineReplyUci.slice(2, 4), promotion: engineReplyUci[4],
      });
      if (engineReply) replies = [{ uci: engineReplyUci, san: engineReply.san, share: 1, source: 'engine' }];
    } catch { /* ignore */ }
  }

  return replies.slice(0, max);
};

/**
 * A move you can safely pre-move after our `ourUci`, given the opponent's likely `replies`.
 * Returns null when nothing qualifies.
 *
 * Strategy:
 *   - Start with the engine's intended continuation (line.pv[2]) as the preferred candidate.
 *   - For each reply the opponent might play, check the candidate is legal and that its landing
 *     square isn't hung in the resulting position.
 *   - Fall back to a plausible quiet developing move if the engine's follow-up isn't safe.
 *
 * Returns { uci, san, confidence: 'strong'|'conditional'|'weak', note?: string } or null.
 */
export const safePremove = (fen, ourUci, replies, { line = null } = {}) => {
  if (!replies || !replies.length) return null;
  const ourPlayed = _playUci(fen, ourUci);
  if (!ourPlayed) return null;
  const afterOursFen = ourPlayed.chess.fen();
  const myColor = ourPlayed.move.color;
  const enemy = myColor === 'w' ? 'b' : 'w';

  const preferred = line?.pv?.[2] || null;
  const candidates = preferred ? [preferred] : [];

  // widen with quiet non-capture non-check moves against the top reply
  try {
    const probe = new Chess(afterOursFen);
    if (replies[0]) probe.move({ from: replies[0].uci.slice(0, 2), to: replies[0].uci.slice(2, 4), promotion: replies[0].uci[4] });
    for (const m of probe.moves({ verbose: true })) {
      if (m.captured) continue;
      if (m.san.includes('+')) continue;
      const uci = `${m.from}${m.to}${m.promotion || ''}`;
      if (!candidates.includes(uci)) candidates.push(uci);
      if (candidates.length > 20) break; // enough to search
    }
  } catch { /* ignore */ }

  const check = (cand) => {
    for (const reply of replies) {
      try {
        const probe = new Chess(afterOursFen);
        probe.move({ from: reply.uci.slice(0, 2), to: reply.uci.slice(2, 4), promotion: reply.uci[4] });
        const made = probe.move({ from: cand.slice(0, 2), to: cand.slice(2, 4), promotion: cand[4] });
        if (!made) return false;
        const attackers = probe.attackers(made.to, enemy);
        const defenders = probe.attackers(made.to, myColor);
        if (attackers.length && (!defenders.length || attackers.length > defenders.length)) return false;
      } catch { return false; }
    }
    return true;
  };

  for (const cand of candidates) {
    if (!check(cand)) continue;
    try {
      const probe = new Chess(afterOursFen);
      if (replies[0]) probe.move({ from: replies[0].uci.slice(0, 2), to: replies[0].uci.slice(2, 4), promotion: replies[0].uci[4] });
      const made = probe.move({ from: cand.slice(0, 2), to: cand.slice(2, 4), promotion: cand[4] });
      const confidence = cand === preferred ? 'strong' : 'conditional';
      const note = confidence === 'conditional'
        ? 'not the engine\'s main line, but legal and safe against the likely reply'
        : undefined;
      return { uci: cand, san: made?.san || cand, confidence, note };
    } catch { /* fallthrough */ }
  }

  // nothing clean — surface the engine's follow-up with a warning so the user can decide
  if (preferred) {
    try {
      const probe = new Chess(afterOursFen);
      if (replies[0]) probe.move({ from: replies[0].uci.slice(0, 2), to: replies[0].uci.slice(2, 4), promotion: replies[0].uci[4] });
      const made = probe.move({ from: preferred.slice(0, 2), to: preferred.slice(2, 4), promotion: preferred[4] });
      if (made) return { uci: preferred, san: made.san, confidence: 'weak', note: 'only works if they play the engine\'s expected reply' };
    } catch { /* ignore */ }
  }
  return null;
};
