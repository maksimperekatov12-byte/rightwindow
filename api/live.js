// The one endpoint the browser polls: intraday signals, proof of life, claim
// colours, and this visitor's personal signals — in a single response.
//
// It used to be four endpoints polled every 30 seconds, each hitting Blob. That
// is what drained the free operation allowance. The public half now comes from
// GitHub's CDN and is edge-cached for everyone; only the per-visitor half is
// ever computed per uid.
import { readJsonSoft } from '../lib/store.mjs';
import { fetchLive } from '../lib/live-source.mjs';

export default async function handler(req, res) {
  const uid = String(req.query.uid || '');
  const live = await fetchLive();

  // An upstream failure must not be cached as if it were the state of the city.
  if (!live) {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[0-9a-f-]{36}$/.test(uid)) return res.json({});
  } else if (!/^[0-9a-f-]{36}$/.test(uid)) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
    return res.json(live);
  }

  // Personal signals rotate on a 48-hour hold, so a stale minute costs nothing.
  const idx = (await readJsonSoft('assign/index.json')) || {};
  const now = Date.now();
  const mine = Object.entries(idx)
    .filter(([, a]) => a.uid === uid && a.until > now)
    .map(([key, a]) => ({ key, until: a.until }));
  if (live) res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  res.json({ ...(live || {}), mine });
}
