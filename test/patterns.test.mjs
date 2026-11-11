// Spot-checks for lib/patterns.js — each test sets up a known FEN, plays one move,
// and asserts the matching detector fires. Uses the node:test style of the other tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../lib/chess.js';
import {
    detectPin,
    detectSkewer,
    detectDiscovered,
    detectBackRankThreat,
    detectBattery,
    detectOutpost,
    detectGreekGift,
    detectFSevenSac,
    detectPawnStorm,
    detectRookLift,
    detectOverload,
    detectPassedPawnQuality,
    detectOpenFileOnKing,
    detectPatterns,
} from '../lib/patterns.js';

const positions = (fen, san) => {
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move(san);
    return { before, after, move };
};

test('absolute pin: Rd1 pins the knight on d5 against the king on d8', () => {
    const fen = '3k4/8/8/3n4/8/8/4K3/4R3 w - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({ from: 'e1', to: 'd1' });
    const r = detectPin(before, after, move);
    assert.ok(r && /pin/i.test(r) && /d5/.test(r), `expected pin reason mentioning d5, got: ${r}`);
});

test('skewer: Rd5 skewers the white king on d2 to the queen on d1', () => {
    const fen = '3r1k2/8/8/8/8/8/3K4/3Q4 b - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({ from: 'd8', to: 'd5' });
    const r = detectSkewer(before, after, move);
    assert.ok(r && /[Ss]kewer/.test(r), `expected skewer reason, got: ${r}`);
});

test('discovered check: knight moves to reveal queen check', () => {
    // White Q on e1, N on e4 (blocks), Black K on e8. Nxf6+ doesn't exist; use Nc5 to discover.
    const fen = '4k3/8/8/8/4N3/8/8/4Q2K w - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({ from: 'e4', to: 'c5' });
    const r = detectDiscovered(before, after, move);
    assert.ok(r && /[Dd]iscovered/.test(r), `expected discovered attack/check, got: ${r}`);
});

test('back-rank threat: king stuck behind its pawns, rook on same rank', () => {
    // Black king on g8, pawns on f7/g7/h7, White rook on d8. Move rook to d8 somehow:
    const fen = '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({ from: 'd1', to: 'd8' });
    const r = detectBackRankThreat(before, after, move);
    assert.ok(r && /[Bb]ack-rank/.test(r), `expected back-rank threat, got: ${r}`);
});

test('battery: Qd1 behind Rd2 aimed at king on d8', () => {
    const fen = '3k4/8/8/8/8/8/3R4/3Q3K w - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    // need to make a move that lands the mover on the file — move Qd1 to d3 (then R is behind Q,
    // not Q behind R). Switch the move: move R from d2 to d3 and keep Q on d1 behind it.
    const move = after.move({ from: 'd2', to: 'd3' });
    const r = detectBattery(before, after, move);
    assert.ok(r && /[Bb]attery/.test(r), `expected battery, got: ${r}`);
});

test('outpost: Nd5 supported by pawn on c4, no enemy pawn to chase', () => {
    // No black pawn on e-file so the e6 push can't kick d5; c-pawn on c7 can only ever attack d3.
    const start = 'r1bqkb1r/pp3ppp/5n2/8/2PP4/4N3/PP3PPP/R1BQKB1R w KQkq - 0 1';
    const before = new Chess(start);
    const after = new Chess(start);
    const move = after.move({ from: 'e3', to: 'd5' });
    const r = detectOutpost(before, after, move);
    assert.ok(r && /[Oo]utpost/.test(r), `expected outpost, got: ${r}`);
});

test('Greek gift: Bxh7+ with king on g8', () => {
    const fen = 'r1bq1rk1/pppp1ppp/2n2n2/4p3/1bB1P3/2NP1N2/PPPB1PPP/R2Q1RK1 w - - 0 1';
    // need pawn on h7 and the white bishop able to reach h7. Craft a cleaner setup:
    const clean = 'r4rk1/pppbqppp/2n2n2/3pp3/3P4/2PBPN2/PP3PPP/RNBQ1RK1 w - - 0 1';
    // ensure h7 pawn + Bd3; Bxh7+ captures
    const start = 'r4rk1/pppbqpBp/2n2n2/3pp3/3P4/2P1PN2/PP3PPP/RNBQ1RK1 w - - 0 1';
    const before = new Chess('r4rk1/pppbqppp/2n2n2/3pp3/3P4/2PB1N2/PP3PPP/RNBQ1RK1 w - - 0 1');
    const after = new Chess('r4rk1/pppbqppp/2n2n2/3pp3/3P4/2PB1N2/PP3PPP/RNBQ1RK1 w - - 0 1');
    const move = after.move({ from: 'd3', to: 'h7' });
    const r = detectGreekGift(before, after, move);
    assert.ok(r && /Greek gift/i.test(r), `expected Greek gift, got: ${r}`);
});

test('Bxf7+ sac to kill castling', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({ from: 'c4', to: 'f7' });
    const r = detectFSevenSac(before, after, move);
    assert.ok(r && /Bxf7/.test(r), `expected Bxf7+ note, got: ${r}`);
});

test('pawn storm: g4 while kings on opposite wings', () => {
    const fen = '2kr3r/ppp2ppp/2n5/8/4P3/2N2N2/PPP2PPP/2KR3R w - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    // white king on c1 (queenside), black king on c8 — same wing. Change: black king on g8.
    const fen2 = '6k1/pppr1ppp/2n5/8/4P3/2N2N2/PPP2PPP/2KR3R w - - 0 1';
    const b = new Chess(fen2);
    const a = new Chess(fen2);
    const m = a.move({ from: 'g2', to: 'g4' });
    const r = detectPawnStorm(b, a, m);
    assert.ok(r && /storm/i.test(r), `expected pawn storm note, got: ${r}`);
});

test('rook lift: Rh1-h3', () => {
    const fen = '4k3/8/8/8/8/8/8/4K2R w - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({ from: 'h1', to: 'h3' });
    const r = detectRookLift(before, after, move);
    assert.ok(r && /[Rr]ook lift/.test(r), `expected rook lift, got: ${r}`);
});

test('open file on uncastled king: Re1 with king still on e8', () => {
    // white king on d1 so e-file is clear for the rook to slide onto it
    const fen = '4k3/pppp1ppp/8/8/8/8/PPPP1PPP/3K3R w - - 0 1';
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({ from: 'h1', to: 'e1' });
    const r = detectOpenFileOnKing(before, after, move);
    assert.ok(r && /e-file/.test(r), `expected open e-file remark, got: ${r}`);
});

test('detectPatterns runs every detector without crashing on the starting position', () => {
    // From the start position, 1.e4 should just produce an empty array (nothing interesting
    // yet); we're mainly checking the aggregator doesn't throw.
    const rs = detectPatterns('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        { from: 'e2', to: 'e4', piece: 'p', color: 'w', san: 'e4', flags: 'b' }, null);
    assert.ok(Array.isArray(rs), 'expected an array');
});
