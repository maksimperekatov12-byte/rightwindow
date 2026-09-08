// Resolve a list of contractor names to website, phone and trust tier — the
// same pipeline that resolves managing agents for the cards.
//
//   npm run enrich -- --names contractors.txt --out contractors.csv
//
// One business name per line, as printed on a DOB permit. Blank lines and
// lines starting with # are ignored, and a markdown table row is accepted too,
// so a list can be pasted straight out of the outreach doc.
//
// It reuses lib/enrich.mjs, which means: same search provider, same rule that
// a number is only read off the firm's OWN page (never off a search snippet),
// same trust tiers, and the same on-disk cache — so re-running costs nothing
// for names already resolved, and the cards benefit from what this finds.
import { readFileSync, writeFileSync } from 'node:fs';
import { enrichContact, enrichmentReady, enrichmentProvider } from '../lib/enrich.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const namesFile = arg('names');
const outFile = arg('out', 'contractors.csv');
const limit = Number(arg('limit', '0')) || Infinity;
if (!namesFile) {
  console.error('usage: npm run enrich -- --names contractors.txt [--out contractors.csv] [--limit 10]');
  process.exit(1);
}

// A markdown row like "| **J&N Construction Group Corp.** | 211 | найти |" is a
// name too — the outreach list lives in a table.
const parseName = (line) => {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) return null;
  const cell = raw.startsWith('|') ? raw.split('|')[1] || '' : raw;
  const name = cell.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (!name || /^-+$/.test(name) || /^(компания|company|name)$/i.test(name)) return null;
  // The list lives in a prose document, so a sentence must not become a
  // lookup — but "Sato Construction Co. Inc." must survive, which rules out
  // judging by punctuation. A company name is short and has no Cyrillic.
  if (!/[A-Za-z]{3}/.test(name) || /[\u0400-\u04FF]/.test(name)) return null;
  if (name.split(/\s+/).length > 8 || name.length > 70) return null;
  return name;
};

const names = [...new Set(readFileSync(namesFile, 'utf8').split('\n').map(parseName).filter(Boolean))].slice(0, limit);

// A lookup that ran without a working provider is cached as "nothing found"
// for thirty days, so the first run after a key is fixed would return the same
// nothing. --refresh drops the EMPTY entries for these names only; resolved
// contacts are never discarded.
if (process.argv.includes('--refresh')) {
  const CACHE = new URL('../data/enrich-cache.json', import.meta.url);
  try {
    const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
    const want = new Set(names.map((n) => n.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    let dropped = 0;
    for (const [k, v] of Object.entries(cache)) {
      const val = v?.value || {};
      if (val.phone || val.email) continue;
      const co = String(val.company || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (co && want.has(co)) {
        delete cache[k];
        dropped += 1;
      }
    }
    writeFileSync(CACHE, JSON.stringify(cache));
    console.log(`--refresh: dropped ${dropped} empty cache entries`);
  } catch (e) {
    console.warn(`--refresh: ${String(e.message).slice(0, 80)}`);
  }
}
console.log(`${names.length} names · provider ${enrichmentProvider()}${enrichmentReady() ? '' : ' (no key: cache only)'}`);

const csv = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The city licenses contractors and prints their telephone number in the
// licence record. That is a city record — better than anything a search
// provider can offer — so it runs FIRST, needs no key, and is why this CLI is
// useful before the search provider is configured.
// Legal suffixes vary between the DOB permit and the DCWP licence for the same
// firm ("Corp." vs "CORP" vs nothing); everything else must match exactly.
// Loose matching is how "Premier Construction" became "Premier Roofing" — a
// wrong phone number on an outreach list is worse than an empty cell.
const SUFFIX = /\b(inc|llc|l\.l\.c|corp|corporation|co|ltd|limited|company|group|llp|lp)\b/gi;
const normName = (n) =>
  String(n || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(SUFFIX, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const dcwpFmt = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `+1-${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p || '';
};

async function fromCityLicence(name) {
  const want = normName(name);
  if (want.length < 5) return null;
  // Search on the first two significant words, then accept only a row whose
  // normalised name equals ours or is ours plus trailing words.
  const probe = want.split(' ').slice(0, 2).join(' ');
  const url =
    'https://data.cityofnewyork.us/resource/w7w3-xahh.json?$where=' +
    encodeURIComponent(`upper(business_name) like '%${probe.replace(/'/g, '')}%'`) +
    '&$select=business_name,contact_phone,address_building,address_street_name,address_zip&$limit=25';
  try {
    const rows = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json();
    const hit = rows.find((r) => {
      const got = normName(r.business_name);
      return got === want || got.startsWith(want + ' ') || want.startsWith(got + ' ');
    });
    if (!hit?.contact_phone) return null;
    return {
      phone: dcwpFmt(hit.contact_phone),
      matched: hit.business_name,
      address: [hit.address_building, hit.address_street_name, hit.address_zip].filter(Boolean).join(' '),
    };
  } catch {
    return null;
  }
}

const rows = [['name', 'website', 'phone', 'email', 'trust', 'source', 'via', 'city_licence_name', 'city_address']];
let found = 0;
for (const [i, name] of names.entries()) {
  let r = { phone: null, email: null, confidence: 'none', source: null, via: null };
  try {
    // No address: these are firms, not buildings, and the cache keys on the
    // normalised company name for exactly this case.
    r = (await enrichContact({ company: name })) || r;
  } catch (e) {
    console.warn(`  ${name}: ${String(e.message || e).slice(0, 80)}`);
  }
  // City record first: a licence phone is published by the city and needs no
  // provider. The search pipeline only fills what the city did not.
  const lic = await fromCityLicence(name);
  const phone = r.phone || lic?.phone || '';
  const trust = r.phone ? r.confidence : lic?.phone ? 'city-licence' : r.confidence || 'none';
  if (phone || r.email) found += 1;
  rows.push([
    name,
    r.source ? `https://${r.source}` : '',
    phone,
    r.email || '',
    trust,
    r.source || (lic ? 'nyc.gov · DCWP licence' : ''),
    r.via || '',
    lic?.matched || '',
    lic?.address || '',
  ]);
  process.stdout.write(`  ${i + 1}/${names.length} ${found} resolved\r`);
}
writeFileSync(outFile, rows.map((r) => r.map(csv).join(',')).join('\n') + '\n');
console.log(`\nwrote ${outFile}: ${found} of ${names.length} with a contact`);
