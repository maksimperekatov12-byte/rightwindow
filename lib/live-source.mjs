// Where the public intraday document and the published contacts come from.
//
// Both used to be Vercel Blob objects rewritten every five minutes. That is one
// "advanced operation" per tick — 288 a day against a 2,000/month allowance —
// and every browser poll was a billed read on top. The store was suspended on
// 2026-08-28 because of it.
//
// Neither this file nor its callers now know where the documents actually live:
// lib/artifacts.mjs owns that, behind STORAGE_DRIVER. This module keeps the
// shape-checking, because a document arriving over the network has to be
// validated wherever it came from.
import { readArtifact, DRIVER } from './artifacts.mjs';

export const storageDriver = DRIVER;

export async function fetchLive() {
  const j = await readArtifact('intraday');
  return j && typeof j === 'object' ? j : null;
}

export async function fetchContacts() {
  const j = await readArtifact('contacts');
  // Accept the wrapper only when it IS the wrapper. Returning `j` on a missing
  // `contacts` key made a malformed publish indistinguishable from an empty one:
  // {note, generatedAt, count} is truthy, so the caller would stop looking and
  // serve a note object as the contact map.
  const map = j && typeof j.contacts === 'object' && j.contacts ? j.contacts : null;
  if (!map) return null;

  // Every field here ends up in a tel: or a mailto: in somebody's browser.
  // Validated once, on arrival, rather than trusted because of where it came
  // from — which is now a question this module cannot even answer.
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
}
