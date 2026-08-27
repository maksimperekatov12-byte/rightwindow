// Personal signals for a uid: exclusive for 48h, then the assigner rotates them.
import { readJson } from '../lib/store.mjs';

export default async function handler(req, res) {
  const uid = String(req.query.uid || '');
  if (!/^[0-9a-f-]{36}$/.test(uid)) return res.status(400).json({ error: 'bad uid' });
  const idx = (await readJson('assign/index.json')) || {};
  const now = Date.now();
  const items = Object.entries(idx)
    .filter(([, a]) => a.uid === uid && a.until > now)
    .map(([key, a]) => ({ key, until: a.until }));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items });
}
