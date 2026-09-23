// Subscribers and suppressions, one blob per address.
//
// The first design kept one JSON document per list and read-modify-wrote it.
// Vercel Blob reads are CDN-cached, so a function could read a copy minutes
// old, add its subscriber, and write the stale list back — the live test
// resurrected an address deleted an hour earlier and lost the one just added.
// A document store with cached reads cannot host read-modify-write.
//
// One file per address has no read-modify-write: subscribing writes one file
// (idempotently), unsubscribing writes one tombstone and deletes one file, and
// nothing ever rewrites the whole list. The senders enumerate with list(),
// which is served by the API rather than the CDN.
import { createHash } from 'node:crypto';
import { readJson, writeJson, removeJson, listJson } from './store.mjs';

const norm = (e) => String(e || '').trim().toLowerCase();
const keyOf = (email) => createHash('sha1').update(norm(email)).digest('hex').slice(0, 24);
const subPath = (email) => `subscribers/${keyOf(email)}.json`;
const supPath = (email) => `suppressed/${keyOf(email)}.json`;

export async function addSubscriber({ email, profile = null, boro = null }) {
  const e = norm(email);
  const prev = await readJson(subPath(e)).catch(() => null);
  await writeJson(subPath(e), {
    email: e,
    profile: profile || prev?.profile || null,
    boro: boro || prev?.boro || null,
    since: prev?.since || new Date().toISOString(),
    updated: new Date().toISOString(),
  });
  // When the record was last written before this call, so the endpoint can
  // tell a person re-clicking from a loop re-sending the confirmation.
  return { already: Boolean(prev), prevUpdated: prev?.updated || null };
}

export async function removeSubscriber(email) {
  await removeJson(subPath(norm(email)));
}

export async function suppress(email) {
  await writeJson(supPath(norm(email)), { email: norm(email), at: new Date().toISOString() });
}

export async function unsuppress(email) {
  await removeJson(supPath(norm(email)));
}

// Whether an address has unsubscribed. Fails closed: a store that cannot answer
// counts as suppressed, because mailing someone who opted out is the worse
// mistake. The sign-up endpoints no longer lift a suppression at all — anyone
// can post anyone's address, so "signing up again" proves nothing about who
// asked, and it used to undo the recipient's own unsubscribe.
export async function isSuppressed(email) {
  const t = await readJson(supPath(norm(email))).catch(() => 'unreadable');
  return t !== null;
}

// The set every sender consults. list() enumerates; each tombstone carries its
// address, because the filename is a hash on purpose.
export async function suppressedSet() {
  const out = new Set();
  try {
    const paths = await listJson('suppressed/');
    for (const p of paths) {
      const t = await readJson(p).catch(() => null);
      if (t?.email) out.add(norm(t.email));
    }
  } catch {}
  return out;
}
