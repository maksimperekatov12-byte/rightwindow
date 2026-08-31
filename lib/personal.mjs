import { readFileSync } from 'node:fs';

// The register is meant to show businesses. A sole proprietor who registers a
// food permit under their own name is a private individual, and printing their
// name beside their mobile number is not something a public-records product
// should do — so those cards are dropped rather than shown.
//
// The test is not hand-written. Two public city files supply it. DCWP labels
// every licence it issues either "Individual" or "Premises" and prints the name
// on both, which separates person tokens from business ones; HPD prints a first
// and last name on all 161,136 registration contacts in the city, which supplies
// the ordinary given names and surnames the smaller file was too thin to hold.
// data/name-vocab.json holds the result: 7,362 person tokens and 821 business
// tokens.
//
// Measured on held-out rows from the DCWP file: it catches 84% of real
// individuals and misreads 6.4% of real businesses. The second figure overstates
// the error — most of those "businesses" are printed SURNAME, FORENAME and are
// people holding a premises licence, so the label is about the licence type
// rather than the entity. On the live openings register it drops nine cards, of
// which eight are genuinely people.
//
// The error is deliberately pointed that way: losing a venue costs one card,
// and publishing a sole proprietor's name beside their mobile number costs
// something that cannot be taken back. The DCWP-only vocabulary caught 75% and
// let ALI RAZA through with a mobile attached.
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

// Exposed so the publisher can ask the same question about the local part of an
// email address that the openings register asks about a business name.
export const isPersonToken = (word) => PERSON.has(String(word || '').toUpperCase());

// ---- Identity: when may a licensee's NAME be shown? -------------------------
//
// Everything above answers "does this look like a person?" and removes what it
// recognises. That shape has a floor it cannot get past: measured recall is 84%,
// so roughly one private individual in six still reaches the register, and the
// ones that get through are exactly the names no public file happened to hold.
// The contact publication gate learned the same lesson and was rewritten to
// publish only on positive evidence; this is that rewrite for the openings
// register.
//
// A name is rendered only when at least one of these actually holds:
//
//   premises  — DCWP issued this name a licence it classes as Premises, i.e.
//               the city itself has recorded it as a business
//   suffix    — the name carries a legal-entity suffix
//   chain     — the same name appears at two or more distinct addresses in this
//               build, which no sole proprietor does
//   domain    — a business domain is positively attributed to the name, by the
//               same test lib/provenance.mjs applies to a contact
//   entity    — the legal name filed alongside the trading name is a company,
//               which vouches for the trading name it filed under
//   trade     — the name contains a word that only appears in trading styles:
//               BAKERY, PIZZERIA, GRILL, MARKET, LOUNGE. This is the same
//               vocabulary as the rest of the file, derived from the names DCWP
//               itself classes as Premises, so it is the city's evidence too —
//               just held as a word list rather than a name list, which is what
//               makes it reach the 42,000 businesses DCWP never licensed.
//               Without it 139 of 381 cards lost their name, nearly all of them
//               plainly businesses.
//   single-word / possessive
//             — a person in these records is a forename and a surname. One word
//               is not that shape, and neither is a possessive: PERAL and
//               FAZENDA are brands, Dave's Pizzeria is a trading style.
//
// With none of them the card SURVIVES — a new venue at a real address with a
// number the city printed is worth showing — but it is identified by its
// address instead of by somebody's name.
const ENTITY_SUFFIX =
  /(^|[^a-z])(llc|l\.l\.c|inc|inc'?d|incorporated|corp|corporation|co|company|ltd|limited|llp|l\.l\.p|lp|pllc|pc|p\.c|plc|group|holdings?|enterprises?|partners(hip)?|associates|ventures|trust|foundation|institute|society|assn|association|nyc|intl|international)([^a-z]|$)/i;

const normalizeName = (n) =>
  String(n || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Which evidence vouches for this name, if any.
 *
 * `premisesNames` is a Set of normalised DCWP Premises names (see
 * scripts/name-vocab.mjs); pass an empty Set when the file is unavailable and
 * the other three tests still apply.
 */
export function nameEvidence(name, { premisesNames, addressCount = 0, domainOk = false, legalName = null } = {}) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const held = [];
  if (premisesNames && premisesNames.has(normalizeName(raw))) held.push('premises');
  if (ENTITY_SUFFIX.test(raw)) held.push('suffix');
  if (addressCount > 1) held.push('chain');
  if (domainOk) held.push('domain');
  if (legalName && normalizeName(legalName) !== normalizeName(raw) && ENTITY_SUFFIX.test(legalName))
    held.push('entity');
  if (words(raw).some((w) => BUSINESS.has(w))) held.push('trade');
  // A person in these records is a forename and a surname. One word is not that
  // shape — PERAL, MOKAFE, FAZENDA are brands — and neither is a possessive,
  // which is how a trading style is built: Dave's Pizzeria, Wilt's Berries.
  if (words(raw).length === 1) held.push('single-word');
  if (/['’]s(\b|$)/i.test(raw)) held.push('possessive');
  return held;
}

/**
 * Decide the identity of every row in a build.
 *
 * Returns the same rows, each carrying `nameShown` (boolean), `evidence` (the
 * list that vouched for it) and, where no evidence held, `identity` — the
 * address-derived label the card shows instead of the name. Nothing is dropped.
 */
export function resolveIdentities(rows, opts = {}) {
  const nameOf = opts.nameOf || ((r) => r.name);
  const addrOf = opts.addrOf || ((r) => r.address);
  const premisesNames = opts.premisesNames || new Set();
  const domainOkOf = opts.domainOkOf || (() => false);

  const sites = new Map();
  for (const r of rows) {
    const k = normalizeName(nameOf(r));
    if (!k) continue;
    (sites.get(k) || sites.set(k, new Set()).get(k)).add(String(addrOf(r) || '').toUpperCase().trim());
  }

  const cost = { total: 0, shown: 0, by: {} };
  for (const r of rows) {
    const name = nameOf(r);
    const evidence = nameEvidence(name, {
      premisesNames,
      addressCount: sites.get(normalizeName(name))?.size || 0,
      domainOk: domainOkOf(r),
      legalName: opts.legalOf ? opts.legalOf(r) : r.legal,
    });
    r.evidence = evidence;
    r.nameShown = evidence.length > 0;
    for (const e of evidence) cost.by[e] = (cost.by[e] || 0) + 1;
    if (r.nameShown) cost.shown++;
    else {
      cost.total++;
      // The address is the identity when the name cannot be. "A new food
      // business at 62 Manhattan Ave" is still a lead; a stranger's name is not
      // ours to print.
      const addr = String(addrOf(r) || '').split(',')[0].trim();
      r.identity = addr ? `New ${String(r.kind || 'business').toLowerCase()} at ${addr}` : 'New business, address on file';
    }
  }
  return { rows, cost };
}

