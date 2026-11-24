'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePairs, validatePairs, secureShuffle } = require('../src/draw');

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('170 participants: valid one-to-one, no self-assignment (100 runs)', () => {
  const ids = range(170);
  for (let run = 0; run < 100; run += 1) {
    const pairs = generatePairs(ids, { mode: 'random', avoidMutual: true });
    assert.equal(validatePairs(ids, pairs), true);
    const map = new Map(pairs);
    for (const [g, r] of pairs) {
      assert.notEqual(g, r);
      assert.notEqual(map.get(r), g, 'mutual pair found while avoidMutual=true');
    }
  }
});

test('chain mode forms a single loop through everyone', () => {
  const ids = range(50);
  const pairs = generatePairs(ids, { mode: 'chain' });
  validatePairs(ids, pairs);
  const map = new Map(pairs);
  const seen = new Set();
  let cur = ids[0];
  do { seen.add(cur); cur = map.get(cur); } while (cur !== ids[0]);
  assert.equal(seen.size, ids.length);
});

test('small groups work (2, 3, 4 people)', () => {
  for (const n of [2, 3, 4]) {
    const ids = range(n);
    for (let i = 0; i < 50; i += 1) validatePairs(ids, generatePairs(ids, { avoidMutual: true }));
  }
});

test('rejects bad input', () => {
  assert.throws(() => generatePairs([1]));
  assert.throws(() => generatePairs([1, 1, 2]));
  assert.throws(() => validatePairs([1, 2, 3], [[1, 1], [2, 3], [3, 2]]), /themselves/);
  assert.throws(() => validatePairs([1, 2, 3], [[1, 2], [2, 2], [3, 1]]));
  assert.throws(() => validatePairs([1, 2, 3], [[1, 2], [3, 1]]));
});

test('every receiver is reachable for a given giver (randomness sanity check)', () => {
  const ids = range(6);
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const map = new Map(generatePairs(ids, { avoidMutual: false }));
    seen.add(map.get(1));
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4, 5, 6]);
});

test('secureShuffle keeps all items', () => {
  const ids = range(100);
  assert.deepEqual([...secureShuffle(ids)].sort((a, b) => a - b), ids);
});
