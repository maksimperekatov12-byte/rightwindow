// Locks the backtest's arithmetic and the shape of what it publishes.
//
// data/evidence.json is what gets quoted on a stage, so two things must never
// drift: the counting rules (a permit in the look-back is not a purchase, a
// renewal is not a second job, an auto-generated row is not a report), and the
// promise that every figure carries its denominator, window and definition and
// that no building, firm or person leaves the script. Offline: the counting is
// checked on a hand-made record, the promise on the committed file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFINITIONS, cohort, concentration, firstReports, kmMedian, openReports, permitIndex, share, shedIndex, valueConcentration, ymd } from './backtest.mjs';
import { assertCollectable } from '../lib/policy.mjs';

// ------------------------------------------------------------ the counting

const permit = (bin, job, issued, extra = {}) => ({
  bin,
  job_filing_number: job,
  issued_date: `${issued}T00:00:00.000`,
  work_on_floor: 'Facade',
  job_description: '',
  estimated_job_costs: '100000',
  applicant_license: `L-${bin}`,
  permittee_s_license_type: 'GC',
  ...extra,
});
const rows = [
  permit('1', 'M001-I1', '2022-06-01'),
  // The same job issued again later (its next permit): still one purchase.
  permit('1', 'M001-I2', '2022-09-01'),
  permit('2', 'M002-I1', '2023-09-01'),
  // Inside the 180-day look-back of building 3's report: already buying.
  permit('3', 'M003-I1', '2021-12-01'),
  // 762 days after building 4's report: outside the 24 months.
  permit('4', 'M004-I1', '2024-04-01'),
  // Masonry by description only: the regex definition takes it, DOB's
  // work-location definition does not.
  permit('5', 'M005-I1', '2022-05-01', { work_on_floor: 'Roof', job_description: 'LL11 PARAPET REPAIR' }),
  permit('6', 'M006-I1', '2022-05-01', { work_on_floor: 'Roof', job_description: 'ROOF DRAIN' }),
];
const wide = permitIndex(rows, DEFINITIONS.regex.test);
const narrow = permitIndex(rows, DEFINITIONS.workOnFloor.test);
assert.equal(wide.byBin.get('1').length, 1, 'a job counts once however many permits it pulls');
assert.equal(+wide.byBin.get('1')[0].t, +ymd('2022-06-01'), 'a job is dated by its earliest permit');
assert.ok(wide.byBin.has('5') && !narrow.byBin.has('5'), 'the work_on_floor definition must stay the narrower one');
assert.ok(!wide.byBin.has('6'), 'a roof job is not a facade purchase');

const report = (bin, date, status, type = 'Initial') => ({ bin, cycle: '9', filing_type: type, filing_date: date ? `${date}T00:00:00.000` : undefined, filing_status: status, borough: 'Brooklyn' });
const filings = [
  report('1', '2022-03-01', 'UNSAFE'),
  // A later Initial for the same building is not its first report.
  report('1', '2023-03-01', 'SAFE'),
  report('2', '2022-03-01', 'UNSAFE'),
  report('3', '2022-03-01', 'UNSAFE'),
  report('4', '2022-03-01', 'UNSAFE'),
  report('5', '2022-03-01', 'SAFE'),
  // Before the cohort window: excluded, not re-entered with a later report.
  report('7', '2021-06-01', 'UNSAFE'),
  // Auto-generated placeholders are not reports.
  report('8', null, 'No Report Filed', 'Auto-Generated'),
  report('9', '2022-04-01', 'No Report Filed', 'Auto-Generated'),
];
const first = firstReports(filings, '9');
assert.ok(!first.has('8') && !first.has('9'), 'an auto-generated row is never a first report');
assert.equal(first.get('1').filing_status, 'UNSAFE', 'the first report is the earliest Initial');

const c = cohort(first, wide.byBin, 'UNSAFE', ymd('2022-02-01'), ymd('2024-09-21'));
assert.equal(c.n, 4, 'UNSAFE buildings reported inside the window, and only those');
assert.equal(c.pre, 1, 'a permit in the 180 days before the report is counted as already buying');
assert.equal(c.in24, 2, 'purchases within 730 days: buildings 1 and 2');
assert.equal(c.in12, 1, 'purchases within 365 days: building 1');
assert.deepEqual(c.lags, [92, 549]);

const k = concentration(['a', 'a', 'b', null], 'w', 'd');
assert.equal(k.jobs, 3);
assert.equal(k.distinct, 2);
assert.equal(k.unattributed, 1, 'a job with no licence is reported apart, not dropped silently');
assert.equal(k.top1.value, 66.7);
assert.equal(share(1, 0, 'w', 'd').value, null, 'an empty denominator is no figure, not 0%');

// By dollars the big firm counts for what it declared, not once per job.
const kv = valueConcentration([['a', 900], ['b', 50], ['b', 50], [null, 1000], ['c', 0]], 'w', 'd');
assert.equal(kv.usd, 1000, 'a job with no licence or no declared cost adds no dollars');
assert.equal(kv.top1.value, 90);

// "Is anybody on it" reads every filing. A job hired long before the report
// (its -I1 outside the look-back) that pulled a part-2 facade permit under
// -S1 after the report is not an open window, though as a purchase it is
// still the old job and the cohort must not count it again.
const later = permitIndex(
  [permit('10', 'M010-I1', '2024-11-21'), permit('10', 'M010-S1', '2026-06-23'), permit('11', 'M011-I1', '2024-11-21')],
  DEFINITIONS.regex.test,
);
assert.equal(later.byBin.get('10').length, 1, 'the -S1 filing is the same job');
const fresh = [report('10', '2026-01-07', 'UNSAFE'), report('11', '2026-01-07', 'UNSAFE')];
assert.deepEqual(openReports(fresh, later.issued).map((r) => r.bin), ['11'], 'a permit of any filing inside the window closes it');

// A shed permit with no job number cannot be joined to its job's sign-off,
// so it must not keep a building's shed standing.
const sheds = shedIndex(
  [
    { bin: '20', job_filing_number: '', issued_date: '2023-01-01', expired_date: '2024-01-01' },
    { bin: '21', job_filing_number: 'M021-I1', issued_date: '2022-01-01', expired_date: '2023-01-01' },
    { bin: '21', job_filing_number: 'M021-S1', issued_date: '2023-01-01', expired_date: '2024-01-01' },
  ],
  () => true,
);
assert.ok(!sheds.has('20'), 'a jobless shed permit is left out');
assert.equal(+sheds.get('21').get('M021').first, +ymd('2022-01-01'), "a shed is aged from its job's first permit, -S# renewals included");

// A shed still standing lived at least this long: dropping it (the median of
// the finished ones alone would be 2) makes sheds look short-lived.
const life = [1, 2, 3].map((t) => ({ t, done: true })).concat([4, 5].map((t) => ({ t, done: false })));
assert.equal(kmMedian(life), 3, 'Kaplan-Meier keeps the censored sheds at risk');
assert.equal(kmMedian([{ t: 9, done: false }]), null, 'no median before half have ended');

// ------------------------------------------------------------ the promise

const ev = JSON.parse(readFileSync(new URL('../data/evidence.json', import.meta.url), 'utf8'));
const round1 = (x) => Math.round(x * 10) / 10;
let shares = 0;
let spreads = 0;
function walk(x, path) {
  if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (x && typeof x === 'object') {
    if ('num' in x && 'den' in x) {
      shares++;
      assert.ok(typeof x.window === 'string' && x.window && typeof x.definition === 'string' && x.definition, `${path}: a share without its window or definition`);
      assert.ok(x.num <= x.den, `${path}: numerator exceeds denominator`);
      assert.equal(x.value, x.den ? round1((100 * x.num) / x.den) : null, `${path}: value is not num/den`);
    }
    if ('median' in x && 'unit' in x) {
      spreads++;
      assert.ok(Number.isInteger(x.n) && x.window && x.definition, `${path}: a distribution without n, window or definition`);
    }
    for (const [key, v] of Object.entries(x)) walk(v, `${path}.${key}`);
    return;
  }
  // Aggregates only. A BIN is seven digits led by the borough; a DOB NOW job
  // number is a borough letter and eight digits; a firm name ends in an entity
  // suffix. None may appear in any string the file carries.
  if (typeof x === 'string') {
    assert.ok(!/\b[1-5]\d{6}\b/.test(x), `${path}: looks like a BIN: ${x.slice(0, 80)}`);
    assert.ok(!/\b[BMQXR]\d{8}\b/.test(x), `${path}: looks like a job number: ${x.slice(0, 80)}`);
    assert.ok(!/\b(LLC|INC|CORP|PLLC|LLP|DPC|P\.C\.)\b/.test(x), `${path}: looks like a firm name: ${x.slice(0, 80)}`);
  }
}
walk(ev, 'evidence');
assert.ok(shares >= 50 && spreads >= 10, `evidence.json holds too few figures (${shares} shares, ${spreads} distributions)`);

assert.ok(ev.generatedAt && ev.asOf, 'evidence.json must be dated');
assert.ok(ev.sources.length >= 3, 'evidence.json must name its datasets');
for (const s of ev.sources) {
  assert.ok(s.id && s.rowsUpdatedAt, `source ${s.id}: no publisher timestamp`);
  assertCollectable(s.host);
}
for (const h of ev.headline) for (const f of ['claim', 'value', 'denominator', 'window', 'definition']) assert.ok(h[f], `headline without ${f}: ${h.claim}`);
// The honesty section is part of the product: it must exist and say so.
assert.ok(ev.nonClaims.length && ev.nonClaims.every((n) => typeof n.holds === 'boolean' && n.evidence), 'nonClaims must state holds and evidence');
assert.ok(ev.caveats.length, 'caveats must not be empty');

// What an independent recompute found overstated must stay fixed. The outcome
// is a facade-related permit, not a repair permit; the register's 800 are never
// a slice of a tie picked by the dataset's row order; an open window says how
// many already have a job filed; a shed's life counts the sheds still up.
for (const h of ev.headline) assert.ok(!/repair permit/i.test(h.claim), `a headline calls the outcome a repair permit: ${h.claim.slice(0, 80)}`);
assert.match(ev.definitions.facadePermit.regex, /not necessarily a repair/);
for (const r of ev.replay) {
  assert.ok(!('top' in r.ranking), `${r.at}: the ranking must not quote a row-order slice of the top tier`);
  assert.ok(r.ranking.topTier && r.ranking.shownWithRandomTies.draws >= 100, `${r.at}: the ranking needs the whole top tier and the random tie-breaks`);
}
for (const [status, o] of Object.entries(ev.openNow).filter(([k]) => k !== 'register')) {
  if (!o.open.num) continue;
  assert.ok(o.facadeJobFiled && o.nothingFiled && o.reportUnder180Days, `openNow.${status}: an open window must say how many already have a job filed`);
  assert.ok(o.nothingFiled.num <= o.open.num, `openNow.${status}: nothing filed cannot exceed open`);
}
assert.ok(ev.sheds.cohort.shedLifeDays.median >= ev.sheds.cohort.daysToSignoff.median, 'a shed life counting the standing sheds cannot be shorter than the signed-off median');

console.log(`test-backtest: counting rules hold; evidence.json carries ${shares} shares and ${spreads} distributions, each with its window and definition`);
