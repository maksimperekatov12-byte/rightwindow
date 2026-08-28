// Where the public intraday document comes from.
//
// It used to be a Vercel Blob object rewritten every five minutes. That is one
// "advanced operation" per tick — 288 a day against a 2,000/month allowance —
// and every browser poll was a billed read on top. The store was suspended on
// 2026-08-28 because of it.
//
// The pinger already runs inside GitHub Actions with the repo checked out, so it
// now force-pushes the same document to the orphan `data` branch instead. Reads
// come from GitHub's CDN and cost nothing; this function re-serves them through
// our own edge cache. Blob stays for private, low-write state only.
const REPO = process.env.DATA_REPO || 'maksimperekatov12-byte/rightwindow';
const BRANCH = process.env.DATA_BRANCH || 'data';
const FILE = 'intraday.json';

export const dataUrl = () =>
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}?ts=${Math.floor(Date.now() / 60000)}`;

export async function fetchLive() {
  try {
    const r = await fetch(dataUrl(), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
