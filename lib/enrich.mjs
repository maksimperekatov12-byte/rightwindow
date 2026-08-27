// Contact enrichment, provider-agnostic.
//
// Call sites only ever see enrichContact(). The provider is chosen by env
// (ENRICH_PROVIDER + ENRICH_API_KEY) and must carry an ALLOWED verdict in
// data/source-policy.json — same gate the collectors use for city data. A
// provider nobody has reviewed throws; it does not silently guess.
//
// Default is a stub that returns nothing, so the product ships honest: a card
// with no verified number says so rather than dressing up a Google search.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const POLICY = JSON.parse(readFileSync(new URL('../data/source-policy.json', import.meta.url), 'utf8'));
const CACHE_PATH = new URL('../data/enrich-cache.json', import.meta.url);
const TTL_MS = 30 * 24 * 3600 * 1000; // contacts move; a month is long enough to save calls, short enough to stay true

function assertProviderAllowed(id) {
  const p = POLICY.find((x) => x.id === id || x.host === id);
  if (!p) throw new Error(`Enrichment provider "${id}" has no verdict in data/source-policy.json — refusing to call it.`);
  if (p.verdict !== 'ALLOWED') throw new Error(`Enrichment provider "${id}" verdict is ${p.verdict} — refusing. ${p.license}`);
  return p;
}

let cache = null;
function loadCache() {
  if (cache) return cache;
  try {
    cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};
  } catch {
    cache = {};
  }
  return cache;
}
function saveCache() {
  if (!cache) return;
  try {
    mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  } catch {}
}
const keyOf = ({ company, address }) =>
  createHash('sha1').update(`${(company || '').toLowerCase()}|${(address || '').toLowerCase()}`).digest('hex').slice(0, 16);

const EMPTY = { phone: null, email: null, confidence: 'none', source: null };

// A provider returns the same shape as enrichContact. Add one here, record its
// verdict in data/source-policy.json, and set ENRICH_PROVIDER to its id.
const PROVIDERS = {
  stub: async () => EMPTY,
};

export function enrichmentProvider() {
  return process.env.ENRICH_PROVIDER || 'enrich-stub';
}

export function enrichmentReady() {
  const id = enrichmentProvider();
  return id !== 'enrich-stub' && Boolean(process.env.ENRICH_API_KEY);
}

export async function enrichContact({ company, name, address } = {}) {
  const id = enrichmentProvider();
  assertProviderAllowed(id);
  if (!company && !name) return EMPTY;

  const c = loadCache();
  const k = keyOf({ company, address });
  const hit = c[k];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const impl = PROVIDERS[id === 'enrich-stub' ? 'stub' : id];
  if (!impl) throw new Error(`Enrichment provider "${id}" is recorded in policy but not implemented.`);

  let value = EMPTY;
  try {
    value = (await impl({ company, name, address, key: process.env.ENRICH_API_KEY })) || EMPTY;
  } catch (e) {
    console.log(`enrich: ${id} failed (${e.message.slice(0, 80)}) — falling back to none`);
    value = EMPTY;
  }
  c[k] = { at: Date.now(), value };
  saveCache();
  return value;
}
