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
 * A move you can safely pre-move after our `ourUci`, given the opponent's likely `replies`
 * (sorted by probability, most-likely first). Returns null when nothing qualifies.
 *
 * Grading rules, in order:
 *   1. "strong"      — safe against EVERY reply with share >= 0.15 (covers ~85% of what you'd
 *                      face), AND it's the engine's intended follow-up (line.pv[2]).
 *   2. "conditional" — safe against the TOP reply (the one with the highest share), which is
 *                      usually ~55-70% of real games at your rating. Either a non-engine move
 *                      or the engine move with some tail-reply hangs.
 *   3. "weak"        — only safe in the engine's main PV line (the opponent plays pv[1]).
 *                      Shown with a clear warning.
 *   4. null          — not even the engine's pv[2] works; no suggestion.
 *
 * We prefer the TOP reply's accuracy over all-reply strictness because: the primary reply is
 * what will actually happen most of the time, and a premove that works 60% of the time is still
 * a big win. Being overly conservative made almost every suggestion fall back to "weak".
 */
export const safePremove = (fen, ourUci, replies, { line = null } = {}) => {
  if (!replies || !replies.length) return null;
  const ourPlayed = _playUci(fen, ourUci);
  if (!ourPlayed) return null;
  const afterOursFen = ourPlayed.chess.fen();
  const myColor = ourPlayed.move.color;
  const enemy = myColor === 'w' ? 'b' : 'w';

  const sortedReplies = [...replies].sort((a, b) => (b.share || 0) - (a.share || 0));
  const topReply = sortedReplies[0];
  const probableReplies = sortedReplies.filter((r) => (r.share || 0) >= 0.15);
  const preferred = line?.pv?.[2] || null;

  const candidates = preferred ? [preferred] : [];

  // widen: quiet non-capture non-check moves against the TOP reply (the one that usually happens)
  try {
    const probe = new Chess(afterOursFen);
    probe.move({ from: topReply.uci.slice(0, 2), to: topReply.uci.slice(2, 4), promotion: topReply.uci[4] });
    for (const m of probe.moves({ verbose: true })) {
      if (m.captured) continue;
      if (m.san.includes('+')) continue;
      const uci = `${m.from}${m.to}${m.promotion || ''}`;
      if (!candidates.includes(uci)) candidates.push(uci);
      if (candidates.length > 20) break;
    }
  } catch { /* ignore */ }

  // test: is `cand` legal and non-hanging after this specific opponent reply?
  const checkAgainst = (cand, reply) => {
    try {
      const probe = new Chess(afterOursFen);
      probe.move({ from: reply.uci.slice(0, 2), to: reply.uci.slice(2, 4), promotion: reply.uci[4] });
      const made = probe.move({ from: cand.slice(0, 2), to: cand.slice(2, 4), promotion: cand[4] });
      if (!made) return null;
      const attackers = probe.attackers(made.to, enemy);
      const defenders = probe.attackers(made.to, myColor);
      if (attackers.length && (!defenders.length || attackers.length > defenders.length)) return null;
      return made;
    } catch { return null; }
  };

  const shareLabel = (share) => `${Math.round(share * 100)}%`;

  // tier 1: engine's follow-up that works against every probable reply
  if (preferred) {
    const okAll = probableReplies.every((r) => checkAgainst(preferred, r) !== null);
    if (okAll) {
      const made = checkAgainst(preferred, topReply);
      if (made) {
        return { uci: preferred, san: made.san, confidence: 'strong' };
      }
    }
  }

  // tier 2: any candidate (engine's pv[2] included) that works against the TOP reply
  for (const cand of candidates) {
    const made = checkAgainst(cand, topReply);
    if (made) {
      const note = `assumes they play ${topReply.san} (${shareLabel(topReply.share || 0)})`;
      return { uci: cand, san: made.san, confidence: 'conditional', note };
    }
  }

  // tier 3: the engine's follow-up, safe only on the engine's own expected reply (pv[1])
  const engineReply = line?.pv?.[1] ? { uci: line.pv[1], san: '', share: 0 } : null;
  if (preferred && engineReply) {
    const made = checkAgainst(preferred, engineReply);
    if (made) {
      return { uci: preferred, san: made.san, confidence: 'weak', note: 'only works if they play the engine\'s expected reply' };
    }
  }
  return null;
};
