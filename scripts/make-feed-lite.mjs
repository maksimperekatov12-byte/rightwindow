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
// every deploy and the two can never drift.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../src/data/feed.json', import.meta.url);
const OUT = new URL('../src/data/feed-lite.json', import.meta.url);
const ROWS = 24;

const d = JSON.parse(readFileSync(SRC));
const lite = {
  lite: true,
  generatedAt: d.generatedAt,
  sources: d.sources,
  whatsNew: d.whatsNew,
  // Register-scope figures the UI must quote correctly BEFORE the full feed
  // lands — a lead line computed from a 24-row slice would be wrong on screen.
  meta: {
    facades: d.facades.feed.length,
    facadeFines: Math.round(d.facades.feed.reduce((s, c) => s + (c.finesOwed || 0), 0)),
    gas: d.gas.feed.length,
    elevators: d.elevators.feed.length,
    carbon: d.carbon.feed.length,
    contracts: d.contracts.length,
    openings: d.openings.length,
    openingsPhones: d.openings.filter((o) => o.phone).length,
    contractsOpen: d.contracts.filter((c) => c.kind !== 'AWARD' && (c.daysLeft == null || c.daysLeft >= 0)).length,
    awardN: d.contracts.filter((c) => c.kind === 'AWARD' && c.amount > 0).length,
    awardsSum: Math.round(d.contracts.filter((c) => c.kind === 'AWARD').reduce((s, c) => s + (c.amount || 0), 0)),
  },
  facades: { totals: d.facades.totals, feed: d.facades.feed.slice(0, ROWS) },
  gas: { totals: d.gas.totals, feed: d.gas.feed.slice(0, ROWS) },
  elevators: { totals: d.elevators.totals, feed: d.elevators.feed.slice(0, ROWS) },
  carbon: { totals: d.carbon.totals, feed: d.carbon.feed.slice(0, ROWS) },
  contracts: d.contracts.slice(0, ROWS),
  openings: d.openings.slice(0, ROWS),
};
writeFileSync(OUT, JSON.stringify(lite));
const kb = (u) => Math.round(readFileSync(u).length / 1024);
console.log(`feed-lite: ${kb(OUT)}KB shell payload (full feed ${kb(SRC)}KB stays out of the bundle)`);
