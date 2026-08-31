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
  // the only path that carries them. The public set — numbers a company printed
  // on its own site or a government record — comes off the data branch and costs
  // nothing. The private store holds the rest and is read only when the branch
  // has not been published yet, because it is billed per read and its allowance
  // is what suspended the store in the first place.
  const [live, branch] = await Promise.all([fetchLive(), fetchContacts()]);
  // The private store may legitimately hold MORE than the branch: the branch
  // carries only what may be republished in bulk, while serving one card at a
  // time was never the thing the provider's terms restrict. It is read only
  // when the branch has nothing, because it is billed per read.
  const stored = branch ? null : await readJsonSoft('contacts.json');
  const contacts = branch || stored || {};
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
