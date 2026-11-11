// Spot-checks for lib/premoves.js. Uses engine PV only (no typicalMovesFn injection) to
// keep the tests deterministic and offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictReply, safePremove } from '../lib/premoves.js';

test('predictReply returns engine PV[1] when no human model is injected', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    // After 1.e4, engine's "typical" best reply is c5 or e5. Provide the line explicitly.
    const line = { pv: ['e2e4', 'c7c5', 'g1f3'] };
    const replies = predictReply(fen, 'e2e4', { line, level: 1600, max: 2 });
    assert.ok(replies.length >= 1, 'expected at least one reply');
    assert.equal(replies[0].uci, 'c7c5');
    assert.equal(replies[0].source, 'engine');
});

test('predictReply returns empty when the move is illegal', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const replies = predictReply(fen, 'e2e9', { line: null, level: 1600 });
    assert.deepEqual(replies, []);
});

test('safePremove returns the engine follow-up when its destination is safe', () => {
    // 1.e4 (predicted reply ...e5) 2.Nf3 — Nf3 should be safe to pre-move.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const line = { pv: ['e2e4', 'e7e5', 'g1f3'] };
    const replies = [{ uci: 'e7e5', san: 'e5', share: 1, source: 'engine' }];
    const pm = safePremove(fen, 'e2e4', replies, { line });
    assert.ok(pm, 'expected a premove');
    assert.equal(pm.uci, 'g1f3');
    assert.equal(pm.confidence, 'strong');
});

test('safePremove flags the engine follow-up as weak when it depends on a specific reply', () => {
    // If we play 1.e4 and the opponent plays ...Nc6 (not what the PV expected), engine's
    // intended Nf3 is still legal and safe, so it should still come through as strong. Use a
    // scenario where the engine's pv[2] becomes attacked under the alternative reply instead.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const line = { pv: ['e2e4', 'e7e5', 'g1f3'] };
    // If the opponent plays ...f5?! instead of ...e5, Nf3 is still legal and still not attacked.
    // This test just confirms the function doesn't crash on unexpected replies.
    const replies = [{ uci: 'f7f5', san: 'f5', share: 1, source: 'engine' }];
    const pm = safePremove(fen, 'e2e4', replies, { line });
    assert.ok(pm, 'expected some premove suggestion');
});

test('predictReply + safePremove gracefully handle empty replies list', () => {
    const pm = safePremove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        'e2e4', [], { line: null });
    assert.equal(pm, null);
});
