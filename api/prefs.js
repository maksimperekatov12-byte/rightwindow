// Per-user preferences: profile, boroughs, watchlist, channels.
//
// Deliberately NOT the average ticket or close rate. The onboarding tells the
// user "both numbers stay on this device", and they were being shipped here
// anyway while nothing on this side ever read them back.
// One document keyed by uid — see lib/store.mjs for why.
//
// This endpoint is unauthenticated and the uid is client-chosen, so the body is
// never spread in whole: an attacker could otherwise set channels.slack to any
// URL and turn the CI worker into an SSRF probe, or channels.email into an open
// relay on our Resend key. Only the fields below are assignable, and the two
// delivery channels go through the same validators as the connect endpoints.
import { updateDoc, PREFS } from '../lib/store.mjs';

const SLACK_HOOK = /^https:\/\/hooks\.slack\.com\/services\/[\w/+-]+$/;
// No markup or quote characters: the address is echoed into pages and mail.
// Apostrophes stay — o'brien@ is a real mailbox.
const EMAIL = /^[^@\s<>"`\\]{1,64}@[^@\s<>"`\\]{1,190}\.[a-z]{2,24}$/i;
const PROFILES = new Set([
  'qewi', 'restoration', 'lender', 'elevator', 'plumber', 'retrofit', 'insurance', 'pos', 'fnb', 'staffing',
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
  // Only the channels this request actually names are touched. The block used to
  // rebuild the object from scratch, so the digest form — which posts nothing but
  // an email address — silently disconnected a Slack webhook the same user had
  // connected through a different flow. A key that is absent means "leave it";
  // an explicit null means "disconnect it".
  if (data.channels && typeof data.channels === 'object') {
    const ch = {};
    if ('slack' in data.channels)
      ch.slack = SLACK_HOOK.test(data.channels.slack || '') ? data.channels.slack : null;
    if ('email' in data.channels) ch.email = EMAIL.test(data.channels.email || '') ? data.channels.email : null;
    if (typeof data.channels.walletSerial === 'string' && /^[\w-]{1,64}$/.test(data.channels.walletSerial))
      ch.walletSerial = data.channels.walletSerial;
    if (Object.keys(ch).length) out.channels = ch;
  }
  return out;
}

// The cap stays generous on purpose. The app posts its whole feedback map, and
// each entry carries the rep's note (up to 400 characters), reason and deal size
// — none of which clean() keeps — so a cap sized to the STORED record would
// throw away the entire save of anyone who writes notes. What is stored is
// bounded by clean(); what the shared document may grow to is bounded below.
//
// An oversize body used to destroy the socket without settling the promise, so
// the function hung until the platform timed it out.
const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 60000) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });

// Every uid lives in ONE document that every save reads twice and rewrites, and
// the notifier and the digest read whole. The uid is minted by the client, so a
// script posting fresh uids could grow that document without end — about 68 KB
// per request — until each save moved tens of megabytes and the store's quota
// went with it, taking claims and subscribers down too. A visitor's record is a
// few hundred bytes, so past this size a brand-new uid is refused while every
// existing one keeps saving. It is a circuit breaker for the store, set far
// above anything real traffic reaches, not a limit anyone should meet.
const MAX_DOC_BYTES = 8e6;

// The uid is also sent as a query parameter to /api/live, so it leaks through
// Referer headers, CDN logs and shared links — it identifies, it does not
// authorise. Writes carry a separate secret that only ever travels in a body.
const secretOk = (s) => typeof s === 'string' && /^[\w-]{20,80}$/.test(s);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await readBody(req);
  const uid = String(body?.uid || '');
  const secret = body?.secret;
  if (!/^[0-9a-f-]{36}$/.test(uid) || !body?.data) return res.status(400).json({ error: 'bad request' });
  if (!secretOk(secret)) return res.status(400).json({ error: 'bad request' });
  let denied = false;
  let full = false;
  try {
    await updateDoc(PREFS, (doc) => {
      const prev = doc[uid];
      full = false;
      if (!prev && JSON.stringify(doc).length > MAX_DOC_BYTES) {
        full = true;
        return null;
      }
      // First write for this uid claims it; later writes must present the same
      // secret, so knowing somebody's uid is not enough to overwrite them.
      if (prev?.secret && prev.secret !== secret) {
        denied = true;
        return null;
      }
      const next = clean(body.data);
      // One level deeper for channels, so a partial update adds to what is
      // stored instead of replacing the whole set.
      if (next.channels) next.channels = { ...(prev?.channels || {}), ...next.channels };
      doc[uid] = { ...(prev || {}), ...next, uid, secret, savedAt: Date.now() };
      return doc;
    });
    if (denied) return res.status(403).json({ error: 'not yours' });
    // The app ignores a failed save and keeps everything on the device.
    if (full) return res.status(503).json({ error: 'store full' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('prefs write failed', e.message);
    return res.status(500).json({ error: 'store failed' });
  }
}
