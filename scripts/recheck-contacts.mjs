// Re-read the page behind every contact the cards use, and keep, correct or
// withdraw it by what the page says today. No search is spent. The rules are
// in lib/recheck.mjs; this pulls the shared cache, runs them, pushes the
// result and reports the pass to /status.
//
//   node scripts/recheck-contacts.mjs                       the hourly job, after collect
//   node --env-file=.env.local scripts/recheck-contacts.mjs --dry-run
//
// --dry-run reads the real store, fetches every due page and prints what the
// pass would do — per level, per outcome, and which cards would keep or lose
// a number — and writes nothing: not the store, not the local cache, not
// data/health.json.
import { readFileSync } from 'node:fs';
import { runRecheck, cardsServed, lastCheckAt, checkable } from '../lib/recheck.mjs';
import { recorder, amendHealth, readHealth } from '../lib/health.mjs';

const dryRun = process.argv.includes('--dry-run');
const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
const n = (x) => Number(x || 0).toLocaleString('en-US');
const dur = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('recheck: no blob token — the shared cache cannot be read, nothing re-checked');
  process.exit(0);
}
const store = await import('../lib/store.mjs');
// Belt and braces: in a dry run the store's writer is not even handed over.
const writeJson = dryRun
  ? async () => {
      throw new Error('dry run: refusing to write to the store');
    }
  : store.writeJson;

const health = dryRun ? null : recorder('hourly');
let out;
try {
  out = await runRecheck({ feed, readJson: store.readJson, writeJson, dryRun });
} catch (e) {
  // Fail closed, as the collector does: without a good read nothing is
  // checked and nothing is pushed. The cards keep what the cache had.
  console.log(`recheck: the shared cache could not be read (${e.message}) — nothing re-checked, nothing pushed`);
  if (health) {
    health.note('contacts', { ok: false, error: `the shared contact cache could not be read (${String(e.message).slice(0, 120)}) — nothing re-checked` });
    amendHealth(health.finish({ outcome: 'ok' }));
  }
  process.exit(0);
}

const { registers, pairs, before, doc, results, due, ms, pushed, standing: s } = out;
const now = Date.now();

// ---- the pass, for /status ---------------------------------------------------
// "When the last full pass finished": now, if this run left nothing due;
// otherwise whatever the last run that did said. On the first run with no
// memory of one, the newest check among a set with nothing due is when it was.
const prevPass = readHealth().carry?.contacts?.fullPassAt || null;
let fullPassAt = prevPass;
if (s.due === 0) {
  if (results.length) fullPassAt = now;
  else if (!fullPassAt) {
    const checks = pairs.map((p) => doc[p.key]).filter((e) => checkable(e) && e.lastCheck).map(lastCheckAt);
    fullPassAt = checks.length ? Math.max(...checks) : null;
  }
}
const summary =
  `${n(s.confirmed)} confirmed · ${n(s.changed)} changed · ${n(s.withdrawn)} withdrawn · ` +
  `${n(s.unreachable)} unreachable · ${n(s.unconfirmed)} unconfirmed` +
  (s.absent ? ` · ${n(s.absent)} missing once` : '') +
  (s.unchecked ? ` · ${n(s.unchecked)} not yet checked` : '');

const tally = {};
for (const r of results) {
  tally[r.level] ||= {};
  tally[r.level][r.outcome] = (tally[r.level][r.outcome] || 0) + 1;
}
const line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${n(v)}`).join(' · ');

if (!dryRun) {
  console.log(
    results.length
      ? `recheck: ${n(results.length)} of ${n(due)} due re-read in ${dur(ms)} — ${line(results.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] || 0) + 1), a), {}))}`
      : 'recheck: nothing due',
  );
  console.log(`recheck: cards' contacts now ${summary}${s.due ? ` · ${n(s.due)} still due` : ''}`);
  console.log(pushed ? `recheck: pushed ${n(pushed)} entries to the shared cache` : 'recheck: the shared cache is unchanged — not rewritten');
  health.note('contacts', {
    ok: true,
    rows: results.length,
    ms,
    detail: { ...s, checked: results.length, fullPassAt, summary },
  });
  amendHealth(health.finish({ outcome: 'ok' }), { contacts: { fullPassAt } });
  process.exit(0);
}

// ---- the dry run's report ----------------------------------------------------
const levels = {};
let tombs = 0;
let missing = 0;
for (const p of pairs) {
  const e = before[p.key];
  if (!e) missing++;
  else if (e.value?.rejected) tombs++;
  else if (checkable(e)) levels[e.value.confidence] = (levels[e.value.confidence] || 0) + 1;
}
const cardCount = pairs.reduce((a, p) => a + p.bins.length, 0);
console.log(`recheck (dry run): registers in the feed — ${registers.join(', ')}`);
console.log(
  `recheck (dry run): ${n(pairs.length)} (company, address) pairs on ${n(cardCount)} cards — ` +
    `${n(Object.values(levels).reduce((a, b) => a + b, 0))} carry a contact to hold (${line(levels)}), ` +
    `${n(tombs)} already withdrawn, ${n(missing)} with no cache entry`,
);
console.log(`recheck (dry run): ${n(due)} due; ${n(results.length)} re-read in ${dur(ms)}`);
console.log('\nOutcome by level (this run):');
for (const [lvl, o] of Object.entries(tally)) console.log(`  ${lvl.padEnd(10)} ${line(o)}`);
console.log(`\nStanding after the run, over the pairs the cards use:\n  ${summary}${s.due ? ` · ${n(s.due)} still due` : ''}`);

// Which cards keep a number: now, and on the day of the pitch if no search key
// arrives and no further pass runs.
const pitch = Date.UTC(2026, 9, 8, 16);
const at = (d, t) => cardsServed(d, pairs, t);
const [b0, a0, b1, a1] = [at(before, now), at(doc, now), at(before, pitch), at(doc, pitch)];
const lostNow = pairs.filter((p) => b0.pairs.has(p.key) && !a0.pairs.has(p.key));
const gainedNow = pairs.filter((p) => !b0.pairs.has(p.key) && a0.pairs.has(p.key));
const cardsOf = (ps) => ps.reduce((a, p) => a + p.bins.length, 0);
console.log('\nCards with a number:');
console.log(
  `  today       before ${n(b0.cards)} → after ${n(a0.cards)}  ` +
    `(${n(a0.cards - cardsOf(gainedNow))} keep one, ${n(cardsOf(lostNow))} lose one on ${n(lostNow.length)} pairs, ${n(cardsOf(gainedNow))} gain one)`,
);
console.log(`  Oct 8       before ${n(b1.cards)} → after ${n(a1.cards)}  (no search key, no further pass)`);

const imperial = pairs.find((p) => p.bins.includes('4079440'));
if (imperial) {
  const e0 = before[imperial.key];
  const e1 = doc[imperial.key];
  const r = results.find((x) => x.key === imperial.key);
  const shown = a0.pairs.has(imperial.key);
  console.log(
    `\nBIN 4079440 — ${imperial.company}, filed at ${imperial.address} (key ${imperial.key}, ${imperial.bins.length} card${imperial.bins.length === 1 ? '' : 's'}):\n` +
      `  before: ${e0?.value?.rejected ? `tombstone — ${e0.value.rejected}` : e0 ? `${e0.value.confidence} via ${e0.value.source}` : 'no entry'}\n` +
      `  this run: ${r ? `${r.outcome}${r.reason ? ` — ${r.reason}` : ''}` : 'not re-checked (a tombstone is never re-checked)'}\n` +
      `  after: ${e1?.value?.rejected ? 'tombstone' : e1?.value?.confidence || 'no entry'}; the card ${shown ? 'SHOWS a number' : 'shows no number'}`,
  );
}

const list = (title, rows, fmt, max = 20) => {
  if (!rows.length) return;
  console.log(`\n${title} (${n(rows.length)}):`);
  for (const r of rows.slice(0, max)) console.log(`  ${fmt(r)}`);
  if (rows.length > max) console.log(`  … and ${n(rows.length - max)} more`);
};
const cards = (r) => `${r.bins.length} card${r.bins.length === 1 ? '' : 's'}`;
list('Rejected under the directory rule', results.filter((r) => r.outcome === 'rejected'), (r) => `${r.company} (${cards(r)}) — ${r.reason}`, 25);
list('Withdrawn, gone from the page twice', results.filter((r) => r.outcome === 'withdrawn'), (r) => `${r.company} (${cards(r)}) — ${r.reason}`);
list('Changed — the page now carries another number', results.filter((r) => r.outcome === 'changed'), (r) => `${r.company} (${r.level}, ${cards(r)})`);
list('Absent once — the exact page loaded without it', results.filter((r) => r.outcome === 'absent'), (r) => `${r.company} (${r.level}, ${cards(r)})`, 15);
console.log('\ndry run: nothing written — not the store, not the local cache, not data/health.json');
