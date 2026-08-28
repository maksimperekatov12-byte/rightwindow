// Tiny JSON layer over Vercel Blob (private store).
//
// Vercel bills put/list/del as "advanced operations" against a very small
// monthly ceiling, so this layer deliberately stores COLLECTIONS as one
// document each (claims.json, prefs.json) instead of one blob per row. A
// blob-per-row design costs a list() plus N get() calls on every read, which
// is what exhausted the quota and suspended the store on 2026-08-28.
import { get, put, del, list } from '@vercel/blob';

export async function readJson(pathname) {
  const r = await get(pathname, { access: 'private' }).catch(() => null);
  if (!r || r.statusCode === 404 || !r.stream) return null;
  try {
    return JSON.parse(await new Response(r.stream).text());
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

export async function listJson(prefix) {
  const { blobs } = await list({ prefix, limit: 1000 });
  return blobs.map((b) => b.pathname);
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
export async function updateDoc(pathname, fn) {
  const before = (await readJson(pathname)) || {};
  const after = await fn(before);
  if (after === null || after === undefined) return before;
  await writeJson(pathname, after);
  return after;
}

export const CLAIMS = 'claims.json';
export const PREFS = 'prefs.json';
