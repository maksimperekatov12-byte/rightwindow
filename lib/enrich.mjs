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
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { currentRecorder } from './health.mjs';

const POLICY = JSON.parse(readFileSync(new URL('../data/source-policy.json', import.meta.url), 'utf8'));
// ENRICH_CACHE_PATH exists for the tests, which must never read or write the
// real cache on the machine that runs them.
const CACHE_PATH = process.env.ENRICH_CACHE_PATH
  ? pathToFileURL(resolve(process.env.ENRICH_CACHE_PATH))
  : new URL('../data/enrich-cache.json', import.meta.url);
const TTL_MS = 30 * 24 * 3600 * 1000; // contacts move; a month is long enough to save calls, short enough to stay true
// A number whose page could not be read — the site was down, or it turns bots
// away — is not thereby a wrong number. lib/recheck.mjs records that outcome,
// and such a number keeps serving for a second month before it lapses.
const GRACE_MS = 60 * 24 * 3600 * 1000;
const GRACE_OUTCOMES = new Set(['unreachable', 'unconfirmed']);

// When the number was last known good: the search that found it (at) or the
// re-check that saw it again on its page (checkedAt, lib/recheck.mjs).
export const lastConfirmed = (e) => Math.max(e?.at || 0, e?.checkedAt || 0);
// The newest word on an entry of any kind, a re-check that did NOT see the
// number included.
export const stampOf = (e) => Math.max(e?.at || 0, e?.checkedAt || 0, e?.lastCheck?.at || 0);

function assertProviderAllowed(id) {
  const p = POLICY.find((x) => x.id === id || x.host === id);
  if (!p) throw new Error(`Enrichment provider "${id}" has no verdict in data/source-policy.json — refusing to call it.`);
  if (p.verdict !== 'ALLOWED') throw new Error(`Enrichment provider "${id}" verdict is ${p.verdict} — refusing. ${p.license}`);
  return p;
}

// What the store held when this process pulled it, blind to key order, so a
// run that resolved nothing new can tell and leave the store alone.
let pulledAs = null;
const canonical = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

// Pull the shared cache down before collecting, so a CI run inherits every
// contact resolved anywhere — including the measured ones, which no provider
// call would reproduce for free.
//
// A read that failed is not an empty store. This used to swallow the error and
// return 0, the same answer as a store that does not exist yet, and CI has no
// cache on disk: after one blip on the read (the store's get() does not retry)
// a run would see no searches made today, spend its budget re-resolving firms
// the store already held, and push those few dozen entries over the whole
// shared cache — a harness reproduced exactly that. store.mjs keeps the two
// apart — null for missing, a throw for failed — and so does this now: the
// throw reaches the caller, and only a read that got an answer allows a push.
let pulledOk = false;
export async function pullCache(readJson) {
  const remote = await readJson('contacts-cache.json');
  pulledOk = true;
  if (!remote) return 0;
  pulledAs = canonical(remote);
  const added = mergeCache(loadCache(), remote);
  if (added) {
    byName = null;
    saveCache();
  }
  return added;
}

// The newest word wins, whatever kind it is. Merging on `at` alone would let
// a machine holding an older copy undo a re-check: on 2026-09-24 the card for
// BIN 4079440 still carried a same-name East Meadow firm's number, withdrawn by
// a tombstone stamped that morning, and every laptop with the August entry on
// disk would otherwise have been one pull away from putting it back.
export function mergeCache(into, from) {
  let n = 0;
  for (const [k, v] of Object.entries(from || {})) {
    if (!v) continue;
    if (!into[k] || stampOf(v) > stampOf(into[k])) {
      into[k] = v;
      n++;
    }
  }
  return n;
}

// After a good pull the local cache is the whole store plus this run's
// additions, so the push can only grow it. Without one it could only shrink it.
export async function pushCache(writeJson) {
  if (!pulledOk) return 0;
  const c = loadCache();
  if (!Object.keys(c).length) return 0;
  // A put is an advanced operation against a 2,000-a-month allowance, and at
  // one sweep an hour most runs resolve nothing new. Writing back exactly what
  // was pulled cost 720 of those a month for nothing.
  if (pulledAs && canonical(c) === pulledAs) return 0;
  await writeJson('contacts-cache.json', c);
  return Object.keys(c).length;
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
    mkdirSync(dirname(fileURLToPath(CACHE_PATH)), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  } catch {}
}
// The re-check (lib/recheck.mjs) works on the same entries this module serves:
// the live object, written back with saveContactCache(). reloadContactCache()
// drops the copy in memory so the next read comes from disk.
export const contactCache = () => loadCache();
export function saveContactCache() {
  byName = null;
  saveCache();
}
export function reloadContactCache() {
  cache = null;
  byName = null;
}
export const keyOf = ({ company, address }) =>
  createHash('sha1').update(`${(company || '').toLowerCase()}|${(address || '').toLowerCase()}`).digest('hex').slice(0, 16);

// HPD lets an agent file under whichever of its buildings it likes, so the same
// firm turns up at several addresses and an address-keyed cache misses itself.
// A company-level index catches that — and it is what makes a NEW building under
// an already-known agent resolve instantly, with no query at all.
const nameKey = (company) =>
  String(company || '')
    .toUpperCase()
    .replace(/\b(INC|LLC|CORP|CORPORATION|LTD|CO|COMPANY|GROUP|THE)\b/g, '')
    .replace(/[^A-Z0-9]+/g, '')
    .trim();

// Per name, the entry most able to travel: a verified one before any other,
// and among those the one seen most recently. The first entry met used to win,
// which was harmless while every entry aged from its search; now a re-check
// keeps one copy of a firm fresh while an unchecked copy at another address
// ages out, and the stale one must not stand in for it.
export function buildIndex(doc) {
  const idx = new Map();
  const rank = (e) => [e.value.confidence === 'verified' ? 1 : 0, lastConfirmed(e)];
  for (const entry of Object.values(doc || {})) {
    const v = entry?.value;
    if (!v || v.rejected || v.confidence === 'none' || (!v.phone && !v.email)) continue;
    const n = v.company ? nameKey(v.company) : null;
    if (!n) continue;
    const had = idx.get(n);
    const [a, b] = rank(entry);
    const [c, d] = had ? rank(had) : [-1, -1];
    if (a > c || (a === c && b > d)) idx.set(n, entry);
  }
  return idx;
}
let byName = null;
function companyIndex() {
  return (byName ||= buildIndex(loadCache()));
}

const EMPTY = { phone: null, email: null, confidence: 'none', source: null, via: null };

// What the cache alone can serve for a (company, address) pair at `now`, with
// no search and no write — enrichContact() below, and the re-check's report
// of which cards keep a number (scripts/recheck-contacts.mjs), both ask this.
//
//   fresh    seen good within thirty days: by its search, or by a re-check
//   grace    not fresh, but the last re-check could not read the page
//            (unreachable / unconfirmed) and it was seen good within sixty
//   sibling  the same firm's own verified number, filed at another address
//   tomb     withdrawn (value.rejected): serves nothing
//   held     a pre-rule directory number yet to show its tie: serves nothing
//   stale / missing
export function fromCache(doc, { company, address }, now = Date.now(), index = null) {
  const hit = doc?.[keyOf({ company, address })];
  if (hit?.value?.rejected) return { state: 'tomb', value: null, entry: hit };
  // A directory number found before the directory rule that has not yet shown
  // its tie to the filing (lib/recheck.mjs): off the cards while the re-check
  // keeps reading its page, not withdrawn.
  if (hit?.lastCheck?.outcome === 'held') return { state: 'held', value: null, entry: hit };
  const age = hit ? now - lastConfirmed(hit) : Infinity;
  if (hit && age < TTL_MS) return { state: 'fresh', value: hit.value, entry: hit };
  if (hit && age < GRACE_MS && GRACE_OUTCOMES.has(hit.lastCheck?.outcome)) return { state: 'grace', value: hit.value, entry: hit };
  // Same firm, different building on the filing. Only a number the company
  // itself publishes travels by name: a directory listing was accepted for one
  // filing address, and a same-name firm at another address is exactly the
  // case that rule exists to keep out.
  const sibling = (index || buildIndex(doc)).get(nameKey(company));
  if (sibling && sibling.value?.confidence === 'verified' && now - lastConfirmed(sibling) < TTL_MS) {
    return { state: 'sibling', value: sibling.value, entry: sibling };
  }
  return { state: hit ? 'stale' : 'missing', value: null, entry: hit || null };
}

// The day, in New York, the number on this pair's entry was last seen good.
// Cards print it ("checked Sep 24"), so a caller can tell a number read off
// its page this morning from one found by a search a month ago.
export function confirmedOn({ company, address }) {
  const t = lastConfirmed(loadCache()[keyOf({ company, address })]);
  return t ? new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null;
}

// Four levels, in descending order of how much the contact can be trusted to be
// the registered entity's own:
//
//   verified   the company's own domain, or a .gov record
//   listed     a third-party directory vouching for the same company
//   affiliate  a DIFFERENT named company that demonstrably runs this building —
//              the on-site managing agent, the sponsor nonprofit, a company at
//              the same suite with the same principals. The call reaches the
//              people who decide, but not under the name on the registration,
//              so `via` must always name who actually picks up.
//   none       nothing we can stand behind
//
// The affiliate tier exists because 11 of 50 sampled registrations are
// single-purpose holding LLCs with no presence anywhere: without it those
// buildings have no door at all. It is deliberately the only tier that requires
// naming a second party, because a caller who does not know they are ringing a
// different company will open the call wrong.
export const LEVELS = ['verified', 'listed', 'affiliate', 'none'];

// Only a number we can attribute is worth showing. Two acceptance rules, both
// measured against a 50-company sample of real HPD managing agents before this
// shipped: a number on the company's own domain is 'verified'; a number on a
// third-party directory is 'listed', and only when that page also shows the
// address the city has on file (acceptPage); anything else is not a contact.
const PHONE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);
const DIRECTORY = /(yellowpages|bbb\.org|manta|bizapedia|buzzfile|dnb\.com|opencorporates)/i;
const JUNK_HOST = /(facebook|instagram|twitter|x\.com|pinterest|indeed|glassdoor|zillow|streeteasy)/i;

const normalise = (m) => `+1-${m[1]}-${m[2]}-${m[3]}`;

// A phone number a human could dial, not a run of digits that happens to be
// ten long. Minified scripts are full of the latter: one site yielded
// "7513812156" (area code 751 does not exist) and another "9487179487", while
// its real number sat in a tel: link two lines away. Both would have gone onto
// an outreach list as fact.
const TEL_HREF = /tel:\s*\+?1?[\s.()-]*(\d[\d\s.()-]{8,18})/gi;
// A written number carries separators or parentheses; a bare ten-digit run
// inside a script does not.
const WRITTEN = /(?:\+?1[\s.-])?\(?([2-9]\d{2})\)[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)|(?:\+?1[\s.-])?([2-9]\d{2})[\s.-](\d{3})[\s.-](\d{4})(?!\d)/g;
// Placeholders and lorem-numbers: 3333333333, 1234567890, 5551234567.
const FAKE = /^(\d)\1{9}$|^123456|^\d{3}555\d{4}$/;

const stripCode = (html) =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

// A page is only evidence for the company whose page it is. Exported for the
// re-check, which applies the directory rule to a page it fetched again.
export function phonesFrom(text) {
  const html = String(text);
  const out = [];
  const add = (digits) => {
    const d = String(digits).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (d.length !== 10 || FAKE.test(d)) return;
    const area = d.slice(0, 3);
    // N11 is a service code, never a subscriber line.
    if (TOLL_FREE.has(area) || area[0] === '1' || area[0] === '0' || /^\d11$/.test(area)) return;
    const v = `+1-${area}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (!out.includes(v)) out.push(v);
  };
  // The site's own declaration comes first: a tel: link is what it wants dialled.
  for (const m of html.matchAll(TEL_HREF)) add(m[1]);
  // Then numbers written for a human to read, with the code stripped out.
  const prose = stripCode(html);
  for (const m of prose.matchAll(WRITTEN)) add(`${m[1] || m[4]}${m[2] || m[5]}${m[3] || m[6]}`);
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

// Which service actually answered — the key's shape cannot tell serper from
// serpapi, so the label must come from the request that worked, not the guess.
export let servedBy = null;
async function searchWeb(query, key, host) {
  if (!servedBy) servedBy = host === 'api.search.brave.com' ? 'brave-search' : host === 'serpapi.com' ? 'serpapi' : 'serper';
  if (host === 'api.search.brave.com') {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { 'X-Subscription-Token': key, accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`brave ${r.status}`);
    const j = await r.json();
    return (j.web?.results || []).map((x) => ({ url: x.url, title: x.title, snippet: x.description || '' }));
  }
  if (host === 'serpapi.com') {
    const u = new URL('https://serpapi.com/search.json');
    u.searchParams.set('engine', 'google');
    u.searchParams.set('q', query);
    u.searchParams.set('num', '8');
    u.searchParams.set('api_key', key);
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`serpapi ${r.status}`);
    const j = await r.json();
    return (j.organic_results || []).map((x) => ({ url: x.link, title: x.title, snippet: x.snippet || '' }));
  }
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, num: 8 }),
    signal: AbortSignal.timeout(12000),
  });
  if (r.status === 401 || r.status === 403) {
    servedBy = 'serpapi';
    // serper.dev and serpapi.com both issue 64 hex characters and differ by
    // two letters in the name. Rather than make every deployment carry a
    // second secret to disambiguate, a rejected key is tried once against the
    // other service — which is also recorded ALLOWED in source-policy.json.
    assertProviderAllowed('serpapi');
    return searchWeb(query, key, 'serpapi.com');
  }
  if (!r.ok) throw new Error(`serper ${r.status}`);
  const j = await r.json();
  return (j.organic || []).map((x) => ({ url: x.link, title: x.title, snippet: x.snippet || '' }));
}

// Search finds the company's page; the page — not the snippet — supplies the
// number. Snippet-level inference is exactly what inflates a hit rate with
// numbers that belong to a different business at the same address.
// A search plan is a monthly bucket, and a collector that thinks it has no
// cache will empty it in one run: on 2026-09-08 a single CI run spent all 250
// searches of a month. The budget is the backstop that does not depend on the
// cache working — past it the run keeps going on cached contacts alone.
const BUDGET = Number(process.env.ENRICH_BUDGET || 40);
// A one-time allowance (Serper's 2,500 at sign-up) or a monthly credit
// (Brave's, about 1,000) is spent by the day, not by the run: eight sweeps a
// day at forty lookups each would empty Serper's allowance inside a week.
// Every search writes one cache entry stamped with its time, and the shared
// cache is pulled before a run, so the entries written today ARE the day's
// spend across every run — no second counter to keep in step with the first.
const DAILY_BUDGET = Number(process.env.ENRICH_DAILY_BUDGET || 60);
// Distinct stamps, not entries. A firm filing under several business addresses
// gets its contact copied to each of them (enrichContact, the sibling path),
// and a copy keeps the stamp of the search it copies — so counting entries
// counted one search once per address: with a daily cap of five and firms of
// three addresses each, the cap declared five searches made after two real
// ones. Real searches never share a stamp: each one waits on a network call.
// A tombstone is stamped with the moment a number was withdrawn, not with a
// search, and must not eat into the day's allowance.
export function searchesToday() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const stamps = new Set();
  for (const e of Object.values(loadCache())) {
    if (e?.value?.rejected) continue;
    if ((e?.at || 0) >= start.getTime()) stamps.add(e.at);
  }
  return stamps.size;
}
let dailyCapSaid = false;
// Distinguishable from EMPTY on purpose: EMPTY means "searched, found nothing"
// and is worth remembering; UNSEARCHED means the lookup never happened and
// must never reach the cache.
const UNSEARCHED = { phone: null, email: null, confidence: 'none', source: null, unsearched: true };
let spent = 0;
export const searchesSpent = () => spent;

async function searchProvider({ company, address, key, host }) {
  if (!company || !key) return UNSEARCHED;
  // Out of budget is not "this company has no telephone" — it is "we did not
  // look". Caching the first as the second is what turned an exhausted search
  // plan into 919 companies marked contactless for thirty days.
  if (spent >= BUDGET) return UNSEARCHED;
  if (searchesToday() >= DAILY_BUDGET) {
    if (!dailyCapSaid) console.log(`enrich: ${DAILY_BUDGET} searches already made today — the rest wait for tomorrow`);
    dailyCapSaid = true;
    return UNSEARCHED;
  }
  spent += 1;
  const zip = (address || '').match(/\b(\d{5})\b/)?.[1] || '';
  const results = await searchWeb(`"${company}" ${zip} New York phone contact`, key, host);
  const usable = results.filter((r) => !JUNK_HOST.test(r.url));
  if (!usable.length) return EMPTY;

  for (const r of usable.slice(0, 4)) {
    let page = '';
    try {
      const res = await fetch(r.url, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'RightWindow/1.0' } });
      if (!res.ok) continue;
      page = pageText(await res.text());
    } catch {
      continue;
    }
    const found = acceptPage({ company, address, url: r.url, page });
    if (found) return found;
  }
  return EMPTY;
}

// The page as the acceptance rule reads it. One definition, so the re-check
// (lib/recheck.mjs) holds a page it fetched again to exactly the reading the
// search held it to.
export const pageText = (html) => String(html).replace(/<[^>]+>/g, ' ');

// A directory lists every business of a name, and a name is not a firm. The
// slide-3 building's agent files with HPD at 118-09 83rd Ave, Kew Gardens
// 11415; the number on its card came off a directory page for a firm of the
// same name in East Meadow, Nassau County, and nothing but the name tied the
// two. So a directory page vouches for a number only when it also shows where
// the city says the firm is: the ZIP or the street of the business address on
// the filing. No address on the filing, no tie. The company's own domain and a
// .gov record are not held to this — they are the firm's own word, and the
// directory is somebody else's.
const STREET_WORDS = [
  [/\b(STREET|STR|ST)\b/g, 'ST'],
  [/\b(AVENUE|AVE|AV)\b/g, 'AVE'],
  [/\b(ROAD|RD)\b/g, 'RD'],
  [/\b(BOULEVARD|BLVD)\b/g, 'BLVD'],
  [/\b(PLACE|PL)\b/g, 'PL'],
  [/\b(DRIVE|DR)\b/g, 'DR'],
  [/\b(LANE|LN)\b/g, 'LN'],
  [/\b(PARKWAY|PKWY)\b/g, 'PKWY'],
  [/\b(COURT|CT)\b/g, 'CT'],
  [/\b(TERRACE|TER)\b/g, 'TER'],
  [/\b(SQUARE|SQ)\b/g, 'SQ'],
  [/\b(HIGHWAY|HWY)\b/g, 'HWY'],
  [/\b(EAST|E)\b/g, 'E'],
  [/\b(WEST|W)\b/g, 'W'],
  [/\b(NORTH|N)\b/g, 'N'],
  [/\b(SOUTH|S)\b/g, 'S'],
];
// "118-09 83RD AVE" and "118-09 83rd Avenue" both read " 118 09 83 AVE ". The
// street word is kept, canonical, so a short address like 5 3rd Ave cannot
// match any "5 3" that happens to sit in a page.
const addressWords = (s) => {
  let t = ` ${String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  t = t.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1');
  for (const [re, to] of STREET_WORDS) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ');
};

// The filing's business address is "street, [suite,] city state zip".
export function pageShowsAddress(page, address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  // Only from the last part: a five-digit house number is not a ZIP.
  const zip = parts.length > 1 ? parts[parts.length - 1].match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || null : null;
  if (zip && new RegExp(`(^|[^0-9])${zip}([^0-9]|$)`).test(String(page))) return true;
  const street = addressWords(parts[0]);
  if (street.trim().split(' ').length < 2 || !/\d/.test(street)) return false;
  return addressWords(page).includes(street);
}

// The number printed nearest the filing's ZIP, within one listing's reach, or
// none. Without a ZIP to anchor on, only a page that carries a single number
// is unambiguous enough.
const NEAR = 600;
export function phoneNearAddress(page, phones, address) {
  const text = String(page);
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  const zip = parts.length > 1 ? parts[parts.length - 1].match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || null : null;
  const anchors = zip ? [...text.matchAll(new RegExp(`(^|[^0-9])${zip}(?=[^0-9]|$)`, 'g'))].map((m) => m.index) : [];
  if (!anchors.length) return phones.length === 1 ? phones[0] : null;
  let best = null;
  let bestGap = Infinity;
  for (const ph of phones) {
    const [, a, b, c] = ph.match(/^\+1-(\d{3})-(\d{3})-(\d{4})$/) || [];
    if (!a) continue;
    for (const m of text.matchAll(new RegExp(`${a}\\D{0,3}${b}\\D{0,3}${c}`, 'g'))) {
      for (const at of anchors) {
        const gap = Math.abs(m.index - at);
        if (gap < bestGap) {
          bestGap = gap;
          best = ph;
        }
      }
    }
  }
  return bestGap <= NEAR ? best : null;
}

// Which pages may supply a contact, and at which level. Exported so the rule
// can be tested against fixture pages without a search provider.
export function acceptPage({ company, address, url, page }) {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const phones = phonesFrom(page);
  const emails = emailsFrom(page, domain);
  if (!phones.length && !emails.length) return null;
  const gov = domain.endsWith('.gov');
  const dir = DIRECTORY.test(domain);
  // The company's own site has to actually look like the company's own site.
  const slug = String(company || '').toLowerCase().replace(/[^a-z]/g, '');
  const own = slug.length > 5 && domain.replace(/[^a-z]/g, '').includes(slug.slice(0, 8));
  if (!own && !gov && !dir) return null;
  if (!own && !gov && !pageShowsAddress(page, address)) return null;
  // On a directory the tie between the address and the number has to be
  // local. A results page, or a listing with a "nearby businesses" rail,
  // shows the filing's ZIP in one entry and a same-name firm's number in
  // another — and the search query itself carries that ZIP, so pages that
  // echo it are exactly the ones a search returns.
  const phone = own || gov ? phones[0] || null : phoneNearAddress(page, phones, address);
  if (!own && !gov && !phone) return null;
  // An address from a directory belongs to whoever the directory says it does;
  // only the company's own site vouches for it.
  const email = own || gov ? emails[0] || null : null;
  const found = {
    phone,
    email,
    confidence: own || gov ? 'verified' : 'listed',
    source: domain,
    via: null,
    // The exact page, so the re-check can read it again instead of guessing
    // from `source`, which names only the host. It stays in the cache: no
    // published row is built from anything but the named fields.
    url,
  };
  return found.phone || found.email ? found : null;
}

// A provider returns the same shape as enrichContact. Add one here, record its
// verdict in data/source-policy.json, and set ENRICH_PROVIDER to its id.
const PROVIDERS = {
  stub: async () => EMPTY,
  serper: (a) => searchProvider({ ...a, host: 'google.serper.dev' }),
  serpapi: (a) => searchProvider({ ...a, host: 'serpapi.com' }),
  'brave-search': (a) => searchProvider({ ...a, host: 'api.search.brave.com' }),
};

export function enrichmentProvider() {
  if (process.env.ENRICH_PROVIDER) return process.env.ENRICH_PROVIDER;
  // One thing to paste, not two: Brave issues keys prefixed BS*, Serper issues
  // 64 hex characters. Both are recorded ALLOWED in data/source-policy.json;
  // an unrecognised key still gets a named provider so the policy gate — not a
  // silent fallback — decides whether it may be used.
  const key = process.env.ENRICH_API_KEY || '';
  if (!key) return 'enrich-stub';
  if (/^BS[A-Za-z0-9_-]{10,}$/.test(key)) return 'brave-search';
  // serper.dev and serpapi.com both issue 64 hex characters, so shape cannot
  // separate them — and guessing wrong costs a run of 403s. scripts/whose-key.mjs
  // asks each service once and writes the answer into ENRICH_PROVIDER.
  return 'serper';
}

export function enrichmentReady() {
  const id = enrichmentProvider();
  return id !== 'enrich-stub' && Boolean(process.env.ENRICH_API_KEY);
}

export async function enrichContact({ company, name, address, cacheOnly = false } = {}) {
  const id = enrichmentProvider();
  assertProviderAllowed(id);
  if (!company && !name) return EMPTY;

  const c = loadCache();
  const k = keyOf({ company, address });
  const got = fromCache(c, { company, address }, Date.now(), companyIndex());
  if (got.state === 'fresh') return got.value;
  if (got.state === 'sibling') {
    const s = got.entry;
    // The copy carries the original's re-check stamps, or it would lapse a
    // month after the search while the original is confirmed every day.
    c[k] = { at: s.at, ...(s.checkedAt ? { checkedAt: s.checkedAt } : {}), ...(s.lastCheck ? { lastCheck: s.lastCheck } : {}), value: s.value };
    saveCache();
    return s.value;
  }
  // A withdrawn number (lib/recheck.mjs) serves nothing. It blocks nothing
  // either: with a provider the pair is searched again, under today's rules.
  // A number in its grace month still serves when there is no search to
  // replace it — the page being unreadable is not the number being wrong.
  const fallback = got.state === 'grace' ? got.value : EMPTY;
  // Without a live provider the cache is still the contact store: numbers put
  // there by a measured run are real and should reach the card.
  if (!enrichmentReady()) return fallback;
  // Registers beyond the first read the cache and stop there. New companies are
  // resolved by a deliberate measured sweep, not by every register quietly
  // spending lookups on a rebuild.
  if (cacheOnly) return fallback;

  const impl = PROVIDERS[id === 'enrich-stub' ? 'stub' : id];
  if (!impl) throw new Error(`Enrichment provider "${id}" is recorded in policy but not implemented.`);

  let value = EMPTY;
  try {
    value = (await impl({ company, name, address, key: process.env.ENRICH_API_KEY })) || EMPTY;
  } catch (e) {
    value = UNSEARCHED;
    // A quota or auth refusal answers every lookup the same way: one is
    // enough to know, forty of them burned the run's whole search budget on
    // 2026-09-21 and drowned the log. The breaker ends searching for this run.
    const status = Number((e.message.match(/\b(401|403|429|5\d\d)\b/) || [])[1]) || null;
    if (/\b(401|403|429)\b/.test(e.message)) {
      console.log(`enrich: ${id} refused searches (${e.message.slice(0, 80)}) — no more lookups this run`);
      spent = BUDGET;
    } else {
      console.log(`enrich: ${id} failed (${e.message.slice(0, 80)}) — falling back to none`);
    }
    // On /status as its own line: a quota that ran out is a problem with a
    // name, and the run that hit it is otherwise green.
    currentRecorder()?.note('enrichment', { ok: false, status, error: `${id}: ${e.message.slice(0, 120)}` });
  }
  // A lookup that never ran leaves no trace: the next run, with budget or a
  // working key, must be free to try this company again.
  if (value.unsearched) return fallback;
  currentRecorder()?.note('enrichment', { ok: true });
  c[k] = { at: Date.now(), value: { ...value, company: value.company || company } };
  byName = null;
  saveCache();
  return c[k].value;
}
