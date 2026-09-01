// Locks the funnel's contract-value basis to one answer per input.
//
// Regression this guards: the same empty register once showed a $375K basis on
// one screen and $12K on another. The resolution function takes no viewport, no
// storage and no globals, and this test fails the build if that ever changes —
// or if the resolution order drifts.
import assert from 'node:assert/strict';
import { resolveDealBasis, defaultCapacity, medianOf } from '../lib/deal-basis.mjs';

const costs = [100000, 200000, 375000, 400000, 500000, 575000, 600000, 700000];

// Determinism: identical inputs, identical output — called twice, and there is
// no width/viewport parameter to pass at all.
const base = {
  explicitTicket: false,
  ticket: 0,
  winsRecorded: 0,
  winsMedian: 0,
  profileKey: null,
  viewCosts: costs,
  registerCosts: costs,
  profileFee: 0,
  fallbackFee: 12000,
};
assert.deepEqual(resolveDealBasis({ ...base }), resolveDealBasis({ ...base }));

// No profile → the city's own median, not our constant.
assert.deepEqual(resolveDealBasis({ ...base }), { avg: medianOf(costs), basis: 'view' });

// A report-selling trade gets its fee, never the whole job's cost.
assert.deepEqual(
  resolveDealBasis({ ...base, profileKey: 'qewi', profileFee: 12000 }),
  { avg: 12000, basis: 'fee' },
);

// A trade that performs the work prices at the declared cost.
assert.equal(resolveDealBasis({ ...base, profileKey: 'restoration', profileFee: 100000 }).basis, 'view');

// The user's own saved figure beats everything.
assert.deepEqual(
  resolveDealBasis({ ...base, explicitTicket: true, ticket: 90000, winsRecorded: 5, winsMedian: 50000 }),
  { avg: 90000, basis: 'yours' },
);

// Three recorded wins beat every derived figure.
assert.deepEqual(
  resolveDealBasis({ ...base, winsRecorded: 3, winsMedian: 80000 }),
  { avg: 80000, basis: 'wins' },
);

// Small view sample falls through to the register, then to the fee.
assert.equal(resolveDealBasis({ ...base, viewCosts: [1, 2] }).basis, 'register');
assert.equal(resolveDealBasis({ ...base, viewCosts: [], registerCosts: [] }).basis, 'constant');

// Capacity is bounded and sane at the edges.
assert.equal(defaultCapacity(NaN), 40);
assert.equal(defaultCapacity(0.5), 8);
assert.equal(defaultCapacity(25), 40);
assert.ok(defaultCapacity(1000) <= 48);

console.log('test-basis: all assertions pass');
