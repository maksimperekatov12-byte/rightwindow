// Personal-signal assigner. Runs in the hourly lane after collect (48-hour holds
// do not need a five-minute cadence, and every run costs blob operations):
//  - expires assignments older than 48h (they rotate to another user or back to the pool)
//  - keeps every active user holding up to 3 exclusive, profile-matched, unclaimed signals
import { readDoc, writeJson, CLAIMS, PREFS } from '../lib/store.mjs';
import { readFileSync } from 'node:fs';
import { TRADE_REGISTERS } from '../lib/trade-filters.mjs';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('assign: skipped, no blob token');
  process.exit(0);
}
const HOLD_MS = 48 * 3600 * 1000;
const PER_USER = 3;
const now = Date.now();
const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));

// Which facade buildings a trade may be handed: the same table the site and
// the digest read (lib/trade-filters.mjs). This file kept its own copy, and it
// had drifted — elevator firms were handed facade buildings the site no longer
// shows them, and legal lost the UNSAFE orders the site lists.
const fMatch = Object.fromEntries(
  Object.entries(TRADE_REGISTERS)
    .filter(([k, regs]) => k !== 'explore' && regs.facades)
    .map(([k, regs]) => [k, regs.facades]),
);

const users = Object.values(await readDoc(PREFS))
  .filter((r) => r?.uid && r.profile && Object.hasOwn(fMatch, r.profile))
  .map((r) => ({ uid: r.uid, profile: r.profile }));
const claimed = new Set(Object.keys(await readDoc(CLAIMS)));

const idx = await readDoc('assign/index.json');
let expired = 0;
const lastHolder = {};
for (const [key, a] of Object.entries(idx)) {
  if (a.until <= now || claimed.has(key)) {
    lastHolder[key] = a.uid;
    delete idx[key];
    expired++;
  }
}

const held = {};
for (const a of Object.values(idx)) held[a.uid] = (held[a.uid] || 0) + 1;
const assignedKeys = new Set(Object.keys(idx));
let added = 0;
for (const u of users) {
  const m = fMatch[u.profile];
  const pool = feed.facades.feed
    .filter((c) => m(c))
    .map((c) => 'b:' + c.bin)
    .filter((k) => !claimed.has(k) && !assignedKeys.has(k) && lastHolder[k] !== u.uid);
  while ((held[u.uid] || 0) < PER_USER && pool.length) {
    const key = pool.shift();
    idx[key] = { uid: u.uid, until: now + HOLD_MS, since: now };
    assignedKeys.add(key);
    held[u.uid] = (held[u.uid] || 0) + 1;
    added++;
  }
}
// Writing is an "advanced" blob operation on a tight monthly budget — skip it
// when the index did not actually move.
if (expired || added) await writeJson('assign/index.json', idx);
console.log(
  `assign: users=${users.length} expired=${expired} added=${added} active=${Object.keys(idx).length}` +
    (expired || added ? '' : ' (no write)'),
);
