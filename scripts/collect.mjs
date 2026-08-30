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
// Who to call for a list of buildings: the current HPD registration, then the
// managing agent on it. Two registers need this now, so it lives in one place.
async function hpdJoin(binList) {
  const regByBin = new Map();
  for (let i = 0; i < binList.length; i += 50) {
    const bins = binList.slice(i, i + 50).map((b) => `'${b}'`).join(',');
    const rows = await fetchAll('tesw-yqqr', { $where: `bin in(${bins})`, $select: 'bin,registrationid,lastregistrationdate,zip' }, 1000);
    for (const r of rows) {
      const cur = regByBin.get(r.bin);
      if (!cur || (r.lastregistrationdate || '') > (cur.lastregistrationdate || '')) regByBin.set(r.bin, r);
    }
  }
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
  return { regByBin, agentByReg, headByReg };
}

// The shape a card renders a contact against, built from an HPD agent row.
const agentCard = (agent, reg, headByReg) =>
  agent
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
    : null;

const top = balancedByBorough(candidates, 600);
console.log('Fetching HPD registrations for top candidates...');
const { regByBin, agentByReg, headByReg } = await hpdJoin(top.map((c) => c.bin));
console.log(`HPD-registered (multifamily): ${regByBin.size}, agents resolved: ${agentByReg.size}`);

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
    // "No filing yet this year" is the calendar, not a lapse: cat1Missing is
    // kept for context but nothing should rank or sell on it.
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
    agent: agentCard(agent, reg, headByReg),
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

  // The queue that used to be written here now covers every register and is
  // built once they all exist, further down.
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
openings = openings.map((o) => ({ ...o, src: 'sla' }));
} catch (e) {
  console.log(`SLA unavailable (${e.message}) — keeping previous data`);
  openings = (prevFeed()?.openings || []).filter((o) => o.src === 'sla');
}

// ---- Second source for the same register: newly permitted food service ----
//
// A liquour licence only catches venues that pour, which is a minority of the
// places that open, and it arrives 40 rows at a time. Every food business needs
// a DOHMH permit, and the inspection file marks an establishment that has been
// permitted but never inspected with a 1900-01-01 sentinel — which is precisely
// a venue that has not opened, or has only just opened.
//
// The file carries no permit date, so the cohort is dated from the CAMIS, which
// DOHMH issues sequentially. Checked rather than assumed: among venues that HAVE
// been inspected, the earliest first inspection in the band above 50,180,000 is
// 2025-12-22, and above 50,185,000 it is 2026-04-29. So a never-inspected
// establishment above that floor was permitted within roughly the last year, and
// the CAMIS itself orders them newest first.
//
// Below the floor sits a real backlog — 383 places DOHMH permitted years ago and
// never reached. Those are not openings and are left out.
const NEVER_INSPECTED = "inspection_date='1900-01-01T00:00:00.000'";
const CAMIS_FLOOR = '50180000';
console.log('Fetching newly permitted food service (DOHMH, never inspected)...');
try {
  const rows = await fetchAll(
    '43nn-pn8j',
    {
      $where: `${NEVER_INSPECTED} and camis > '${CAMIS_FLOOR}' and boro in('Manhattan','Brooklyn','Queens','Bronx')`,
      $select: 'camis,dba,boro,building,street,zipcode,phone,bin,bbl',
      $order: 'camis DESC',
    },
    6000,
  );
  const byCamis = new Map();
  for (const r of rows) {
    if (!r.camis || byCamis.has(r.camis)) continue;
    const addr = `${(r.building || '').trim()} ${(r.street || '').trim()}`.replace(/\s+/g, ' ').trim();
    if (!addr || !r.dba) continue;
    byCamis.set(r.camis, {
      id: `dohmh-${r.camis}`,
      src: 'dohmh',
      name: r.dba.trim(),
      legal: r.dba.trim(),
      kind: 'Food service',
      address: addr,
      county: r.boro,
      zip: (r.zipcode || '').trim().slice(0, 5) || null,
      bin: r.bin || null,
      camis: r.camis,
      // Published by DOHMH on the permit record as the establishment's own line.
      phone: (r.phone || '').replace(/[^\d]/g, '').length === 10 ? r.phone.replace(/[^\d]/g, '') : null,
      received: null,
      daysAgo: null,
    });
  }
  const pool = [...byCamis.values()];
  // Same balance rule as the building registers: a borough missing from the cut
  // can never come back.
  const picked = balancedByBorough(
    pool.map((o) => ({ ...o, borough: o.county })),
    360,
  ).map(({ borough, ...o }) => o);
  // Newest permit first, which the CAMIS order gives directly.
  picked.sort((a, b) => Number(b.camis) - Number(a.camis));
  openings = [...openings, ...picked];
  const boro = {};
  for (const o of picked) boro[o.county] = (boro[o.county] || 0) + 1;
  console.log(`DOHMH: ${pool.length} newly permitted, feed ${picked.length}, with a phone ${picked.filter((o) => o.phone).length}`, boro);
} catch (e) {
  console.log(`DOHMH unavailable (${e.message}) — keeping previous data`);
  openings = [...openings, ...(prevFeed()?.openings || []).filter((o) => o.src === 'dohmh')];
}

// A liquour-licence card carries no contact of any kind. Most of those venues
// also hold a food permit, and that record prints a number — so the gap closes
// for free, from the same file, with no lookup.
//
// The premises address alone is not evidence: the previous tenant sat at the
// same storefront, and handing someone the old occupant's number is exactly the
// call this product exists to prevent. The names have to corroborate too, and
// the twelve that survive that test are worth more than the twenty-nine that
// would not.
const NAME_STOP = new Set([
  'INC', 'LLC', 'CORP', 'CORPORATION', 'LTD', 'CO', 'COMPANY', 'THE', 'AND', 'OF', 'NY', 'NYC', 'NEW', 'YORK',
  'DELI', 'GROCERY', 'STORE', 'RESTAURANT', 'CAFE', 'BAR', 'GRILL', 'PIZZA', 'FOOD', 'MARKET', 'KITCHEN', 'GROUP',
  'HOLDINGS',
]);
const nameTokens = (v) =>
  new Set(
    String(v || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !NAME_STOP.has(w)),
  );
const streetKey = (v) =>
  String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|BOULEVARD|BLVD|PLACE|PL|DRIVE|DR|LANE|LN|PARKWAY|PKWY|COURT|CT|TERRACE|SQUARE|SQ)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
// The permit file writes bare digits; the contact cache writes +1-XXX-XXX-XXXX.
// Both have to survive, and anything that is not a US ten-digit number is
// dropped rather than shown as a number that will not dial.
const tenDigits = (v) => {
  const d = String(v || '').replace(/[^\d]/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? d : null;
};

{
  let joined = 0;
  let refused = 0;
  for (const o of openings) {
    if (o.phone) continue;
    const first = String(o.address || '').split(',')[0].trim();
    const m = first.match(/^(\d+[A-Z]?(?:-\d+)?)\s+(.+)$/i);
    if (!m) continue;
    const num = m[1].toUpperCase();
    const key = (streetKey(m[2]).split(/\s+/)[0] || '').slice(0, 20);
    if (!key) continue;
    let rows = [];
    try {
      rows = await fetchAll(
        '43nn-pn8j',
        {
          $where: `building='${num.replace(/'/g, "''")}' and upper(street) like '%${key.replace(/'/g, "''")}%' and phone IS NOT NULL`,
          $select: 'dba,building,street,phone',
        },
        20,
      );
    } catch {
      continue;
    }
    if (!rows.length) continue;
    const want = nameTokens(`${o.name} ${o.legal}`);
    const hit = rows.find((r) => {
      if (streetKey(r.street).split(/\s+/)[0] !== key) return false;
      if (!tenDigits(r.phone)) return false;
      for (const t of want) if (nameTokens(r.dba).has(t)) return true;
      return false;
    });
    if (hit) {
      o.phone = tenDigits(hit.phone);
      o.phoneVia = hit.dba.trim();
      joined++;
    } else {
      refused++;
    }
  }
  console.log(`Openings joined to a food permit by name and address: ${joined} (${refused} refused, address matched but the name did not)`);

  // Whatever the join could not reach falls back to the same contact cache the
  // building registers use, so a venue somebody measured by hand is not
  // measured again on the next run.
  let fromCache = 0;
  for (const o of openings) {
    if (o.phone) continue;
    const e = await enrichContact({ company: o.name, address: o.address, cacheOnly: true });
    if (e.confidence === 'none' || !(e.phone || e.email)) continue;
    o.phone = tenDigits(e.phone) || null;
    o.email = e.email || null;
    o.contactLevel = e.confidence;
    o.contactSource = e.source || null;
    if (e.via) o.phoneVia = e.via;
    if (o.phone || o.email) fromCache++;
  }
  console.log(`Openings resolved from the contact cache: ${fromCache}`);
}

// "What's new": monotonic memory of everything the engine has ever surfaced.
// First run writes a baseline (nothing is marked new); later runs stamp first-seen
// ---- Building registers built on the periodic mandates ----
//
// The facade law is not the only obligation the city puts on a cycle and then
// publishes non-compliance for. 855j-jady carries every one of them keyed by
// BIN, so one shape serves several registers: pick a device type, group the
// active violations by building, join the HPD registration for someone to call,
// and rank.
//
// What differs between them is whether a deadline exists at all. Gas piping and
// parking structures sit in a window that has not closed yet, and the card can
// count down to it. Elevators, boilers and carbon reports do not: every open
// violation belongs to a cycle that already ended, and the honest card says how
// long it has been ignored rather than inventing a countdown. A register whose
// deadline has to be implied is not a register worth having, so `deadlineFor`
// is allowed to return nothing and the copy adapts.
const MANDATE_SELECT =
  'bin,violation_number,violation_issue_date,violation_remarks,cycle_end_date,borough,block,lot,house_number,street,zip,community_board';
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx'];

async function mandateRegister({ label, deviceType, extraWhere, fetchCap = 30000, deadlineFor, cap = 400 }) {
  const where =
    `device_type='${deviceType}' and violation_status='Active'` + (extraWhere ? ` and (${extraWhere})` : '');
  const raw = await fetchAll(
    '855j-jady',
    { $where: where, $select: MANDATE_SELECT, $order: 'violation_issue_date DESC' },
    fetchCap,
  );
  const byBin = new Map();
  for (const r of raw) {
    if (!r.bin || r.bin === '0') continue;
    const issued = (r.violation_issue_date || '').slice(0, 10);
    const cur = byBin.get(r.bin);
    if (!cur) {
      byBin.set(r.bin, {
        bin: r.bin,
        address: [r.house_number, r.street].filter(Boolean).join(' ').trim(),
        borough: (r.borough || '').trim(),
        zip: (r.zip || '').trim().slice(0, 5) || null,
        cd: Number(r.community_board) % 100 || null,
        remarks: r.violation_remarks || null,
        cycleEnd: (r.cycle_end_date || '').slice(0, 10) || null,
        issued,
        latest: issued,
        violations: 1,
      });
    } else {
      cur.violations++;
      if (issued && (!cur.issued || issued < cur.issued)) cur.issued = issued;
      if (issued && issued > (cur.latest || '')) cur.latest = issued;
      if (!cur.cycleEnd && r.cycle_end_date) cur.cycleEnd = r.cycle_end_date.slice(0, 10);
      if (!cur.remarks && r.violation_remarks) cur.remarks = r.violation_remarks;
    }
  }
  const cited = byBin.size;
  const pool = [...byBin.values()].filter((c) => BOROUGHS.includes(c.borough) && c.address);
  // Contacts are only fetched for the shortlist, so it is balanced here as well
  // as at the cut — a borough missing from it could never come back. Roughly
  // half of these buildings turn out to have an HPD registration, so the
  // shortlist is sized for the survivors rather than for the target.
  const shortlist = balancedByBorough(pool, cap * 3.5);
  const { regByBin, agentByReg, headByReg } = await hpdJoin(shortlist.map((c) => c.bin));
  for (const c of shortlist) {
    const reg = regByBin.get(c.bin);
    const agent = reg ? agentByReg.get(reg.registrationid) : null;
    const due = deadlineFor ? deadlineFor(c) : null;
    c.deadline = due || null;
    c.monthsLeft = due ? monthsUntil(due) : null;
    c.openDays = c.issued ? Math.max(0, Math.round((TODAY - new Date(c.issued)) / 86400000)) : null;
    c.cycleYear = c.cycleEnd ? Number(c.cycleEnd.slice(0, 4)) : null;
    c.multifamily = Boolean(reg);
    c.agent = agentCard(agent, reg, headByReg);
    if (reg?.zip && !c.zip) c.zip = String(reg.zip).trim().slice(0, 5);
    delete c.remarks;
    // A closing window counts for most where there is one; where there is not,
    // the years a building has spent ignoring the citation carry the ranking.
    c.urgencyScore =
      (c.monthsLeft == null ? 0 : c.monthsLeft <= 6 ? 10 : c.monthsLeft <= 12 ? 5 : 2) +
      Math.min(8, Math.floor((c.openDays || 0) / 120)) +
      Math.min(4, c.violations - 1) +
      (c.agent ? 2 : 0);
  }
  const eligible = shortlist.filter((c) => c.agent);
  const feed = balancedByBorough(eligible, cap);
  feed.sort((a, b) => b.urgencyScore - a.urgencyScore);
  const boro = {};
  for (const c of feed) boro[c.borough] = (boro[c.borough] || 0) + 1;
  console.log(`${label}: ${cited} cited buildings, feed ${feed.length}`, boro);
  return { totals: { cited, open: feed.length }, feed };
}

// Local Law 152, gas piping. Four-year cycle, sub-cycles keyed on community
// district. The mapping is not assumed: the dataset states it in its own
// remarks ("Cycle 1, Sub-cycle C (premises is in Community District 4)") and
// grouping every active row confirms it exactly.
const LL152_CYCLE2 = { A: '2024-12-31', B: '2025-12-31', C: '2026-12-31', D: '2027-12-31' };
const ll152Today = TODAY.toISOString().slice(0, 10);
const nextLL152 = (sub) => {
  let d = LL152_CYCLE2[sub];
  while (d && d < ll152Today) d = `${Number(d.slice(0, 4)) + 4}${d.slice(4)}`;
  return d;
};
// Only the sub-cycles whose next deadline is close enough to sell. A window two
// years out is a calendar, and a calendar is not a signal.
const LL152_LIVE = Object.keys(LL152_CYCLE2).filter((k) => monthsUntil(nextLL152(k)) <= 18);
const subOf = (remarks) => (String(remarks || '').match(/Sub-cycle\s+([A-D])/) || [])[1] || null;

// Elevators, read from the compliance table rather than the violations one.
// 855j-jady has 158,405 active elevator violations and not one belongs to a
// cycle that is still open — it records failures long past. The compliance
// table records state: every active device carries the year of its last CAT1
// test.
//
// The obvious filter is wrong and worth naming. "No CAT1 filed for the current
// year" is true of 25,042 buildings in August, because most of the city files
// in the autumn and the deadline is 31 December — that is the calendar, and the
// calendar is not a signal. A building that last filed two years ago has SKIPPED
// a cycle, which is 4,710 buildings and a real deviation. It also still has this
// year's window to put it right, so the card has both halves: a proven lapse
// and a date that has not passed.
async function elevatorRegister({ cap = 400 } = {}) {
  const year = TODAY.getFullYear();
  const deadline = `${year}-12-31`;
  const rows = await fetchAll(
    'e5aq-a4j2',
    {
      $where: `device_status='Active' and (cat1_report_year IS NULL or cat1_report_year <= '${year - 2}')`,
      $select:
        'bin,device_number,device_type,cat1_report_year,cat1_latest_report_filed,cat5_latest_report_filed,borough,house_number,street_name,zip_code,communitydistrict',
      $order: 'bin',
    },
    60000,
  );
  const byBin = new Map();
  for (const r of rows) {
    if (!r.bin || r.bin === '0') continue;
    const y = r.cat1_report_year ? Number(r.cat1_report_year) : null;
    const cur = byBin.get(r.bin);
    if (!cur) {
      byBin.set(r.bin, {
        bin: r.bin,
        address: [r.house_number, r.street_name].filter(Boolean).join(' ').trim(),
        borough: (r.borough || '').trim(),
        zip: (r.zip_code || '').trim().slice(0, 5) || null,
        cd: Number(r.communitydistrict) % 100 || null,
        devices: 1,
        lastCat1: y,
        lastCat1On: (r.cat1_latest_report_filed || '').slice(0, 10) || null,
        lastCat5: (r.cat5_latest_report_filed || '').slice(0, 10) || null,
      });
    } else {
      cur.devices++;
      // The worst device on the building is the one worth calling about, and
      // its filing date has to travel with its year or the card pairs one
      // device's year with another device's date.
      if (y == null || (cur.lastCat1 != null && y < cur.lastCat1)) {
        cur.lastCat1 = y;
        cur.lastCat1On = (r.cat1_latest_report_filed || '').slice(0, 10) || null;
      }
    }
  }
  const cited = byBin.size;
  const pool = [...byBin.values()].filter((c) => BOROUGHS.includes(c.borough) && c.address);
  const shortlist = balancedByBorough(pool, cap * 3.5);
  const { regByBin, agentByReg, headByReg } = await hpdJoin(shortlist.map((c) => c.bin));
  for (const c of shortlist) {
    const reg = regByBin.get(c.bin);
    const agent = reg ? agentByReg.get(reg.registrationid) : null;
    c.deadline = deadline;
    c.monthsLeft = monthsUntil(deadline);
    // Years behind, counted from the current filing year: 1 means they simply
    // have not got to this year's test yet, 3 means nobody has looked since.
    c.yearsBehind = c.lastCat1 == null ? null : year - c.lastCat1;
    c.multifamily = Boolean(reg);
    c.agent = agentCard(agent, reg, headByReg);
    if (reg?.zip && !c.zip) c.zip = String(reg.zip).trim().slice(0, 5);
    // Everyone here shares one deadline, so the ranking is how far behind they
    // are and how many devices are waiting on the same visit.
    c.urgencyScore =
      (c.lastCat1 == null ? 9 : Math.min(9, (year - c.lastCat1 - 1) * 3)) +
      Math.min(5, c.devices) +
      (c.agent ? 2 : 0);
  }
  const eligible = shortlist.filter((c) => c.agent);
  const feed = balancedByBorough(eligible, cap);
  feed.sort((a, b) => b.urgencyScore - a.urgencyScore);
  const boro = {};
  for (const c of feed) boro[c.borough] = (boro[c.borough] || 0) + 1;
  console.log(`Elevator CAT1: ${cited} buildings that skipped a cycle, feed ${feed.length}`, boro);
  return { totals: { cited, open: feed.length, deadline }, feed };
}

const REGISTERS = [
  {
    key: 'gas',
    label: 'LL152 gas piping',
    deviceType: 'Gas Piping - LL152',
    extraWhere: LL152_LIVE.map((k) => `violation_remarks like '%Sub-cycle ${k}%'`).join(' or ') || null,
    fetchCap: 60000,
    deadlineFor: (c) => {
      const sub = subOf(c.remarks);
      if (!sub) return null;
      c.subCycle = sub;
      return nextLL152(sub);
    },
  },
  {
    key: 'carbon',
    label: 'LL97 emissions',
    deviceType: 'GHG Emissions - LL97',
    fetchCap: 8000,
    deadlineFor: () => null,
  },
];

const registers = {};
for (const spec of REGISTERS) {
  console.log(`Fetching ${spec.label}...`);
  try {
    registers[spec.key] = await mandateRegister(spec);
  } catch (e) {
    console.log(`${spec.label} unavailable (${e.message}) — keeping previous data`);
    const prev = prevFeed()?.[spec.key];
    registers[spec.key] = prev || { totals: { cited: 0, open: 0 }, feed: [] };
  }
}
console.log('Fetching elevator CAT1 compliance...');
try {
  registers.elevators = await elevatorRegister();
} catch (e) {
  console.log(`Elevator CAT1 unavailable (${e.message}) — keeping previous data`);
  registers.elevators = prevFeed()?.elevators || { totals: { cited: 0, open: 0 }, feed: [] };
}
// The contact cache the facade pass filled is the same cache these registers
// need, and a firm that manages a facade building usually manages a boiler and
// a lift in it too. Reading it here costs nothing and is the difference between
// a card that names an agent and one you can ring. Cache only: new companies are
// resolved by a deliberate measured sweep, not by a rebuild spending lookups.
{
  let reached = 0;
  for (const reg of Object.values(registers)) {
    for (const c of reg.feed) {
      if (!c.agent?.company) continue;
      const e = await enrichContact({ company: c.agent.company, address: c.agent.address, cacheOnly: true });
      if (e.confidence === 'none') continue;
      c.agent.phone = e.phone;
      c.agent.email = e.email;
      c.agent.confidence = e.confidence;
      c.agent.contactSource = e.source;
      if (e.via) c.agent.via = e.via;
      reached++;
    }
    const viaHpd = resolveAffiliates(reg.feed);
    reached += viaHpd;
  }
  console.log(`Contacts carried into the other registers from the cache: ${reached}`);

  // One queue for every register, so the next sweep sees the whole gap and can
  // spend its lookups where they cover the most cards.
  const gap = new Map();
  const add = (c, where) => {
    const a = c.agent;
    if (!a?.company || a.phone || a.email) return;
    const k = a.company.toUpperCase().trim();
    const cur = gap.get(k) || { company: a.company, addr: a.address || '', headOfficer: a.headOfficer || null, cards: 0, registers: [] };
    cur.cards++;
    if (!cur.registers.includes(where)) cur.registers.push(where);
    gap.set(k, cur);
  };
  for (const c of feed) add(c, 'facades');
  for (const [key, reg] of Object.entries(registers)) for (const c of reg.feed) add(c, key);
  const queue = [...gap.values()].sort((x, y) => y.cards - x.cards);
  writeFileSync(new URL('../data/unresolved-contacts.json', import.meta.url), JSON.stringify(queue, null, 1));
  console.log(
    `Contacts still unresolved across all registers: ${queue.length} companies covering ` +
      `${queue.reduce((n, x) => n + x.cards, 0)} cards; the top 10 alone cover ` +
      `${queue.slice(0, 10).reduce((n, x) => n + x.cards, 0)}`,
  );
}

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
for (const [key, reg] of Object.entries(registers)) {
  seen[key] ||= {};
  for (const g of reg.feed) {
    seen[key][g.bin] ||= stamp();
    g.isNew = isFreshTs(seen[key][g.bin]);
  }
}
writeFileSync(seenPath, JSON.stringify(seen, null, 1));
const whatsNew = {
  windowHours: 48,
  buildings: feed.filter((c) => c.isNew).length,
  signals: feed.reduce((n, c) => n + (c.fresh?.length || 0), 0),
  contracts: contracts.filter((c) => c.isNew).length,
  openings: openings.filter((o) => o.isNew).length,
  ...Object.fromEntries(Object.entries(registers).map(([k, r]) => [k, r.feed.filter((g) => g.isNew).length])),
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
  dohmh: await sourceMeta('43nn-pn8j'),
  mandates: await sourceMeta('855j-jady'),
  elevatorCompliance: await sourceMeta('e5aq-a4j2'),
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
  ...registers,
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
  // Every register that carries an agent, not just the first one written. The
  // last time a register was added this loop was left pointing at facades and
  // 399 people's names went into the public repo.
  const withAgents = [out.facades.feed, ...Object.keys(registers).map((k) => out[k].feed)].flat();
  for (const c of withAgents) {
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
console.log(
  `Written: facades ${feed.length}, ` +
    Object.entries(registers).map(([k, r]) => `${k} ${r.feed.length}`).join(', ') +
    `, contracts ${contracts.length}, openings ${openings.length}. Totals:`,
  out.facades.totals,
);
