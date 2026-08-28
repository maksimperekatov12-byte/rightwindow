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

// Runs from the hourly lane so the migration happens on its own the moment the
// store comes back from suspension. Two cheap gates keep the hourly cost at one
// read: a suspended store exits quietly, a done marker exits quietly.
try {
  if (await readJson('state/migrated.json')) {
    console.log('migrate: already done');
    process.exit(0);
  }
} catch (e) {
  console.log(`migrate: store not available yet (${e.message}) — will retry next hour`);
  process.exit(0);
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

await writeJson('state/migrated.json', { at: Date.now(), claims: n, prefs: m });
console.log('migrate: marker written — this will not run again');
