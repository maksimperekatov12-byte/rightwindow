// Collect: NYC FISP facade filings + HPD contacts -> src/data/feed.json
// Sources (all NYC Open Data, no restrictions on use):
//   xubg-57si  DOB NOW Facades Compliance Filings (updated every business day)
//   tesw-yqqr  HPD Multiple Dwelling Registrations
//   feu5-w2e2  HPD Registration Contacts
// Signal logic (FISP Cycle 10, sub-cycle by last digit of tax block):
//   A: 4,5,6,9 -> file by 2027-02-21   B: 0,7,8 -> 2028-02-21   C: 1,2,3 -> 2029-02-21
// Deviations we sell: non-filer inside an open window, SWARMP carried from Cycle 9,
// UNSAFE and chronic no-report. Calendar itself is not a signal - everyone knows it.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { enrichContact, enrichmentProvider, enrichmentReady, pullCache, pushCache } from '../lib/enrich.mjs';
import { assertCollectable } from '../lib/policy.mjs';
import { resolveAffiliates } from '../lib/affiliate.mjs';

// Source gate (same rule as Signal): a source without an ALLOWED verdict in
// data/source-policy.json does not get fetched. web-ACRIS is DENIED by the city's
// own Bandwidth Policy — real-time deeds are the City Register's paid feed, not a scrape.
assertCollectable('data.cityofnewyork.us');
assertCollectable('data.ny.gov');
console.log('Source gate: data.cityofnewyork.us ALLOWED, data.ny.gov ALLOWED, a836-acris.nyc.gov DENIED (robots prohibited by city policy)');

const BASE = 'https://data.cityofnewyork.us/resource';
const TODAY = new Date();

async function getJson(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw lastErr;
}

async function fetchAll(dataset, params, pageSize = 50000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    // Paging without $order can skip or repeat rows between requests, and a
    // dropped filing turns a compliant building into a false lead.
    const qs = new URLSearchParams({ $order: ':id', ...params, $limit: String(pageSize), $offset: String(offset) });
    const page = await getJson(`${BASE}/${dataset}.json?${qs}`);
    rows.push(...page);
    process.stdout.write(`  ${dataset}: ${rows.length}\r`);
    if (page.length < pageSize) break;
  }
  console.log(`  ${dataset}: ${rows.length} rows`);
  return rows;
}

function prevFeed() {
  try {
    return JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
  } catch {
    return null;
  }
}

function subCycle(block) {
  const d = String(block || '').trim().slice(-1);
  if ('4569'.includes(d)) return { sub: '10A', deadline: '2027-02-21', opens: '2025-02-21' };
  if ('078'.includes(d)) return { sub: '10B', deadline: '2028-02-21', opens: '2026-02-21' };
  if ('123'.includes(d)) return { sub: '10C', deadline: '2029-02-21', opens: '2027-02-21' };
  return null;
}

function parseYmd(v) {
  if (!v) return null;
  const m = String(v).trim();
  if (/^\d{8}$/.test(m)) return new Date(`${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}`);
  const d = new Date(m);
  return isNaN(d) ? null : d;
}

function monthsUntil(dateStr) {
  return Math.round((new Date(dateStr) - TODAY) / (30.44 * 24 * 3600 * 1000));
}

console.log('Fetching facade filings (cycles 9 and 10)...');
const filings = await fetchAll('xubg-57si', {
  $where: "cycle in('9','10')",
  $select: 'tr6_no,cycle,bin,house_no,street_name,borough,block,lot,current_status,filing_status,submitted_on,filing_date,qewi_name,qewi_bus_name,owner_name,owner_bus_name,late_filing_amt,failure_to_file_amt,failure_to_correct_amt',
});

// Latest filing per bin per cycle
const byBin = new Map();
for (const f of filings) {
  if (!f.bin) continue;
  const rec = byBin.get(f.bin) || { c9: null, c10: null };
  const slot = f.cycle === '9' ? 'c9' : 'c10';
  const cur = rec[slot];
  if (!cur || (f.submitted_on || '') > (cur.submitted_on || '')) rec[slot] = f;
  byBin.set(f.bin, rec);
}
console.log(`Buildings with cycle 9/10 history: ${byBin.size}`);

// Build candidate signals
const candidates = [];
for (const [bin, { c9, c10 }] of byBin) {
  const src = c10 || c9;
  if (!src) continue;
  const boro = (src.borough || '').trim();
  if (!['Manhattan', 'Brooklyn', 'Queens', 'Bronx'].includes(boro)) continue;
  const sc = subCycle(src.block);
  if (!sc) continue;
  const windowOpen = sc.opens <= TODAY.toISOString().slice(0, 10);
  const mLeft = monthsUntil(sc.deadline);
  const signals = [];

  if (!c10 && windowOpen) {
    signals.push({
      kind: 'NON_FILER',
      urgency: mLeft <= 7 ? 3 : mLeft <= 18 ? 2 : 1,
      monthsLeft: mLeft,
    });
  }
  if (c9 && (c9.current_status || '') === 'SWARMP' && (!c10 || (c10.current_status || '') !== 'SAFE')) {
    signals.push({ kind: 'SWARMP_CARRYOVER', urgency: mLeft <= 7 ? 3 : 2, monthsLeft: mLeft });
  }
  if (c9 && (c9.current_status || '') === 'UNSAFE' && !c10) {
    signals.push({ kind: 'UNSAFE_PRIOR', urgency: 3, monthsLeft: mLeft });
  }
  if (c9 && (c9.current_status || '') === 'No Report Filed' && !c10) {
    signals.push({ kind: 'CHRONIC_NON_FILER', urgency: 2, monthsLeft: mLeft });
  }
  if (!signals.length) continue;

  const finesOwed =
    Number(c9?.late_filing_amt || 0) + Number(c9?.failure_to_file_amt || 0) + Number(c9?.failure_to_correct_amt || 0);

  candidates.push({
    bin,
    address: `${(src.house_no || '').trim()} ${(src.street_name || '').trim()}`.trim(),
    borough: boro,
    block: src.block,
    lot: src.lot,
    subCycle: sc.sub,
    deadline: sc.deadline,
    monthsLeft: mLeft,
    signals,
    score: signals.reduce((s, x) => s + x.urgency, 0) + (finesOwed > 0 ? 1 : 0),
    lastStatus: (c10 || c9).current_status || '',
    lastCycle: c10 ? '10' : '9',
    lastFiling: (c10 || c9).submitted_on?.slice(0, 10) || null,
    priorQewi: c9?.qewi_bus_name || c9?.qewi_name || null,
    owner: c9?.owner_bus_name || c9?.owner_name || c10?.owner_bus_name || null,
    finesOwed,
  });
}
console.log(`Candidates (MN+BK+QN+BX): ${candidates.length}`);
candidates.sort((a, b) => b.score - a.score || a.monthsLeft - b.monthsLeft);

// Take the best of each borough rather than the best overall.
//
// The register is genuinely Manhattan-heavy — FISP covers buildings over six
// storeys, and Manhattan has 50,702 of the 86,234 — so a pure score ordering
// gave Manhattan 206 of 400 while three adjacent Brooklyn ZIPs held two
// buildings between them. That is fine as a ranking and useless as a product:
// territory is sold per borough, so each borough needs enough depth to be worth
// working. A borough that cannot fill its quota gives the remainder back to the
// others, so nothing is wasted holding a seat empty.
function balancedByBorough(rows, total) {
  const boroughs = [...new Set(rows.map((r) => r.borough))].filter(Boolean);
  if (!boroughs.length) return rows.slice(0, total);
  const pools = new Map(boroughs.map((b) => [b, rows.filter((r) => r.borough === b)]));
  const picked = [];
  const taken = new Map(boroughs.map((b) => [b, 0]));
  // Deal one at a time so an under-filled borough releases its share as we go.
  let progress = true;
  while (picked.length < total && progress) {
    progress = false;
    for (const b of boroughs) {
      if (picked.length >= total) break;
      const pool = pools.get(b);
      const i = taken.get(b);
      if (i >= pool.length) continue;
      picked.push(pool[i]);
      taken.set(b, i + 1);
      progress = true;
    }
  }
  return picked;
}

// HPD join: registrations by BIN for the top slice, then agents by registrationid.
// Balanced here too, not only at the feed cut: contacts and violations are only
// fetched for this shortlist, so a borough missing from it can never appear.
const top = balancedByBorough(candidates, 600);
console.log('Fetching HPD registrations for top candidates...');
const regByBin = new Map();
for (let i = 0; i < top.length; i += 50) {
  const bins = top.slice(i, i + 50).map((c) => `'${c.bin}'`).join(',');
  const rows = await fetchAll('tesw-yqqr', { $where: `bin in(${bins})`, $select: 'bin,registrationid,lastregistrationdate,zip' }, 1000);
  for (const r of rows) {
    const cur = regByBin.get(r.bin);
    if (!cur || (r.lastregistrationdate || '') > (cur.lastregistrationdate || '')) regByBin.set(r.bin, r);
  }
}
console.log(`HPD-registered (multifamily): ${regByBin.size}`);

const regIds = [...new Set([...regByBin.values()].map((r) => r.registrationid))];
const agentByReg = new Map();
const headByReg = new Map();
for (let i = 0; i < regIds.length; i += 50) {
  const ids = regIds.slice(i, i + 50).map((x) => `'${x}'`).join(',');
  const rows = await fetchAll(
    'feu5-w2e2',
    { $where: `registrationid in(${ids}) and type in('Agent','SiteManager','HeadOfficer')`, $select: 'registrationid,type,corporationname,firstname,lastname,businesshousenumber,businessstreetname,businessapartment,businesscity,businessstate,businesszip' },
    2000,
  );
  for (const r of rows) {
    if (r.type === 'HeadOfficer') {
      const who = [r.firstname, r.lastname].filter(Boolean).join(' ').trim();
      if (who) headByReg.set(r.registrationid, who.toUpperCase());
      continue;
    }
    const cur = agentByReg.get(r.registrationid);
    if (!cur || (r.type === 'Agent' && cur.type !== 'Agent')) agentByReg.set(r.registrationid, r);
  }
}
console.log(`Agents resolved: ${agentByReg.size}`);

// Business days to a date, so a hearing three weeks out scores like the
// deadline it is rather than like a calendar distance.
function businessDaysTo(d) {
  let n = 0;
  const cur = new Date(TODAY);
  const end = new Date(d);
  while (cur < end && n < 400) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

// ECB violations for candidate bins: fresh hazardous events + open penalty balances + next hearings
console.log('Fetching ECB violations for top candidates...');
const ecbByBin = new Map();
for (let i = 0; i < top.length; i += 50) {
  const bins = top.slice(i, i + 50).map((c) => `'${c.bin}'`).join(',');
  const rows = await fetchAll(
    '6bgk-3dad',
    { $where: `bin in(${bins}) and ecb_violation_status='ACTIVE'`, $select: 'bin,issue_date,severity,violation_description,balance_due,hearing_date,hearing_status' },
    5000,
  );
  for (const r of rows) {
    const agg = ecbByBin.get(r.bin) || { balance: 0, fresh: null, nextHearing: null };
    agg.balance += Number(r.balance_due || 0);
    const d = parseYmd(r.issue_date);
    if (d) {
      const daysAgo = Math.round((TODAY - d) / 86400000);
      const sev = (r.severity || '').trim();
      const hazardous = /\bCLASS\s*-?\s*1\b/i.test(sev) || /^hazardous$/i.test(sev);
      if (daysAgo >= 0 && daysAgo <= 120 && (!agg.fresh || (hazardous && !agg.fresh.hazardous) || daysAgo < agg.fresh.daysAgo)) {
        agg.fresh = { daysAgo, hazardous, severity: sev, desc: (r.violation_description || '').replace(/\s+/g, ' ').slice(0, 150).trim() };
      }
    }
    // Only a hearing still waiting to happen is a date somebody can be helped
    // with; a defaulted or decided one is a different, worse conversation.
    const pending = /pending|scheduled/i.test(r.hearing_status || '');
    const h = pending ? parseYmd(r.hearing_date) : null;
    if (h && h > TODAY && (!agg.nextHearing || h < agg.nextHearing)) agg.nextHearing = h;
    ecbByBin.set(r.bin, agg);
  }
}
console.log(`ECB data for ${ecbByBin.size} buildings`);

// Chain: ownership change (ACRIS). Monthly open-data batch lags ~2-4 weeks; a 90-day
// contract-review window survives that. Flip the join: recent DEEDs first, then legals by block.
console.log('Fetching recent ACRIS deeds...');
const deedSince = new Date(TODAY - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const recentDeeds = new Map();
{
  const rows = await fetchAll('bnx9-e6tj', {
    $where: `doc_type='DEED' and recorded_datetime>='${deedSince}T00:00:00'`,
    $select: 'document_id,recorded_datetime,document_amt',
  });
  for (const r of rows) recentDeeds.set(r.document_id, r);
}
const BOro = { Manhattan: 1, Bronx: 2, Brooklyn: 3, Queens: 4 };
const ownerByKey = new Map();
for (const [boroName, boroNum] of Object.entries(BOro)) {
  const blocks = [...new Set(top.filter((c) => c.borough === boroName).map((c) => parseInt(c.block, 10)).filter(Boolean))];
  for (let i = 0; i < blocks.length; i += 60) {
    const chunk = blocks.slice(i, i + 60).join(',');
    const rows = await fetchAll('8h5j-fqxa', { $where: `borough=${boroNum} and block in(${chunk})`, $select: 'document_id,block,lot' }, 50000);
    for (const r of rows) {
      const deed = recentDeeds.get(r.document_id);
      if (!deed) continue;
      const key = `${boroNum}-${parseInt(r.block, 10)}-${parseInt(r.lot, 10)}`;
      const cur = ownerByKey.get(key);
      if (!cur || deed.recorded_datetime > cur.recorded) {
        ownerByKey.set(key, { recorded: deed.recorded_datetime, amount: Number(deed.document_amt || 0) });
      }
    }
  }
}
console.log(`Ownership changes matched: ${ownerByKey.size} block-lots`);

// Chain: elevator compliance (CAT1 annual, CAT5 five-year) for candidate bins
console.log('Fetching elevator compliance...');
const elevByBin = new Map();
for (let i = 0; i < top.length; i += 50) {
  const bins = top.slice(i, i + 50).map((c) => `'${c.bin}'`).join(',');
  const rows = await fetchAll(
    'e5aq-a4j2',
    { $where: `bin in(${bins}) and device_status='Active'`, $select: 'bin,cat1_report_year,cat5_latest_report_filed' },
    5000,
  );
  for (const r of rows) {
    const agg = elevByBin.get(r.bin) || { devices: 0, cat1Missing: 0, cat1Overdue: 0, cat5Due: 0 };
    agg.devices += 1;
    const y = parseInt(r.cat1_report_year || '0', 10);
    if (y && y < TODAY.getFullYear()) agg.cat1Missing += 1;
    if (y && y < TODAY.getFullYear() - 1) agg.cat1Overdue += 1;
    const c5 = parseYmd(r.cat5_latest_report_filed);
    // Six months of lead time before the five-year mark: the useful moment to
    // call is before it lapses, not after. Named "due", never "overdue".
    if (c5 && TODAY - c5 > 4.5 * 365.25 * 24 * 3600 * 1000) agg.cat5Due += 1;
    elevByBin.set(r.bin, agg);
  }
}
console.log(`Elevator data for ${elevByBin.size} buildings`);

// Chain: active sidewalk sheds / scaffolds from DOB NOW approved permits.
// This is the credibility check: an UNSAFE facade almost always already has a shed
// and a contractor on site. Knowing that turns a dead lead into an honest one — and
// surfaces the real prize: a shed standing for a year with no repair filed.
console.log('Fetching active shed and scaffold permits...');
const todayIso = TODAY.toISOString().slice(0, 10);
const shedByBin = new Map();
for (let i = 0; i < top.length; i += 40) {
  const bins = top.slice(i, i + 40).map((c) => `'${c.bin}'`).join(',');
  const rows = await fetchAll(
    'rbx6-tga4',
    {
      $where: `bin in(${bins}) and work_type in('Sidewalk Shed','Suspended Scaffold','Supported Scaffold') and permit_status='Permit Issued'`,
      $select: 'bin,job_filing_number,work_type,issued_date,expired_date,applicant_business_name',
    },
    5000,
  );
  for (const r of rows) {
    const issued = parseYmd(r.issued_date);
    const expires = parseYmd(r.expired_date);
    if (!issued) continue;
    const cur = shedByBin.get(r.bin) || { jobs: new Map() };
    // A shed's age is measured from the first permit of its job number; renewals keep it.
    const j = cur.jobs.get(r.job_filing_number) || { first: issued, last: expires, type: r.work_type, who: r.applicant_business_name };
    if (issued < j.first) j.first = issued;
    if (expires && (!j.last || expires > j.last)) j.last = expires;
    cur.jobs.set(r.job_filing_number, j);
    shedByBin.set(r.bin, cur);
  }
}
console.log(`Shed permits for ${shedByBin.size} buildings`);

// Chain: facade work already filed (someone is on it) — DOB NOW job applications.
console.log('Fetching facade job filings...');
const FACADE_RE = /FACADE|FISP|LOCAL LAW 11|PARAPET|EXTERIOR WALL|POINTING|LINTEL/i;
const filingByBin = new Map();
for (let i = 0; i < top.length; i += 40) {
  const bins = top.slice(i, i + 40).map((c) => `'${c.bin}'`).join(',');
  const rows = await fetchAll(
    'w9ak-ipjd',
    {
      $where: `bin in(${bins}) and job_type='Alteration' and filing_status not in('Filing Withdrawn')`,
      $select: 'bin,job_filing_number,job_description,filing_status,filing_date,approved_date,first_permit_date,initial_cost,applicant_business_name,existing_height',
    },
    5000,
  );
  for (const r of rows) {
    if (!FACADE_RE.test(r.job_description || '')) continue;
    const filed = parseYmd(r.filing_date);
    if (!filed || TODAY - filed > 730 * 86400000) continue;
    const cur = filingByBin.get(r.bin);
    if (!cur || filed > cur.filed) {
      filingByBin.set(r.bin, {
        filed,
        status: r.filing_status || null,
        approved: parseYmd(r.approved_date),
        permitted: Boolean(parseYmd(r.first_permit_date)),
        cost: Number(r.initial_cost || 0),
        who: r.applicant_business_name || null,
        height: Number(r.existing_height || 0),
      });
    }
  }
}
console.log(`Facade filings for ${filingByBin.size} buildings`);

// HPD registration change watcher: the registration dataset updates daily, so a change
// in registrationid or managing-agent company is a days-fresh, fully-open proxy for a
// sale or management change — the legal alternative to scraping web-ACRIS.
const baselinePath = new URL('../data/hpd-baseline.json', import.meta.url);
// The diff only sees a change during the one run that catches it, and the very
// next run writes the new state into the baseline — so a management change
// detected at 3pm was gone by 4pm and reached nobody. The detections are logged
// and kept for the same 90 days the ACRIS deed signal uses, because that is how
// long a new agent is still rebuilding a vendor list.
const mgmtLogPath = new URL('../data/mgmt-changes.json', import.meta.url);
const MGMT_WINDOW_DAYS = 90;
let baseline = {};
try { if (existsSync(baselinePath)) baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch {}
let mgmtLog = {};
try { if (existsSync(mgmtLogPath)) mgmtLog = JSON.parse(readFileSync(mgmtLogPath, 'utf8')); } catch {}

let freshMgmt = 0;
const newBaseline = { ...baseline };
for (const c of top) {
  const reg = regByBin.get(c.bin);
  if (!reg) continue;
  const agent = agentByReg.get(reg.registrationid);
  const nowState = { registrationid: reg.registrationid, agentCompany: agent?.corporationname || null };
  const prev = baseline[c.bin];
  if (prev && (prev.registrationid !== nowState.registrationid || (prev.agentCompany || '') !== (nowState.agentCompany || ''))) {
    mgmtLog[c.bin] = {
      prevCompany: prev.agentCompany || null,
      newCompany: nowState.agentCompany || null,
      detected: TODAY.toISOString().slice(0, 10),
    };
    freshMgmt++;
  }
  newBaseline[c.bin] = nowState;
}
// Age the log out rather than letting it grow for ever.
for (const [bin, entry] of Object.entries(mgmtLog)) {
  const age = (TODAY - new Date(entry.detected)) / 86400000;
  if (!(age >= 0) || age > MGMT_WINDOW_DAYS) delete mgmtLog[bin];
}
const mgmtChangeByBin = new Map(Object.entries(mgmtLog));
console.log(
  `HPD watcher: baseline ${Object.keys(baseline).length} bins, ${freshMgmt} new this run, ` +
    `${mgmtChangeByBin.size} inside the ${MGMT_WINDOW_DAYS}-day window`,
);

const cards = [];
for (const c of top) {
  const reg = regByBin.get(c.bin);
  const agent = reg ? agentByReg.get(reg.registrationid) : null;
  const ecb = ecbByBin.get(c.bin);
  const ecbBalance = ecb ? Math.round(ecb.balance) : 0;
  const freshHaz = ecb?.fresh || null;

  const boroNum = { Manhattan: 1, Bronx: 2, Brooklyn: 3, Queens: 4 }[c.borough];
  const own = ownerByKey.get(`${boroNum}-${parseInt(c.block, 10)}-${parseInt(c.lot, 10)}`);
  const ownerChange = own
    ? { daysAgo: Math.round((TODAY - new Date(own.recorded)) / 86400000), amount: own.amount, recorded: own.recorded.slice(0, 10) }
    : null;

  const elev = elevByBin.get(c.bin);
  const elevator =
    elev && (elev.cat1Missing > 0 || elev.cat5Due > 0)
      ? { devices: elev.devices, cat1Missing: elev.cat1Missing, cat1Overdue: elev.cat1Overdue, cat5Due: elev.cat5Due }
      : null;

  // Occupancy: is someone already working on this facade?
  const sh = shedByBin.get(c.bin);
  let shed = null;
  if (sh && sh.jobs.size) {
    let first = null, last = null, type = null, who = null;
    for (const j of sh.jobs.values()) {
      if (!first || j.first < first) { first = j.first; type = j.type; who = j.who; }
      if (j.last && (!last || j.last > last)) last = j.last;
    }
    const ageDays = Math.round((TODAY - first) / 86400000);
    const active = last && last >= TODAY;
    shed = {
      state: active ? 'active' : 'lapsed',
      ageDays,
      since: first.toISOString().slice(0, 10),
      until: last ? last.toISOString().slice(0, 10) : null,
      type,
      who: who || null,
      longStanding: ageDays >= 365,
    };
  }

  const fl = filingByBin.get(c.bin);
  const filing = fl
    ? {
        filed: fl.filed.toISOString().slice(0, 10),
        daysSince: Math.round((TODAY - fl.filed) / 86400000),
        status: fl.status,
        permitted: fl.permitted,
        stalled: Boolean(fl.approved && !fl.permitted && TODAY - fl.approved > 70 * 86400000),
        cost: fl.cost > 50000 ? fl.cost : null,
        who: fl.who,
      }
    : null;
  const height = fl?.height > 0 ? fl.height : null;

  // The prize: a shed standing over a year with nobody filed to do the repair.
  const payingForNothing = Boolean(shed?.state === 'active' && shed.longStanding && !filing);
  const occupied = Boolean(filing?.permitted || (shed?.state === 'active' && !shed.longStanding && filing));

  const mgmtChange = mgmtChangeByBin.get(c.bin) || null;
  const signals = [...c.signals];
  if (mgmtChange) signals.push({ kind: 'NEW_MGMT', urgency: 3, monthsLeft: c.monthsLeft });
  if (ownerChange && ownerChange.daysAgo <= 180) signals.push({ kind: 'OWNER_CHANGE', urgency: 3, monthsLeft: c.monthsLeft });
  if (elevator) signals.push({ kind: 'ELEV_DUE', urgency: elevator.cat1Overdue > 0 ? 3 : 2, monthsLeft: c.monthsLeft });
  if (payingForNothing) signals.push({ kind: 'SHED_NO_REPAIR', urgency: 4, monthsLeft: c.monthsLeft });
  if (filing?.stalled) signals.push({ kind: 'FILING_STALLED', urgency: 3, monthsLeft: c.monthsLeft });

  const urgencyScore =
    c.score +
    (freshHaz ? (freshHaz.hazardous ? 5 : 3) - Math.min(3, Math.floor(freshHaz.daysAgo / 40)) : 0) +
    (mgmtChange ? 4 : 0) +
    (ownerChange && ownerChange.daysAgo <= 180 ? 4 - Math.min(2, Math.floor(ownerChange.daysAgo / 60)) : 0) +
    (elevator ? (elevator.cat1Overdue > 0 ? 3 : 2) : 0) +
    (payingForNothing ? 5 : 0) +
    (filing?.stalled ? 3 : 0) +
    (occupied ? -6 : 0) +
    // Scaled to the range this data actually occupies: median $4.9k, max $65k.
    Math.min(3, Math.floor(ecbBalance / 15000)) +
    // A hearing is a date somebody has to prepare for; the closer it is, the
    // more a code attorney or expeditor is worth to them today.
    (ecb?.nextHearing ? (businessDaysTo(ecb.nextHearing) <= 21 ? 3 : 1) : 0) +
    // A shed permit about to lapse forces a decision: renew, or finish the work.
    (shed?.until && new Date(shed.until) - TODAY < 60 * 86400000 ? 2 : 0) +
    (c.monthsLeft <= 7 ? 1 : 0);
  cards.push({
    ...c,
    signals,
    mgmtChange,
    ownerChange,
    elevator,
    shed,
    filing,
    height,
    occupied,
    payingForNothing,
    ecbBalance,
    freshHaz,
    nextHearing: ecb?.nextHearing ? ecb.nextHearing.toISOString().slice(0, 10) : null,
    urgencyScore,
    zip: (reg?.zip || '').trim().slice(0, 5) || null,
    multifamily: Boolean(reg),
    agent: agent
      ? {
          company: agent.corporationname || null,
          name: [agent.firstname, agent.lastname].filter(Boolean).join(' ') || null,
          role: agent.type === 'Agent' ? 'Managing agent (HPD registration)' : 'Site manager (HPD registration)',
          headOfficer: (reg && headByReg.get(reg.registrationid)) || null,
          address: [
            [agent.businesshousenumber, agent.businessstreetname].filter(Boolean).join(' '),
            agent.businessapartment,
            [agent.businesscity, agent.businessstate, agent.businesszip].filter(Boolean).join(' '),
          ]
            .filter(Boolean)
            .join(', ') || null,
        }
      : null,
  });
}

// Contact enrichment: stub by default, real provider behind env. Cached on disk,
// so a rebuild does not re-query. Never invents a number.
// Runs whether or not a live provider is configured: the cache holds numbers
// that a measured run already resolved, and those are as real as fresh ones.
{
  // CI has no cache on disk — it lives in the private store, so a run inherits
  // everything resolved before it and only pays for genuinely new companies.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { readJson } = await import('../lib/store.mjs');
      const got = await pullCache(readJson);
      console.log(`Contact cache: pulled ${got} entries from the private store`);
    } catch (e) {
      console.log(`Contact cache: could not pull (${e.message}) — starting from what is on disk`);
    }
  }
  const live = enrichmentReady();
  console.log(live ? `Enriching contacts via ${enrichmentProvider()}...` : 'Enrichment: reading cached contacts only');
  let hits = 0;
  const byLevel = { verified: 0, listed: 0 };
  for (const c of cards.slice(0, 400)) {
    if (!c.agent?.company) continue;
    const e = await enrichContact({ company: c.agent.company, name: c.agent.name, address: c.agent.address });
    if (e.confidence !== 'none') {
      c.agent.phone = e.phone;
      c.agent.email = e.email;
      c.agent.confidence = e.confidence;
      c.agent.contactSource = e.source;
      if (e.via) c.agent.via = e.via;
      byLevel[e.confidence] = (byLevel[e.confidence] || 0) + 1;
      hits++;
    }
  }
  console.log(`Contacts resolved: ${hits} (verified ${byLevel.verified || 0}, listed ${byLevel.listed || 0})`);
  // Second pass, free and offline: a holding LLC inherits the contact of the
  // firm whose head officer signs for both, labelled as reaching that firm.
  const viaHpd = resolveAffiliates(cards);
  console.log(`Affiliates resolved from HPD head officers: ${viaHpd}`);

  // Whatever the automatic passes could not reach becomes the queue for the
  // next deliberate sweep. New buildings arrive every hour with agents nobody
  // has looked up yet; without this the gap is invisible until someone opens a
  // card and finds no way to call.
  const unresolved = new Map();
  for (const c of cards.slice(0, 400)) {
    const a = c.agent;
    if (!a?.company || a.phone || a.email) continue;
    const k = a.company.toUpperCase().trim();
    const cur = unresolved.get(k) || { company: a.company, addr: a.address || '', headOfficer: a.headOfficer || null, cards: 0 };
    cur.cards++;
    unresolved.set(k, cur);
  }
  const queue = [...unresolved.values()].sort((x, y) => y.cards - x.cards);
  writeFileSync(new URL('../data/unresolved-contacts.json', import.meta.url), JSON.stringify(queue, null, 1));
  console.log(
    `Contacts still unresolved: ${queue.length} companies covering ${queue.reduce((n, x) => n + x.cards, 0)} cards ` +
      '(queued in data/unresolved-contacts.json)',
  );
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { writeJson } = await import('../lib/store.mjs');
      const n = await pushCache(writeJson);
      console.log(`Contact cache: pushed ${n} entries to the private store`);
    } catch (e) {
      console.log(`Contact cache: could not push (${e.message})`);
    }
  }
}


// Demo feed: most urgent first (post-enrichment), multifamily with a resolved contact
cards.sort((a, b) => b.urgencyScore - a.urgencyScore);
const eligible = cards.filter((c) => c.multifamily && c.agent);
const feed = balancedByBorough(eligible, 400);
// Within the feed, urgency still decides the order — the quota governs who is on
// the list, not who is at the top of it.
feed.sort((a, b) => b.urgencyScore - a.urgencyScore);
console.log('Chains in cards:', {
  ownerChange: cards.filter((c) => c.ownerChange).length,
  elevator: cards.filter((c) => c.elevator).length,
  shed: cards.filter((c) => c.shed).length,
});

// ---- Vertical 2: the City Record ----
//
// This used to read qyyg-4tf5, which is a saved Socrata filter over dg92-zbpx
// rather than a dataset of its own: both hold exactly the same 53,533 'Award'
// rows. Reading the parent costs the same request and adds the half of the
// register that is still open. An award is the moment an opportunity closed; a
// solicitation with a live due date is one that has not, and the city prints a
// named contracting officer with a phone and an email on the notice itself.
//
// dg92-zbpx is 1.1M rows, two thirds of them 'Changes in Personnel'. Never
// fetch it without a type and a date.
console.log('Fetching the City Record (awards, solicitations, intents)...');
const since = new Date(TODAY - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const openAfter = new Date(TODAY).toISOString().slice(0, 19);
const CROL = 'dg92-zbpx';
// The notice body is raw HTML, and 0x1a stands in for every apostrophe in it.
const plain = (html) =>
  String(html || '')
    .replace(/\u001a/g, "'")
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
let contracts = [];
try {
const awardsRaw = await fetchAll(CROL, {
  $where: `type_of_notice_description='Award' and start_date>='${since}'`,
  $order: 'start_date DESC',
  $select: 'request_id,start_date,agency_name,short_title,category_description,contract_amount,vendor_name,vendor_address,selection_method_description',
}, 2000);
// The trade filters run downstream of this cap, so a plain top-20 starves the
// construction trades: only 9 of the 141 awards in a 14-day window are construction.
// Take the most recent 20, then top up with every construction award in the window.
const CONSTR_CAT = /construction|architect|engineer/i;
const eligible = awardsRaw.filter((a) => Number(a.contract_amount) >= 100000 && a.vendor_name);
const keptAwards = new Map();
for (const a of [...eligible.slice(0, 20), ...eligible.filter((a) => CONSTR_CAT.test(a.category_description || ''))])
  keptAwards.set(a.request_id, a);
const awards = [...keptAwards.values()]
  .map((a) => ({
    id: a.request_id,
    kind: 'AWARD',
    vendor: a.vendor_name,
    vendorAddress: a.vendor_address || null,
    agency: a.agency_name,
    amount: Number(a.contract_amount),
    title: a.short_title,
    category: a.category_description,
    method: a.selection_method_description,
    date: a.start_date?.slice(0, 10),
    daysAgo: a.start_date ? Math.max(0, Math.round((TODAY - new Date(a.start_date)) / 86400000)) : null,
  }))
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.amount - a.amount);

// Open windows. The contact printed here is the officer the city names on the
// notice so that bidders can call them — republishing it is what the notice is
// for, which is why it is not treated like the managing-agent contacts the
// public feed redacts.
const openNotice = async (type, kind, limit) => {
  const rows = await fetchAll(CROL, {
    $where: `type_of_notice_description='${type}' and due_date > '${openAfter}'`,
    $order: 'due_date',
    $select:
      'request_id,start_date,due_date,agency_name,short_title,category_description,' +
      'selection_method_description,pin,address_to_request,contact_name,contact_phone,email,additional_description_1',
  }, 2000);
  return rows.slice(0, limit).map((r) => {
    const scope = plain(r.additional_description_1);
    return {
      id: r.request_id,
      kind,
      agency: r.agency_name,
      title: r.short_title,
      category: r.category_description,
      method: r.selection_method_description,
      date: r.start_date?.slice(0, 10),
      dueDate: r.due_date || null,
      daysLeft: r.due_date ? businessDaysTo(r.due_date.slice(0, 10)) : null,
      epin: r.pin || null,
      submitTo: r.address_to_request || null,
      scope: scope ? scope.slice(0, 300) : null,
      contact: {
        name: r.contact_name || null,
        phone: r.contact_phone || null,
        email: r.email || null,
      },
    };
  });
};
const [solicitations, intents] = await Promise.all([
  openNotice('Solicitation', 'SOLICITATION', 120),
  openNotice('Intent to Award', 'INTENT', 20),
]);
// Open windows lead, soonest deadline first; the awards that already landed
// follow. A closed opportunity should never outrank one that is still open.
contracts = [
  ...[...solicitations, ...intents].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')),
  ...awards,
];
console.log(
  `City Record: ${solicitations.length} open solicitations, ${intents.length} intents, ${awards.length} awards`,
);
} catch (e) {
  console.log(`City Record unavailable (${e.message}) — keeping previous data`);
  contracts = prevFeed()?.contracts || [];
}

// ---- Vertical 3: pending liquor licenses (venues opening in 2-4 months) ----
console.log('Fetching SLA pending licenses (NYC counties)...');
let openings = [];
try {
const qs = new URLSearchParams({
  $where: `premises_county in('Kings','Queens','New York','Bronx','Richmond') and status='Under Review' and received_date >= '${new Date(TODAY - 150 * 86400000).toISOString().slice(0, 10)}'`,
  $order: 'received_date DESC',
  $limit: '60',
  $select: 'application_id,premises_county,description,legalname,dba,actual_address_of_premises,city,zip_code,received_date',
});
const slaRaw = await getJson(`https://data.ny.gov/resource/f8i8-k2gm.json?${qs}`);
openings = slaRaw.slice(0, 40).map((o) => ({
  id: o.application_id,
  name: o.dba || o.legalname,
  legal: o.legalname,
  kind: o.description,
  address: `${o.actual_address_of_premises || ''}, ${o.city || ''}`.trim(),
  county: o.premises_county,
  received: o.received_date?.slice(0, 10),
  daysAgo: o.received_date ? Math.max(0, Math.round((TODAY - new Date(o.received_date)) / 86400000)) : null,
}));
} catch (e) {
  console.log(`SLA unavailable (${e.message}) — keeping previous data`);
  openings = prevFeed()?.openings || [];
}

// "What's new": monotonic memory of everything the engine has ever surfaced.
// First run writes a baseline (nothing is marked new); later runs stamp first-seen
// timestamps, so the feed can honestly say what appeared in the last 48 hours.
const NEW_WINDOW_MS = 48 * 3600 * 1000;
const seenPath = new URL('../data/seen.json', import.meta.url);
let seen = null;
try { if (existsSync(seenPath)) seen = JSON.parse(readFileSync(seenPath, 'utf8')); } catch {}
const baselineDone = Boolean(seen);
if (!seen) seen = { bins: {}, contracts: {}, openings: {} };
const nowIso = TODAY.toISOString();
const stamp = () => (baselineDone ? nowIso : 'baseline');
const isFreshTs = (ts) => Boolean(ts) && ts !== 'baseline' && TODAY - new Date(ts) <= NEW_WINDOW_MS;

for (const c of cards) {
  const rec = (seen.bins[c.bin] ||= { first: stamp(), kinds: {} });
  for (const sg of c.signals) rec.kinds[sg.kind] ||= stamp();
  c.isNew = isFreshTs(rec.first);
  c.fresh = c.isNew ? [] : c.signals.map((sg) => sg.kind).filter((k) => isFreshTs(rec.kinds[k]));
}
for (const c of contracts) {
  seen.contracts[c.id] ||= stamp();
  c.isNew = isFreshTs(seen.contracts[c.id]);
}
for (const o of openings) {
  seen.openings[o.id] ||= stamp();
  o.isNew = isFreshTs(seen.openings[o.id]);
}
writeFileSync(seenPath, JSON.stringify(seen, null, 1));
const whatsNew = {
  windowHours: 48,
  buildings: feed.filter((c) => c.isNew).length,
  signals: feed.reduce((n, c) => n + (c.fresh?.length || 0), 0),
  contracts: contracts.filter((c) => c.isNew).length,
  openings: openings.filter((o) => o.isNew).length,
};
console.log("What's new (48h):", whatsNew);

// Real per-source freshness, shown in the UI instead of promises.
async function sourceMeta(id, host = 'data.cityofnewyork.us') {
  try {
    const r = await getJson(`https://${host}/api/views/${id}.json`);
    return new Date(r.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}
const acrisThrough = [...recentDeeds.values()].reduce((m, r) => (r.recorded_datetime > m ? r.recorded_datetime : m), '').slice(0, 10) || null;
const sources = {
  facades: await sourceMeta('xubg-57si'),
  hpd: await sourceMeta('tesw-yqqr'),
  ecb: await sourceMeta('6bgk-3dad'),
  elevators: await sourceMeta('e5aq-a4j2'),
  permits: await sourceMeta('rbx6-tga4'),
  jobs: await sourceMeta('w9ak-ipjd'),
  awards: await sourceMeta(CROL),
  sla: await sourceMeta('f8i8-k2gm', 'data.ny.gov'),
  acrisThrough,
};
console.log('Source freshness:', sources);

const out = {
  generatedAt: TODAY.toISOString(),
  sources,
  whatsNew,
  facades: {
    totals: {
      candidates: candidates.length,
      nonFilers10A: candidates.filter((c) => c.subCycle === '10A' && c.signals.some((s) => s.kind === 'NON_FILER')).length,
      swarmpCarryover: candidates.filter((c) => c.signals.some((s) => s.kind === 'SWARMP_CARRYOVER')).length,
      unsafePrior: candidates.filter((c) => c.signals.some((s) => s.kind === 'UNSAFE_PRIOR')).length,
    },
    feed,
  },
  contracts,
  openings,
};
// feed.json is committed hourly to a PUBLIC repo. Provider-licensed phones and
// emails must not ride along in it: the card keeps the contact's name, company
// and confidence level, and the number itself is only written when the operator
// has explicitly opted in for a private deployment.
// feed.json is committed hourly to a repo that is public so Actions minutes are
// free. Two kinds of thing must not ride along in it:
//
//  - provider-licensed phones and emails, which almost every enrichment ToS
//    forbids redistributing;
//  - the names of the individual people on HPD registrations. Those filings are
//    public record, but the site tells visitors "buildings, not people", and a
//    git repo mirrors and indexes them in a way the city's own portal does not.
//
// Both stay in the pipeline and reach the private serving path; only the
// committed artefact is redacted. PUBLISH_CONTACTS=1 opts a private deployment
// back in.
const PUBLISH_CONTACTS = process.env.PUBLISH_CONTACTS === '1';
if (!PUBLISH_CONTACTS) {
  let contacts = 0;
  let names = 0;
  for (const c of out.facades.feed) {
    if (!c.agent) continue;
    if (c.agent.phone || c.agent.email) contacts++;
    if (c.agent.name) names++;
    // Keep the shape the card renders against, so a redacted feed still shows
    // which contacts exist rather than pretending there are none.
    c.agent.contactKnown = Boolean(c.agent.phone || c.agent.email);
    c.agent.namedContact = Boolean(c.agent.name);
    delete c.agent.phone;
    delete c.agent.email;
    delete c.agent.name;
    // Used by the affiliate pass above, which has already run. It is a person's
    // name on a city filing and has no business in a public repo.
    delete c.agent.headOfficer;
  }
  console.log(
    `Public feed redacted: ${contacts} contacts and ${names} personal names withheld ` +
      '(set PUBLISH_CONTACTS=1 for a private deployment)',
  );
}
writeFileSync(new URL('../src/data/feed.json', import.meta.url), JSON.stringify(out, null, 1));
// The HPD baseline advances only once the feed it produced is safely on disk:
// committing a moved baseline against a stale feed loses those management
// changes permanently, because the "previous" state has already passed them.
writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 1));
writeFileSync(mgmtLogPath, JSON.stringify(mgmtLog, null, 1));
console.log(`Written: facades ${feed.length}, contracts ${contracts.length}, openings ${openings.length}. Totals:`, out.facades.totals);
