// Puts the measured contact cache into the private store, where CI can read it.
//
// The cache that matters lives on the machine that measured it — data/enrich-cache.json
// is gitignored, because the repository is public and provider-licensed contact
// data must never land in it. CI therefore starts empty unless it is seeded,
// and an empty CI cache means every run re-resolves companies already known:
// that is how one hour spent a month of search plan on 2026-09-08.
//
// It also drops entries that record a failure rather than a finding — a run
// that could not search wrote 919 of those into the store.
//
//   node --env-file=.env.blob scripts/seed-cache.mjs
import { readFileSync } from 'node:fs';
import { readJson, writeJson } from '../lib/store.mjs';

const local = JSON.parse(readFileSync(new URL('../data/enrich-cache.json', import.meta.url), 'utf8'));
const remote = (await readJson('contacts-cache.json')) || {};

const merged = { ...remote };
let dropped = 0;
for (const [k, v] of Object.entries(merged)) {
  const val = v?.value || {};
  if (!val.phone && !val.email) {
    delete merged[k];
    dropped += 1;
  }
}
let added = 0;
for (const [k, v] of Object.entries(local)) {
  const val = v?.value || {};
  if (!val.phone && !val.email) continue; // only findings travel
  if (!merged[k] || (v.at || 0) > (merged[k].at || 0)) {
    merged[k] = v;
    added += 1;
  }
}
await writeJson('contacts-cache.json', merged);
console.log(
  `seed-cache: store had ${Object.keys(remote).length}, dropped ${dropped} contactless entries, ` +
    `added ${added} measured contacts → ${Object.keys(merged).length} in the store`,
);
