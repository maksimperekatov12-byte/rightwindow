// Tiny JSON layer over Vercel Blob (private store).
//
// Vercel bills put/list/del as "advanced operations" against a very small
// monthly ceiling, so this layer deliberately stores COLLECTIONS as one
// document each (claims.json, prefs.json) instead of one blob per row. A
// blob-per-row design costs a list() plus N get() calls on every read, which
// is what exhausted the quota and suspended the store on 2026-08-28.
import { get, put, del, list } from '@vercel/blob';

// "Missing" and "failed" must stay distinguishable: a collection document that
// reads as null on a timeout would come back from updateDoc as {} and one write
// later every other user's data is gone. Missing returns null; failure throws.
export async function readJson(pathname) {
  let r;
  try {
    r = await get(pathname, { access: 'private' });
  } catch (e) {
    if (e?.name === 'BlobNotFoundError' || /not.?found|404/i.test(e?.message || '')) return null;
    throw e;
  }
  if (!r || r.statusCode === 404) return null;
  if (!r.stream) throw new Error(`blob read failed: ${pathname} (${r.statusCode})`);
  return JSON.parse(await new Response(r.stream).text());
}

// The old swallow-everything read, for callers that genuinely prefer stale/empty
// over an error (display paths, never write paths).
export async function readJsonSoft(pathname) {
  try {
    return await readJson(pathname);
  } catch {
    return null;
  }
}

export async function writeJson(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export async function removeJson(pathname) {
  await del(pathname).catch(() => {});
}

// A page holds at most 1,000 blobs, and the first version read one page and
// stopped. Nothing said so: past the thousandth event the ref report went on
// counting an old page, past the thousandth pilot some real pilots silently
// stopped getting their digest, and past the thousandth unsubscribe an address
// would have fallen out of the suppression set and been mailed again. Below
// 1,000 this is still exactly one list() call.
export async function listJson(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, limit: 1000, cursor });
    for (const b of r.blobs) out.push(b.pathname);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

// ---- collection documents ---------------------------------------------------
// One blob holds the whole map. Reading costs one simple operation; writing
// costs one advanced operation no matter how many entries changed.

export async function readDoc(pathname) {
  return (await readJson(pathname)) || {};
}

// Read, mutate, write — but only write when the mutation actually changed
// something. `fn` may mutate the object in place and return it, or return null
// to say "nothing to do", which skips the write entirely.
//
// The store offers no compare-and-set, so the guard is a re-read immediately
// before writing: if the document moved under us, the mutation is replayed on
// the fresh copy. Without it two people claiming different buildings at the
// same moment lose one claim, and the board shows green for a taken building —
// the exact double-call this product exists to prevent.
export async function updateDoc(pathname, fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const before = (await readJson(pathname)) || {};
    const stamp = JSON.stringify(before);
    const after = await fn(before);
    if (after === null || after === undefined) return before;
    const latest = (await readJson(pathname)) || {};
    if (JSON.stringify(latest) !== stamp) continue; // someone else wrote; replay
    await writeJson(pathname, after);
    return after;
  }
  throw new Error(`updateDoc: ${pathname} kept changing under us`);
}

export const CLAIMS = 'claims.json';
export const PREFS = 'prefs.json';
