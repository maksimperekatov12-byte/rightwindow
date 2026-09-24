// Keeping the numbers on the cards true, every day, without spending a search.
//
// Why it exists. Nearly every contact in the shared cache was resolved on
// 2026-08-28..31 and served for thirty days from its search. The search key's
// quota ran out on 2026-09-21 (SerpApi 429), and with no search to renew them
// almost every phone on every card would have gone quietly between Sep 27 and
// Sep 30 — a week before the Oct 8 pitch. push-contacts' shrink guard would not
// have caught it: the entries lapse in hourly slices, each under half.
//
// Re-reading the page a number came from costs no search at all. Measured over
// the 841 cached entries on 2026-09-24: about 430 verified numbers were still
// on their page. So once a day every contact a card uses is read again, and the
// outcome is what keeps it on the card — or takes it off:
//
//   confirmed    the number (for an inbox-only row, the inbox) is on the page
//   changed      the page now carries a different number for the firm; the new
//                one is taken and the old one kept in `was`
//   absent       the exact page it came from loaded, without it. Twice, at
//                least 20 hours apart, and the number is withdrawn
//   unconfirmed  only guessed pages (homepage, contact) loaded, without it
//   unreachable  nothing loaded: down, TLS, timeout, 403, 404, 429, 5xx
//   rejected     a directory number that fails the directory rule
//
// And it holds old entries to today's rules. The directory rule — a listing
// vouches for a number only when it shows the filing's ZIP or street, and only
// for the number printed nearest it (lib/enrich.mjs, acceptPage) — landed on
// 2026-09-23 and bound only new searches. The card for BIN 4079440 kept a
// Nextdoor number for a same-name firm in East Meadow; the filing is in Kew
// Gardens. A tombstone ({value.rejected}) withdrew it by hand on 2026-09-24;
// this is what withdraws the next one.
//
// Everything that decides is here, with fetch injected, so the rules run in
// prebuild against fixture pages (scripts/test-recheck.mjs). The runner is
// scripts/recheck-contacts.mjs.
import {
  acceptPage,
  pageShowsAddress,
  phoneNearAddress,
  phonesFrom,
  pageText,
  keyOf,
  lastConfirmed,
  fromCache,
  buildIndex,
  mergeCache,
  contactCache,
  saveContactCache,
  pullCache,
  pushCache,
} from './enrich.mjs';
import { isDirectoryHost } from './provenance.mjs';

const HOUR = 3600 * 1000;
// Once a day, give or take the hourly schedule.
export const DUE_MS = 20 * HOUR;
// A run that is checking anyway takes everything last checked more than half a
// day ago as well. Without it a pass cut short by the budget stays cut: its
// halves come due an hour apart forever, and each costs a store write.
export const JOIN_MS = 12 * HOUR;
// The directory rule's first day. A listed entry resolved before it and never
// re-checked since was accepted on the name alone.
export const RULE_AT = Date.UTC(2026, 8, 23);
export const UA = 'RightWindow/1.0 (+https://rightwindow.nyc)';
export const LIMITS = {
  cap: 700, // entries per run; the feed's cards use about 610 today
  budgetMs: 4 * 60 * 1000, // no new entry is started after this
  total: 8, // requests in flight
  perHost: 2, // requests in flight to one host
  timeoutMs: 10000,
  fetchesPerEntry: 4,
  workers: 12,
};
const LEVELS = new Set(['verified', 'listed', 'affiliate']);

// ---- which pairs, and which of them are due ---------------------------------

// Every register in the feed that carries agents, derived as push-contacts
// derives it: a hard-coded list is how 399 names once went public, and here
// it would be how a new register's numbers silently stopped being checked.
export function feedPairs(feed) {
  const registers = Object.keys(feed || {}).filter((k) => Array.isArray(feed[k]?.feed));
  const byKey = new Map();
  for (const k of registers) {
    for (const c of feed[k].feed) {
      if (!c?.agent?.company) continue;
      const key = keyOf({ company: c.agent.company, address: c.agent.address });
      if (!byKey.has(key)) byKey.set(key, { key, company: c.agent.company, address: c.agent.address || '', bins: [] });
      byKey.get(key).bins.push(String(c.bin));
    }
  }
  return { registers, pairs: [...byKey.values()] };
}

export const lastCheckAt = (e) => e?.lastCheck?.at || lastConfirmed(e);
export const checkable = (e) => {
  const v = e?.value;
  return Boolean(v && !v.rejected && LEVELS.has(v.confidence) && (v.phone || v.email));
};

// Nothing, when nothing is due: most hourly runs, and those write nothing.
export function dueBatch(doc, pairs, now, cap = LIMITS.cap) {
  const live = pairs.map((p) => ({ p, e: doc[p.key] })).filter((x) => checkable(x.e));
  if (!live.some((x) => now - lastCheckAt(x.e) >= DUE_MS)) return [];
  return live
    .filter((x) => now - lastCheckAt(x.e) >= JOIN_MS)
    .sort((a, b) => lastCheckAt(a.e) - lastCheckAt(b.e))
    .slice(0, cap);
}

// ---- where the number came from ---------------------------------------------

// A search records the exact page (value.url, since 2026-09-24). Before that
// the only record is `source`, prose written for a person —
// "fsresidential.com/new-york/contact-us", "amsterdampropny.com (company's own
// site)", "yellowpages.com (Jrc Management Co, 9354 Queens Blvd, Rego Park NY
// 11374)" — whose leading host, and path if any, is the part a machine can use.
const LEAD = /^\s*(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s,;()'"<>]*)?/i;
export function sourcePage(value) {
  if (value?.url) {
    try {
      const u = new URL(value.url);
      if (/^https?:$/.test(u.protocol)) return { url: u.href, host: bare(u.hostname), exact: true };
    } catch {}
  }
  const m = LEAD.exec(String(value?.source || ''));
  if (!m) return null;
  const host = m[1].toLowerCase();
  const path = (m[2] || '').replace(/[.,:]+$/, '');
  if (path && path !== '/') return { url: `https://${host}${path}`, host: bare(host), exact: true };
  return { url: `https://${host}/`, host: bare(host), exact: false };
}
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
const hostOf = (u) => {
  try {
    return bare(new URL(u).hostname);
  } catch {
    return '';
  }
};

// ---- reading a page ----------------------------------------------------------

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '-', mdash: '-', hyphen: '-', minus: '-', lpar: '(', rpar: ')', period: '.', commat: '@' };
const decode = (s) =>
  String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
const textOf = (html) => decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

// Area, exchange and line, up to three non-digits between them: (212) 555-0142,
// 212.555.0142, +1 212 555 0142, and the same split across tags.
function phoneRe(phone) {
  const m = /^\+1-(\d{3})-(\d{3})-(\d{4})$/.exec(String(phone || ''));
  return m ? new RegExp(`(?<!\\d)(?:1\\D{0,3})?${m[1]}\\D{0,3}${m[2]}\\D{0,3}${m[3]}(?!\\d)`) : null;
}
export function showsPhone(html, phone) {
  const re = phoneRe(phone);
  if (!re) return false;
  // The site's own declaration first: a tel: link is what it wants dialled,
  // and it lives inside a tag, where the text below cannot see it.
  for (const t of String(html).matchAll(/\btel:([^"'<>]{7,40})/gi)) {
    let s = t[1];
    try {
      s = decodeURIComponent(s);
    } catch {}
    if (re.test(decode(s))) return true;
  }
  return re.test(textOf(html));
}
export function showsEmail(html, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e.includes('@')) return false;
  const raw = String(html);
  let unescaped = raw;
  try {
    unescaped = decodeURIComponent(raw.replace(/%(?![0-9a-f]{2})/gi, '%25'));
  } catch {}
  return decode(unescaped).toLowerCase().includes(e);
}

// A bot wall answers 200 and is not the page. Read as the page, it would say
// the number had gone, and two of those withdraw it. Only specific markers:
// "captcha" alone is on every contact form with reCAPTCHA.
const BOT_WALL =
  /cf-browser-verification|\/cdn-cgi\/challenge-platform\/|cf_chl_opt|<title>\s*(just a moment|attention required|access denied|pardon our interruption)|request unsuccessful\. incapsula|captcha-delivery\.com|px-captcha|enable javascript and cookies to continue/i;
function unreadable(html) {
  if (BOT_WALL.test(html)) return 'a bot check, not the page';
  const text = textOf(String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  if (text.trim().length < 40) return 'no readable text (a script-only page)';
  return null;
}

// One fetch per URL per run, however many entries name it; at most `total`
// in flight and `perHost` to any one host, so a firm's site sees two
// requests at a time and nobody sees a crawl.
export function pageGetter(fetchImpl = globalThis.fetch, opts = {}) {
  const { total, perHost, timeoutMs } = { ...LIMITS, ...opts };
  const memo = new Map();
  const busy = new Map();
  const waiting = [];
  let active = 0;
  const free = (h) => active < total && (busy.get(h) || 0) < perHost;
  const take = (h) => {
    active++;
    busy.set(h, (busy.get(h) || 0) + 1);
  };
  const acquire = (h) =>
    new Promise((res) => {
      if (free(h)) {
        take(h);
        res();
      } else waiting.push({ h, res });
    });
  const release = (h) => {
    active--;
    busy.set(h, busy.get(h) - 1);
    for (let i = 0; i < waiting.length; i++) {
      if (!free(waiting[i].h)) continue;
      const [w] = waiting.splice(i--, 1);
      take(w.h);
      w.res();
    }
  };
  async function load(url) {
    const h = hostOf(url);
    if (!h) return { ok: false, error: 'not a url' };
    await acquire(h);
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const type = res.headers?.get?.('content-type') || '';
      // A PDF filing cannot be read here; that is not the number being gone.
      if (type && !/html|text|xml/i.test(type)) return { ok: false, status: res.status, error: `not a page (${type.split(';')[0]})` };
      const html = (await res.text()).slice(0, 3_000_000);
      const why = unreadable(html);
      if (why) return { ok: false, status: res.status, error: why };
      return { ok: true, status: res.status, html, url: res.url || url };
    } catch (e) {
      return { ok: false, error: String(e?.message || e).slice(0, 120) };
    } finally {
      release(h);
    }
  }
  return (url) => {
    if (!memo.has(url)) memo.set(url, load(url));
    return memo.get(url);
  };
}

// Same-host links a person would click to find a phone number, contact pages
// before office pages before about pages.
const LINK_RANK = [/contact|get-in-touch|reach-us/i, /office|location/i, /about/i];
export function contactLinks(html, base, max = 2) {
  let from;
  try {
    from = new URL(base);
  } catch {
    return [];
  }
  const found = [];
  for (const m of String(html).matchAll(/<a\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = decode(m[1]);
    const text = textOf(m[2]);
    const rank = LINK_RANK.findIndex((re) => re.test(href) || re.test(text));
    if (rank < 0 || /^(mailto|tel|javascript):/i.test(href) || href.startsWith('#')) continue;
    let u;
    try {
      u = new URL(href, from);
    } catch {
      continue;
    }
    u.hash = '';
    if (!/^https?:$/.test(u.protocol) || bare(u.hostname) !== bare(from.hostname)) continue;
    if (u.pathname === '/' || /\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(u.pathname)) continue;
    if (!found.some((f) => f.url === u.href)) found.push({ url: u.href, rank });
  }
  return found
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max)
    .map((f) => f.url);
}

// ---- the check ---------------------------------------------------------------

const norm = (u) => String(u).replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();

// The company's own site, a .gov record, or an affiliate's page: is the
// number still where it was read?
async function checkOwn(entry, { company, address }, page, get, max) {
  const v = entry.value;
  if (!page) return { outcome: 'unreachable', note: 'the source names no page' };
  const has = (html) => (v.phone ? showsPhone(html, v.phone) : showsEmail(html, v.email));
  const home = new URL('/', page.url).href;
  // A directory's homepage says nothing about any one listing on it.
  const crawl = !isDirectoryHost(page.host);
  const queue = [];
  const queued = new Set();
  const push = (step) => {
    if (queued.has(norm(step.url))) return false;
    queued.add(norm(step.url));
    queue.push(step);
    return true;
  };
  if (page.exact) push({ url: page.url, exact: true });
  if (crawl && !push({ url: home, home: true })) queue[0].home = true;
  if (!queue.length) return { outcome: 'unreachable', note: 'a directory named without the listing' };

  const loaded = [];
  let exactLoaded = false;
  let fetched = 0;
  while (queue.length && fetched < max) {
    const step = queue.shift();
    fetched++;
    const r = await get(step.url);
    if (r.ok) {
      loaded.push(r);
      if (step.exact) exactLoaded = true;
      if (has(r.html)) return { outcome: 'confirmed', url: r.url || step.url };
    }
    if (step.home) {
      if (r.ok) for (const u of contactLinks(r.html, r.url || step.url)) push({ url: u });
      push({ url: new URL('/contact', home).href });
      push({ url: new URL('/contact-us', home).href });
    }
  }

  // The firm's own site now carries a different number. Only its own domain
  // speaks for it here: the first number on a .gov page is the agency's, and
  // an affiliate's number is somebody else's by definition.
  if (v.confidence === 'verified' && v.phone && !page.host.endsWith('.gov')) {
    for (const r of loaded) {
      if (hostOf(r.url) !== page.host) continue;
      const found = acceptPage({ company, address, url: r.url, page: r.html });
      if (found?.confidence === 'verified' && found.phone && found.phone !== v.phone) {
        return { outcome: 'changed', phone: found.phone, url: r.url };
      }
    }
  }
  if (exactLoaded) return { outcome: 'absent' };
  if (loaded.length) return { outcome: 'unconfirmed' };
  return { outcome: 'unreachable' };
}

// A directory listing: held to the rule a search is held to today. Only the
// listing page itself is evidence — a directory's homepage vouches for nothing.
async function checkListed(entry, address, page, get) {
  const v = entry.value;
  if (page?.exact) {
    const r = await get(page.url);
    if (r.ok) {
      const url = r.url || page.url;
      // Read exactly as the search reads a page (lib/enrich.mjs, pageText).
      const text = pageText(r.html);
      const shows = pageShowsAddress(text, address);
      if (!v.phone) {
        return shows && showsEmail(r.html, v.email)
          ? { outcome: 'confirmed', url }
          : { outcome: 'rejected', reason: `the directory page (${page.host}) does not tie this inbox to the filing's address` };
      }
      const near = shows ? phoneNearAddress(text, phonesFrom(text), address) : null;
      if (near === v.phone) return { outcome: 'confirmed', url };
      if (near) return { outcome: 'changed', phone: near, url };
      return {
        outcome: 'rejected',
        reason: shows
          ? `the directory page (${page.host}) shows the filing's address with no number beside it`
          : `the directory page (${page.host}) does not show the filing's address${address ? `, ${address}` : ''}`,
      };
    }
  }
  // It cannot be read again. A listing accepted under today's rule stays: the
  // rule was met when it was taken. One accepted before the rule existed has
  // only its source note left to show the tie, and is kept on that alone —
  // kept, not refreshed.
  const legacy = (entry.at || 0) < RULE_AT && !entry.checkedAt;
  if (!legacy) return { outcome: 'unreachable' };
  if (pageShowsAddress(v.source, address)) return { outcome: 'unreachable', note: "kept on the filing's address in its source note" };
  return { outcome: 'rejected', reason: "directory number with no demonstrable tie to the filing's address" };
}

export async function checkEntry(entry, pair, get, { fetchesPerEntry = LIMITS.fetchesPerEntry } = {}) {
  const page = sourcePage(entry.value);
  if (entry.value.confidence === 'listed') return checkListed(entry, pair.address, page, get);
  return checkOwn(entry, pair, page, get, fetchesPerEntry);
}

// ---- what an outcome does to the entry ---------------------------------------

const day = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// A tombstone serves nothing and is stamped now, so it beats every older copy
// in a merge (lib/enrich.mjs, mergeCache). What it replaced stays in `was`,
// private like the rest of the cache, so a withdrawal can be read back.
export function tombstone(entry, reason, outcome, now, company = null) {
  const v = entry.value || {};
  return {
    at: now,
    value: {
      company: v.company || company,
      phone: null,
      email: null,
      confidence: 'none',
      source: null,
      via: null,
      rejected: reason,
      was: { phone: v.phone || null, email: v.email || null, confidence: v.confidence || null, source: v.source || null },
    },
    lastCheck: { at: now, outcome },
  };
}

export function applyCheck(entry, res, now, company = null) {
  const v = entry.value;
  const prev = entry.lastCheck;
  const stamp = (outcome, extra = {}) => ({ at: now, outcome, ...extra });
  switch (res.outcome) {
    case 'confirmed':
      return { ...entry, checkedAt: now, lastCheck: stamp('confirmed'), value: res.url ? { ...v, url: res.url } : v };
    case 'changed':
      return {
        ...entry,
        checkedAt: now,
        lastCheck: stamp('changed'),
        value: { ...v, phone: res.phone, ...(res.url ? { url: res.url } : {}), was: { phone: v.phone, until: now } },
      };
    case 'absent': {
      // One absence is a page having a bad day. Two, a day apart, is the
      // number gone from it.
      const since = prev?.outcome === 'absent' ? prev.since || prev.at : now;
      if (prev?.outcome === 'absent' && now - since >= DUE_MS) {
        return tombstone(entry, `no longer on its source page since ${day(since)}`, 'withdrawn', now, company);
      }
      return { ...entry, lastCheck: stamp('absent', { since }) };
    }
    case 'rejected':
      return tombstone(entry, res.reason, 'rejected', now, company);
    default:
      return { ...entry, lastCheck: stamp(res.outcome === 'unconfirmed' ? 'unconfirmed' : 'unreachable') };
  }
}

// ---- a run -------------------------------------------------------------------

export async function recheck(doc, pairs, { get, now = Date.now(), clock = Date.now, ...opts } = {}) {
  const L = { ...LIMITS, ...opts };
  const batch = dueBatch(doc, pairs, now, L.cap);
  const deadline = clock() + L.budgetMs;
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < batch.length && clock() < deadline) {
      const { p, e } = batch[next++];
      let res;
      try {
        res = await checkEntry(e, p, get, L);
      } catch (err) {
        res = { outcome: 'unreachable', note: String(err?.message || err).slice(0, 120) };
      }
      const after = applyCheck(e, res, now, p.company);
      doc[p.key] = after;
      results.push({
        key: p.key,
        company: p.company,
        bins: p.bins,
        level: e.value.confidence,
        outcome: after.lastCheck.outcome,
        reason: after.value.rejected || res.note || null,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, L.workers) }, worker));
  return { due: batch.length, results };
}

// Where the cards stand, by each pair's latest outcome. This, not one run's
// tally, is what /status shows: most runs check nothing.
export function standing(doc, pairs, now) {
  const s = { contacts: 0, confirmed: 0, changed: 0, absent: 0, unconfirmed: 0, unreachable: 0, unchecked: 0, withdrawn: 0, due: 0 };
  for (const p of pairs) {
    const e = doc[p.key];
    if (e?.value?.rejected) {
      s.withdrawn++;
      continue;
    }
    if (!checkable(e)) continue;
    s.contacts++;
    const o = e.lastCheck?.outcome;
    if (o && o in s && o !== 'contacts') s[o]++;
    else s.unchecked++;
    if (now - lastCheckAt(e) >= DUE_MS) s.due++;
  }
  return s;
}

// How many cards the cache alone would give a number at `at`, pair by pair,
// under the serving rules (lib/enrich.mjs, fromCache).
export function cardsServed(doc, pairs, at) {
  const index = buildIndex(doc);
  const served = new Set();
  let cards = 0;
  for (const p of pairs) {
    const v = fromCache(doc, p, at, index).value;
    if (v && (v.phone || v.email)) {
      served.add(p.key);
      cards += p.bins.length;
    }
  }
  return { cards, pairs: served };
}

// Pull, re-check, push. The pull must have answered before anything is
// pushed (lib/enrich.mjs), and a push of what was pulled is skipped there, so
// a run with nothing due writes nothing. A dry run reads the store and this
// machine's cache into a copy in memory, checks that, and writes nowhere.
export async function runRecheck({ feed, readJson, writeJson, fetchImpl = globalThis.fetch, dryRun = false, now = Date.now(), limits = {} }) {
  const L = { ...LIMITS, ...limits };
  const { registers, pairs } = feedPairs(feed);
  let doc;
  if (dryRun) {
    const remote = await readJson('contacts-cache.json');
    doc = structuredClone(contactCache());
    mergeCache(doc, remote || {});
  } else {
    await pullCache(readJson);
    doc = contactCache();
  }
  const before = structuredClone(doc);
  const t0 = Date.now();
  const run = await recheck(doc, pairs, { get: pageGetter(fetchImpl, L), now, ...L });
  const ms = Date.now() - t0;
  let pushed = 0;
  if (!dryRun) {
    if (run.results.length) saveContactCache();
    pushed = await pushCache(writeJson);
  }
  return { registers, pairs, before, doc, ...run, ms, pushed, standing: standing(doc, pairs, now) };
}
