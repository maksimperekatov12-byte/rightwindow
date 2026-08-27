// Personal-signal assigner. Runs hourly after collect:
//  - expires assignments older than 48h (they rotate to another user or back to the pool)
//  - keeps every active user holding up to 3 exclusive, profile-matched, unclaimed signals
import { readJson, writeJson, listJson } from '../lib/store.mjs';
import { readFileSync } from 'node:fs';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('assign: skipped, no blob token');
  process.exit(0);
}
const HOLD_MS = 48 * 3600 * 1000;
const PER_USER = 3;
const now = Date.now();
const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));

const FACADE = new Set(['qewi', 'restoration', 'elevator', 'insurance', 'lender', 'equipment', 'propmgmt', 'legal', 'cre']);
const fMatch = {
  elevator: (c) => Boolean(c.elevator),
  propmgmt: (c) => Boolean(c.ownerChange || c.mgmtChange),
  legal: (c) => Boolean(c.nextHearing || c.freshHaz || (c.ecbBalance || 0) > 0),
  equipment: (c) => c.signals.some((s) => ['SWARMP_CARRYOVER', 'UNSAFE_PRIOR'].includes(s.kind)) || Boolean(c.shed),
};

const prefPaths = await listJson('prefs/');
const users = [];
for (const p of prefPaths) {
  const r = await readJson(p);
  if (r?.uid && r.profile && FACADE.has(r.profile)) users.push({ uid: r.uid, profile: r.profile });
}
const claimPaths = await listJson('claim/');
const claimed = new Set(claimPaths.map((p) => p.replace(/^claim\//, '').replace(/\.json$/, '')));

const idx = (await readJson('assign/index.json')) || {};
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
  const m = fMatch[u.profile] || (() => true);
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
await writeJson('assign/index.json', idx);
console.log(`assign: users=${users.length} expired=${expired} added=${added} active=${Object.keys(idx).length}`);
