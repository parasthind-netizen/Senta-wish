'use strict';
// Secret Santa assignment algorithm. Pure functions, no database access – see test/draw.test.js.
const crypto = require('crypto');

/** Fisher–Yates shuffle using a cryptographically secure RNG. */
function secureShuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build giver -> receiver pairs.
 *  mode 'random': a uniformly random derangement (rejection sampling – nobody gets themselves).
 *                 With avoidMutual, 2-person swaps (A→B and B→A) are rejected too.
 *  mode 'chain' : one single gift loop through everyone (A→B→C→…→A).
 * @param {number[]} ids unique participant ids
 * @returns {Array<[number, number]>}
 */
function generatePairs(ids, { mode = 'random', avoidMutual = true } = {}) {
  const n = ids.length;
  if (n < 2) throw new Error('At least 2 participants are needed for a Secret Santa draw.');
  if (new Set(ids).size !== n) throw new Error('Participant list contains duplicates.');

  if (mode === 'chain') {
    const order = secureShuffle(ids);
    return order.map((giver, i) => [giver, order[(i + 1) % n]]);
  }

  const blockMutual = avoidMutual && n >= 3; // with 2 people a swap is the only option
  // Expected attempts: ~2.7 (plain) or ~4.5 (no swaps); the cap is just a safety net.
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const perm = secureShuffle(ids);
    let ok = true;
    for (let i = 0; i < n; i += 1) {
      if (perm[i] === ids[i]) { ok = false; break; }
    }
    if (!ok) continue;
    const pairs = ids.map((giver, i) => [giver, perm[i]]);
    if (blockMutual) {
      const map = new Map(pairs);
      if (pairs.some(([g, r]) => map.get(r) === g)) continue;
    }
    return pairs;
  }
  // Practically unreachable – fall back to a single loop, which satisfies every rule.
  return generatePairs(ids, { mode: 'chain' });
}

/** Throws unless pairs form a valid one-to-one Secret Santa distribution over ids. */
function validatePairs(ids, pairs) {
  const people = new Set(ids);
  const givers = new Set();
  const receivers = new Set();
  if (pairs.length !== people.size) throw new Error('Every participant must give exactly one gift.');
  for (const [g, r] of pairs) {
    if (!people.has(g) || !people.has(r)) throw new Error('Assignment references a non-participant.');
    if (g === r) throw new Error('A participant was assigned to themselves.');
    if (givers.has(g)) throw new Error('A participant was assigned twice as a giver.');
    if (receivers.has(r)) throw new Error('A recipient has more than one Secret Santa.');
    givers.add(g);
    receivers.add(r);
  }
  if (givers.size !== people.size || receivers.size !== people.size) throw new Error('Not everyone gives and receives exactly once.');
  return true;
}

module.exports = { secureShuffle, generatePairs, validatePairs };
