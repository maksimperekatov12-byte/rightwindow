// Splits the 2MB register out of the JS bundle.
//
// What was gating mobile paint: feed.json was inlined into the main chunk as a
// JavaScript object literal, and a phone CPU spent ~15 seconds parsing it
// before anything painted. The shell now ships with THIS file — every total
// the hooks and leads quote, plus the first rows of each register so the page
// is real on arrival — and the full feed arrives in parallel as JSON, which
// the browser parses off the critical path.
//
// Runs in prebuild, so the hourly CI commit of feed.json regenerates it before
// every deploy and the two can never drift. scripts/test-lite-meta.mjs checks
// every figure below against the same figure computed from the full feed.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readAppRules } from './app-rules.mjs';

const SRC = new URL('../src/data/feed.json', import.meta.url);
const OUT = new URL('../src/data/feed-lite.json', import.meta.url);
export const ROWS = 24;
// The building registers are the weight (800 facade cards alone are ~110KB
// gzipped), so the shell carries their first rows and the UI quotes them only
// from `meta` until the rest lands. City contracts (~150 notices) and new
// openings (~400 venues) ship whole, about 40KB gzipped together: their hooks,
// awards-only headlines, tab gates, top cards and #c/ and #o/ links are all
// trade-scoped and ranked across the whole register, and no stand-in figure
// could reproduce that. A 24-row slice held no awards at all (the collector
// writes solicitations first) and no Health Department venue (SLA rows come
// first), so lender saw "127 notices open" over an empty list and the venue
// that opened on arrival fell out of the first seven a second later.
const SLICED = ['facades', 'gas', 'elevators', 'carbon'];
const MANDATE_KEYS = ['gas', 'elevators', 'carbon'];
// The borough chips a mandate register can offer, in chip order.
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];

export function buildLite(d, { PROFILES, COHORTS, REG_COHORTS } = readAppRules()) {
  const all = () => true;
  const facadePool = (p) => d.facades.feed.filter(p?.facade?.fFilter || all);
  // The toolbar's own rule: a chip that selects nothing, or everything, is not offered.
  const offeredCohorts = (keys, pool) =>
    (keys || []).filter((k) => {
      if (!COHORTS[k]) return false;
      const n = pool.filter(COHORTS[k].of).length;
      return n > 0 && n < pool.length;
    });
  const withFacade = Object.entries(PROFILES).filter(([, p]) => p.facade);
  return {
    lite: true,
    generatedAt: d.generatedAt,
    sources: d.sources,
    sourcesAt: d.sourcesAt || null,
    cityAt: d.cityAt || null,
    cityBy: d.cityBy || null,
    whatsNew: d.whatsNew,
    // Register-scope figures the UI must quote correctly BEFORE the full feed
    // lands — a lead line computed from a 24-row slice would be wrong on screen.
    // Anything a sliced register shows that is not here waits for the full feed.
    meta: {
      sliced: SLICED,
      // Register sizes: tab gates, "open where the work is", what's-new, the
      // trade pages and the coverage table all weigh these.
      ...Object.fromEntries(SLICED.map((k) => [k, d[k].feed.length])),
      facadeFines: Math.round(d.facades.feed.reduce((s, c) => s + (c.finesOwed || 0), 0)),
      // The facade register as each trade sees it (equipment, property
      // management and code attorneys filter it).
      facadesFor: Object.fromEntries(withFacade.map(([k, p]) => [k, facadePool(p).length])),
      // Which borough chips each mandate register offers at all.
      boroughs: Object.fromEntries(
        MANDATE_KEYS.map((k) => [k, BOROUGHS.filter((b) => d[k].feed.some((c) => (c.borough || c.county) === b))]),
      ),
      // Which cohort chips appear: per trade on facades, per register elsewhere.
      cohorts: {
        facades: Object.fromEntries(
          Object.entries(PROFILES)
            .filter(([, p]) => p.cohorts)
            .map(([k, p]) => [k, offeredCohorts(p.cohorts, facadePool(p))]),
        ),
        ...Object.fromEntries(MANDATE_KEYS.map((k) => [k, offeredCohorts(REG_COHORTS[k], d[k].feed)])),
      },
      // The data page's coverage table: cards that reach a named contact.
      reached: Object.fromEntries(SLICED.map((k) => [k, d[k].feed.filter((c) => c.agent?.contactKnown).length])),
    },
    ...Object.fromEntries(SLICED.map((k) => [k, { totals: d[k].totals, feed: d[k].feed.slice(0, ROWS) }])),
    contracts: d.contracts,
    openings: d.openings,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUT, JSON.stringify(buildLite(JSON.parse(readFileSync(SRC)))));
  const kb = (u) => Math.round(readFileSync(u).length / 1024);
  console.log(`feed-lite: ${kb(OUT)}KB shell payload (full feed ${kb(SRC)}KB stays out of the bundle)`);
}
