// Every figure the lite shell quotes must be the figure the page shows once
// the full feed lands — otherwise it is a number that corrects itself a second
// after first paint, the one thing this page cannot afford.
//
// For the committed src/data/feed.json this builds the lite shell the way
// prebuild does, then recomputes each `meta` figure from the FULL feed with the
// formula the page itself uses in the full phase (named per line below) and
// requires the two to agree, for every trade. A meta field with no full-phase
// formula here fails the run, so a new one cannot ship unchecked. It also holds
// the shell to its own declaration: a register not listed in meta.sliced must
// ship whole, and a sliced one must be the register's first rows.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildLite, ROWS } from './make-feed-lite.mjs';
import { readAppRules } from './app-rules.mjs';

const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url)));
const rules = readAppRules();
const { PROFILES, COHORTS, REG_COHORTS } = rules;
const lite = buildLite(feed, rules);
const { meta } = lite;
const all = () => true;
const MANDATES = ['gas', 'elevators', 'carbon'];
// profileKey null is the visitor who picked nothing: the page renders explore.
const TRADES = [null, ...Object.keys(PROFILES)];
const profileOf = (k) => PROFILES[k] || PROFILES.explore;

// App.jsx facadeFeed: the facade register through the trade's own filter
// (GENERIC_FACADE has none), before search and chips.
const facadeFeed = (k) => feed.facades.feed.filter(profileOf(k).facade?.fFilter || all);
// App.jsx toolbar cohort chips (facades and miniToolbar): hidden when they
// select nothing or everything.
const chipsShown = (keys, pool) =>
  (keys || []).filter((key) => {
    const def = COHORTS[key];
    if (!def) return false;
    const n = pool.filter(def.of).length;
    return !(!n || n === pool.length);
  });
// App.jsx miniToolbar `ever`: a borough the register never touches gets no chip.
const chipBoroughs = (k) =>
  ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'].filter((b) => feed[k].feed.some((c) => (c.borough || c.county) === b));

// Each meta field: [what the lite page reads, what the full page computes], per trade where it varies.
const CHECKS = {
  sliced: () => {
    const regs = Object.keys(feed).filter((k) => Array.isArray(feed[k]) || Array.isArray(feed[k]?.feed));
    for (const k of regs) {
      if (meta.sliced.includes(k)) {
        assert.deepEqual(lite[k].totals, feed[k].totals, `${k}: totals must ship whole`);
        assert.deepEqual(lite[k].feed, feed[k].feed.slice(0, ROWS), `${k}: a sliced register ships its first ${ROWS} rows`);
      } else {
        assert.deepEqual(lite[k], feed[k], `${k} is not in meta.sliced, so the page computes from it directly — it must ship whole`);
      }
    }
    for (const k of meta.sliced) assert.ok(regs.includes(k), `meta.sliced names ${k}, which the feed does not have`);
  },
  // vertSize, whatsNew, tradeVolume, the facade clause of the trade pages: (data[k]?.feed || []).length
  facades: () => assert.equal(meta.facades, feed.facades.feed.length, 'facades size'),
  gas: () => assert.equal(meta.gas, feed.gas.feed.length, 'gas size'),
  elevators: () => assert.equal(meta.elevators, feed.elevators.feed.length, 'elevators size'),
  carbon: () => assert.equal(meta.carbon, feed.carbon.feed.length, 'carbon size'),
  // App.jsx facadeFines
  facadeFines: () =>
    assert.equal(meta.facadeFines, Math.round(feed.facades.feed.reduce((s, c) => s + (c.finesOwed || 0), 0)), 'facadeFines'),
  // App.jsx vertSize.facades and tradeVolume's facade count; lite reads
  // meta.facadesFor[trade] ?? meta.facades.
  facadesFor: () => {
    for (const k of TRADES) {
      assert.equal(meta.facadesFor[k] ?? meta.facades, facadeFeed(k).length, `facade register as ${k} sees it`);
    }
  },
  // App.jsx miniToolbar borough chips (`ever`).
  boroughs: () => {
    for (const k of MANDATES) assert.deepEqual(meta.boroughs[k], chipBoroughs(k), `${k} borough chips`);
  },
  // App.jsx facade toolbar cohort chips (per trade) and miniToolbar's (per register).
  cohorts: () => {
    for (const k of TRADES) {
      const lit = profileOf(k).cohorts ? meta.cohorts.facades[k] || [] : [];
      assert.deepEqual(lit, chipsShown(profileOf(k).cohorts, facadeFeed(k)), `facade cohort chips for ${k}`);
    }
    for (const k of MANDATES) assert.deepEqual(meta.cohorts[k], chipsShown(REG_COHORTS[k], feed[k].feed), `${k} cohort chips`);
  },
  // Data.jsx coverage table: cards whose agent has a known contact.
  reached: () => {
    for (const k of meta.sliced) {
      assert.equal(meta.reached[k], feed[k].feed.filter((c) => c.agent?.contactKnown).length, `${k} coverage`);
    }
  },
};

const unchecked = Object.keys(meta).filter((k) => !CHECKS[k]);
assert.deepEqual(unchecked, [], `meta fields with no full-phase formula in scripts/test-lite-meta.mjs: ${unchecked.join(', ')}`);
for (const [k, check] of Object.entries(CHECKS)) {
  assert.ok(k in meta, `meta.${k} is checked here but no longer built by make-feed-lite`);
  check();
}

// The file prebuild just wrote is the one the bundle inlines; it must be this build.
const OUT = new URL('../src/data/feed-lite.json', import.meta.url);
if (existsSync(OUT)) {
  assert.deepEqual(JSON.parse(readFileSync(OUT)), JSON.parse(JSON.stringify(lite)), 'src/data/feed-lite.json is stale: run node scripts/make-feed-lite.mjs');
}

console.log(`lite meta: ${Object.keys(CHECKS).length} figures match the full feed for ${TRADES.length} trades`);
