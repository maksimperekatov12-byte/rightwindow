// Wipes OUR test marks so a first visitor sees an open register.
//
// Every card we marked Contacted or Won during testing is amber for everybody
// — "taken", with a reservation attached — and a cold-email prospect landing
// on a register that looks half-worked is the worst first impression the
// product can make. Run this before any outreach batch:
//
//     node scripts/clear-demo-state.mjs            # dry run, prints what it would clear
//     node scripts/clear-demo-state.mjs --apply    # clears
//
// It clears claims, personal reservations and per-device tracking marks that
// belong to OUR identities. A real customer's marks are never touched: pass
// --all only when the whole register genuinely needs resetting.
import { readDoc, writeJson, readJsonSoft, CLAIMS, PREFS } from '../lib/store.mjs';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

// Our own devices, by the uid the browser generated for each. Add one here
// rather than clearing everything: prefs.json knows which uid carries which
// email, and ours are the ones with no pilot behind them.
const OURS = new Set(
  (process.env.DEMO_UIDS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
);

const claims = (await readDoc(CLAIMS)) || {};
const prefs = (await readDoc(PREFS)) || {};
const assign = (await readJsonSoft('assign/index.json')) || {};

// A uid is "ours" when it is listed in DEMO_UIDS, or — the common case — when
// it never gave an email address, because every real pilot does.
const anonymous = new Set(
  Object.entries(prefs)
    .filter(([, p]) => !p?.channels?.email)
    .map(([uid]) => uid),
);
const isOurs = (uid) => ALL || OURS.has(uid) || anonymous.has(uid);

const keptClaims = {};
const dropped = [];
for (const [key, c] of Object.entries(claims)) {
  if (isOurs(c?.uid) || !c?.uid) dropped.push(key);
  else keptClaims[key] = c;
}

const keptAssign = {};
const droppedAssign = [];
for (const [uid, rows] of Object.entries(assign)) {
  if (isOurs(uid)) droppedAssign.push(uid);
  else keptAssign[uid] = rows;
}

// Tracking marks (Contacted / Won / Lost / Dismiss) live on the device, in
// localStorage — nothing server-side to clear. The page clears its own on
// ?reset=1 so a demo laptop can be reset without opening devtools.
console.log(`claims:      ${Object.keys(claims).length} → ${Object.keys(keptClaims).length} (clearing ${dropped.length})`);
console.log(`reservations: ${Object.keys(assign).length} holders → ${Object.keys(keptAssign).length} (clearing ${droppedAssign.length})`);
if (dropped.length) console.log(`  cards released: ${dropped.slice(0, 12).join(', ')}${dropped.length > 12 ? ' …' : ''}`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}
await writeJson(CLAIMS, keptClaims);
await writeJson('assign/index.json', keptAssign);
console.log('cleared.');
