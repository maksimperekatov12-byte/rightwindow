// Kept for anything still pointing at it; the number now travels inside
// /api/live, which the site polls instead.
import { fetchLive } from '../lib/live-source.mjs';
export default async function handler(req, res) {
  const live = await fetchLive();
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.json({ checkedAt: live?.checkedAt || null });
}
