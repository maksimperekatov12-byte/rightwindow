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
  return name;
};

const names = [...new Set(readFileSync(namesFile, 'utf8').split('\n').map(parseName).filter(Boolean))].slice(0, limit);
console.log(`${names.length} names · provider ${enrichmentProvider()}${enrichmentReady() ? '' : ' (no key: cache only)'}`);

const csv = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = [['name', 'website', 'phone', 'email', 'trust', 'source', 'via']];
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
  if (r.phone || r.email) found += 1;
  rows.push([name, r.source ? `https://${r.source}` : '', r.phone || '', r.email || '', r.confidence || 'none', r.source || '', r.via || '']);
  process.stdout.write(`  ${i + 1}/${names.length} ${found} resolved\r`);
}
writeFileSync(outFile, rows.map((r) => r.map(csv).join(',')).join('\n') + '\n');
console.log(`\nwrote ${outFile}: ${found} of ${names.length} with a contact`);
