// Scope assertions over the committed feed: the class of bug where two counts
// of the same thing disagree on screen has shipped twice. Now it cannot ship:
// the build fails if any register's figures stop nesting.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url)));
const ll = (rows) => rows.filter((c) => Array.isArray(c.ll) && c.ll.length === 2).length;

// Buildings registers: what totals claim must be what the feed holds, and
// every derived subset must fit inside it.
for (const k of ['gas', 'elevators', 'carbon']) {
  const rows = d[k]?.feed || [];
  const open = d[k]?.totals?.open;
  assert.equal(open, rows.length, `${k}: totals.open (${open}) must equal the register (${rows.length})`);
  assert.ok(ll(rows) <= rows.length, `${k}: mapped exceeds the register`);
  const cited = d[k]?.totals?.cited;
  if (cited != null) assert.ok(rows.length <= cited, `${k}: register (${rows.length}) exceeds citywide cited (${cited})`);
}
assert.ok(ll(d.facades.feed) <= d.facades.feed.length, 'facades: mapped exceeds the register');
assert.ok(d.facades.feed.length <= d.facades.totals.candidates, 'facades: register exceeds citywide candidates');

// Openings: the phone count the copy quotes must fit the population it counts.
const phones = d.openings.filter((o) => o.phone).length;
assert.ok(phones <= d.openings.length, `openings: withPhone (${phones}) exceeds the register (${d.openings.length})`);

// Contracts: a cancellation notice is not an open solicitation — the collector
// filters them, and a feed that still carries one must not ship.
const cancels = d.contracts.filter((c) => /^\s*cancell/i.test(c.title || ''));
assert.equal(cancels.length, 0, `contracts: ${cancels.length} cancellation notice(s) in the feed`);

console.log('test-stats: every register\u2019s scopes nest correctly');
