// Fast lane: re-check the intraday sources (contract awards + SLA licenses)
// every five minutes and publish the result.
//
// The published document does NOT go to Vercel Blob any more. One put() per
// tick is 288 advanced operations a day against a 2,000/month allowance, and
// that is what suspended the store on 2026-08-28. It is written to a working
// copy of the orphan `data` branch instead, which the workflow force-pushes;
// the site reads it back through GitHub's CDN for free. See lib/live-source.mjs.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { readDoc, CLAIMS } from '../lib/store.mjs';

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
// The trade filters run downstream of this cap, so a plain top-20 starves the
// construction trades: only 9 of the 141 awards in a 14-day window are construction.
// Take the most recent 20, then top up with every construction award in the window.
const CONSTR_CAT = /construction|architect|engineer/i;
const eligible = awardsRaw.filter((a) => Number(a.contract_amount) >= 100000 && a.vendor_name);
const keptAwards = new Map();
for (const a of [...eligible.slice(0, 20), ...eligible.filter((a) => CONSTR_CAT.test(a.category_description || ''))])
  keptAwards.set(a.request_id, a);
const contracts = [...keptAwards.values()]
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
  $limit: '60',
  $select: 'application_id,premises_county,description,legalname,dba,actual_address_of_premises,city,zip_code,received_date',
});
const slaRaw = await getJson(`https://data.ny.gov/resource/f8i8-k2gm.json?${qs2}`);
const openings = slaRaw.slice(0, 40).map((o) => ({
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

// The previous published document is the local working copy of the data branch,
// so continuity of the pulse and the change log costs nothing to read.
const outDir = process.env.DATA_DIR || new URL('../.data', import.meta.url).pathname;
const outPath = `${outDir}/intraday.json`;
const strip = (arr) => arr.map(({ daysAgo, isNew, ...rest }) => rest);
let prevLive = null;
try { prevLive = JSON.parse(readFileSync(outPath, 'utf8')); } catch {}
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

// Claim colours ride along in the published document so browsers never pay a
// blob read for them. Claims move on human timescales, so re-reading the store
// every third tick (15 minutes) is enough; the claimer sees their own instantly.
const CLAIM_EVERY = Number(process.env.CLAIM_REFRESH_TICKS || 3);
const tick = Number(process.env.TICK || 0);
let claims = prevLive?.claims || {};
if (process.env.BLOB_READ_WRITE_TOKEN && (!prevLive || tick % CLAIM_EVERY === 0)) {
  try {
    const doc = await readDoc(CLAIMS);
    claims = Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, { at: v.at }]));
  } catch (e) {
    console.log(`fast: claims unavailable (${e.message}) — keeping previous`);
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify({
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
  claims,
}));
// seen memory is committed by the hourly lane; keep it fresh locally when we can
if (seen && changed) {
  try { writeFileSync(seenPath, JSON.stringify(seen, null, 1)); } catch {}
}
console.log(
  changed
    ? `fast: updated — contracts new=${contracts.filter((c) => c.isNew).length}, openings new=${openings.filter((o) => o.isNew).length}`
    : `fast: no changes (checked ${new Date(nowMs).toISOString().slice(11, 19)}Z)`,
);
