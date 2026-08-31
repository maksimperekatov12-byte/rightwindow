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

// raw.githubusercontent.com ignores query strings in its cache key (verified:
// identical etag for ?ts=<anything>), so there is no cache-buster to add. Its
// own TTL is ~5 minutes, which stacks with our edge cache — the UI must treat
// checkedAt as "at least this fresh", not as a clock.
export const dataUrl = () => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;

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

// Contacts ride the same channel, for the same reason: one blob read per browser
// poll is what exhausted the allowance, and this file is identical for every
// visitor. Only the numbers a company published about itself are on the branch —
// see lib/provenance.mjs for where that line is drawn and why.
export const contactsUrl = () => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/contacts.json`;

export async function fetchContacts() {
  try {
    const r = await fetch(contactsUrl(), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    // Accept the wrapper only when it IS the wrapper. Returning `j` on a
    // missing `contacts` key made a malformed publish indistinguishable from an
    // empty one: {note, generatedAt, count} is truthy, so the caller would stop
    // looking and serve a note object as the contact map.
    const map = j && typeof j.contacts === 'object' && j.contacts ? j.contacts : null;
    if (!map) return null;

    // This document is fetched over the network and its every field ends up in
    // a tel: or mailto: in somebody's browser. Validate it here, once, rather
    // than trusting it because of where it came from.
    const clean = {};
    for (const [bin, row] of Object.entries(map)) {
      if (!/^\d{1,9}$/.test(bin) || !row || typeof row !== 'object') continue;
      const phone = typeof row.phone === 'string' && /^\+1-\d{3}-\d{3}-\d{4}$/.test(row.phone) ? row.phone : null;
      const email =
        typeof row.email === 'string' && /^[^\s@<>"'`;,()[\]\\]{1,64}@[^\s@<>"'`;,()[\]\\]{1,190}\.[a-z]{2,24}$/i.test(row.email)
          ? row.email
          : null;
      if (!phone && !email) continue;
      clean[bin] = {
        phone,
        email,
        confidence: ['verified', 'listed', 'affiliate'].includes(row.confidence) ? row.confidence : 'listed',
        ...(typeof row.source === 'string' && row.source.length < 200 ? { source: row.source } : {}),
        ...(typeof row.via === 'string' && row.via.length < 120 ? { via: row.via } : {}),
      };
    }
    return Object.keys(clean).length ? clean : null;
  } catch {
    return null;
  }
}
