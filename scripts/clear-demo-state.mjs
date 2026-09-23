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
//
// Claims are open to anyone, so this is also the tool for undoing a script that
// claimed cards in bulk. The attacker's uid is not in prefs, so a plain run keeps
// its claims, and --all would take every real pilot's claims and reservations
// with them. Three narrower selectors release just the bad ones; each ADDS to
// what a plain run clears, and the dry run lists the busiest sources first:
//
//     --uid=<uid>[,<uid>…]     everything those devices claimed or hold
//     --src=<hash>[,<hash>…]   every claim from those source addresses (the
//                              hash api/claims.js stores; see the dry run)
//     --after=<ISO date|ms>    every claim taken at or after that moment, by
//                              anyone — check the dry run before applying
import { readDoc, writeJson, readJsonSoft, CLAIMS, PREFS } from '../lib/store.mjs';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const flag = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const listFlag = (name) => new Set((flag(name) || '').split(',').map((s) => s.trim()).filter(Boolean));
const SRC = listFlag('src');
const AFTER = (() => {
  const v = flag('after');
  if (!v) return null;
  const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(t)) {
    console.error(`--after=${v} is neither a date nor epoch milliseconds`);
    process.exit(1);
  }
  return t;
})();

// Our own devices, by the uid the browser generated for each. Add one here
// rather than clearing everything: prefs.json knows which uid carries which
// email, and ours are the ones with no pilot behind them.
const OURS = new Set(
  (process.env.DEMO_UIDS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
);
for (const u of listFlag('uid')) OURS.add(u);

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

const bulk = (c) => (c?.src && SRC.has(c.src)) || (AFTER !== null && c?.at >= AFTER);

const keptClaims = {};
const dropped = [];
for (const [key, c] of Object.entries(claims)) {
  if (isOurs(c?.uid) || !c?.uid || bulk(c)) dropped.push(key);
  else keptClaims[key] = c;
}

// The index is keyed by CARD — { "b:1234": { uid, until, since } } — the way
// scripts/assign.mjs writes it and api/live.js reads it. This loop used to read
// the keys as uids, so it never matched one and no reservation was ever cleared.
const keptAssign = {};
const droppedAssign = [];
for (const [key, a] of Object.entries(assign)) {
  if (isOurs(a?.uid) || !a?.uid) droppedAssign.push(key);
  else keptAssign[key] = a;
}

// Tracking marks (Contacted / Won / Lost / Dismiss) live on the device, in
// localStorage — nothing server-side to clear. The page clears its own on
// ?reset=1 so a demo laptop can be reset without opening devtools.
console.log(`claims:      ${Object.keys(claims).length} → ${Object.keys(keptClaims).length} (clearing ${dropped.length})`);
console.log(`reservations: ${Object.keys(assign).length} → ${Object.keys(keptAssign).length} (clearing ${droppedAssign.length})`);
if (dropped.length) console.log(`  cards released: ${dropped.slice(0, 12).join(', ')}${dropped.length > 12 ? ' …' : ''}`);

// Who is holding the register: claims per source address in the last day and in
// total. A bulk claimer is the one line that dwarfs the rest; its hash is what
// --src takes. Claims taken before the source was recorded show as "(none)".
{
  const day = Date.now() - 864e5;
  const by = {};
  for (const c of Object.values(claims)) {
    const s = c?.src || '(none)';
    by[s] ||= { total: 0, day: 0 };
    by[s].total++;
    if (c?.at > day) by[s].day++;
  }
  const top = Object.entries(by).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  if (top.length) {
    console.log('  claims by source (top 5):');
    for (const [s, n] of top) console.log(`    ${s.padEnd(12)}  ${n.total} total, ${n.day} in the last 24h`);
  }
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}
await writeJson(CLAIMS, keptClaims);
await writeJson('assign/index.json', keptAssign);
console.log('cleared.');
