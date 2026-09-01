// Where a number came from decides whether it may be republished, and it is
// worth being exact about why, because the first version of this file was built
// on a misquotation.
//
// data/source-policy.json used to record the enrichment provider's terms as
// "must not redistribute it publicly". That sentence was this project's own
// conservative paraphrase, not a term the provider imposes. Read on 2026-08-31,
// the published Terms of Use carry no redistribution, storage or resale clause
// at all; what they require is that you not "misrepresent the ownership or the
// source" and not "falsify or delete any author attributions ... or other labels
// of the origin or source of material". Naming the source on every row, which is
// what this module makes the publisher do, is compliance rather than a risk.
//
// The number is not the provider's data in the first place: the search API
// returns candidate URLs, and lib/enrich.mjs then fetches the company's own page
// and reads the number off it.
//
// So the gate that follows is not a licence gate. It stays because it is right
// on its own terms:
//
//   - A third-party directory's listing is that directory's compilation, and we
//     have not read Yelp's or BBB's terms. Withholding those costs little.
//   - A number we cannot tie to the firm is a number we cannot stand behind.
//   - A mailbox that belongs to a person is not a business contact, whatever its
//     provenance.
//
// It fails closed. The first version asked "is the source one of thirty-five
// directory brands I listed?" and published everything else — an audit found
// that 967 of 1,211 rows published for no better reason than failing to match a
// brand name, and that cityrealty.com, nybits.com, local.yahoo.com,
// nextdoor.com, merchantcircle.com, gonofee.com, cooperatordirectory.com and a
// rentmanager.com tenant portal all walked through it. A denylist is the wrong
// shape for a publication gate: every directory nobody has thought of yet sits
// on its allow side. A row publishes now only on a fact positively established.
const GOV = /(^|[/@.\s])((\w+\.)*\w+\.gov)\b|data\.cityofnewyork\.us|data\.ny\.gov/i;

// Named because a customer subdomain on a vendor's platform is the vendor's
// domain, not the customer's: "sem.twa.rentmanager.com (Stone Edge Management
// tenant portal)" is a property-management SaaS, and eight rows were publishing
// it as the company's own site.
const DIRECTORY_HOSTS =
  /\b(yelp|yellowpages|yp\.com|bbb\.org|manta|bizapedia|buzzfile|dnb\.com|dandb|opencorporates|zoominfo|apollo\.io|rocketreach|crunchbase|facebook|linkedin|instagram|twitter|mapquest|foursquare|nextdoor|chamberofcommerce|cybo|local\.com|local\.yahoo|superpages|citysearch|birdeye|nicelocal|allbiz|trustpilot|tupalo|brownbook|cortera|corporationwiki|zippia|glassdoor|indeed|merchantcircle|cityrealty|nybits|gonofee|cooperatordirectory|causeiq|propertyshark|streeteasy|loopnet|zillow|realtor|apartments|nyscar|bizstanding|findglocal|pitchbook|hub\.biz|whitepages|spokeo)\b/i;

const VENDOR_HOSTS =
  /\b(rentmanager|appfolio|buildium|yardi|rentcafe|entrata|realpage|propertyware|hub\.biz|wixsite|squarespace|weebly|godaddysites|business\.site|wordpress|blogspot|sharepoint|googleusercontent)\b/i;

const STOP = new Set([
  'the','and','of','llc','inc','ltd','llp','co','corp','corporation','company','group','holdings','associates',
  'partners','management','mgmt','properties','property','realty','real','estate','services','service','organization',
  'enterprises','development','residential','commercial','new','york','nyc','ny','city','american','national','and',
]);

const hostsIn = (s) =>
  (String(s || '').match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/gi) || []).map((h) => h.toLowerCase());

// Everything after the last two labels, roughly — enough to compare "argo" in
// argo.com against a company called ARGO MANAGEMENT.
const stemOf = (host) => {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length < 2) return '';
  const tld2 = /^(co|com|net|org|gov|ac)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return (tld2 ? parts[parts.length - 3] : parts[parts.length - 2]) || '';
};

const tokensOf = (name) =>
  String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));

// "FirstService Residential" against fsresidential.com: no shared token, but the
// stem contains a run of the company's own letters. Checked both ways so an
// abbreviation on either side still ties.
const tiesToCompany = (stem, company) => {
  if (!stem || stem.length < 3) return false;
  // Five characters, not four: a four-letter token matches by accident. "SOME
  // MGMT" tied itself to someplace-we-cannot-tie.com on the substring "some".
  const toks = tokensOf(company).filter((t) => t.length >= 5);
  if (toks.some((t) => stem.includes(t) || t.includes(stem))) return true;
  const squashed = String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return squashed.length >= 6 && stem.length >= 6 && (squashed.includes(stem) || stem.includes(squashed));
};

/**
 * May this row's number be republished?
 *
 * `company` is the agent as the city registered it and `email` is the address we
 * resolved alongside the number — a mailbox on the same host as the source is
 * the strongest available proof that the host belongs to the firm.
 */
export function republishable(source, company, email, confidence) {
  const s = String(source || '').trim();
  if (!s) return false;

  // The vetoes run FIRST. Putting the government check ahead of them let a row
  // through whose number was read off yellowpages.com and whose only government
  // citation was an HPD record used to link the entity — the government host
  // short-circuited the whole test. A directory or a vendor portal named
  // anywhere in the string sinks the row, whatever else the string also claims.
  const hosts = hostsIn(s);
  if (hosts.some((h) => DIRECTORY_HOSTS.test(h) || VENDOR_HOSTS.test(h))) return false;

  // A government record carries no provider question at all.
  if (GOV.test(s)) return true;
  if (!hosts.length) return false;

  const mailHost = String(email || '').split('@')[1]?.toLowerCase() || '';
  const tied = hosts.some((h) => {
    const stem = stemOf(h);
    if (mailHost && (h === mailHost || stemOf(mailHost) === stem)) return true;
    return tiesToCompany(stem, company);
  });
  if (tied) return true;

  // A firm's domain is often an abbreviation its name cannot be matched
  // against — fsresidential.com for FirstService Residential. lib/enrich.mjs
  // sets confidence to 'verified' only when the number came off the company's
  // own domain or a government record, so that flag is the fact, written at
  // fetch time. It is trusted only after the two vetoes above have run.
  return confidence === 'verified';
}

export function provenanceOf(source, company, email, confidence) {
  const s = String(source || '');
  if (!s) return 'unknown';
  const hosts = hostsIn(s);
  if (hosts.some((h) => DIRECTORY_HOSTS.test(h))) return 'a third-party directory';
  if (GOV.test(s)) return 'a government record';
  if (hosts.some((h) => VENDOR_HOSTS.test(h))) return "a vendor-hosted portal rather than the firm's own domain";
  if (republishable(s, company, email, confidence)) return "the firm's own domain";
  return 'a source we could not tie to the firm';
}

// A telephone number on a firm's contact page is that firm's switchboard. An
// address at gmail.com on the same page is somebody's personal mailbox, and
// three of the first five found in this feed were a person's own name. The
// number still publishes — a small operator's business line is a business fact —
// and the mailbox does not.
//
// The list is not hand-kept any more than it has to be: the audit found
// optimum.net missing while optonline.net was present, both being the same
// consumer ISP. The backstop is the rule below it — a mailbox on a domain that
// is not the firm's own is treated as personal whatever its host.
const FREE_MAIL =
  /@(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|passport|aol|aim|icloud|me\.com|mac\.com|mail\.com|email\.com|gmx|web\.de|protonmail|proton\.me|pm\.me|tutanota|yandex|zoho|hushmail|fastmail|inbox|juno|netzero|comcast\.net|xfinity|verizon\.net|att\.net|sbcglobal|bellsouth|ameritech|pacbell|optonline\.net|optimum\.net|rr\.com|roadrunner|charter\.net|spectrum\.net|earthlink|mindspring|cox\.net|rcn\.com|nyc\.rr\.com|si\.rr\.com|frontier\.com|windstream)\b/i;

const ROLE =
  /^(info|contact|admin|administration|office|hello|hi|mail|email|inquiries|inquiry|enquiries|leasing|leases|rentals|rent|management|mgmt|manager|property|properties|service|services|support|help|helpdesk|team|reception|frontdesk|front_desk|general|gm|maintenance|repairs|super|billing|accounting|accounts|ap|ar|payables|receivables|sales|marketing|hr|jobs|careers|compliance|legal|closings|operations|ops|customerservice|clientservices|tenant|tenants|resident|residents)([._-]?\d{0,3})?$/;

/**
 * May this mailbox be republished?
 *
 * Fails closed the same way the source gate does: a role mailbox on the firm's
 * own domain publishes, and everything else is treated as a person's until it
 * proves otherwise. That covers the three cases the audit found — an initial
 * plus surname (mgrant@), a bare first name (esther@), and a domain that is
 * itself somebody's name (contact@josephpopack.com).
 */
export function republishableEmail(email, isPersonToken, looksPersonal) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(e)) return false;
  if (FREE_MAIL.test(e)) return false;

  const [local, host] = e.split('@');
  // Only a role mailbox publishes. The audit found three ways a person's own
  // address was getting through — an initial and a surname (mgrant@), a bare
  // first name (esther@), and a first name the vocabulary happened not to hold
  // (danny@) — and every one of them was a case of asking "is this a person?"
  // and publishing on a no. Asking "is this the firm answering?" and publishing
  // only on a yes closes all three at once, including the names nobody listed.
  if (!ROLE.test(local)) return false;

  // A domain that is itself somebody's name makes every mailbox on it personal,
  // info@ and contact@ included: contact@josephpopack.com is Joseph Popack's.
  const stem = stemOf(host);
  if (looksPersonal(stem.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'))) return false;
  if (splitWords(stem).filter((w) => isPersonToken(w)).length >= 2) return false;
  // No separator to split on, so try every division of the stem in two: a
  // person's forename welded to a surname is the shape that hides here.
  for (let i = 5; i <= stem.length - 4; i++) {
    if (isPersonToken(stem.slice(0, i)) && /^[a-z]{4,}$/.test(stem.slice(i))) return false;
  }
  return true;
}

// Rough camel/compound splitter for a domain stem: josephpopack -> joseph popack
// is not recoverable in general, so this only helps where separators exist.
function splitWords(stem) {
  return String(stem || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z]+/)
    .filter(Boolean);
}

// `via` is free text written to explain a tie — "resolved through the firm that
// actually runs the building" — and free text is where a person's name gets in.
// The audit of the first artefact found five: "Mark Harounian's office",
// "Ian V. Lagowitz", "Mitchell B. Rutter", "Joseph Popack" and "contact Isack
// Hagar". Every one arrived through this field, which no guard was checking.
//
// The field is worth keeping: without it a caller opens by asking for a holding
// company nobody at the other end has heard of. So it is cut back to the company
// it names — everything before the first bracket, dash or semicolon — and
// dropped outright if what remains is itself a person's name.
export function republishableVia(via, looksPersonal) {
  const head = String(via || '')
    .split(/[(—–;|]/)[0]
    .replace(/\s+[-–—]\s+.*$/, '')
    .trim()
    .replace(/[,\s]+$/, '');
  if (!head || head.length < 3) return null;
  if (looksPersonal(head)) return null;
  return head;
}

// The source string is prose a human wrote, and one of them turned out to carry
// "nyscar.org member profile 60314102 (Brandon Yasgur, Principal, YRC Management,
// 825 E. 233rd St, Bronx NY 10466)" — a name, a title and a street address. The
// person test only looks at two- and three-word names, so a longer sentence
// walked past it. This strips the parts that are never a person (hosts, ids,
// addresses) and tests the capitalised runs that are left.
export function namesAPerson(text, looksPersonal) {
  const prose = String(text || '')
    .replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[\w./?=&%#-]*)?/gi, ' ')
    .replace(/\b\d[\w.-]*\b/g, ' ')
    .replace(/[(),;:/|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!prose) return false;
  // A person's name in written prose is capitalised. Once the vocabulary grew
  // to 7,362 tokens it learned PAGE as a surname and read the lowercase phrase
  // "contact page" as a person — an all-lowercase string is annotation, not a
  // name, and is not tested at all.
  if (!/[A-Z]/.test(prose)) return false;
  if (looksPersonal(prose)) return true;
  // Every run of two or three capitalised words, tested on its own.
  const runs = prose.match(/\b([A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+){1,2})\b/g) || [];
  return runs.some((r) => looksPersonal(r.replace(/\b[A-Z]\.\s*/g, '')));
}
