// Tiny JSON layer over Vercel Blob (private store).
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
