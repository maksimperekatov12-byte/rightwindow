// Backtest: when the register says a building is in its window, does the
// building then buy?
//
// That is the question an investor asks of a sales-timing product, and the
// public record can answer it looking backwards. Take a signal that was
// visible on a past date, follow the building forward, and count who bought
// what the signal says they will: a facade-related General Construction
// permit in DOB NOW (the public trace of the job a restoration contractor
// sells) or a facade report (the job an engineer sells). Buildings whose report
// came back SAFE are the comparison, not a control: the law requires an UNSAFE
// building to repair and a SAFE one not to, so the gap between them sizes the
// repair wave rather than proving anybody's foresight.
//
// Everything is re-derived from three DOB NOW datasets on NYC Open Data and
// written to data/evidence.json, each figure with its denominator, window and
// definition — including the figures that say what does NOT hold, such as the
// register's own ranking, because a number nobody can check is worth nothing
// on a stage. Aggregates only: no building, firm or person leaves this script.
//
//   npm run backtest     two dozen queries (about thirty requests with an empty
//                        cache, a big query paging); a rerun within a day makes none
//
// The cache lives outside the repo ($TMPDIR/rw-backtest-cache, or
// BACKTEST_CACHE) and an entry is reused for BACKTEST_MAX_AGE_H hours (24 by
// default; 0 refetches). Not in prebuild: a build must never need the network.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertCollectable } from '../lib/policy.mjs';

const HOST = 'data.cityofnewyork.us';
const DAY = 86400000;
const M6 = 183;
const M12 = 365;
const M24 = 730;
const LOOKBACK = 180;
// The register leaves Staten Island out (collect.mjs), so every replay of its
// rules does too. The cohort and market figures are citywide facts and keep it.
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx'];
const CEILING = 800;
const DRAWS = 500;

// What counts as buying facade work: a DOB NOW General Construction permit
// with filing reason "Initial Permit" (a renewal is the same job again) whose
// work location names the facade, or whose description does. The collector's
// own PERMIT_RE is wider — masonry, brick, waterproofing — because there it
// only has to notice that somebody is already on site; an outcome measure has
// to stay narrow, or roof and interior masonry would count as facade sales.
// The conservative variant keeps DOB's own work-location field alone.
//
// It is called a facade-related permit, not a repair permit, on purpose. A
// description that mentions a facade also catches mixed-scope jobs (an
// extension plus an interior renovation that names its "facades"), and the
// test misses repairs filed under a suspended-scaffold or shed job, work filed
// in the older BIS system, and minor work done with no GC permit at all.
const FACADE_WORDS = ['FACADE', 'FISP', 'LOCAL LAW 11', 'LL11', 'LL 11', 'PARAPET', 'EXTERIOR WALL', 'POINTING', 'LINTEL', 'TERRA COTTA', 'CORNICE'];
const WORDS_RE = new RegExp(FACADE_WORDS.join('|'), 'i');
const PERMIT = 'facade-related GC permit in DOB NOW';
export const DEFINITIONS = {
  regex: {
    test: (p) => /Facade/.test(p.work_on_floor || '') || WORDS_RE.test(p.job_description || ''),
    text:
      "A facade-related General Construction permit in DOB NOW, not necessarily a repair: DOB NOW Approved Permits (rbx6-tga4), work_type 'General Construction', filing_reason 'Initial Permit', same BIN, " +
      `work_on_floor contains 'Facade' OR job_description contains any of ${FACADE_WORDS.join(', ')} (case-insensitive). ` +
      "One job counts once: its -I1 and -S# filings are merged under the job number before the dash, and the job is dated by its earliest issued_date. " +
      'Includes mixed-scope and non-repair jobs whose description names a facade; misses repairs filed under suspended-scaffold or shed jobs, work filed in BIS, and minor work with no GC permit.',
  },
  workOnFloor: {
    test: (p) => /Facade/.test(p.work_on_floor || ''),
    text: "As the regex definition, but only permits whose work_on_floor (DOB's own work-location field) contains 'Facade'.",
  },
};
const PERMIT_WHERE =
  "work_type='General Construction' and filing_reason='Initial Permit' and (work_on_floor like '%Facade%' or " +
  FACADE_WORDS.map((w) => `upper(job_description) like '%${w}%'`).join(' or ') +
  ')';

// Windows. DOB NOW General Construction permits begin 2020-12-27 and reach a
// steady volume by 2021-08, so a report has to fall on or after 2022-02-01 for
// its 180-day look-back to sit inside that coverage, and on or before
// 2024-09-21 to have 24 months of follow-up. They are fixed rather than
// relative to today, so a rerun moves a figure only when the city's data does.
const COHORT = { from: '2022-02-01', to: '2024-09-21' };
const MARKET_FROM = '2022-01-01';
// Cycle 9, one cycle behind the register's cycle 10 (collect.mjs subCycle):
// the sub-cycle is the last digit of the tax block. Each replay date is a
// deadline minus six months, the moment the register's NON_FILER urgency peaks.
const SUB9 = [
  { sub: '9A', digits: '4569', opens: '2020-02-21', deadline: '2022-02-21', at: '2021-08-21' },
  { sub: '9B', digits: '078', opens: '2021-02-21', deadline: '2023-02-21', at: '2022-08-21' },
  { sub: '9C', digits: '123', opens: '2022-02-21', deadline: '2024-02-21', at: '2023-08-21' },
];
// Sheds. The cohort starts when permit coverage is steady and ends three years
// before the data, so most sheds have had time to come down. A replay date
// needs its two-year look-back for a facade permit inside coverage (on or after
// 2023-08) and two years of follow-up after it (on or before 2024-09).
const SHED_COHORT = { from: '2021-08-01', to: '2023-09-21' };
const SHED_REPLAY = ['2023-09-21', '2024-03-21'];

const CACHE = process.env.BACKTEST_CACHE || join(tmpdir(), 'rw-backtest-cache');
const MAX_AGE_H = Number(process.env.BACKTEST_MAX_AGE_H ?? 24);
const PAUSE_MS = 400;
const OUT = new URL('../data/evidence.json', import.meta.url);

// ---------------------------------------------------------------- dates, stats

export const ymd = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : null);
const iso = (d) => d.toISOString().slice(0, 10);
const days = (ms) => Math.round(ms / DAY);
const round1 = (x) => Math.round(x * 10) / 10;

export function share(num, den, window, definition) {
  return { value: den ? round1((100 * num) / den) : null, num, den, window, definition };
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function spread(values, unit, window, definition, { total = false, p90 = false } = {}) {
  const a = values.slice().sort((x, y) => x - y);
  const r = (x) => (x == null ? null : Math.round(x));
  const out = { n: a.length, median: r(quantile(a, 0.5)), p25: r(quantile(a, 0.25)), p75: r(quantile(a, 0.75)) };
  if (p90) out.p90 = r(quantile(a, 0.9));
  if (total) out.total = Math.round(a.reduce((s, x) => s + x, 0));
  return { ...out, unit, window, definition };
}

// How split a market is: the share the ten busiest firms hold, and the share
// of the single busiest. Keys are held in memory only to be counted.
export function concentration(keys, window, definition) {
  const counts = new Map();
  let unattributed = 0;
  for (const k of keys) {
    if (!k) unattributed++;
    else counts.set(k, (counts.get(k) || 0) + 1);
  }
  const v = [...counts.values()].sort((a, b) => b - a);
  const total = v.reduce((a, b) => a + b, 0);
  const top = (k) => v.slice(0, k).reduce((a, b) => a + b, 0);
  return {
    jobs: total,
    distinct: counts.size,
    withOneJob: v.filter((x) => x === 1).length,
    unattributed,
    top10: share(top(10), total, window, `jobs held by the ten busiest of ${definition}`),
    top1: share(top(1), total, window, `jobs held by the single busiest of ${definition}`),
    hhi: total ? Math.round(v.reduce((s, x) => s + ((100 * x) / total) ** 2, 0)) : null,
    window,
    definition,
  };
}

// The same split weighted by money instead of jobs: a count says how many
// firms are in the market, the declared cost says who does the big jobs, and
// the largest firms by dollars hold a bigger share than the busiest by count.
export function valueConcentration(pairs, window, definition) {
  const sums = new Map();
  for (const [k, x] of pairs) if (k && x > 0) sums.set(k, (sums.get(k) || 0) + x);
  const v = [...sums.values()].sort((a, b) => b - a);
  const total = Math.round(v.reduce((a, b) => a + b, 0));
  const top = (k) => Math.round(v.slice(0, k).reduce((a, b) => a + b, 0));
  return {
    usd: total,
    distinct: sums.size,
    top10: share(top(10), total, window, `declared cost held by the ten largest of ${definition}`),
    top1: share(top(1), total, window, `declared cost held by the single largest of ${definition}`),
    hhi: total ? Math.round(v.reduce((s, x) => s + ((100 * x) / total) ** 2, 0)) : null,
    window,
    definition,
  };
}

// The median time to an event when some subjects have not had it yet
// (Kaplan-Meier). A shed still standing today has lived at least this long;
// dropping it, as a median over the signed-off sheds alone does, makes sheds
// look short-lived. Each item is { t, done }: done false means still going at t.
export function kmMedian(items) {
  const a = items.slice().sort((x, y) => x.t - y.t);
  let atRisk = a.length;
  let s = 1;
  for (let i = 0; i < a.length; ) {
    let j = i;
    let events = 0;
    while (j < a.length && a[j].t === a[i].t) events += a[j++].done ? 1 : 0;
    s *= 1 - events / atRisk;
    atRisk -= j - i;
    if (s <= 0.5) return a[i].t;
    i = j;
  }
  return null;
}

// Counting engineering firms needs their names in memory; none is written out.
// Punctuation and a trailing entity suffix are folded, so "Acme Engineering,
// P.C." and "ACME ENGINEERING PC" count once.
const firmKey = (s) =>
  String(s || '')
    .toUpperCase()
    .replace(/[.,&']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ (INC|LLC|PLLC|LLP|CORP|CORPORATION|CO|LTD|PC|P C|DPC)$/, '') || null;
// How many firms there are depends on how their names are folded, so the count
// is given across three folds: case and spacing only, the suffix fold above,
// and one that also drops entity and profession words anywhere in the name
// (merging "Acme Engineering PC" with "Acme Engineers"). The top-10 share
// barely moves; the firm count moves by about a tenth.
const FIRM_FOLDS = {
  caseOnly: (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim() || null,
  suffix: firmKey,
  professionWords: (s) =>
    String(s || '')
      .toUpperCase()
      .replace(/[.,'"&()\-/]/g, ' ')
      .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|PC|P C|PLLC|P L L C|LLP|LTD|DPC|D P C|PE|RA|ARCHITECTS?|ENGINEERS?|ENGINEERING)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || null,
};

// A seeded generator (mulberry32), so a rerun on the same data draws the same
// tie-breaks and evidence.json does not change for no reason.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const jobKey = (n) => String(n || '').split('-')[0];

function sub9(block) {
  const x = String(block || '').trim().slice(-1);
  return (x && SUB9.find((s) => s.digits.includes(x))) || null;
}

// The register's own deal-out (collect.mjs balancedByBorough): one card per
// borough in turn, so an under-filled borough releases its share as it goes.
function balancedByBorough(rows, total) {
  const boroughs = [...new Set(rows.map((r) => r.borough))].filter(Boolean);
  const pools = new Map(boroughs.map((b) => [b, rows.filter((r) => r.borough === b)]));
  const taken = new Map(boroughs.map((b) => [b, 0]));
  const picked = [];
  let progress = true;
  while (picked.length < total && progress) {
    progress = false;
    for (const b of boroughs) {
      if (picked.length >= total) break;
      const i = taken.get(b);
      if (i >= pools.get(b).length) continue;
      picked.push(pools.get(b)[i]);
      taken.set(b, i + 1);
      progress = true;
    }
  }
  return picked;
}

// ---------------------------------------------------------------- the record

// Facade permits by building: each job once, dated by its earliest Initial
// Permit, with the declared cost and the permittee's licence of that permit.
// That is the right unit for "did the building buy after the report": a
// subsequent (-S#) filing on a job filed before the report is the same
// job carrying on, not a new purchase. It is the wrong unit for "is
// anybody on site", which is what issued answers: every matching permit's
// issue date by building, -S# filings included.
export function permitIndex(rows, test) {
  const byJob = new Map();
  const issued = new Map();
  for (const p of rows) {
    const t = ymd(p.issued_date);
    if (!p.bin || !t || !test(p)) continue;
    (issued.get(p.bin) || issued.set(p.bin, []).get(p.bin)).push(t);
    const key = jobKey(p.job_filing_number) || `${p.bin}@${iso(t)}`;
    const cur = byJob.get(key);
    if (cur && cur.t <= t) continue;
    byJob.set(key, {
      bin: p.bin,
      t,
      job: p.job_filing_number || null,
      cost: Number(p.estimated_job_costs) || 0,
      lic: String(p.applicant_license || '').trim() || null,
      gc: p.permittee_s_license_type === 'GC',
    });
  }
  const byBin = new Map();
  for (const p of byJob.values()) (byBin.get(p.bin) || byBin.set(p.bin, []).get(p.bin)).push(p);
  for (const a of byBin.values()) a.sort((x, y) => x.t - y.t);
  return { jobs: [...byJob.values()], byBin, issued };
}

// A fresh report is still open when no matching permit of any filing was
// issued from LOOKBACK days before it: a building whose old job pulled a
// "part 2 facade restoration" permit after the report is not an open lead.
export function openReports(reports, issued) {
  return reports.filter((r) => {
    const from = +ymd(r.filing_date) - LOOKBACK * DAY;
    return !(issued.get(r.bin) || []).some((t) => +t >= from);
  });
}

// Live sheds by building, from shed permits: each job's first permit and the
// term of every permit it pulled. A permit with no job number (196 of 76,170
// on the 2026-09-22 load) cannot be joined to its job's sign-off, so it
// cannot say whether the shed was still up; counting it kept four buildings
// "standing" whose jobs were signed off months before the replay date.
export function shedIndex(permits, keep) {
  const out = new Map();
  for (const p of permits) {
    const a = ymd(p.issued_date);
    const b = ymd(p.expired_date);
    const k = jobKey(p.job_filing_number);
    if (!p.bin || !a || !b || !k || !keep(p.bin)) continue;
    const jobs = out.get(p.bin) || out.set(p.bin, new Map()).get(p.bin);
    const j = jobs.get(k) || jobs.set(k, { first: a, spans: [] }).get(k);
    if (a < j.first) j.first = a;
    j.spans.push([a, b]);
  }
  return out;
}

// A cycle's first report per building: its earliest dated Initial filing.
// "Auto-Generated / No Report Filed" rows are not reports (8,652 of the 11,723
// cycle-9 buildings carrying one also filed an Initial), so they never count.
export function firstReports(filings, cycle) {
  const out = new Map();
  for (const r of filings) {
    if (r.cycle !== cycle || r.filing_type !== 'Initial' || !r.filing_date || !r.bin) continue;
    const cur = out.get(r.bin);
    if (!cur || r.filing_date < cur.filing_date) out.set(r.bin, r);
  }
  return out;
}

// Buildings whose first report had `status` and fell inside [from, to], each
// followed for 24 months: did a facade permit follow, how soon, for how much,
// and to whom. A permit in the 180 days before the report is counted apart:
// that building was already buying when the report landed.
export function cohort(reports, byBin, status, from, to) {
  const c = { n: 0, pre: 0, in12: 0, in24: 0, lags: [], costs: [], licences: [], hits: [], byBorough: {} };
  for (const [bin, r] of reports) {
    const t = ymd(r.filing_date);
    if (r.filing_status !== status || t < from || t > to) continue;
    c.n++;
    const b = (c.byBorough[String(r.borough || '').trim() || 'Unknown'] ||= { n: 0, in24: 0 });
    b.n++;
    const ps = byBin.get(bin) || [];
    if (ps.some((p) => p.t < t && t - p.t <= LOOKBACK * DAY)) c.pre++;
    const post = ps.find((p) => p.t >= t && p.t - t <= M24 * DAY);
    if (!post) continue;
    const lag = days(post.t - t);
    c.in24++;
    b.in24++;
    if (lag <= M12) c.in12++;
    c.lags.push(lag);
    if (post.cost > 0) c.costs.push(post.cost);
    c.licences.push(post.lic);
    c.hits.push({ job: post.job, report: t, issued: post.t });
  }
  return c;
}

// The cycle-8 and cycle-9 record of every building as it stood on date T:
// only filings dated on or before T are visible, and each filing speaks with
// its own filing_status — current_status is today's word, not T's. An undated
// cycle-9 row is an auto-generated placeholder nobody could have read.
function stateAt(filings, T) {
  const L = new Map();
  for (const r of filings) {
    if (!r.bin || (r.cycle !== '8' && r.cycle !== '9')) continue;
    const dt = r.cycle === '8' ? r.filing_date || r.submitted_on || '' : r.filing_date || '';
    if (r.cycle === '9' && !dt) continue;
    if (dt && ymd(dt) > T) continue;
    const rec = L.get(r.bin) || { borough: String(r.borough || '').trim(), block: r.block, c8: null, c9: null };
    const slot = r.cycle === '8' ? 'c8' : 'c9';
    if (!rec[slot] || dt > rec[slot].dt) rec[slot] = { status: r.filing_status, dt };
    L.set(r.bin, rec);
  }
  return L;
}

function outcome(bins, byBin, T, label, def) {
  let in12 = 0;
  let in24 = 0;
  for (const bin of bins) {
    const p = (byBin.get(bin) || []).find((x) => x.t > T && x.t - T <= M24 * DAY);
    if (!p) continue;
    in24++;
    if (p.t - T <= M12 * DAY) in12++;
  }
  // Each span's window is written out whole. Filling a placeholder letter in
  // one template with replace() hit the first capital N instead, the one in
  // "DOB NOW" or NOT_FLAGGED, and left the placeholder in place.
  const w = (span) => `${label}; permit issued within ${span} days after ${iso(T)}`;
  return {
    n: bins.length,
    within12: share(in12, bins.length, w(M12), def),
    within24: share(in24, bins.length, w(M24), def),
  };
}

// The register's facade rules (collect.mjs, "Build candidate signals") replayed
// one cycle back: cycle 8 plays cycle 9 and cycle 9 plays cycle 10. The score
// is the rules' urgency sum. The fines point is left out — the penalty columns
// repeat on every row of a building and carry no date, so what was owed on a
// past date cannot be read — and so are the enrichment points (ECB, HPD,
// deeds, sheds), which cannot be seen as they stood on a past date either.
// As in the collector, only NON_FILER waits for the sub-cycle to open: the
// carry-over rules fire on a building whose window has not opened yet, so
// those buildings stay in the pool and in the baseline (they matter only on
// the first date, when 9C had not opened).
function replay(filings, byBin, T) {
  const L = stateAt(filings, T);
  const groups = { FLAGGED: [], NOT_FLAGGED: [], NOT_FLAGGED_FILED_UNSAFE: [], NON_FILER: [], SWARMP_CARRYOVER: [], UNSAFE_PRIOR: [], CHRONIC_NON_FILER: [] };
  const pool = [];
  for (const [bin, { borough, block, c8: a, c9: b }] of L) {
    if (!BOROUGHS.includes(borough)) continue;
    const sc = sub9(block);
    if (!sc) continue;
    const m = Math.round((ymd(sc.deadline) - T) / (30.44 * DAY));
    const sig = [];
    if (!b && ymd(sc.opens) <= T) sig.push(['NON_FILER', m <= 7 ? 3 : m <= 18 ? 2 : 1]);
    if (a?.status === 'SWARMP' && (!b || b.status !== 'SAFE')) sig.push(['SWARMP_CARRYOVER', m <= 7 ? 3 : 2]);
    if (a?.status === 'UNSAFE' && !b) sig.push(['UNSAFE_PRIOR', 3]);
    if (a?.status === 'No Report Filed' && !b) sig.push(['CHRONIC_NON_FILER', 2]);
    if (!sig.length) {
      groups.NOT_FLAGGED.push(bin);
      // Filed this cycle and came back UNSAFE: no rule fires on it, and it is
      // the cohort above — the buyer the register does not show.
      if (b?.status === 'UNSAFE') groups.NOT_FLAGGED_FILED_UNSAFE.push(bin);
      continue;
    }
    groups.FLAGGED.push(bin);
    for (const [k] of sig) groups[k].push(bin);
    pool.push({ bin, borough, score: sig.reduce((s, [, u]) => s + u, 0), monthsLeft: m });
  }
  const def = `${PERMIT} (definitions.facadePermit.regex)`;
  const where = `four register boroughs, buildings with a cycle-8 or dated cycle-9 filing on ${iso(T)}`;

  // Without the points it cannot replay, the score ties at its maximum for
  // thousands of buildings. The register then orders them by months left, most
  // overdue first, and inside one sub-cycle monthsLeft ties too, so a plain
  // sort hands the last seats to whichever rows the dataset happened to list
  // first. That slice measures the dataset's row order, not the score. So the
  // score is judged tier by tier, the whole top tier against the rest, the top
  // tier by months left (the register's own tie-break), and the 800 with the
  // remaining ties drawn at random many times.
  const scores = [...new Set(pool.map((c) => c.score))].sort((a, b) => b - a);
  const binsOf = (xs) => xs.map((c) => c.bin);
  const byScore = Object.fromEntries(
    scores.map((s) => [s, outcome(binsOf(pool.filter((c) => c.score === s)), byBin, T, `flagged buildings with a facade score of ${s}, ${where}`, def)]),
  );
  const tier = pool.filter((c) => c.score === scores[0]);
  const below = pool.filter((c) => c.score !== scores[0]);
  const months = [...new Set(tier.map((c) => c.monthsLeft))].sort((a, b) => a - b);
  const hit = new Map(pool.map((c) => [c.bin, (byBin.get(c.bin) || []).some((x) => x.t > T && x.t - T <= M24 * DAY)]));
  const rate = (xs) => (xs.length ? (100 * xs.filter((c) => hit.get(c.bin)).length) / xs.length : 0);
  const rand = seeded(+T / DAY);
  const gaps = [];
  for (let i = 0; i < DRAWS; i++) {
    const drawn = pool.map((c) => ({ ...c, r: rand() })).sort((x, y) => y.score - x.score || x.monthsLeft - y.monthsLeft || x.r - y.r);
    const shown = new Set(binsOf(balancedByBorough(drawn, CEILING)));
    gaps.push(rate(pool.filter((c) => shown.has(c.bin))) - rate(pool.filter((c) => !shown.has(c.bin))));
  }
  gaps.sort((a, b) => a - b);
  return {
    at: iso(T),
    groups: Object.fromEntries(Object.entries(groups).map(([k, bins]) => [k, outcome(bins, byBin, T, `${k}, ${where}`, def)])),
    ranking: {
      byScore,
      topTier: {
        score: scores[0],
        top: outcome(binsOf(tier), byBin, T, `every flagged building at the top facade score (${scores[0]}), ${where}`, def),
        rest: outcome(binsOf(below), byBin, T, `the rest of the flagged pool, ${where}`, def),
        byMonthsLeft: months.map((m) => ({
          monthsLeft: m,
          ...outcome(binsOf(tier.filter((c) => c.monthsLeft === m)), byBin, T, `top-tier buildings ${m} months from their sub-cycle deadline (negative: overdue), ${where}`, def),
        })),
      },
      shownWithRandomTies: {
        tiedAtTop: tier.length,
        draws: DRAWS,
        gapWithin24: {
          n: DRAWS,
          median: round1(quantile(gaps, 0.5)),
          p5: round1(quantile(gaps, 0.05)),
          p95: round1(quantile(gaps, 0.95)),
          unit: 'percentage points',
          window: `${iso(T)}; permit issued within 730 days after`,
          definition: `the ${CEILING} buildings the register's score would show (balanced by borough, ties at equal score and monthsLeft drawn at random) minus the rest of the flagged pool, share with a ${def}`,
        },
      },
    },
  };
}

// Engineers: buildings that had not filed their cycle-9 report six months
// before their sub-cycle's deadline. How many hired an engineer (the report is
// filed by one) within six and twelve months, and how many firms shared that.
function nonFilers(filings, firstC9, v) {
  const T = ymd(v.at);
  let n = 0;
  let in6 = 0;
  let in12 = 0;
  const firms = [];
  for (const [bin, rec] of stateAt(filings, T)) {
    if (!BOROUGHS.includes(rec.borough) || !rec.c8 || rec.c9 || sub9(rec.block)?.sub !== v.sub) continue;
    n++;
    const r = firstC9.get(bin);
    const lag = r ? days(ymd(r.filing_date) - T) : null;
    if (lag == null || lag <= 0) continue;
    if (lag <= M6) in6++;
    if (lag <= M12) {
      in12++;
      firms.push(firmKey(r.qewi_bus_name));
    }
  }
  const w = `sub-cycle ${v.sub} (deadline ${v.deadline}), buildings with any cycle-8 row (an auto-generated 'No Report Filed' included) and no dated cycle-9 filing on ${v.at}, four register boroughs`;
  const def = "first cycle-9 Initial report (xubg-57si filing_date) filed after the replay date";
  return {
    sub: v.sub,
    at: v.at,
    deadline: v.deadline,
    nonFilers: n,
    within6: share(in6, n, `${w}; filed within ${M6} days`, def),
    within12: share(in12, n, `${w}; filed within ${M12} days`, def),
    engineers: concentration(firms, `${w}; reports filed within ${M12} days`, 'QEWI firms (qewi_bus_name, suffixes folded) on those reports'),
  };
}

// ---------------------------------------------------------------- fetching

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);

// Polite: one request at a time with a pause between them, backing off on the
// server's own Retry-After, and never retrying a 4xx — a bad query is not an outage.
async function getJson(url, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    let wait = Math.min(60000, 2000 * 2 ** i);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (res.ok) return await res.json();
      last = new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (!RETRY.has(res.status)) throw Object.assign(last, { fatal: true });
      const after = Number(res.headers.get('retry-after'));
      if (after > 0) wait = Math.min(120000, after * 1000);
    } catch (e) {
      if (e.fatal) throw e;
      last = e;
    }
    if (i < tries - 1) await sleep(wait);
  }
  throw last;
}

const meta = new Map();
async function datasetMeta(id) {
  if (!meta.has(id)) {
    const m = await getJson(`https://${HOST}/api/views/${id}.json`);
    meta.set(id, { name: m.name, rowsUpdatedAt: m.rowsUpdatedAt ? new Date(m.rowsUpdatedAt * 1000).toISOString() : null });
    await sleep(PAUSE_MS);
  }
  return meta.get(id);
}

// Every read is cached with the publisher's rowsUpdatedAt as it stood when the
// rows were fetched, so evidence.json names the load it was computed from even
// when a rerun is served from disk.
const reads = [];
async function read(id, label, params, { pageSize = 50000, describe } = {}) {
  const key = createHash('sha1').update(`${id}?${new URLSearchParams(params)}`).digest('hex').slice(0, 16);
  const file = join(CACHE, `${id}-${key}.json`);
  let hit = null;
  try {
    hit = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  const cached = Boolean(hit && Date.now() - Date.parse(hit.fetchedAt) < MAX_AGE_H * 3.6e6);
  if (!cached) {
    const m = await datasetMeta(id);
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      // Paging without $order can skip or repeat rows between requests.
      const qs = new URLSearchParams({ $order: ':id', ...params, $limit: String(pageSize), $offset: String(offset) });
      const page = await getJson(`https://${HOST}/resource/${id}.json?${qs}`);
      rows.push(...page);
      await sleep(PAUSE_MS);
      if (page.length < pageSize) break;
    }
    hit = { id, name: m.name, rowsUpdatedAt: m.rowsUpdatedAt, fetchedAt: new Date().toISOString(), rows };
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(hit));
  }
  reads.push({ id, name: hit.name, label, where: describe || params.$where, rows: hit.rows.length, rowsUpdatedAt: hit.rowsUpdatedAt, fetchedAt: hit.fetchedAt });
  console.log(`  ${id} ${label}: ${hit.rows.length} rows${cached ? ' (cache)' : ''}`);
  return hit.rows;
}

// One entry per dataset; a dataset read at two moments reports the older load.
function sourcesTable() {
  const out = new Map();
  for (const r of reads) {
    const s = out.get(r.id) || { id: r.id, name: r.name, host: HOST, rowsUpdatedAt: r.rowsUpdatedAt, fetchedAt: r.fetchedAt, queries: [] };
    if (r.rowsUpdatedAt && (!s.rowsUpdatedAt || r.rowsUpdatedAt < s.rowsUpdatedAt)) s.rowsUpdatedAt = r.rowsUpdatedAt;
    if (r.fetchedAt < s.fetchedAt) s.fetchedAt = r.fetchedAt;
    const q = s.queries.find((x) => x.label === r.label);
    if (q) {
      q.rows += r.rows;
      q.requests += 1;
    } else s.queries.push({ label: r.label, where: r.where, rows: r.rows, requests: 1 });
    out.set(r.id, s);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- the run

const fmt = (n) => Number(n).toLocaleString('en-US');
const usd = (n) => (n >= 1e6 ? `$${round1(n / 1e6)}M` : `$${Math.round(n / 1000)}k`);
const range = (xs) => {
  const v = xs.filter((x) => x != null);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
};

async function main() {
  assertCollectable(HOST);
  console.log(`Backtest: reading ${HOST} (cache ${CACHE})`);
  const lastShedDay = iso(new Date(+ymd(SHED_REPLAY.at(-1)) + DAY));
  const filings = await read('xubg-57si', 'facade filings, cycles 8-10', {
    $where: "cycle in('8','9','10')",
    $select: 'cycle,filing_type,bin,borough,block,filing_date,submitted_on,filing_status,qewi_bus_name',
  });
  const permitRows = await read('rbx6-tga4', 'facade Initial Permits, General Construction', {
    $where: PERMIT_WHERE,
    $select: 'job_filing_number,bin,work_on_floor,job_description,issued_date,estimated_job_costs,applicant_license,permittee_s_license_type',
  });
  // Both shed reads stop at the day after the last shed replay date: nothing
  // first permitted later can be in the cohort or live on a replay date. The
  // cut is in the query, so the row counts in `sources` are those of the cut
  // (the datasets hold far more shed rows than these, all of them later).
  const shedJobs = await read('w9ak-ipjd', `sidewalk-shed jobs first permitted before ${lastShedDay}`, {
    $where: `shed='YES' and first_permit_date < '${lastShedDay}'`,
    $select: 'job_filing_number,bin,first_permit_date,signoff_date',
  });
  const shedPermits = await read('rbx6-tga4', `sidewalk-shed permits issued before ${lastShedDay}, every filing reason and status`, {
    $where: `work_type='Sidewalk Shed' and issued_date < '${lastShedDay}'`,
    $select: 'job_filing_number,bin,issued_date,expired_date',
  });

  // The data horizon is the oldest load among the datasets read: nothing after
  // it can be seen in all of them.
  const stamps = reads.map((r) => r.rowsUpdatedAt).filter(Boolean).sort();
  if (!stamps.length) throw new Error('no rowsUpdatedAt on any dataset — refusing to date the evidence');
  const asOf = ymd(stamps[0]);
  if (+ymd(COHORT.to) + M24 * DAY > +asOf) throw new Error(`data through ${iso(asOf)} cannot follow the ${COHORT.to} cohort for 24 months`);

  const idx = { regex: permitIndex(permitRows, DEFINITIONS.regex.test), workOnFloor: permitIndex(permitRows, DEFINITIONS.workOnFloor.test) };
  const byBin = idx.regex.byBin;
  const c9 = firstReports(filings, '9');
  const c10 = firstReports(filings, '10');
  const fisp = new Map();
  for (const r of filings) if (r.bin && !fisp.has(r.bin)) fisp.set(r.bin, String(r.borough || '').trim());

  // (a) The purchase after the report.
  const from = ymd(COHORT.from);
  const to = ymd(COHORT.to);
  const W = `citywide, each building's first cycle-9 report filed ${COHORT.from}..${COHORT.to}`;
  const cohorts = {};
  const raw = {};
  for (const def of ['regex', 'workOnFloor']) {
    cohorts[def] = {};
    const d = `${PERMIT} (definitions.facadePermit.${def})`;
    for (const status of ['UNSAFE', 'SWARMP', 'SAFE']) {
      const c = cohort(c9, idx[def].byBin, status, from, to);
      raw[`${def}.${status}`] = c;
      cohorts[def][status] = {
        buildings: c.n,
        within12: share(c.in12, c.n, `${W}, report status ${status}; permit issued 0-${M12} days after the report`, d),
        within24: share(c.in24, c.n, `${W}, report status ${status}; permit issued 0-${M24} days after the report`, d),
        alreadyBefore: share(c.pre, c.n, `${W}, report status ${status}; permit issued 1-${LOOKBACK} days before the report`, d),
        lagDays: spread(c.lags, 'days', `${W}, report status ${status}; buildings with a permit within ${M24} days`, `report filing_date to the first ${d} issued on or after it`),
        jobCost: spread(
          c.costs,
          'USD',
          `${W}, report status ${status}; that first permit, when it declares a cost`,
          "estimated_job_costs: the applicant's own estimate for the whole job, some of it not facade work; not a contract value, and the total is not a market size",
          { total: true },
        ),
        contractors: concentration(c.licences, `${W}, report status ${status}; that first permit`, 'permittees (applicant_license)'),
        within24ByBorough: Object.fromEntries(
          Object.entries(c.byBorough)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([b, x]) => [b, share(x.in24, x.n, `${W}, report status ${status}, ${b}; permit within ${M24} days`, d)]),
        ),
      };
    }
    const u = raw[`${def}.UNSAFE`];
    const s = raw[`${def}.SAFE`];
    cohorts[def].liftUnsafeOverSafe = {
      within12: s.in12 ? round1(u.in12 / u.n / (s.in12 / s.n)) : null,
      within24: s.in24 ? round1(u.in24 / u.n / (s.in24 / s.n)) : null,
      definition:
        'UNSAFE share divided by SAFE share, same window and permit definition. This is what the law requires (an UNSAFE report obliges a repair, a SAFE one does not), not evidence that anything predicts a purchase.',
    };
  }

  // Where the time goes between an UNSAFE report and its permit: the job's
  // own filing date, from the job-applications dataset (same number).
  // A job is filed by its applicant of record, usually the engineer or
  // architect, and the permit that names the contractor comes months later.
  // So the report-to-job-filed time, not the report-to-permit time, is the
  // closer mark of when the work was decided, and a job filed before the
  // report was under way before it. It does not show when a contractor was
  // hired: the record has no date for that.
  const hits = raw['regex.UNSAFE'].hits.filter((h) => h.job);
  const ids = [...new Set(hits.map((h) => h.job))].sort();
  const filed = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((j) => `'${j.replace(/'/g, "''")}'`).join(',');
    const rows = await read(
      'w9ak-ipjd',
      "jobs behind the UNSAFE cohort's facade-related permits",
      { $where: `job_filing_number in(${list})`, $select: 'job_filing_number,filing_date' },
      { pageSize: 1000, describe: 'job_filing_number in (the jobs of those permits, 100 per request)' },
    );
    for (const r of rows) if (r.filing_date) filed.set(r.job_filing_number, ymd(r.filing_date));
  }
  const found = hits.filter((h) => filed.has(h.job));
  const before = found.filter((h) => filed.get(h.job) < h.report);
  const WJ = `${W}, report status UNSAFE; its first ${PERMIT} within ${M24} days (regex definition)`;
  const jobTiming = {
    joined: share(found.length, hits.length, WJ, 'permits whose job_filing_number is found in w9ak-ipjd'),
    jobFiledBeforeReport: share(before.length, found.length, WJ, 'the job behind the permit filed (w9ak-ipjd filing_date) before the UNSAFE report was filed'),
    reportToJobFiledSigned: spread(
      found.map((h) => days(filed.get(h.job) - h.report)),
      'days',
      WJ,
      'report filing_date to the job filing_date, negative when the job was filed before the report',
    ),
    reportToJobFiled: spread(
      found.filter((h) => filed.get(h.job) >= h.report).map((h) => days(filed.get(h.job) - h.report)),
      'days',
      `${WJ}; job filed on or after the report`,
      'report filing_date to the job filing_date',
    ),
    jobFiledToPermit: spread(found.map((h) => days(h.issued - filed.get(h.job))), 'days', WJ, 'job filing_date to permit issued_date'),
  };

  // (c) The whole facade market since 2022: who pulls the permits. A job is
  // its base number, so its -I1 and -S# filings count once (counting each
  // filing apart adds under half a percent to the job count). Split by
  // job count and by declared cost: the largest firms by dollars hold a bigger
  // share than the busiest by count, and a claim about the market needs both.
  const WM = `citywide, facade-related Initial Permits issued ${MARKET_FROM}..${iso(asOf)}`;
  const market = {};
  for (const def of ['regex', 'workOnFloor']) {
    const jobs = idx[def].jobs.filter((p) => p.t >= ymd(MARKET_FROM) && p.t <= asOf);
    const gc = jobs.filter((p) => p.gc);
    const who = `GC licences (applicant_license) on permits meeting definitions.facadePermit.${def}; one job counted once, its -I1 and -S# filings merged under the base job number`;
    market[def] = {
      jobs: jobs.length,
      gcPermittee: share(gc.length, jobs.length, WM, "permittee_s_license_type 'GC': the licence on the permit is the contractor's, not the filing engineer's"),
      contractors: concentration(gc.map((p) => p.lic), WM, who),
      contractorsByDeclaredCost: valueConcentration(
        gc.map((p) => [p.lic, p.cost]),
        WM,
        `${who}; weighted by estimated_job_costs on the job's first permit (the applicant's own estimate for the whole job)`,
      ),
    };
  }

  // (b) The engineer's purchase, and the engineering market as a whole.
  const vintages = SUB9.map((v) => nonFilers(filings, c9, v));
  const allReports = filings.filter((r) => r.cycle === '9' && r.filing_type === 'Initial');
  const qewiMarket = concentration(allReports.map((r) => firmKey(r.qewi_bus_name)), 'citywide, every cycle-9 Initial report', 'QEWI firms (qewi_bus_name, suffixes folded)');
  const qewiByFold = Object.fromEntries(
    Object.entries(FIRM_FOLDS).map(([k, fold]) => {
      const c = concentration(allReports.map((r) => fold(r.qewi_bus_name)), 'citywide, every cycle-9 Initial report', `QEWI firms (qewi_bus_name, names folded: ${k})`);
      return [k, { distinct: c.distinct, top10: c.top10 }];
    }),
  );
  const firmRange = Object.values(qewiByFold).map((x) => x.distinct);
  const firmTop10 = Object.values(qewiByFold).map((x) => x.top10.value);

  // What does not hold: the register's rules and ranking replayed.
  const replays = SUB9.map((v) => replay(filings, byBin, ymd(v.at)));

  // (d) Sheds. The cohort reads the job-applications dataset, whose sign-off
  // (Letter of Completion) is the day the shed came down; a permit's
  // expired_date is only the end of its term.
  const signoff = new Map();
  for (const j of shedJobs) signoff.set(jobKey(j.job_filing_number), ymd(j.signoff_date));
  const inFisp = (bin) => BOROUGHS.includes(fisp.get(bin));
  const WS = `sidewalk-shed jobs (w9ak-ipjd shed='YES') first permitted ${SHED_COHORT.from}..${SHED_COHORT.to} at FISP buildings, four register boroughs`;
  const sj = shedJobs.filter((j) => {
    const t = ymd(j.first_permit_date);
    return inFisp(j.bin) && t >= ymd(SHED_COHORT.from) && t <= ymd(SHED_COHORT.to);
  });
  let withPermit = 0;
  let removedNoPermit = 0;
  let standingNoPermit = 0;
  const shedLags = [];
  for (const j of sj) {
    const s = ymd(j.first_permit_date);
    const e = ymd(j.signoff_date) || asOf;
    const p = (byBin.get(j.bin) || []).find((x) => x.t >= s - 90 * DAY && x.t <= e);
    if (p) {
      withPermit++;
      shedLags.push(days(p.t - s));
    } else if (j.signoff_date) removedNoPermit++;
    else standingNoPermit++;
  }
  const signed = sj.filter((j) => j.signoff_date);
  // How long a shed stands, counting the ones still up: a median over the
  // signed-off sheds alone drops every shed that outlived the data.
  const life = sj
    .map((j) => ({ t: days((ymd(j.signoff_date) || asOf) - ymd(j.first_permit_date)), done: Boolean(j.signoff_date) }))
    .filter((x) => x.t >= 0);
  const permitDef =
    `${PERMIT} (definitions.facadePermit.regex) issued at the same building from 90 days before the shed's first permit to its sign-off, or to ${iso(asOf)} if never signed off. ` +
    'Not linked to this shed: any such permit at the building in that span counts.';
  const shedCohort = {
    jobs: sj.length,
    signedOff: share(signed.length, sj.length, WS, `signoff_date recorded by ${iso(asOf)}`),
    daysToSignoff: spread(signed.map((j) => days(ymd(j.signoff_date) - ymd(j.first_permit_date))).filter((x) => x >= 0), 'days', `${WS}; signed off`, 'first_permit_date to signoff_date, signed-off sheds only', { p90: true }),
    shedLifeDays: {
      n: life.length,
      median: kmMedian(life),
      stillStanding: life.filter((x) => !x.done).length,
      unit: 'days',
      window: WS,
      definition: `Kaplan-Meier median from first_permit_date to signoff_date; a shed with no sign-off by ${iso(asOf)} counts as still standing on that day, not dropped`,
    },
    withFacadePermit: share(withPermit, sj.length, WS, permitDef),
    shedToFacadePermitDays: spread(shedLags, 'days', `${WS}; with such a permit`, "shed's first permit to the facade-related permit (negative: the permit came first)"),
    signedOffWithNoFacadePermit: share(removedNoPermit, sj.length, WS, 'signed off with no such permit'),
    standingWithNoFacadePermit: share(standingNoPermit, sj.length, WS, 'no sign-off and no such permit'),
  };

  // The replay of SHED_NO_REPAIR reads what the collector reads — shed permits
  // — with the age taken from the first permit of the job that is live on the
  // date, not of any job the building ever had (a 2018 shed and a 2026 shed
  // are two sheds). A job whose sign-off precedes the date is down. A new shed
  // is reported twice: with no facade permit in the two years before, which
  // is the like-for-like comparison with SHED_NO_REPAIR, and all new sheds,
  // because the first alone would read as "a new shed converts at 50%".
  const shedJobsByBin = shedIndex(shedPermits, inFisp);
  const shedReplay = SHED_REPLAY.map((at) => {
    const T = ymd(at);
    const g = { SHED_NO_REPAIR: [], LONG_WITH_REPAIR: [], NEW_NO_REPAIR: [], NEW_ANY: [] };
    for (const [bin, jobs] of shedJobsByBin) {
      let first = null;
      for (const [k, j] of jobs) {
        const down = signoff.get(k);
        if ((down && down <= T) || !j.spans.some(([a, b]) => a <= T && T <= b)) continue;
        if (!first || j.first < first) first = j.first;
      }
      if (!first) continue;
      const prior = (byBin.get(bin) || []).some((p) => p.t <= T && T - p.t <= M24 * DAY);
      if (T - first >= 365 * DAY) g[prior ? 'LONG_WITH_REPAIR' : 'SHED_NO_REPAIR'].push(bin);
      else {
        g.NEW_ANY.push(bin);
        if (!prior) g.NEW_NO_REPAIR.push(bin);
      }
    }
    const lbl = {
      SHED_NO_REPAIR: `shed permit live on ${at} for 365+ days, no ${PERMIT} in the ${M24} days before (SHED_NO_REPAIR as the rule should read, not as the collector computes it today)`,
      LONG_WITH_REPAIR: `shed permit live on ${at} for 365+ days, such a permit already in the ${M24} days before`,
      NEW_NO_REPAIR: `shed permit live on ${at} for under 365 days, no ${PERMIT} in the ${M24} days before`,
      NEW_ANY: `shed permit live on ${at} for under 365 days, with or without such a permit before`,
    };
    const def = `${PERMIT} (definitions.facadePermit.regex)`;
    return { at, groups: Object.fromEntries(Object.entries(g).map(([k, bins]) => [k, outcome(bins, byBin, T, `FISP buildings, four register boroughs, ${lbl[k]}`, def)])) };
  });

  // (e) Fresh reports today that the register does not show: a cycle-10 first
  // report filed UNSAFE in the last twelve months, and no facade-related permit
  // of any filing from 180 days before it. No permit is not nobody on it: the
  // permit trails the job filing by months, so the job applications filed at
  // those buildings are read too, and a report younger than 180 days has not
  // had the usual time to show a permit at all.
  let feed = null;
  try {
    feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
  } catch {}
  const cards = feed?.facades?.feed || [];
  const shown = new Set(cards.map((c) => String(c.bin)));
  const fresh = {};
  for (const status of ['UNSAFE', 'SWARMP']) {
    const recent = [...c10.values()].filter((r) => {
      const t = ymd(r.filing_date);
      return r.filing_status === status && BOROUGHS.includes(String(r.borough || '').trim()) && t <= asOf && asOf - t <= M12 * DAY;
    });
    fresh[status] = { recent, open: openReports(recent, idx.regex.issued) };
  }
  const openBins = [...new Set(Object.values(fresh).flatMap((f) => f.open.map((r) => r.bin)))].sort();
  const since = iso(new Date(+asOf - (M12 + LOOKBACK) * DAY));
  const jobsAt = new Map();
  for (let i = 0; i < openBins.length; i += 100) {
    const list = openBins.slice(i, i + 100).map((b) => `'${String(b).replace(/'/g, "''")}'`).join(',');
    const rows = await read(
      'w9ak-ipjd',
      'job applications at the open fresh-report buildings',
      { $where: `bin in(${list}) and filing_date >= '${since}'`, $select: 'job_filing_number,bin,filing_date,filing_status,work_on_floor,job_description,shed' },
      { pageSize: 5000, describe: `bin in (the open buildings, 100 per request) and filing_date >= '${since}'` },
    );
    for (const r of rows) (jobsAt.get(r.bin) || jobsAt.set(r.bin, []).get(r.bin)).push(r);
  }
  const filedSince = (r) =>
    (jobsAt.get(r.bin) || []).filter((j) => j.filing_status !== 'Filing Withdrawn' && +ymd(j.filing_date) >= +ymd(r.filing_date) - LOOKBACK * DAY);
  const openNow = {};
  for (const status of ['UNSAFE', 'SWARMP']) {
    const { recent, open } = fresh[status];
    const facadeJob = new Set(open.filter((r) => filedSince(r).some(DEFINITIONS.regex.test)));
    const shedJob = open.filter((r) => filedSince(r).some((j) => j.shed === 'YES'));
    const young = open.filter((r) => asOf - ymd(r.filing_date) < LOOKBACK * DAY);
    const nothing = open.filter((r) => !facadeJob.has(r));
    const WO = `four register boroughs, first cycle-10 report filed ${status} ${iso(new Date(+asOf - M12 * DAY))}..${iso(asOf)}`;
    const openDef = `no ${PERMIT} (definitions.facadePermit.regex) of any filing, -S# included, issued from ${LOOKBACK} days before the report to ${iso(asOf)}`;
    const jobDef = `a job application in DOB NOW (w9ak-ipjd, any work type, not withdrawn) filed from ${LOOKBACK} days before the report to ${iso(asOf)}`;
    const nothingDef = `${openDef}, and no facade-related ${jobDef.slice(2)}`;
    // Territory is sold per borough, so the counts are kept per borough too,
    // each over that borough's own reports.
    const perBorough = (xs, def) =>
      Object.fromEntries(
        BOROUGHS.map((b) => {
          const here = (ys) => ys.filter((r) => String(r.borough).trim() === b).length;
          return [b, share(here(xs), here(recent), `${WO}, ${b}`, def)];
        }),
      );
    openNow[status] = {
      reports: recent.length,
      open: share(open.length, recent.length, WO, openDef),
      openByBorough: perBorough(open, openDef),
      facadeJobFiled: share(facadeJob.size, open.length, `${WO}; open`, `${jobDef}, passing the same facade test on its work_on_floor or job_description: the work is already filed and the permit not yet issued`),
      shedJobFiled: share(shedJob.length, open.length, `${WO}; open`, `${jobDef}, with a sidewalk shed (shed='YES')`),
      // Measured against the job filing, not the permit: a report under 180
      // days old is not inside the median time to a job filing, and the page
      // once called it inside the longer lag to a permit (review of
      // 2026-09-24). The job timing is of the UNSAFE cohort, so a SWARMP
      // report is not held to it.
      reportUnder180Days: share(
        young.length,
        open.length,
        `${WO}; open`,
        `report filed less than ${LOOKBACK} days before ${iso(asOf)}` +
          (status === 'UNSAFE'
            ? `; for comparison, the median time from an UNSAFE report to the filing of the job behind its first facade-related permit is ${jobTiming.reportToJobFiledSigned.median} days (facades.jobTiming.reportToJobFiledSigned)`
            : ''),
      ),
      nothingFiled: share(nothing.length, recent.length, WO, nothingDef),
      nothingFiledByBorough: perBorough(nothing, nothingDef),
      nothingFiledReportUnder180Days: share(
        nothing.filter((r) => young.includes(r)).length,
        nothing.length,
        `${WO}; nothing facade-related filed`,
        `report filed less than ${LOOKBACK} days before ${iso(asOf)}`,
      ),
      // With nothing filed, the next mark is the job filing, not the permit,
      // and it comes months sooner. The page once measured these reports
      // against the time to a permit alone, which flattered how many were
      // still early (review of 2026-09-24). The job timing is measured on the
      // UNSAFE cohort only, so a SWARMP report is not held to it.
      ...(status === 'UNSAFE'
        ? {
            nothingFiledReportUnderJobFiling: share(
              nothing.filter((r) => asOf - ymd(r.filing_date) < jobTiming.reportToJobFiledSigned.median * DAY).length,
              nothing.length,
              `${WO}; nothing facade-related filed`,
              `report filed less than ${jobTiming.reportToJobFiledSigned.median} days before ${iso(asOf)}, the median time from an UNSAFE report to the filing of the job behind its first facade-related permit (facades.jobTiming.reportToJobFiledSigned)`,
            ),
          }
        : {}),
      inRegister: feed
        ? share(
            open.filter((r) => shown.has(String(r.bin))).length,
            open.length,
            `${WO}; open`,
            `on the facade register committed at ${feed.generatedAt}. The register ranks its candidates and keeps the top ones, and a building whose cycle-9 report was SWARMP can qualify with a fresh cycle-10 ${status} report (SWARMP_CARRYOVER), so a zero here is how it ranks today, not a guarantee: see openNow.register`,
          )
        : null,
    };
  }
  // Why none of them is on the register today: every card on it is a building
  // that has not filed in cycle 10. That is how the register ranks, not a rule:
  // SWARMP_CARRYOVER (scripts/collect.mjs) also takes a building with a fresh
  // cycle-10 UNSAFE report whose cycle-9 report was SWARMP, and the zero comes
  // from the cut to the top-ranked cards; the page once called it the
  // register's design (review of 2026-09-24). The register does read an UNSAFE
  // report, one cycle late (UNSAFE_PRIOR), and it is counted here: the
  // evidence page once said a filed UNSAFE report was a signal the product had
  // yet to read, while 98 of the 800 cards carried one (same review).
  const reg = `the facade register committed at ${feed?.generatedAt}`;
  openNow.register = feed
    ? {
        committedAt: feed.generatedAt,
        cards: cards.length,
        noCycle10Filing: share(
          cards.filter((c) => String(c.lastCycle) === '9').length,
          cards.length,
          reg,
          'cards whose building has no cycle-10 filing (lastCycle 9)',
        ),
        unsafePrior: share(
          cards.filter((c) => (c.signals || []).some((x) => x.kind === 'UNSAFE_PRIOR')).length,
          cards.length,
          reg,
          "cards carrying the UNSAFE_PRIOR signal (scripts/collect.mjs): the building's cycle-9 report is UNSAFE and it has filed nothing in cycle 10, so the report is a cycle old; replay.*.groups.UNSAFE_PRIOR tests the rule",
        ),
      }
    : null;

  // ------------------------------------------------------------ the verdicts

  const R = cohorts.regex;
  const C = cohorts.workOnFloor;
  const JT = jobTiming;
  const signed1 = (x) => `${x >= 0 ? '+' : ''}${x}`;
  const tierGap = replays.map((r) => round1(r.ranking.topTier.top.within24.value - r.ranking.topTier.rest.within24.value));
  const drawGap = replays.map((r) => r.ranking.shownWithRandomTies.gapWithin24);
  // Does the register's tie-break (most overdue first) pick the weaker part of
  // the top tier? Only a tier that spans more than one deadline can say.
  const mixedTiers = replays.filter((r) => r.ranking.topTier.byMonthsLeft.length > 1);
  const overdueWorse = mixedTiers.length > 0 && mixedTiers.every((r) => {
    const t = r.ranking.topTier.byMonthsLeft;
    const due = t.filter((o) => o.monthsLeft > 0).map((o) => o.within24.value);
    return due.length && t.filter((o) => o.monthsLeft <= 0).every((o) => o.within24.value < Math.min(...due));
  });
  // Conversion rises with the score only if no higher score converts below a
  // lower one at any replay date.
  const rising = replays.every((r) => {
    const v = Object.entries(r.ranking.byScore).sort(([x], [y]) => Number(x) - Number(y)).map(([, o]) => o.within24.value);
    return v.every((x, i) => !i || x >= v[i - 1]);
  });
  // The 800 the register would show against the rest of the flagged pool, read
  // off the spread of the random draws and not their median alone: better only
  // when the whole 5th-95th percentile range sits above zero, worse only when
  // it sits below, and no better when it straddles zero. The sentence is built
  // from those verdicts so a rerun cannot leave a softer one standing.
  const shownVerdicts = drawGap.map((g) => (g.p5 > 0 ? 'better' : g.p95 < 0 ? 'worse' : 'level'));
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
  const shownAgainstRest = [
    ['level', 'no better than the rest of the flagged pool'],
    ['worse', 'worse than the rest'],
    ['better', 'better than the rest'],
  ]
    .map(([v, words]) => [words, replays.filter((_, i) => shownVerdicts[i] === v).map((r) => r.at)])
    .filter(([, dates]) => dates.length)
    .map(([words, dates]) =>
      dates.length === replays.length
        ? `${words} at every replay date`
        : `${words} at ${WORDS[dates.length] ?? dates.length} ${dates.length > 1 ? 'dates' : 'date'} (${dates.join(', ')})`,
    )
    .join(' and ');
  // Worded from the size of the gaps, not from their sign alone: a +0.2 gap
  // once would still have read "a few points" (review of 2026-09-24).
  const lowHighPts = (xs) => {
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return lo === hi ? `${lo} points` : `${lo}–${hi} points`;
  };
  const tierAgainstRest = tierGap.every((g) => g > 0)
    ? `the top score tier converts ${lowHighPts(tierGap)} above the rest of the flagged pool`
    : tierGap.every((g) => g <= 0)
      ? 'the top score tier converts no better than the rest of the flagged pool'
      : 'the top score tier converts above the rest of the flagged pool at some dates and not at others';
  const noPermit = share(
    R.UNSAFE.within24.den - R.UNSAFE.within24.num,
    R.UNSAFE.within24.den,
    R.UNSAFE.within24.window,
    `no ${R.UNSAFE.within24.definition} within 730 days`,
  );
  const base = replays.map((r) => r.groups.NOT_FLAGGED.within24.value);
  const vsBase = (k) => replays.map((r, i) => ({ at: r.at, v: r.groups[k].within24.value, b: base[i], gap: round1(r.groups[k].within24.value - base[i]) }));
  const sr = shedReplay.map((r) => r.groups);
  // The market headline leads with the narrow definition: DOB's own facade
  // work location cannot be argued with, and the wider count only adds firms.
  const mk = market.workOnFloor.contractors;
  const mw = market.regex.contractors;
  const mkd = market.workOnFloor.contractorsByDeclaredCost;
  const mwd = market.regex.contractorsByDeclaredCost;
  const U = openNow.UNSAFE;
  const byCount = (o) =>
    Object.entries(o)
      .sort(([, a], [, b]) => b.num - a.num)
      .map(([b, s]) => `${b} ${fmt(s.num)}`)
      .join(', ');

  const headline = [
    {
      claim:
        `Of ${fmt(R.UNSAFE.buildings)} NYC buildings whose first cycle-9 facade report was filed UNSAFE, ` +
        `${range([C.UNSAFE.within24.value, R.UNSAFE.within24.value])} had a ${PERMIT} issued within 24 months ` +
        `(${range([C.UNSAFE.within12.value, R.UNSAFE.within12.value])} within 12), against ` +
        `${range([C.SAFE.within24.value, R.SAFE.within24.value])} of buildings reported SAFE. ` +
        'That gap is what the law requires (an UNSAFE building must repair, a SAFE one need not): it sizes the repair wave and its timing, it does not show that anything predicts it. ' +
        `The ${noPermit.value}% (${fmt(noPermit.num)} of ${fmt(noPermit.den)}) with no such permit in two years mix repairs the permit record misses, repairs that slipped past two years and buildings not yet repaired; the record cannot tell them apart.`,
      value: `${R.UNSAFE.within24.value}%`,
      denominator: `${fmt(R.UNSAFE.buildings)} buildings`,
      window: `first cycle-9 report filed ${COHORT.from}..${COHORT.to}, followed 730 days`,
      definition: 'regex definition; the lower bound of each range is the work_on_floor-only definition. A facade-related permit is not necessarily a repair (definitions.facadePermit)',
    },
    {
      claim:
        `The permit comes months after the work is filed. The job behind it was filed with DOB a median ${JT.reportToJobFiledSigned.median} days after the UNSAFE report ` +
        `(IQR ${JT.reportToJobFiledSigned.p25}–${JT.reportToJobFiledSigned.p75}), ${JT.jobFiledBeforeReport.value}% of them before it, and the permit was issued a median ${R.UNSAFE.lagDays.median} days after the report ` +
        `(IQR ${R.UNSAFE.lagDays.p25}–${R.UNSAFE.lagDays.p75}); ${R.UNSAFE.alreadyBefore.value}% of UNSAFE buildings already had such a permit in the ${LOOKBACK} days before their report. ` +
        `A job is filed by its applicant of record, usually the engineer or architect, and the permit names the contractor, so the report-to-permit lag overstates the time there is to sell into; for that ${JT.jobFiledBeforeReport.value}% the work was already filed before the report.`,
      value: `${JT.reportToJobFiledSigned.median} days`,
      denominator: `${fmt(JT.reportToJobFiledSigned.n)} jobs behind the first permits (${fmt(R.UNSAFE.buildings)} buildings for the look-back share)`,
      window: `first cycle-9 UNSAFE report filed ${COHORT.from}..${COHORT.to}; first permit within 730 days`,
      definition: 'w9ak-ipjd filing_date of the job behind the first facade-related permit (regex definition), minus the report filing_date',
    },
    {
      claim:
        `Applicants declared a median ${usd(R.UNSAFE.jobCost.median)} (IQR ${usd(R.UNSAFE.jobCost.p25)}–${usd(R.UNSAFE.jobCost.p75)}) on those first permits: ` +
        'their own estimate for the whole job, some of it not facade work. It is neither a contract value nor, summed, the size of a market.',
      value: usd(R.UNSAFE.jobCost.median),
      denominator: `${fmt(R.UNSAFE.jobCost.n)} permits declaring a cost`,
      window: `first cycle-9 UNSAFE report filed ${COHORT.from}..${COHORT.to}; first permit within 730 days`,
      definition: 'estimated_job_costs on the permit application; a permit is the lagging trace of a hired contractor, not a contract',
    },
    {
      claim: `${fmt(R.UNSAFE.contractors.distinct)} different permittee licences pulled those ${fmt(R.UNSAFE.contractors.jobs)} permits; the ten busiest hold ${R.UNSAFE.contractors.top10.value}%.`,
      value: `${R.UNSAFE.contractors.top10.value}%`,
      denominator: `${fmt(R.UNSAFE.contractors.jobs)} jobs`,
      window: `first cycle-9 UNSAFE report filed ${COHORT.from}..${COHORT.to}`,
      definition: 'distinct applicant_license on the first facade-related permit',
    },
    {
      claim:
        `Facade work is not a concentrated market: ${fmt(mk.distinct)} GC licences pulled facade-related permits since 2022; by job count the top 10 hold ${mk.top10.value}% and the busiest ${mk.top1.value}% ` +
        `(${fmt(mw.distinct)} GCs and ${mw.top10.value}% on the wider definition). By declared cost the top 10 hold ${mkd.top10.value}% (${mwd.top10.value}%) and the largest ${mkd.top1.value}% (${mwd.top1.value}%), ` +
        `${round1(mkd.top10.value / mk.top10.value)}x (${round1(mwd.top10.value / mw.top10.value)}x) their share by count, and the dollar HHI is ${mkd.hhi} (${mwd.hhi}).`,
      value: `${mk.top10.value}% of jobs, ${mkd.top10.value}% of dollars`,
      denominator: `${fmt(mk.jobs)} facade-related jobs with a GC permittee`,
      window: `Initial Permits issued ${MARKET_FROM}..${iso(asOf)}`,
      definition: 'work_on_floor definition (the wider regex definition in parentheses); one job counted once, its -I1 and -S# filings merged under the base job number; dollars are estimated_job_costs',
    },
    {
      claim:
        `Buildings with six months left and no report filed: ${range(vintages.map((v) => v.within6.value))} filed within 6 months and ` +
        `${range(vintages.map((v) => v.within12.value))} within 12, in each of three sub-cycles. About ${fmt(Math.min(...firmRange))}–${fmt(Math.max(...firmRange))} engineering firms filed cycle-9 reports ` +
        `(the count depends on how their names are folded) and the top 10 hold ${range(firmTop10)}.`,
      value: range(vintages.map((v) => v.within12.value)),
      denominator: vintages.map((v) => `${v.sub}: ${fmt(v.nonFilers)}`).join(', ') + ' buildings',
      window: vintages.map((v) => v.at).join(', ') + ' (each deadline minus six months)',
      definition: "first cycle-9 Initial report filed after the replay date; a building's cycle-8 record includes auto-generated 'No Report Filed' rows",
    },
    {
      claim:
        `${shedCohort.withFacadePermit.value}% of sidewalk sheds at FISP buildings had a ${PERMIT} at the same building between 90 days before the shed went up and its removal (not linked to that shed). ` +
        `Counting the ${fmt(shedCohort.shedLifeDays.stillStanding)} still up, a shed stands a median ${shedCohort.shedLifeDays.median} days (${shedCohort.daysToSignoff.median} among those taken down). ` +
        `Among sheds with no such permit in the two years before, one standing over a year converted at ${range(sr.map((g) => g.SHED_NO_REPAIR.within24.value))} within 24 months, ` +
        `one under a year old at ${range(sr.map((g) => g.NEW_NO_REPAIR.within24.value))}; all sheds under a year old, permit before or not, at ${range(sr.map((g) => g.NEW_ANY.within24.value))}.`,
      value: `${shedCohort.withFacadePermit.value}%`,
      denominator: `${fmt(shedCohort.jobs)} shed jobs`,
      window: `first permitted ${SHED_COHORT.from}..${SHED_COHORT.to}; replays at ${SHED_REPLAY.join(', ')}`,
      definition: 'regex definition; sign-off is w9ak-ipjd signoff_date; the shed life is a Kaplan-Meier median',
    },
    {
      claim:
        `Today ${fmt(U.open.num)} buildings have a cycle-10 report filed UNSAFE in the last 12 months and no ${PERMIT} issued since (nor in the six months before). ` +
        `They are not all untouched: ${fmt(U.facadeJobFiled.num)} already have a facade-related job application filed in DOB NOW, awaiting or beside its permit, ` +
        `and ${fmt(U.reportUnder180Days.num)} of the reports are under ${LOOKBACK} days old. ` +
        `${fmt(U.nothingFiled.num)} have nothing facade-related filed (${byCount(U.nothingFiledByBorough)}), ${fmt(U.nothingFiledReportUnder180Days.num)} of them reported under ${LOOKBACK} days ago ` +
        `and ${fmt(U.nothingFiledReportUnderJobFiling.num)} under ${JT.reportToJobFiledSigned.median} days, the median time from an UNSAFE report to the filing of its facade job. ` +
        (!openNow.register
          ? ''
          : openNow.register.noCycle10Filing.num === openNow.register.cards && !U.inRegister.num
            ? `None is on the register today, which is how it ranks rather than a guarantee: all ${fmt(openNow.register.cards)} of its cards are buildings with no cycle-10 filing, though a building whose cycle-9 report was SWARMP can still qualify with a fresh UNSAFE report.`
            : `${fmt(U.inRegister.num)} are on the register.`),
      value: fmt(U.nothingFiled.num),
      denominator: `${fmt(U.reports)} UNSAFE first reports`,
      window: U.open.window,
      definition: 'a window the register does not read as a signal today: a fresh cycle-10 UNSAFE report with no facade-related permit issued and no facade-related job application filed from 180 days before the report',
    },
  ];

  const nonClaims = [
    {
      claim: "The register's facade score puts the buyers on top.",
      holds: tierGap.every((g) => g >= 3) && drawGap.every((g) => g.median >= 3),
      evidence:
        `Replayed without the points it cannot see on a past date, the score ties at its maximum for ${replays.map((r) => fmt(r.ranking.shownWithRandomTies.tiedAtTop)).join(' / ')} buildings. ` +
        'Facade-related permit within 24 months, the whole top tier against the rest of the flagged pool: ' +
        replays.map((r, i) => `${r.at} ${r.ranking.topTier.top.within24.value}% vs ${r.ranking.topTier.rest.within24.value}% (${signed1(tierGap[i])} pts)`).join('; ') +
        (mixedTiers.length
          ? `. The register breaks that tie by months left, most overdue first, and inside the top tier ${overdueWorse ? 'the overdue buildings convert worse' : 'conversion by months left is'}: ` +
            mixedTiers.map((r) => `${r.at} ${r.ranking.topTier.byMonthsLeft.map((o) => `${o.monthsLeft} months: ${o.within24.value}%`).join(', ')}`).join('; ')
          : '') +
        `. So the ${CEILING} it would show, remaining ties drawn at random ${DRAWS} times, against the rest of the pool: median ` +
        drawGap.map((g) => signed1(g.median)).join(' / ') +
        ' pts (5th–95th percentile ' +
        drawGap.map((g) => `${signed1(g.p5)} to ${signed1(g.p95)}`).join(' / ') +
        `). Conversion ${rising ? 'rises' : 'does not rise steadily'} with the score: ` +
        replays
          .map((r) => {
            const t = Object.entries(r.ranking.byScore).sort(([x], [y]) => Number(x) - Number(y));
            const low = t.reduce((m, x) => (x[1].within24.value < m[1].within24.value ? x : m));
            return `${r.at} score ${t.map(([sc, o]) => `${sc}: ${o.within24.value}%`).join(', ')} (lowest: ${low[0]})`;
          })
          .join('; ') +
        `. Fair statement: ${tierAgainstRest}, conversion ${rising ? 'rises' : 'does not rise steadily'} with the score, and the ${CEILING} the register would show, most overdue first, did ${shownAgainstRest}.`,
      rule: 'counted as holding only if the top score tier, and the median random draw of the 800 shown, both beat the rest of the flagged pool by at least 3 percentage points at every replay date',
    },
    {
      claim: 'UNSAFE_PRIOR buildings (UNSAFE last cycle, nothing filed this cycle) buy more than the unflagged baseline.',
      holds: vsBase('UNSAFE_PRIOR').every((x) => x.gap > 0),
      evidence: 'Against the NOT_FLAGGED baseline: ' + vsBase('UNSAFE_PRIOR').map((x) => `${x.at} ${x.v}% vs ${x.b}% (${signed1(x.gap)} pts)`).join('; ') + '.',
      rule: 'holds only if above the baseline at every replay date',
    },
    {
      claim: 'CHRONIC_NON_FILER buildings (no report last cycle, nothing this cycle) buy more than the unflagged baseline.',
      holds: vsBase('CHRONIC_NON_FILER').every((x) => x.gap > 0),
      evidence: 'Against the NOT_FLAGGED baseline: ' + vsBase('CHRONIC_NON_FILER').map((x) => `${x.at} ${x.v}% vs ${x.b}% (${signed1(x.gap)} pts)`).join('; ') + '.',
      rule: 'holds only if above the baseline at every replay date',
    },
    {
      claim: 'A long-standing shed with no facade permit (SHED_NO_REPAIR) is the best facade lead.',
      holds: sr.every((g) => g.SHED_NO_REPAIR.within24.value >= g.NEW_NO_REPAIR.within24.value),
      evidence:
        sr
          .map((g, i) => `${SHED_REPLAY[i]}: ${g.SHED_NO_REPAIR.within24.value}% within 24 months vs ${g.NEW_NO_REPAIR.within24.value}% for a shed under a year old with no such permit before it (${g.NEW_ANY.within24.value}% for every shed under a year old)`)
          .join('; ') +
        (sr.every((g) => g.SHED_NO_REPAIR.within24.value < g.NEW_NO_REPAIR.within24.value)
          ? '. Like for like, the long-standing shed converts worse at every replay date: it reads more like a stuck owner than a ready buyer.'
          : sr.every((g) => g.SHED_NO_REPAIR.within24.value >= g.NEW_NO_REPAIR.within24.value)
            ? '. Like for like, the long-standing shed converts at least as well at every replay date.'
            : '. Like for like, the long-standing shed converts worse at some replay dates and not at others.'),
      rule: 'holds only if it converts at least as well as a new shed with no prior facade permit at every replay date',
    },
    {
      claim: "The UNSAFE buildings' lift over SAFE ones shows that the record predicts a purchase.",
      holds: false,
      evidence:
        `The lift (${R.liftUnsafeOverSafe.within24}x at 24 months, ${R.liftUnsafeOverSafe.within12}x at 12, regex definition) restates the law: an UNSAFE report obliges a repair and a SAFE one does not. ` +
        'What the record adds is timing and size, not foresight.',
    },
    {
      claim: 'A fresh UNSAFE building with no facade permit is an untouched lead.',
      holds: false,
      evidence:
        `Of ${fmt(U.open.num)} such buildings, ${fmt(U.facadeJobFiled.num)} (${U.facadeJobFiled.value}%) already have a facade-related job application filed in DOB NOW and ${fmt(U.shedJobFiled.num)} a shed job; ` +
        `${fmt(U.reportUnder180Days.num)} reports are under ${LOOKBACK} days old. A permit trails the job filing by months (a median ${JT.jobFiledToPermit.median} days in the UNSAFE cohort), so "no permit" is an upper bound on the open leads.`,
    },
    {
      claim: 'A facade permit is a signed contract, and its declared cost is the contract value.',
      holds: false,
      evidence:
        `A permit is the lagging public trace of a hired contractor: in the UNSAFE cohort the job was filed a median ${JT.jobFiledToPermit.median} days before its permit issued. ` +
        "The cost is the applicant's own estimate for the whole job on the permit application.",
    },
    {
      claim: 'Venue openings (SLA licences, DOHMH) or City Record award timing are backtested here.',
      holds: false,
      evidence: 'This script measures facades and sheds only. A pending liquor application has no key to the licence it becomes, so its lag can only be logged going forward; make no timing claim for venues or awards from this file.',
    },
  ];

  const caveats = [
    `The outcome is a facade-related GC permit in DOB NOW, not necessarily a repair: any General Construction Initial Permit whose work location says Facade or whose description names a facade word. It includes mixed-scope and non-repair jobs that mention a facade, and misses repairs filed under suspended-scaffold or shed jobs, work filed in BIS, and minor work pulled with no GC permit. Every UNSAFE building must repair, yet only ${R.UNSAFE.within24.value}% show such a permit within 24 months: the measure undercounts, some repairs slip past two years, and some buildings have not repaired yet. The record cannot tell these apart.`,
    `A permit is a lagging proxy for a purchase: it shows a licensed contractor was hired, not when or for how much. In the UNSAFE cohort the job was filed a median ${JT.reportToJobFiledSigned.median} days after the report and ${JT.jobFiledBeforeReport.value}% before it, so the report-to-permit lag (${R.UNSAFE.lagDays.median} days) overstates the selling window. The declared cost is the applicant's estimate for the whole job.`,
    'The UNSAFE-over-SAFE lift is what the law requires, not a prediction: SAFE buildings are a comparison group, not a control.',
    'DOB NOW General Construction permits begin 2020-12-27; work permitted in the older BIS system before that is invisible, which is why every look-back starts in 2021-08 or later.',
    // A hand check from an earlier run, on a cohort drawn slightly differently:
    // this script reads no lot numbers, so it cannot redo the BBL join, and the
    // caveat says so instead of passing its figures off as this run's.
    'Outcomes join on BIN. An earlier hand check, on a slightly different UNSAFE cohort than the one counted here (81 of its 2,543 buildings), found that joining on BBL as well would add about 3 percentage points. This script does not re-derive it and leaves the BBL join out, so the conversion shares are slightly low rather than high.',
    `The regex definition is narrower than the collector's own PERMIT_RE (no masonry, brick or waterproofing); the work_on_floor definition is narrower still. Both are reported and the claims quote the range.`,
    'A job is its base number: its -I1 and -S# filings are one job, dated by its earliest permit. For the cohorts that is the right unit (a -S# filing on a job filed before the report is not a new purchase); for the open windows today every filing counts, because the question there is whether anybody is on site.',
    'A share of UNSAFE buildings already had a facade-related permit in the 180 days before the report (alreadyBefore); they are kept in the denominator, and their later permits are new jobs.',
    'Market concentration is given by job count and by declared cost: by cost the largest firms hold a larger share than by count, and both views belong in any claim about how split the market is.',
    `The engineering firm count depends on how names are folded (${fmt(Math.min(...firmRange))}–${fmt(Math.max(...firmRange))} across the folds in engineers.marketByFold); the top-10 share barely moves.`,
    'The replays use each filing\'s own filing_status as of its date, not current_status. The register\'s enrichment points (ECB, HPD, deeds, sheds, fines) cannot be replayed as they stood on a past date, so the ranking test uses the facade score alone, and without them the score ties at its maximum for thousands of buildings: the 800 the register would show are judged with the tie drawn at random, never by the dataset\'s row order. Cycle-9 auto-generated "No Report Filed" rows carry no date, so the replay cannot tell when one appeared and ignores them; the collector, reading them today, stops calling a building a NON_FILER once one does. Cycle 8 was closed by every replay date, so its auto-generated rows are read as they stand (CHRONIC_NON_FILER).',
    `The unflagged baseline includes buildings that filed this cycle and came back UNSAFE (NOT_FLAGGED_FILED_UNSAFE, ${range(replays.map((r) => r.groups.NOT_FLAGGED_FILED_UNSAFE.within24.value))} within 24 months): the strongest buyers, and no register rule flags them.`,
    'Shed removal is the job\'s sign-off (Letter of Completion); a job never signed off is treated as standing, and its life is counted to the data date (Kaplan-Meier), not dropped. The shed replay reads shed permits live on the date, aged from the first permit of the live job; a permit\'s expired_date is the end of its term, not the day the shed came down, and a shed permit with no job number is left out because it cannot be joined to a sign-off.',
    'A facade-related permit "with" a shed is any such permit at the same building from 90 days before the shed went up to its sign-off; it is not linked to that shed.',
    'The shed replay is SHED_NO_REPAIR as it should read, not as the collector computes it today: the collector also counts scaffolds, dates a shed from the earliest job the building ever had (so a shed re-erected after a gap looks years old), and treats a wider set of permits (masonry, brick, waterproofing) or a filed job as "repair".',
    `Open windows (openNow) are a snapshot on ${iso(asOf)}. "Open" means no facade-related permit yet; the facade-related job applications already filed at those buildings, and the reports too young to show a permit, are counted beside it (facadeJobFiled, reportUnder180Days, nothingFiled).`,
    'The shed reads stop at the day after the last shed replay date, in the query itself: the row counts in sources are those of the cut, not of the whole datasets.',
    'Open data is revised: rerun `npm run backtest` before quoting a figure, and quote it with the dataset loads in `sources`.',
  ];

  const evidence = {
    generatedAt: new Date().toISOString(),
    asOf: iso(asOf),
    script: 'scripts/backtest.mjs',
    question: "When the public record says a building's facade window is open, does the building then buy the work?",
    sources: sourcesTable(),
    definitions: {
      facadePermit: { regex: DEFINITIONS.regex.text, workOnFloor: DEFINITIONS.workOnFloor.text },
      firstReport: "A building's earliest xubg-57si filing with filing_type 'Initial' and a filing_date in the cycle; its filing_status is the report's status.",
      subCycle9: SUB9.map(({ sub, digits, opens, deadline }) => ({ sub, blockLastDigit: digits.split(''), opens, deadline })),
      months: { 6: `${M6} days`, 12: `${M12} days`, 24: `${M24} days` },
    },
    headline,
    facades: { cohorts, jobTiming, market },
    engineers: { nonFilers: vintages, market: qewiMarket, marketByFold: qewiByFold },
    replay: replays,
    sheds: { cohort: shedCohort, replay: shedReplay },
    openNow,
    nonClaims,
    caveats,
  };
  writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`\nWrote data/evidence.json (data through ${iso(asOf)})`);
  for (const h of headline) console.log(`- ${h.claim}`);
  for (const n of nonClaims) console.log(`${n.holds ? 'HOLDS' : 'does not hold'}: ${n.claim}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
