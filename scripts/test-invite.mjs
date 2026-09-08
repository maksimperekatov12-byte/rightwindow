// The cold-email link is the product's front door; a parser bug there is a
// prospect landing on the wrong list. These run in prebuild.
//
// The regression that earned this file: `clean()` was written with a character
// RANGE that silently stripped every digit, so ?zips= arrived empty and the
// contractor saw the whole city instead of his three ZIPs.
import assert from 'node:assert/strict';
import { readInvite, TRADE_ALIASES } from '../src/invite.js';

const i = readInvite('?trade=restoration&zips=11201,11205,11217&for=Tribute%20Restoration&ref=tribute');
assert.equal(i.trade, 'restoration');
assert.deepEqual(i.zips, ['11201', '11205', '11217'], 'ZIP digits must survive sanitising');
assert.equal(i.for, 'Tribute Restoration');
assert.equal(i.ref, 'tribute');

// Aliases a salesperson would actually type, and the register each implies.
assert.equal(readInvite('?trade=facade-engineer').trade, 'qewi');
assert.equal(readInvite('?trade=plumber').reg, 'gas');
assert.equal(readInvite('?trade=elevator').reg, 'elevators');
assert.equal(readInvite('?trade=retrofit').reg, 'carbon');
assert.equal(readInvite('?reg=carbon').reg, 'carbon');
assert.equal(readInvite('?reg=nonsense').reg, null);
assert.equal(readInvite('?trade=nonsense').trade, null);

// A bare URL behaves exactly as before.
assert.deepEqual(readInvite(''), { trade: null, rawTrade: null, zips: [], reg: null, for: null, ref: null });

// Nothing from the query may reach the page as markup.
assert.ok(!readInvite('?for=%3Cimg%20src%3Dx%3E').for.includes('<'));
assert.equal(readInvite('?ref=Tribute%20Co!').ref, 'tributeco');

// Every alias points at a profile the app actually has.
const PROFILE_IDS = new Set([
  'qewi', 'restoration', 'equipment', 'elevator', 'insurance', 'lender',
  'propmgmt', 'legal', 'cre', 'staffing', 'pos', 'fnb', 'marketing', 'signage',
]);
for (const [alias, id] of Object.entries(TRADE_ALIASES))
  assert.ok(PROFILE_IDS.has(id), `alias ${alias} → unknown profile ${id}`);

console.log('test-invite: deep links parse correctly');
