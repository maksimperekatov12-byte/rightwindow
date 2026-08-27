// Fast lane: re-check the intraday sources (contract awards + SLA licenses)
// every 10 minutes. Writes feed.json ONLY when something actually changed,
// so Vercel deploys stay within the free tier while signals land in minutes.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readJson, writeJson } from '../lib/store.mjs';

const TODAY = new Date();
async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((s) => setTimeout(s, 1200 * 2 ** i));
    }
  }
  throw last;
}

const feedPath = new URL('../src/data/feed.json', import.meta.url);
const seenPath = new URL('../data/seen.json', import.meta.url);
const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
const seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : null;
const NEW_WINDOW_MS = 48 * 3600 * 1000;
const nowIso = TODAY.toISOString();
const isFreshTs = (ts) => Boolean(ts) && ts !== 'baseline' && TODAY - new Date(ts) <= NEW_WINDOW_MS;

// contracts
const since = new Date(TODAY - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const qs = new URLSearchParams({
  $where: `type_of_notice_description='Award' and start_date>='${since}'`,
  $order: 'start_date DESC',
  $limit: '2000',
  $select: 'request_id,start_date,agency_name,short_title,category_description,contract_amount,vendor_name,vendor_address,selection_method_description',
});
const awardsRaw = await getJson(`https://data.cityofnewyork.us/resource/qyyg-4tf5.json?${qs}`);
const contracts = awardsRaw
  .filter((a) => Number(a.contract_amount) >= 100000 && a.vendor_name)
  .slice(0, 20)
  .map((a) => ({
    id: a.request_id,
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

// openings
const qs2 = new URLSearchParams({
  $where: "premises_county in('Kings','Queens','New York','Bronx','Richmond') and status='Under Review'",
  $order: 'received_date DESC',
  $limit: '40',
  $select: 'application_id,premises_county,description,legalname,dba,actual_address_of_premises,city,zip_code,received_date',
});
const slaRaw = await getJson(`https://data.ny.gov/resource/f8i8-k2gm.json?${qs2}`);
const openings = slaRaw.slice(0, 20).map((o) => ({
  id: o.application_id,
  name: o.dba || o.legalname,
  legal: o.legalname,
  kind: o.description,
  address: `${o.actual_address_of_premises || ''}, ${o.city || ''}`.trim(),
  county: o.premises_county,
  received: o.received_date?.slice(0, 10),
  daysAgo: o.received_date ? Math.max(0, Math.round((TODAY - new Date(o.received_date)) / 86400000)) : null,
}));

// stamp newness against seen memory (only if a baseline already exists)
if (seen) {
  for (const c of contracts) {
    seen.contracts[c.id] ||= nowIso;
    c.isNew = isFreshTs(seen.contracts[c.id]);
  }
  for (const o of openings) {
    seen.openings[o.id] ||= nowIso;
    o.isNew = isFreshTs(seen.openings[o.id]);
  }
}

// Intraday data goes to Blob, not git: the site reads it live, so a tick costs
// no commit and no redeploy — that is what makes a 5-minute cadence possible.
const strip = (arr) => arr.map(({ daysAgo, isNew, ...rest }) => rest);
const prevLive = await readJson('live/intraday.json');
const prevContracts = prevLive?.contracts || feed.contracts || [];
const prevOpenings = prevLive?.openings || feed.openings || [];
const changed =
  JSON.stringify(strip(contracts)) !== JSON.stringify(strip(prevContracts)) ||
  JSON.stringify(strip(openings)) !== JSON.stringify(strip(prevOpenings));

let awardsDate = feed.sources?.awards || null;
try {
  const m = await getJson('https://data.cityofnewyork.us/api/views/qyyg-4tf5.json');
  awardsDate = new Date(m.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
} catch {}

// Rolling proof of life: every check is recorded, every change is labelled.
const DAY = 24 * 3600 * 1000;
const nowMs = Date.now();
const pulse = [...(prevLive?.pulse || []), nowMs].filter((t) => nowMs - t < DAY).slice(-400);
const changeLog = [...(prevLive?.changeLog || [])];
if (changed) {
  const newC = contracts.filter((c) => c.isNew).length;
  const newO = openings.filter((o) => o.isNew).length;
  changeLog.push({ at: nowMs, contracts: newC, openings: newO });
}
const recentChanges = changeLog.filter((c) => nowMs - c.at < 7 * DAY).slice(-60);

await writeJson('live/intraday.json', {
  checkedAt: nowMs,
  changedAt: changed ? nowMs : prevLive?.changedAt || nowMs,
  pulse,
  changeLog: recentChanges,
  contracts,
  openings,
  whatsNew: {
    contracts: contracts.filter((c) => c.isNew).length,
    openings: openings.filter((o) => o.isNew).length,
  },
  sources: { awards: awardsDate },
});
// seen memory is committed by the hourly lane; keep it fresh locally when we can
if (seen && changed) {
  try { writeFileSync(seenPath, JSON.stringify(seen, null, 1)); } catch {}
}
console.log(
  changed
    ? `fast: updated — contracts new=${contracts.filter((c) => c.isNew).length}, openings new=${openings.filter((o) => o.isNew).length}`
    : 'fast: no changes (heartbeat written)',
);
