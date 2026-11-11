// Spot-checks for lib/opening-plans.js — just confirms the lookup wires up for a
// handful of popular openings and returns null for the unknown.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFor } from '../lib/opening-plans.js';

test('matches the Yugoslav Attack against a deep opening name', () => {
    const plan = planFor('Sicilian Defense, Dragon Variation, Yugoslav Attack');
    assert.ok(plan && /h-file/.test(plan), `expected a Yugoslav plan mentioning h-file, got: ${plan}`);
});

test('matches the King\'s Indian plan', () => {
    const plan = planFor('King\'s Indian Defense, Classical Variation');
    assert.ok(plan && /queenside|kingside/.test(plan), `expected KID plan, got: ${plan}`);
});

test('matches the Catalan plan', () => {
    const plan = planFor('Catalan Opening');
    assert.ok(plan && /long diagonal|c4/i.test(plan), `expected Catalan plan, got: ${plan}`);
});

test('returns null for a truly unknown opening', () => {
    const plan = planFor('Zyzzyva Attack');
    assert.equal(plan, null);
});

test('returns null for falsy input', () => {
    assert.equal(planFor(null), null);
    assert.equal(planFor(''), null);
    assert.equal(planFor(undefined), null);
});
