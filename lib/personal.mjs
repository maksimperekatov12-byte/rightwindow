import { readFileSync } from 'node:fs';

// The register is meant to show businesses. A sole proprietor who registers a
// food permit under their own name is a private individual, and printing their
// name beside their mobile number is not something a public-records product
// should do — so those cards are dropped rather than shown.
//
// The test is not hand-written. DCWP labels every licence it issues either
// "Individual" or "Premises" and prints the name on both, which is 72,000 rows
// of public ground truth. data/name-vocab.json holds the tokens that separate
// the two. Measured on held-out rows from that same file: it catches 75% of
// real individuals and misreads 4% of real businesses as people. The error is
// deliberately pointed that way — losing a venue costs one card.
const V = JSON.parse(readFileSync(new URL('../data/name-vocab.json', import.meta.url), 'utf8'));
const PERSON = new Set(V.person);
const BUSINESS = new Set(V.business);

const words = (s) => (s.toUpperCase().match(/[A-Z]{2,}/g) || []);

export const looksPersonal = (raw) => {
  const n = (raw || '').trim();
  if (!n) return false;
  if (/[0-9&#/@+]/.test(n)) return false; // a number or an ampersand is a trading style
  if (/['’]s\b/i.test(n)) return false; // Dave's, Herbie's
  const t = words(n);
  if (t.length < 2 || t.length > 3) return false;
  if (t.some((x) => BUSINESS.has(x))) return false;
  return t.some((x) => PERSON.has(x));
};

// A name at more than one address is a chain, whatever it reads like. This is
// what keeps Duane Reade in the feed.
export const dropPrivateIndividuals = (rows, nameOf = (r) => r.name, addrOf = (r) => r.address) => {
  const sites = new Map();
  for (const r of rows) {
    const k = (nameOf(r) || '').toUpperCase().trim();
    if (!k) continue;
    (sites.get(k) || sites.set(k, new Set()).get(k)).add((addrOf(r) || '').toUpperCase());
  }
  return rows.filter((r) => {
    const k = (nameOf(r) || '').toUpperCase().trim();
    if ((sites.get(k)?.size || 0) > 1) return true;
    return !looksPersonal(nameOf(r));
  });
};
