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

// Only a number we can attribute is worth showing. Two acceptance rules, both
// measured against a 50-company sample of real HPD managing agents before this
// shipped: a number on the company's own domain is 'verified'; a number on a
// third-party directory is 'listed'; anything else is not a contact.
const PHONE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);
const DIRECTORY = /(yellowpages|bbb\.org|manta|bizapedia|buzzfile|dnb\.com|opencorporates)/i;
const JUNK_HOST = /(facebook|instagram|twitter|x\.com|pinterest|indeed|glassdoor|zillow|streeteasy)/i;

const normalise = (m) => `+1-${m[1]}-${m[2]}-${m[3]}`;

// A page is only evidence for the company whose page it is.
function phonesFrom(text) {
  const out = [];
  for (const m of String(text).matchAll(PHONE)) {
    if (TOLL_FREE.has(m[1])) continue; // a national line tells you nothing about this office
    const v = normalise(m);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

// Where there is no direct line there is often a shared inbox, and for a cold
// approach that is frequently the better door anyway: it is monitored, it is
// meant to be written to, and it belongs to the company rather than a person.
const EMAIL = /\b[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})\b/g;
// Addresses the company published for exactly this purpose, best first.
const ROLE = /^(info|contact|management|office|admin|hello|leasing|inquiries|customerservice|service|support|help|mail)@/i;
const EMAIL_JUNK = /(sentry|wixpress|example|yourdomain|domain\.com|godaddy|squarespace|\.png|\.jpg|\.webp|@2x|sentry\.io)/i;

// A person's address is deliberately ranked below the company's own inbox: the
// site tells visitors "buildings, not people", and a shared mailbox is both the
// more durable contact and the one nobody has to feel written-at.
function emailsFrom(text, domain) {
  const seen = [];
  for (const m of String(text).matchAll(EMAIL)) {
    const addr = m[0].toLowerCase();
    if (EMAIL_JUNK.test(addr)) continue;
    if (!seen.includes(addr)) seen.push(addr);
  }
  const onDomain = (a) => domain && a.endsWith('@' + domain.replace(/^www\./, ''));
  return seen.sort((a, b) => {
    const score = (x) => (ROLE.test(x) ? 0 : 1) + (onDomain(x) ? 0 : 2);
    return score(a) - score(b);
  });
}

async function searchWeb(query, key, host) {
  if (host === 'api.search.brave.com') {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { 'X-Subscription-Token': key, accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`brave ${r.status}`);
    const j = await r.json();
    return (j.web?.results || []).map((x) => ({ url: x.url, title: x.title, snippet: x.description || '' }));
  }
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, num: 8 }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`serper ${r.status}`);
  const j = await r.json();
  return (j.organic || []).map((x) => ({ url: x.link, title: x.title, snippet: x.snippet || '' }));
}

// Search finds the company's page; the page — not the snippet — supplies the
// number. Snippet-level inference is exactly what inflates a hit rate with
// numbers that belong to a different business at the same address.
async function searchProvider({ company, address, key, host }) {
  if (!company || !key) return EMPTY;
  const zip = (address || '').match(/\b(\d{5})\b/)?.[1] || '';
  const results = await searchWeb(`"${company}" ${zip} New York phone contact`, key, host);
  const usable = results.filter((r) => !JUNK_HOST.test(r.url));
  if (!usable.length) return EMPTY;

  for (const r of usable.slice(0, 4)) {
    let page = '';
    try {
      const res = await fetch(r.url, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'RightWindow/1.0' } });
      if (!res.ok) continue;
      page = (await res.text()).replace(/<[^>]+>/g, ' ');
    } catch {
      continue;
    }
    const domain = new URL(r.url).hostname.replace(/^www\./, '');
    const phones = phonesFrom(page);
    const emails = emailsFrom(page, domain);
    if (!phones.length && !emails.length) continue;
    const gov = domain.endsWith('.gov');
    const dir = DIRECTORY.test(domain);
    // The company's own site has to actually look like the company's own site.
    const slug = company.toLowerCase().replace(/[^a-z]/g, '');
    const own = slug.length > 5 && domain.replace(/[^a-z]/g, '').includes(slug.slice(0, 8));
    if (!own && !gov && !dir) continue;
    // An address from a directory belongs to whoever the directory says it does;
    // only the company's own site vouches for it.
    const email = own || gov ? emails[0] || null : null;
    const found = {
      phone: phones[0] || null,
      email,
      confidence: own || gov ? 'verified' : 'listed',
      source: domain,
    };
    if (found.phone || found.email) return found;
  }
  return EMPTY;
}

// A provider returns the same shape as enrichContact. Add one here, record its
// verdict in data/source-policy.json, and set ENRICH_PROVIDER to its id.
const PROVIDERS = {
  stub: async () => EMPTY,
  serper: (a) => searchProvider({ ...a, host: 'google.serper.dev' }),
  'brave-search': (a) => searchProvider({ ...a, host: 'api.search.brave.com' }),
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
  // Without a live provider the cache is still the contact store: numbers put
  // there by a measured run are real and should reach the card.
  if (!enrichmentReady()) return EMPTY;

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
