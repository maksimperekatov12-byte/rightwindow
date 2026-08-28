// Shared-pool claim state. Green = nobody claimed; yellow = claimed ("taken").
// GET  -> { "b:1234": { at: 1787... }, ... }   (claimer uid is never exposed)
// POST { uid, key } -> first caller claims; later callers get {status:"taken"}.
//
// All claims live in ONE document. The previous blob-per-claim layout cost a
// list() plus N get() calls on every poll, which is what drained the quota.
import { readDoc, updateDoc, CLAIMS } from '../lib/store.mjs';

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
  });

export const publicClaims = (doc) => {
  const out = {};
  for (const [k, v] of Object.entries(doc)) out[k] = { at: v.at };
  return out;
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const doc = await readDoc(CLAIMS);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.json(publicClaims(doc));
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const uid = String(body?.uid || '');
    const key = String(body?.key || '');
    if (!/^[0-9a-f-]{36}$/.test(uid) || !/^[bco]:[\w-]{1,40}$/.test(key)) return res.status(400).json({ error: 'bad request' });
    let taken = null;
    await updateDoc(CLAIMS, (doc) => {
      if (doc[key]) { taken = doc[key]; return null; }
      doc[key] = { uid, at: Date.now() };
      return doc;
    });
    if (taken) return res.json({ status: 'taken', at: taken.at });
    return res.status(201).json({ status: 'claimed' });
  }
  res.status(405).end();
}
