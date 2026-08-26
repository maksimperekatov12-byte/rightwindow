import { readJson } from '../lib/store.mjs';
export default async function handler(req, res) {
  const h = await readJson('heartbeat.json');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  res.json({ checkedAt: h?.checkedAt || null });
}
