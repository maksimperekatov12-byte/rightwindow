// Locks the funnel's money to one resolution path per input.
//
// Regression this guards: the same empty register once showed a $375K basis on
// one screen and $12K on another. resolveMoney takes no viewport, no storage
// and no globals; this fails the build if that changes — or if the order
// drifts, or if an assumption sneaks in outside TRADE_UNITS.
import assert from 'node:assert/strict';
import { resolveMoney, defaultCapacity, medianOf, TRADE_UNITS } from '../lib/deal-basis.mjs';

const derived = { medianCost: 375000, medianAward: 3194100 };
const base = {
  register: 'facades',
  profileKey: null,
  explicitTicket: false,
  ticket: 0,
  winsRecorded: 0,
  winsMedian: 0,
  derived,
};

// Determinism: identical inputs, identical output.
assert.deepEqual(resolveMoney({ ...base }), resolveMoney({ ...base }));

// No profile → the city's own median, marked city-record.
assert.deepEqual(resolveMoney({ ...base }), { unit: 375000, basis: 'city-record', what: 'median declared job cost' });

// The unit follows the TRADE: a QEWI sells the report, restoration sells the job.
assert.equal(resolveMoney({ ...base, profileKey: 'qewi' }).unit, 12000);
assert.equal(resolveMoney({ ...base, profileKey: 'restoration' }).unit, 375000);
assert.equal(resolveMoney({ ...base, profileKey: 'restoration' }).basis, 'city-record');

// The user's own figure beats everything; three wins beat the table.
assert.equal(resolveMoney({ ...base, explicitTicket: true, ticket: 90000, winsRecorded: 5, winsMedian: 50000 }).unit, 90000);
assert.equal(resolveMoney({ ...base, winsRecorded: 3, winsMedian: 80000 }).basis, 'wins');

// Contracts: a bidding trade gets no invented money; a service trade prices
// as a share of the real award amounts.
assert.equal(resolveMoney({ ...base, register: 'contracts', profileKey: 'restoration' }).unit, 0);
assert.equal(resolveMoney({ ...base, register: 'contracts', profileKey: 'insurance' }).unit, Math.round(3194100 * 0.015));

// Recurring units say so.
assert.equal(resolveMoney({ ...base, register: 'elevators', profileKey: null }).recurring, 'year');
assert.equal(resolveMoney({ ...base, register: 'openings', profileKey: 'pos' }).life, 4);

// Every non-derived unit in the table is marked as an assumption.
for (const [reg, table] of Object.entries(TRADE_UNITS))
  for (const [k, spec] of Object.entries(table))
    if (spec.unit) assert.equal(spec.basis, 'assumption', `${reg}.${k} must be labelled an assumption`);

// Capacity bounds are sane at the edges.
assert.equal(defaultCapacity(NaN), 40);
assert.equal(defaultCapacity(25), 40);
assert.ok(defaultCapacity(1000) <= 48);
assert.equal(defaultCapacity(25, 'fee'), 125);
assert.ok(defaultCapacity(1000, 'fee') <= 240);
assert.equal(medianOf([1, 2, 3]), 2);

console.log('test-basis: all assertions pass');
