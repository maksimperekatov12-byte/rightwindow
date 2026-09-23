// Shared-pool claim state. Green = nobody claimed; yellow = claimed ("taken").
// GET  -> { "b:1234": { at: 1787... }, ... }   (claimer uid is never exposed)
// POST { uid, key } -> first caller claims; later callers get {status:"taken"}.
//
// All claims live in ONE document. The previous blob-per-claim layout cost a
// list() plus N get() calls on every poll, which is what drained the quota.
import { createHash } from 'node:crypto';
import { readDoc, updateDoc, CLAIMS } from '../lib/store.mjs';

// An oversize body used to destroy the socket without settling the promise, so
// the function sat there until the platform timed it out.
const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5000) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });

// A claim needs no account, the uid is minted by the client and the key only has
// to look like a key, so one script could POST every card in the feed and turn
// the whole register "Taken" for every visitor — and nothing ever expires a
// claim. Requiring the secret would not stop that: an attacker sends any string.
// What a script cannot mint freely is a source address, so new claims are
// capped per address per rolling day. A real rep marks a few dozen cards a day
// at the very most; the cap is an env var so it can be lifted for a room full of
// people on one venue Wi-Fi without touching code.
const PER_IP_PER_DAY = (() => {
  const n = Number(process.env.CLAIMS_PER_IP_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : 60;
})();

// An IPv6 client is usually handed a whole /64 and can walk through it at will,
// so a v6 address is counted by its /64 rather than by itself.
function ipBucket(ip) {
  const a = ip.toLowerCase();
  if (!a.includes(':')) return a;
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = a.split('::');
  const l = head ? head.split(':') : [];
  const r = tail ? tail.split(':') : [];
  const groups = [...l, ...Array(Math.max(0, 8 - l.length - r.length)).fill('0'), ...r];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// Only a short hash is kept, and only in the private document: publicClaims and
// the collector copy nothing but `at`, so it never reaches a browser.
function sourceOf(req) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return ip ? createHash('sha256').update('rw-claims:' + ipBucket(ip)).digest('hex').slice(0, 12) : null;
}

export const publicClaims = (doc) => {
  const out = {};
  for (const [k, v] of Object.entries(doc)) out[k] = { at: v.at };
  return out;
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    let doc;
    try {
      doc = await readDoc(CLAIMS);
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({});
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.json(publicClaims(doc));
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const uid = String(body?.uid || '');
    const key = String(body?.key || '');
    const secret = typeof body?.secret === 'string' && /^[\w-]{20,80}$/.test(body.secret) ? body.secret : null;
    if (!/^[0-9a-f-]{36}$/.test(uid) || !/^[bcgeko]:[\w-]{1,40}$/.test(key)) return res.status(400).json({ error: 'bad request' });
    const src = sourceOf(req);
    let taken = null;
    let limited = false;
    try {
      await updateDoc(CLAIMS, (doc) => {
        taken = null;
        limited = false;
        if (doc[key]) { taken = doc[key]; return null; }
        // Checked after "taken", so a card somebody already holds still answers
        // taken rather than a rate limit.
        if (src) {
          const since = Date.now() - 864e5;
          let n = 0;
          for (const v of Object.values(doc)) if (v?.src === src && v.at > since) n++;
          if (n >= PER_IP_PER_DAY) { limited = true; return null; }
        }
        doc[key] = { uid, at: Date.now(), ...(src ? { src } : {}), ...(secret ? { secret } : {}) };
        return doc;
      });
    } catch {
      return res.status(503).json({ error: 'store unavailable' });
    }
    if (taken) return res.json({ status: 'taken', at: taken.at });
    // The SPA reads anything but 201 as "the claim never landed" and takes the
    // optimistic amber back off; the device's own Contacted/Won mark stays.
    if (limited) return res.status(429).json({ error: 'too many claims' });
    return res.status(201).json({ status: 'claimed' });
  }
  if (req.method === 'DELETE') {
    // Only the device that claimed it can release it — otherwise anyone could
    // clear the whole shared pool.
    const body = await readBody(req);
    const uid = String(body?.uid || '');
    const key = String(body?.key || '');
    const secret = typeof body?.secret === 'string' ? body.secret : null;
    if (!/^[0-9a-f-]{36}$/.test(uid) || !/^[bcgeko]:[\w-]{1,40}$/.test(key)) return res.status(400).json({ error: 'bad request' });
    let released = false;
    try {
      await updateDoc(CLAIMS, (doc) => {
        // The uid travels as a query parameter to /api/live and leaks through
        // Referer headers and shared links, so it identifies and does not
        // authorise — the same argument api/prefs.js makes for its writes. A
        // release has to present the secret the claim was taken with.
        if (doc[key]?.uid !== uid) return null;
        if (doc[key]?.secret && doc[key].secret !== secret) return null;
        delete doc[key];
        released = true;
        return doc;
      });
    } catch {
      return res.status(503).json({ error: 'store unavailable' });
    }
    return res.json({ status: released ? 'released' : 'not yours' });
  }
  res.status(405).end();
}
