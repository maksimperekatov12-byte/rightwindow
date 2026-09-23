// What a trade is mailed must be what it sees on the site. These run in
// prebuild, offline, on a small inline feed.
//
// The regressions that earned this file: the mail kept its own copy of the
// site's trade filters and it drifted. The elevator trade was mailed facade
// hearings the site had stopped showing it; a code attorney never got the
// UNSAFE orders the site listed for him; plumber, retrofit and every visitor
// who had not picked a trade were mailed nothing at all; and every pilot with a
// ZIP was sent nothing, because the territory filter read the ZIP off the
// wrong object.
//
// Three layers:
//   1. matchFor agrees with the shared table for every trade x register.
//   2. The shared table and predicates agree with src/App.jsx, as long as
//      App.jsx still spells them out itself (it is meant to import them).
//   3. Pilots, dismissals and copy, one assertion per bug.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as TF from '../lib/trade-filters.mjs';
import { matchFor, pilotMatch, notDismissed } from '../lib/signals.mjs';

const { TRADE_REGISTERS, REGISTERS, REGISTER_KIND, ALL } = TF;

// ---- fixture --------------------------------------------------------------

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const bldg = (bin, zip, extra = {}) => ({
  bin,
  address: `${bin.slice(-2)} TEST STREET`,
  borough: 'Manhattan',
  zip,
  signals: [],
  subCycle: 'C',
  deadline: '2027-02-21',
  monthsLeft: 5,
  urgencyScore: 10,
  isNew: false,
  fresh: [],
  ...extra,
});
const feed = {
  facades: {
    feed: [
      bldg('1000001', '10001', { isNew: true }),
      // UNSAFE on file and nothing else: the legal trade's site filter lists it.
      bldg('1000002', '10002', { signals: [{ kind: 'UNSAFE_PRIOR' }] }),
      bldg('1000003', '10001', { signals: [{ kind: 'SWARMP_CARRYOVER' }], nextHearing: inDays(10), fresh: ['HEARING'] }),
      bldg('1000004', '11201', { ownerChange: { daysAgo: 10, recorded: '2026-09-01' }, fresh: ['SOLD'] }),
      // Lifts on record: the old mail matched this for the elevator trade.
      bldg('1000005', '10001', { elevator: { cat1Missing: 2 }, shed: { ageDays: 400 } }),
      bldg('1000006', '11201', { ecbBalance: 500, freshHaz: { daysAgo: 3, hazardous: true }, isNew: true }),
      bldg('1000007', '10458', { mgmtChange: true }),
    ],
  },
  contracts: [
    { id: 'c1', kind: 'AWARD', vendor: 'Acme Builders', amount: 1000000, agency: 'DDC', title: 'Library rehab', category: 'Construction/Construction Services', isNew: true },
    { id: 'c2', kind: 'AWARD', vendor: 'Settlement House', amount: 50000, agency: 'DYCD', title: 'Community centers', category: 'Human Services/Client Services' },
    { id: 'c3', kind: 'SOLICITATION', agency: 'DDC', title: 'Roof replacement at a school', category: 'Construction/Construction Services', dueDate: `${inDays(20)}T10:30:00.000`, isNew: true },
    { id: 'c4', kind: 'SOLICITATION', agency: 'DEP', title: 'Sewer reconstruction', category: 'Construction/Construction Services' },
    { id: 'c5', kind: 'SOLICITATION', agency: 'DDC', title: 'CANCELLATION: facade repair', category: 'Construction/Construction Services', isNew: true },
    { id: 'c6', kind: 'INTENT', agency: 'SBS', title: 'Extension contract', category: 'Services (other than human services)', dueDate: `${inDays(3)}T19:00:00.000` },
    { id: 'c7', kind: 'AWARD', vendor: 'Plan & Co', amount: 200000, agency: 'DCAS', title: 'Design services', category: 'Architecture/Engineering' },
  ],
  openings: [
    { id: 'o1', src: 'dohmh', kind: 'Food service', name: 'Noodle Bar', address: '1 A St', zip: '10458', isNew: true },
    { id: 'o2', src: 'sla', kind: 'Restaurant', name: 'Trattoria', address: '2 B St', zip: '10458', isNew: true },
    { id: 'o3', src: 'sla', kind: 'Grocery Store', name: 'Corner Grocery', address: '3 C St', zip: '10458' },
    { id: 'o4', src: 'sla', kind: 'Wholesale Beer', name: 'Beer Distributor', address: '4 D St', zip: '10458', isNew: true },
    { id: 'o5', src: 'sla', kind: 'Drug Store', name: 'Pharmacy', address: '5 E St', zip: '10001' },
    { id: 'o6', src: 'sla', kind: 'Liquor Store', name: 'Wine Shop', address: '6 F St', zip: '10001', isNew: true },
  ],
  gas: { feed: [bldg('2000001', '10031', { isNew: true, urgencyScore: 14 }), bldg('2000002', '10458', { urgencyScore: 14 })] },
  carbon: { feed: [bldg('3000001', '10001', { isNew: true, ghg: { usd: 311602 }, urgencyScore: 3 }), bldg('3000002', '10458', { urgencyScore: 3 })] },
  elevators: { feed: [bldg('4000001', '10001', { devices: 3, lastCat1: '2023' }), bldg('4000002', '10458', { devices: 1, isNew: true })] },
};

// ---- 1. the matcher agrees with the shared table --------------------------

// The rows a register lists before any trade filter, written the way the page
// writes them (App.jsx liveContracts / liveOpenings), not through the helper
// the matcher uses.
const base = {
  facades: feed.facades.feed,
  contracts: TF.noCancel(feed.contracts),
  openings: feed.openings.filter((o) => o.src !== 'sla' || !TF.NOT_A_VENUE.test(o.kind || '')),
  gas: feed.gas.feed,
  elevators: feed.elevators.feed,
  carbon: feed.carbon.feed,
};
const idOf = (reg, r) => (reg === 'contracts' || reg === 'openings' ? r.id : r.bin);
const sorted = (a) => [...a].sort();

for (const p of Object.keys(TRADE_REGISTERS)) {
  const all = matchFor(feed, p, { onlyNew: false });
  for (const reg of REGISTERS) {
    const f = TRADE_REGISTERS[p][reg];
    const want = f ? base[reg].filter(f).map((r) => idOf(reg, r)) : [];
    const got = all.filter((i) => i.kind === REGISTER_KIND[reg]).map((i) => i.id);
    assert.deepEqual(sorted(got), sorted(want), `${p} x ${reg}: the mail and the site list different rows`);

    // A register forced by a link or a pilot: the trade's filter if it has
    // one, every row if not.
    const forced = matchFor(feed, p, { onlyNew: false, register: reg }).map((i) => i.id);
    assert.deepEqual(sorted(forced), sorted(base[reg].filter(f || ALL).map((r) => idOf(reg, r))), `${p} forced onto ${reg}`);

    // The new-only cut is the same rows, restricted to what is new.
    const isNewRow = (r) => (reg === 'facades' ? r.isNew || r.fresh?.length : r.isNew);
    const wantNew = f ? base[reg].filter(f).filter(isNewRow).map((r) => idOf(reg, r)) : [];
    const gotNew = matchFor(feed, p, { onlyNew: true }).filter((i) => i.kind === REGISTER_KIND[reg]).map((i) => i.id);
    assert.deepEqual(sorted(gotNew), sorted(wantNew), `${p} x ${reg}: new-only`);
  }
}

// Hand-checked cells, the ones that drifted.
const kinds = (items) => new Set(items.map((i) => i.kind));
assert.ok(!kinds(matchFor(feed, 'elevator', { onlyNew: false })).has('b'), 'elevator must not be mailed facade cards');
assert.ok(
  matchFor(feed, 'legal', { onlyNew: false }).some((i) => i.id === '1000002'),
  'legal must get a building whose only signal is an UNSAFE order',
);
assert.deepEqual([...kinds(matchFor(feed, 'plumber', { onlyNew: false }))], ['g'], 'plumber gets the gas register');
assert.deepEqual([...kinds(matchFor(feed, 'retrofit', { onlyNew: false }))], ['k'], 'retrofit gets the carbon register');
assert.equal(kinds(matchFor(feed, 'explore', { onlyNew: false })).size, 6, 'exploring sees every register');
assert.deepEqual(
  matchFor(feed, undefined, { onlyNew: true }).map((i) => i.id),
  matchFor(feed, 'explore', { onlyNew: true }).map((i) => i.id),
  'no trade reads as exploring, as it does on the site',
);

// A portfolio keeps its buildings every day and only its buildings.
const pf = matchFor(feed, 'legal', { onlyNew: true, portfolio: ['1000002', '2000002'] });
assert.deepEqual(sorted(pf.map((i) => i.id)), ['1000002', '2000002'], 'portfolio buildings on every register');

// ---- 2. the shared table agrees with src/App.jsx ---------------------------

// Formatting is not a difference: a filter the formatter wraps over three
// lines is still the same filter.
const norm = (s) =>
  String(s)
    .replace(/\s+/g, ' ')
    .replace(/,\s*\)/g, ')')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

// The expression after `from`, up to the first comma or semicolon at bracket
// depth zero outside a string.
function expr(src, from) {
  let depth = 0;
  let q = null;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if ((ch === ',' || ch === ';') && depth === 0) return src.slice(from, i).trim();
    if (depth < 0) return src.slice(from, i).trim();
  }
  return null;
}
const skipped = [];

// The predicates, while App.jsx still defines them itself. Once it imports
// them from lib/trade-filters.mjs there is nothing left to compare.
for (const name of ['has', 'isOpenNotice', 'noticeLabel', 'CONSTR', 'ENVELOPE', 'facadeBid', 'constrAward', 'NOT_A_VENUE', 'VENUE_KIND', 'isVenue', 'sawRecord', 'noCancel']) {
  const m = new RegExp(`^\\s*const ${name} = `, 'm').exec(app);
  if (!m) continue;
  const text = app.slice(m.index + m[0].length, app.indexOf(';\n', m.index));
  const ours = TF[name] instanceof RegExp ? String(TF[name]) : TF[name].toString();
  assert.equal(norm(ours), norm(text), `${name} in lib/trade-filters.mjs differs from src/App.jsx`);
}

// Which registers each trade sees, and through which filter.
const start = app.indexOf('\nconst PROFILES = {\n');
const end = start < 0 ? -1 : app.indexOf('\n};\n', start);
const heads = start < 0 ? [] : [...app.slice(start, end).matchAll(/^ {2}(\w+): \{$/gm)];
if (!heads.length) skipped.push('PROFILES block not found in src/App.jsx');
const block = start < 0 ? '' : app.slice(start, end);
const appIds = [];
heads.forEach((h, n) => {
  const id = h[1];
  appIds.push(id);
  const body = block.slice(h.index, n + 1 < heads.length ? heads[n + 1].index : undefined);
  const facade = /^ {4}facade: (?!null)/m.test(body);
  const cNeed = /^ {4}cNeed: (?!null)/m.test(body);
  const oNeed = /^ {4}oNeed: (?!null)/m.test(body);
  const mBlock = /^ {4}mandates: \{\n([\s\S]*?)^ {4}\},?$/m.exec(body);
  const mandates = mBlock ? [...mBlock[1].matchAll(/^ {6}(\w+):/gm)].map((x) => x[1]) : [];
  const exploring = !facade && !cNeed && !oNeed && !mBlock;
  const regs = exploring
    ? REGISTERS
    : [...(facade ? ['facades'] : []), ...mandates, ...(cNeed ? ['contracts'] : []), ...(oNeed ? ['openings'] : [])];
  assert.ok(TRADE_REGISTERS[id], `App.jsx trade "${id}" is missing from lib/trade-filters.mjs, so the mail treats it as exploring`);
  assert.deepEqual(sorted(Object.keys(TRADE_REGISTERS[id])), sorted(regs), `${id}: registers differ between App.jsx and the mail`);

  const label = /^ {4}label: '([^']*)',$/m.exec(body)?.[1];
  if (label) assert.equal(TF.TRADE_LABELS[id], label, `${id}: label differs from App.jsx`);

  for (const [reg, re] of [
    ['facades', /^ {6}fFilter: /m],
    ['contracts', /^ {4}cFilter: /m],
    ['openings', /^ {4}oFilter: /m],
  ]) {
    if (!regs.includes(reg)) continue;
    const ours = TRADE_REGISTERS[id][reg];
    const m = re.exec(body);
    if (!m) {
      assert.equal(ours, ALL, `${id} x ${reg}: App.jsx has no filter, the mail has one`);
      continue;
    }
    const text = expr(body, m.index + m[0].length);
    if (/^[A-Za-z_$][\w$]*$/.test(text)) {
      if (TF[text]) assert.equal(ours, TF[text], `${id} x ${reg}: App.jsx uses ${text}`);
      else skipped.push(`${id} x ${reg}: ${text} is not a shared predicate`);
    } else if (/^TRADE_REGISTERS(\.\w+)+$/.test(text)) {
      const [, ...path] = text.split('.');
      assert.equal(ours, path.reduce((o, k) => o?.[k], TRADE_REGISTERS), `${id} x ${reg}: ${text}`);
    } else if (text && /=>/.test(text)) {
      assert.equal(norm(ours.toString()), norm(text), `${id} x ${reg}: filter differs from App.jsx`);
    } else skipped.push(`${id} x ${reg}: could not read the filter`);
  }
});
if (heads.length)
  for (const id of Object.keys(TRADE_REGISTERS))
    assert.ok(appIds.includes(id), `lib/trade-filters.mjs has a trade "${id}" that App.jsx does not`);

// ---- 3. pilots, dismissals, copy -------------------------------------------

const ids = (items) => sorted(items.map((i) => i.id));

// The ZIP is on the row, not the wrapper.
assert.deepEqual(ids(pilotMatch(feed, { trade: 'qewi', reg: 'facades', zips: ['11201'] }, { onlyNew: false })), ['1000004', '1000006']);
// A visitor with no trade who started on the openings list gets openings.
assert.deepEqual(ids(pilotMatch(feed, { trade: null, reg: 'openings', zips: ['10458'] }, { onlyNew: false })), ['o1', 'o2', 'o3']);
assert.deepEqual(ids(pilotMatch(feed, { trade: 'fnb', reg: 'openings', zips: ['10458'] }, { onlyNew: false })), ['o1', 'o2']);
// Gas is gas, not a facade list.
assert.deepEqual(ids(pilotMatch(feed, { trade: 'plumber', reg: 'gas', zips: ['10031'] }, { onlyNew: true })), ['2000001']);
// Notices carry no ZIP; a ZIP search on the site lists none either.
assert.deepEqual(pilotMatch(feed, { trade: 'insurance', reg: 'contracts', zips: ['10001'] }, { onlyNew: false }), []);
// A register the mail does not know is silence.
assert.deepEqual(pilotMatch(feed, { trade: 'qewi', reg: 'nonsense', zips: [] }, { onlyNew: false }), []);
// A pilot saved before `reg` existed keeps its trade's registers.
assert.deepEqual(
  ids(pilotMatch(feed, { trade: 'qewi', zips: ['10001'] }, { onlyNew: false })),
  ['1000001', '1000003', '1000005'],
);
// No ZIPs, no territory filter.
assert.equal(pilotMatch(feed, { trade: 'qewi', reg: 'facades' }, { onlyNew: false }).length, 7);

// A dismissed card does not come back.
const pref = { feedback: { 'b:1000006': { s: 'dismissed' }, 'b:1000003': { s: 'contacted' } } };
const kept = matchFor(feed, 'qewi', { onlyNew: true }).filter(notDismissed(pref)).map((i) => i.id);
assert.ok(!kept.includes('1000006') && kept.includes('1000003'), 'dismissed cards are dropped, others kept');

// No fixed opening window: about a third of new licences precede an opening.
for (const i of matchFor(feed, 'explore', { onlyNew: false })) {
  assert.ok(!/2\s*[–-]\s*4 months/.test(i.why), `fixed opening window in: ${i.why}`);
  assert.ok(i.title && !/undefined|\$0\b/.test(`${i.title} ${i.why}`), `broken copy: ${i.title} — ${i.why}`);
}
assert.match(matchFor(feed, 'fnb', { onlyNew: false }).find((i) => i.id === 'o2').why, /often before it opens/);

for (const s of skipped) console.warn(`test-trade-filters: skipped — ${s}`);
console.log('test-trade-filters: ok');
