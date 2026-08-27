// Shared-pool claim state. Green = nobody claimed; yellow = claimed ("taken").
// GET  -> { "b:1234": { at: 1787... }, ... }   (claimer uid is never exposed)
// POST { uid, key } -> first caller claims; later callers get {status:"taken"}.
import { readJson, writeJson, listJson } from '../lib/store.mjs';

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
  });

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const paths = await listJson('claim/');
    const out = {};
    await Promise.all(
      paths.slice(0, 500).map(async (p) => {
        const r = await readJson(p);
        if (r) out[p.replace(/^claim\//, '').replace(/\.json$/, '')] = { at: r.at };
      }),
    );
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.json(out);
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const uid = String(body?.uid || '');
    const key = String(body?.key || '');
    if (!/^[0-9a-f-]{36}$/.test(uid) || !/^[bco]:[\w-]{1,40}$/.test(key)) return res.status(400).json({ error: 'bad request' });
    const path = `claim/${key}.json`;
    const existing = await readJson(path);
    if (existing) return res.json({ status: 'taken', at: existing.at });
    await writeJson(path, { uid, at: Date.now() });
    return res.status(201).json({ status: 'claimed' });
  }
  res.status(405).end();
}
