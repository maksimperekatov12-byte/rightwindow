// One-off: fold the old blob-per-row layout into the two collection documents.
//
// Old: claim/<key>.json and prefs/<uid>.json, one blob each. Reading either
// collection cost a list() plus N get() calls — the design that drained the
// free operation allowance. New: claims.json and prefs.json.
//
// Safe to re-run: it merges rather than overwrites, and leaves the old blobs in
// place. Delete them by hand once you have checked the result.
import { readJson, writeJson, listJson, readDoc, CLAIMS, PREFS } from '../lib/store.mjs';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('migrate: no BLOB_READ_WRITE_TOKEN');
  process.exit(1);
}

const claims = await readDoc(CLAIMS);
let n = 0;
for (const p of await listJson('claim/')) {
  const key = p.replace(/^claim\//, '').replace(/\.json$/, '');
  if (claims[key]) continue;
  const r = await readJson(p);
  if (r) { claims[key] = r; n++; }
}
if (n) await writeJson(CLAIMS, claims);
console.log(`migrate: claims +${n} (total ${Object.keys(claims).length})`);

const prefs = await readDoc(PREFS);
let m = 0;
for (const p of await listJson('prefs/')) {
  const uid = p.replace(/^prefs\//, '').replace(/\.json$/, '');
  if (prefs[uid]) continue;
  const r = await readJson(p);
  if (r) { prefs[uid] = r; m++; }
}
if (m) await writeJson(PREFS, prefs);
console.log(`migrate: prefs +${m} (total ${Object.keys(prefs).length})`);
