// Pilots and the first-party event log.
//
// A pilot is a subscriber record with a territory: trade, ZIPs, the ref that
// brought them and the date the free window closes. It lives one-file-per-
// address like every other lead (lib/leads.mjs explains why a document store
// with CDN-cached reads cannot host read-modify-write).
//
// The event log is deliberately small: what the daily-list product needs to
// know is who came from which email, what they opened and whether they
// started. No third-party analytics, no cookies, no identifiers beyond the
// ref the salesperson put in the link and an anonymous session id the page
// already has.
import { createHash } from 'node:crypto';
import { readJson, writeJson, listJson, readJsonSoft } from './store.mjs';

const norm = (e) => String(e || '').trim().toLowerCase();
const keyOf = (email) => createHash('sha1').update(norm(email)).digest('hex').slice(0, 24);
const pilotPath = (email) => `pilots/${keyOf(email)}.json`;

export const PILOT_DAYS = 60;

/** Store (or refresh) a pilot. Signing up twice is a success, not an error. */
export async function savePilot({ email, company = null, trade = null, zips = [], ref = null, reg = null }) {
  const e = norm(email);
  const prev = await readJsonSoft(pilotPath(e));
  const started = prev?.started || new Date().toISOString();
  const until = new Date(new Date(started).getTime() + PILOT_DAYS * 86400000).toISOString();
  const rec = {
    email: e,
    company: company || prev?.company || null,
    trade: trade || prev?.trade || null,
    // The territory is the product: the digest sends exactly these ZIPs.
    zips: zips.length ? zips : prev?.zips || [],
    reg: reg || prev?.reg || null,
    ref: ref || prev?.ref || null,
    started,
    until,
    updated: new Date().toISOString(),
  };
  await writeJson(pilotPath(e), rec);
  return { record: rec, already: Boolean(prev) };
}

export async function readPilot(email) {
  return readJsonSoft(pilotPath(norm(email)));
}

/** Every pilot, for the digest and the private report. */
export async function allPilots() {
  const out = [];
  try {
    for (const p of await listJson('pilots/')) {
      const rec = await readJson(p).catch(() => null);
      if (rec?.email) out.push(rec);
    }
  } catch {}
  return out;
}

// ---- events ---------------------------------------------------------------

// One document per ref per day. Append-only in spirit: a day's file only ever
// grows, and a busy ref costs one small write per event rather than a
// read-modify-write of one giant log.
const evPath = (ref, day, seq) => `events/${day}/${ref || 'none'}/${seq}.json`;
const DAY = () => new Date().toISOString().slice(0, 10);

export const EVENT_KINDS = new Set([
  'visit',
  'card_expanded',
  'call_clicked',
  'copy_opener',
  'export_csv',
  'pilot_started',
  'dismiss',
]);

export async function logEvent({ kind, ref = null, card = null, trade = null, zips = null, reg = null, ua = null, sid = null }) {
  if (!EVENT_KINDS.has(kind)) return { ok: false, reason: 'unknown kind' };
  const day = DAY();
  const seq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await writeJson(evPath(ref, day, seq), {
    kind,
    ref: ref || null,
    card: card || null,
    trade: trade || null,
    zips: Array.isArray(zips) ? zips.slice(0, 12) : null,
    reg: reg || null,
    // The family, not the string: "who came" is a question about phones vs
    // laptops, not about fingerprinting anybody.
    ua: ua || null,
    sid: sid || null,
    at: new Date().toISOString(),
  });
  return { ok: true };
}

/** Roll the log up per ref — the table that decides whom to phone. */
export async function refReport(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const byRef = new Map();
  let paths = [];
  try {
    paths = await listJson('events/');
  } catch {}
  for (const p of paths) {
    const day = p.split('/')[1] || '';
    if (day < since) continue;
    const ev = await readJson(p).catch(() => null);
    if (!ev) continue;
    const r = ev.ref || 'none';
    const row = byRef.get(r) || {
      ref: r, first: ev.at, last: ev.at, visits: 0, cards: 0, calls: 0, openers: 0, exports: 0, pilots: 0, dismissed: 0, trades: new Set(), sids: new Set(),
    };
    if (ev.at < row.first) row.first = ev.at;
    if (ev.at > row.last) row.last = ev.at;
    if (ev.kind === 'visit') row.visits += 1;
    if (ev.kind === 'card_expanded') row.cards += 1;
    if (ev.kind === 'call_clicked') row.calls += 1;
    if (ev.kind === 'copy_opener') row.openers += 1;
    if (ev.kind === 'export_csv') row.exports += 1;
    if (ev.kind === 'pilot_started') row.pilots += 1;
    if (ev.kind === 'dismiss') row.dismissed += 1;
    if (ev.trade) row.trades.add(ev.trade);
    if (ev.sid) row.sids.add(ev.sid);
    byRef.set(r, row);
  }
  return [...byRef.values()]
    .map((r) => ({ ...r, trades: [...r.trades], people: r.sids.size, sids: undefined }))
    .sort((a, b) => (b.last > a.last ? 1 : -1));
}
