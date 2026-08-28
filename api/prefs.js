// Per-user preferences: profile, ticket, boroughs, watchlist, channels.
// One document keyed by uid — see lib/store.mjs for why.
//
// This endpoint is unauthenticated and the uid is client-chosen, so the body is
// never spread in whole: an attacker could otherwise set channels.slack to any
// URL and turn the CI worker into an SSRF probe, or channels.email into an open
// relay on our Resend key. Only the fields below are assignable, and the two
// delivery channels go through the same validators as the connect endpoints.
import { updateDoc, PREFS } from '../lib/store.mjs';

const SLACK_HOOK = /^https:\/\/hooks\.slack\.com\/services\/[\w/+-]+$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;
const PROFILES = new Set([
  'qewi', 'restoration', 'lender', 'elevator', 'insurance', 'pos', 'fnb', 'staffing',
  'equipment', 'propmgmt', 'legal', 'cre', 'marketing', 'signage', 'explore',
]);
const BOROS = new Set(['all', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx']);
const FB = new Set(['contacted', 'won', 'lost', 'dismissed']);
const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const keyList = (v, max) =>
  Array.isArray(v) ? v.filter((k) => typeof k === 'string' && /^[\w:-]{1,48}$/.test(k)).slice(0, max) : undefined;

// Anything not named here is dropped on the floor.
function clean(data) {
  const out = {};
  if (PROFILES.has(data.profile)) out.profile = data.profile;
  if (BOROS.has(data.boro)) out.boro = data.boro;
  const t = num(Number(data.ticket), 0, 1e9);
  if (t !== undefined) out.ticket = t;
  const r = num(Number(data.closeRate), 0.01, 1);
  if (r !== undefined) out.closeRate = r;
  const w = keyList(data.watch, 500);
  if (w) out.watch = w;
  const pf = keyList(data.portfolio, 500);
  if (pf) out.portfolio = pf;
  if (typeof data.lastFeedSeen === 'string' && data.lastFeedSeen.length < 40) out.lastFeedSeen = data.lastFeedSeen;
  if (typeof data.instant === 'boolean') out.instant = data.instant;
  if (data.feedback && typeof data.feedback === 'object') {
    const fb = {};
    for (const [k, v] of Object.entries(data.feedback).slice(0, 500)) {
      if (/^[\w:-]{1,48}$/.test(k) && FB.has(v?.s)) fb[k] = { s: v.s, t: num(Number(v.t), 0, 4e12) || Date.now() };
    }
    out.feedback = fb;
  }
  if (data.channels && typeof data.channels === 'object') {
    const ch = {};
    ch.slack = SLACK_HOOK.test(data.channels.slack || '') ? data.channels.slack : null;
    ch.email = EMAIL.test(data.channels.email || '') ? data.channels.email : null;
    if (typeof data.channels.walletSerial === 'string' && /^[\w-]{1,64}$/.test(data.channels.walletSerial))
      ch.walletSerial = data.channels.walletSerial;
    out.channels = ch;
  }
  return out;
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 60000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await readBody(req);
  const uid = String(body?.uid || '');
  if (!/^[0-9a-f-]{36}$/.test(uid) || !body?.data) return res.status(400).json({ error: 'bad request' });
  try {
    await updateDoc(PREFS, (doc) => {
      doc[uid] = { ...(doc[uid] || {}), ...clean(body.data), uid, savedAt: Date.now() };
      return doc;
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('prefs write failed', e.message);
    return res.status(500).json({ error: 'store failed' });
  }
}
