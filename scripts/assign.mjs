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

// A building reserved for you is only worth the reservation if there is
// somebody to ring. The pool used to be taken in urgency order alone, and on
// 2026-09-24 the owner's own three reserved cards were three with no number,
// sitting above every callable building. So a number comes first: what the
// private store serves (the same rows /api/live hands the cards), then an
// inbox, then nothing — urgency decides only within those.
let served = {};
try {
  served = await readDoc('contacts.json');
} catch (e) {
  console.log(`assign: the contact store could not be read (${e.message}) — ordering by the feed's contact flag alone`);
}
const bins = new Map(feed.facades.feed.map((c) => [String(c.bin), c]));
const reach = (key) => {
  const bin = key.slice(2);
  if (served[bin]?.phone) return 2;
  return served[bin]?.email || bins.get(bin)?.agent?.contactKnown ? 1 : 0;
};

const held = {};
for (const a of Object.values(idx)) held[a.uid] = (held[a.uid] || 0) + 1;
const assignedKeys = new Set(Object.keys(idx));
let added = 0;
let swapped = 0;
for (const u of users) {
  const m = fMatch[u.profile];
  const pool = feed.facades.feed
    .filter((c) => m(c))
    .map((c) => 'b:' + c.bin)
    .filter((k) => !claimed.has(k) && !assignedKeys.has(k) && lastHolder[k] !== u.uid)
    .map((k, i) => ({ k, i }))
    .sort((a, b) => reach(b.k) - reach(a.k) || a.i - b.i)
    .map((x) => x.k);
  // A reservation already held with no number gives way to a building that
  // has one, one for one. Only then: with no numbered building left for this
  // trade, it stays, rather than churning every hour.
  const weak = Object.entries(idx)
    .filter(([k, a]) => a.uid === u.uid && reach(k) < 2)
    .map(([k]) => k);
  let numbered = pool.filter((k) => reach(k) === 2).length;
  for (const k of weak) {
    if (numbered-- <= 0) break;
    delete idx[k];
    held[u.uid]--;
    swapped++;
  }
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
// --dry-run reads everything and writes nothing.
const dryRun = process.argv.includes('--dry-run');
if ((expired || added || swapped) && !dryRun) await writeJson('assign/index.json', idx);
if (dryRun) {
  for (const [k, a] of Object.entries(idx)) console.log(`  ${k} → ${a.uid.slice(0, 8)}… reach ${reach(k)} (${a.since === now ? 'new' : 'kept'})`);
}
console.log(
  `assign: users=${users.length} expired=${expired} added=${added} swapped for a numbered building=${swapped} ` +
    `active=${Object.keys(idx).length}` +
    (expired || added || swapped ? '' : ' (no write)'),
);
