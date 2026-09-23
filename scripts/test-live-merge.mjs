// The five-minute lane's rows are merged over the hourly build in the browser
// (src/live-merge.js). The build normalises and vets what it publishes; the
// fast lane does neither, and the merge used to spread every fast-lane field
// over the vetted row. In production that relabelled 29 of 40 venues to their
// legal county ("Kings", "New York", "Richmond"), so the borough chips lost
// them, and it put back a private individual's name the identity gate had
// withheld. These run in prebuild. Fast and offline.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mergeLive, LIVE_VOLATILE } from '../src/live-merge.js';

const BOROUGHS = new Set(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']);
const LEGAL_COUNTY = { Manhattan: 'New York', Brooklyn: 'Kings', 'Staten Island': 'Richmond', Queens: 'Queens', Bronx: 'Bronx' };

// A vetted row whose name the build withheld, and one it kept.
const hidden = {
  id: 'NA-1', src: 'sla', kind: 'Food & Beverage Business', address: '19-79 Steinway St, Astoria', county: 'Queens',
  nameShown: false, evidence: [], identity: 'New food & beverage business at 19-79 Steinway St', isNew: false, daysAgo: 9,
};
const shown = {
  id: 'NA-2', src: 'sla', kind: 'Restaurant', address: '1 Main St, Brooklyn', county: 'Brooklyn',
  nameShown: true, evidence: ['entity'], name: 'MAIN STREET TAVERN LLC', legal: 'MAIN STREET TAVERN LLC', isNew: false, daysAgo: 3,
};
const base = [hidden, shown];

// What the fast lane publishes for the same two ids: raw county, raw names.
const fresh = [
  { id: 'NA-1', name: 'JANE Q PUBLIC', legal: 'JANE Q PUBLIC', kind: 'Food & Beverage Business', address: '19-79 Steinway St, Astoria', county: 'Queens', daysAgo: 10, isNew: true },
  { id: 'NA-2', name: 'Main St Tavern', legal: 'MAIN STREET TAVERN LLC', kind: 'Restaurant', address: '1 Main St, Brooklyn', county: 'Kings', daysAgo: 4 },
];
const out = new Map(mergeLive(base, fresh, 'openings').map((r) => [r.id, r]));

// A withheld name stays withheld, the identity stays, nothing else leaks in.
const h = out.get('NA-1');
assert.equal(h.name, undefined, 'a name the build withheld must not come back from the fast lane');
assert.equal(h.legal, undefined, 'a legal name the build withheld must not come back from the fast lane');
assert.equal(h.identity, hidden.identity);
assert.equal(h.nameShown, false);
// ...while what genuinely moves between builds does refresh.
assert.equal(h.isNew, true);
assert.equal(h.daysAgo, 10);

// The build's borough and name win over the fast lane's legal county and spelling.
const s = out.get('NA-2');
assert.equal(s.county, 'Brooklyn', 'the fast lane must not relabel Brooklyn as Kings');
assert.equal(s.name, 'MAIN STREET TAVERN LLC');
assert.equal(s.daysAgo, 4);
assert.equal(s.isNew, false, 'a volatile field the fast lane did not send keeps the build value');

// Only the volatile fields may differ from the build row.
for (const r of base) {
  const m = out.get(r.id);
  for (const k of new Set([...Object.keys(r), ...Object.keys(m)])) {
    if (LIVE_VOLATILE.includes(k)) continue;
    assert.deepEqual(m[k], r[k], `${r.id}.${k} was overwritten by the fast lane`);
  }
}

// A licence the build has not seen yet: borough mapped, no name, an identity,
// and tagged as a liquor row so the not-a-venue filter still applies.
const [, , unseen] = mergeLive(base, [...fresh, { id: 'NA-3', name: 'JOHN DOE', legal: 'JOHN DOE', kind: 'Wholesale Beer', address: '5 Bay St, Staten Island', county: 'Richmond', daysAgo: 0 }], 'openings');
assert.equal(unseen.id, 'NA-3');
assert.equal(unseen.county, 'Staten Island');
assert.equal(unseen.name, undefined);
assert.equal(unseen.legal, undefined);
assert.equal(unseen.nameShown, false);
assert.equal(unseen.src, 'sla');
assert.equal(unseen.identity, 'New wholesale beer at 5 Bay St');
// ...unless the producer ran the gate and vouches for the name.
const [vouched] = mergeLive([], [{ id: 'NA-4', name: 'BAY ST BREWING LLC', county: 'Kings', nameShown: true }], 'openings');
assert.equal(vouched.name, 'BAY ST BREWING LLC');
assert.equal(vouched.county, 'Brooklyn');

// An award the build has not seen: tagged as one, its title cleaned as the build cleans it.
const [award] = mergeLive([], [{ id: '2026001', vendor: 'ACME', title: 'SITE WORK &amp; <b>PAVING</b>' }], 'contracts');
assert.equal(award.kind, 'AWARD');
assert.equal(award.title, 'SITE WORK & PAVING');
// An award the build has: the build's title and kind stand.
const built = { id: '2026002', kind: 'AWARD', vendor: 'ACME', title: 'R&D services', daysAgo: 2 };
const [kept] = mergeLive([built], [{ id: '2026002', vendor: 'ACME', title: 'R&amp;D services', daysAgo: 3 }], 'contracts');
assert.equal(kept.title, 'R&D services');
assert.equal(kept.daysAgo, 3);

// Nothing to merge hands the build back untouched.
assert.equal(mergeLive(base, [], 'openings'), base);
assert.equal(mergeLive(base, null, 'openings'), base);

// The whole committed register, fed back as the fast lane would send it
// (legal county, a name on every row): every borough survives, every
// withheld name stays withheld.
const feedPath = new URL('../src/data/feed.json', import.meta.url);
if (existsSync(feedPath)) {
  const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
  const rows = feed.openings || [];
  const asFast = rows
    .filter((o) => o.src === 'sla')
    .map((o) => ({ id: o.id, name: o.name || 'PRIVATE PERSON', legal: o.legal || 'PRIVATE PERSON', kind: o.kind, address: o.address, county: LEGAL_COUNTY[o.county] || o.county, daysAgo: o.daysAgo }));
  const merged = new Map(mergeLive(rows, asFast, 'openings').map((r) => [r.id, r]));
  for (const o of rows) {
    const m = merged.get(o.id);
    assert.ok(BOROUGHS.has(m.county), `${o.id}: county ${m.county} is not a borough`);
    assert.equal(m.county, o.county);
    if (o.nameShown === false) assert.ok(!m.name && !m.legal, `${o.id}: withheld name leaked`);
  }
}

console.log('test-live-merge: the fast lane cannot relabel a borough or bring back a withheld name');
