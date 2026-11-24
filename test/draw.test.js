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

/* ---------- location-wise draw ---------- */
const { groupByLocation, generateGroupedPairs, locationKey } = require('../src/draw');

const staff = (spec) => {
  let id = 0;
  return Object.entries(spec).flatMap(([loc, n]) => Array.from({ length: n }, () => {
    id += 1;
    return { id, full_name: `P${id}`, location: loc };
  }));
};

test('location-wise: nobody is ever matched outside their location (100 runs per style)', () => {
  const people = staff({ Noida: 90, Ahmedabad: 60, Jaipur: 17, Pune: 3 });
  const { groups, problems } = groupByLocation(people);
  assert.deepEqual(problems, []);
  assert.deepEqual(groups.map((g) => [g.name, g.ids.length]), [['Noida', 90], ['Ahmedabad', 60], ['Jaipur', 17], ['Pune', 3]]);
  const ids = people.map((p) => p.id);
  const groupOf = new Map(people.map((p) => [p.id, locationKey(p.location)]));
  for (const mode of ['random', 'chain']) {
    for (let run = 0; run < 100; run += 1) {
      const pairs = generateGroupedPairs(groups.map((g) => g.ids), { mode, avoidMutual: true });
      assert.equal(validatePairs(ids, pairs, groupOf), true);
    }
  }
});

test('location-wise: spelling/case/spacing of the same place is one group', () => {
  const people = [
    { id: 1, full_name: 'A', location: 'Noida' }, { id: 2, full_name: 'B', location: ' NOIDA ' },
    { id: 3, full_name: 'C', location: 'noida' }, { id: 4, full_name: 'D', location: 'New  Delhi' }, { id: 5, full_name: 'E', location: 'new delhi' },
  ];
  const { groups, problems } = groupByLocation(people);
  assert.deepEqual(problems, []);
  assert.deepEqual(groups.map((g) => [g.name, g.ids]), [['Noida', [1, 2, 3]], ['New Delhi', [4, 5]]]);
});

test('location-wise: a 1-person location or a missing location is reported', () => {
  const people = [...staff({ Noida: 4, Jaipur: 1 }), { id: 99, full_name: 'No Place', location: '  ' }];
  const { problems } = groupByLocation(people);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /1 participant has no location set \(No Place\)/);
  assert.match(problems[1], /"Jaipur" has only 1 participant/);
});

test('validatePairs rejects a cross-location match', () => {
  const groupOf = new Map([[1, 'noida'], [2, 'noida'], [3, 'ahmedabad'], [4, 'ahmedabad']]);
  assert.equal(validatePairs([1, 2, 3, 4], [[1, 2], [2, 1], [3, 4], [4, 3]], groupOf), true);
  assert.throws(() => validatePairs([1, 2, 3, 4], [[1, 3], [3, 2], [2, 4], [4, 1]], groupOf), /outside their location/);
});
