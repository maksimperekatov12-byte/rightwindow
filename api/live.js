// Intraday layer: contracts, openings and freshness written by the pinger every
// few minutes. Served straight from Blob so the site is fresh without a redeploy.
import { readJson } from '../lib/store.mjs';

export default async function handler(req, res) {
  const live = await readJson('live/intraday.json');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
  res.json(live || {});
}
