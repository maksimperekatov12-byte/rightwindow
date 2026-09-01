// The one endpoint the browser polls: intraday signals, proof of life, claim
// colours, and this visitor's personal signals — in a single response.
//
// It used to be four endpoints polled every 30 seconds, each hitting Blob. That
// is what drained the free operation allowance. The public half now comes from
// GitHub's CDN and is edge-cached for everyone; only the per-visitor half is
// ever computed per uid.
import { readJsonSoft } from '../lib/store.mjs';
import { fetchLive, fetchContacts } from '../lib/live-source.mjs';

export default async function handler(req, res) {
  const uid = String(req.query.uid || '');
  // Resolved numbers are deliberately absent from the committed feed, so this is
  // the only path that carries them. Two sets merge here, and the difference
  // between them is the publication gate, not trust: the branch carries what may
  // be REPUBLISHED IN BULK — numbers off the firm's own site or a government
  // record — while the private store also holds the directory-tier numbers the
  // gate keeps out of the downloadable artefact. Serving one card at a time was
  // never what any licence restricted, so with the store alive again (Pro,
  // 2026-08-31) a card gets the fullest contact we resolved, and the branch
  // remains both the CDN fast path and the fallback when the store blinks.
  const [live, branch, stored] = await Promise.all([
    fetchLive(),
    fetchContacts(),
    readJsonSoft('contacts.json'),
  ]);
  const contacts = { ...(branch || {}), ...(stored || {}) };
  // "No contacts" must not be cached as though it were an answer. Before the
  // first publish, or during a branch outage, an empty map pinned at the edge
  // for two minutes is every card in the product saying there is nobody to ring.
  const contactsFailed = !branch && !stored;

  // An upstream failure must not be cached as if it were the state of the city.
  if (!live) {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[0-9a-f-]{36}$/.test(uid)) return res.json({ contacts });
  } else if (!/^[0-9a-f-]{36}$/.test(uid)) {
    res.setHeader(
      'Cache-Control',
      contactsFailed ? 'no-store' : 's-maxage=60, stale-while-revalidate=600',
    );
    return res.json({ ...live, contacts });
  }

  // Personal signals rotate on a 48-hour hold, so a stale minute costs nothing.
  const idx = (await readJsonSoft('assign/index.json')) || {};
  const now = Date.now();
  const mine = Object.entries(idx)
    .filter(([, a]) => a.uid === uid && a.until > now)
    .map(([key, a]) => ({ key, until: a.until }));
  if (live && !contactsFailed) res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  else res.setHeader('Cache-Control', 'no-store');
  res.json({ ...(live || {}), contacts, mine });
}
