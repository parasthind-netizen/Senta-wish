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

/** Location used for grouping: case and spacing don't matter ("Noida", " noida " are the same place). */
const tidyLocation = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const locationKey = (v) => tidyLocation(v).toLowerCase();

/**
 * Split participants ({ id, full_name, location }) into location groups for a location-wise draw.
 * Nobody can be matched outside their group, so every group needs at least 2 people.
 * @returns {{ groups: Array<{ name: string, ids: number[] }>, problems: string[] }}
 */
function groupByLocation(people) {
  const map = new Map();
  const missing = [];
  for (const p of people) {
    const key = locationKey(p.location);
    if (!key) { missing.push(p.full_name); continue; }
    if (!map.has(key)) map.set(key, { name: tidyLocation(p.location), ids: [] });
    map.get(key).ids.push(p.id);
  }
  const groups = [...map.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
  const problems = [];
  if (missing.length) {
    const names = missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` and ${missing.length - 5} more` : '');
    problems.push(`${missing.length} participant${missing.length === 1 ? ' has' : 's have'} no location set (${names}) – add it on the Employees page.`);
  }
  for (const g of groups) {
    if (g.ids.length < 2) problems.push(`"${g.name}" has only 1 participant, so they can't be matched within their location – fix the location or add more people there.`);
  }
  return { groups, problems };
}

/** Pairs made inside each group only – each group is its own random draw (or its own chain). */
function generateGroupedPairs(groups, opts) {
  return groups.flatMap((ids) => generatePairs(ids, opts));
}

/**
 * Throws unless pairs form a valid one-to-one Secret Santa distribution over ids.
 * With groupOf (id -> group key), every giver and receiver must also be in the same group.
 */
function validatePairs(ids, pairs, groupOf = null) {
  const people = new Set(ids);
  const givers = new Set();
  const receivers = new Set();
  if (pairs.length !== people.size) throw new Error('Every participant must give exactly one gift.');
  for (const [g, r] of pairs) {
    if (!people.has(g) || !people.has(r)) throw new Error('Assignment references a non-participant.');
    if (g === r) throw new Error('A participant was assigned to themselves.');
    if (givers.has(g)) throw new Error('A participant was assigned twice as a giver.');
    if (receivers.has(r)) throw new Error('A recipient has more than one Secret Santa.');
    if (groupOf && groupOf.get(g) !== groupOf.get(r)) throw new Error('A participant was matched outside their location.');
    givers.add(g);
    receivers.add(r);
  }
  if (givers.size !== people.size || receivers.size !== people.size) throw new Error('Not everyone gives and receives exactly once.');
  return true;
}

module.exports = { secureShuffle, generatePairs, generateGroupedPairs, validatePairs, locationKey, groupByLocation };
