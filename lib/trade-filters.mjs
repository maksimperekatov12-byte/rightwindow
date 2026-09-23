// Which rows each trade sees, in one place the site and the mail can share.
//
// The morning digest, the instant alerts and the pilot list used to carry their
// own copy of the site's trade filters (lib/signals.mjs), and the two copies
// drifted: the elevator trade kept getting facade hearings the site had
// stopped showing it, a code attorney never got the UNSAFE orders the site
// promised him, and plumber, retrofit and "just exploring" were mailed nothing
// at all. The predicates below are copied verbatim from src/App.jsx under the
// same names, so the page can import them from here and there is one copy.
//
// Pure functions and plain tables only: this file is imported by the CI
// scripts and must stay importable by the page bundle too.

export const has = (c, kind) => c.signals.some((s) => s.kind === kind);

// The City Record carries three kinds of notice and they ask for different
// things. An award names the firm that already took the money, so you sell to
// it. A solicitation names an agency that wants bids by a date, so the window
// is still open and the contact printed on it is the officer to ask. An intent
// to award is the objection window on a sole-source deal — the shortest window
// in the product and the only one where saying nothing forfeits it.
export const isOpenNotice = (c) => c.kind === 'SOLICITATION' || c.kind === 'INTENT';
export const noticeLabel = (c) => (c.kind === 'INTENT' ? 'Intent to award' : 'Open for bids');

export const CONSTR = /construction|architect|engineer/i;
// An open notice is a facade trade's to bid on only when the scope is the
// building envelope; a sewer, a sidewalk or a boiler is construction too, and
// it filled the register. Awards keep the category test — the pitch there is
// to the winner, whatever they won.
export const ENVELOPE = /fa[cç]ade|roof|waterproof|masonry|brick|pointing|parapet|exterior|envelope|window|storefront|general construction|building projects|scaffold|sidewalk shed/i;
export const facadeBid = (c) => CONSTR.test(c.category || '') && (c.kind === 'AWARD' || ENVELOPE.test(`${c.title || ''} ${c.scope || ''}`));
// A human-services renewal to a settlement house posts no performance bond and
// hires no crew — the bonding pitch is true only of construction winners.
export const constrAward = (c) => c.kind === 'AWARD' && CONSTR.test(c.category || '');
// A liquor licence names a venue only when the licensee is one: a distributor,
// an importer, a brand owner or a chain pharmacy adding beer is not a room
// about to open its doors, and none of them pick a launch agency or cost a menu.
export const NOT_A_VENUE = /^(Wholesale|Importer|Brand Owner|Drug Store)/i;
export const VENUE_KIND = /restaurant|food|beverage|\bbar\b|tavern|club|cabaret|hotel|cater|cafe|brew|winery/i;
export const isVenue = (o) => o.src === 'dohmh' || VENUE_KIND.test(o.kind || '');
// Nine in ten venue rows are Health Department permits, not licence applications.
export const sawRecord = (c) =>
  c.src === 'dohmh' ? `saw the new Health Department permit for ${c.address}` : `saw the license application for ${c.address}`;

// A cancellation notice is not an open solicitation; City Record files them
// under the same kind, and one sat in the feed reading "closes in 2 days".
export const noCancel = (rows) => rows.filter((c) => !/^\s*cancell/i.test(c.title || ''));

// The six registers, and the letter each one's card links use (#b/…, #g/…),
// which is also the prefix of its keys in prefs.feedback.
export const REGISTER_KIND = { facades: 'b', gas: 'g', elevators: 'e', carbon: 'k', contracts: 'c', openings: 'o' };
export const REGISTERS = Object.keys(REGISTER_KIND);

// Every row a register lists before any trade filter — the same rows the page
// starts from: no cancellation notices, and no liquor licensee that is not a
// venue.
export function registerRows(feed, reg) {
  if (reg === 'facades') return feed.facades?.feed || [];
  if (reg === 'contracts') return noCancel(feed.contracts || []);
  if (reg === 'openings') return (feed.openings || []).filter((o) => o.src !== 'sla' || !NOT_A_VENUE.test(o.kind || ''));
  return feed[reg]?.feed || [];
}

export const ALL = () => true;

// Each trade's registers and the filter it sees each one through. A register a
// trade does not list is one the site does not show it. The shape follows
// PROFILES in src/App.jsx:
//   facades   — `facade` is set; its `fFilter`, or every row
//   gas, elevators, carbon — named under `mandates`; no filter
//   contracts — `cNeed` is set; `cFilter`, or every row
//   openings  — `oNeed` is set; `oFilter`, or every row
// A trade with none of those is exploring and sees every register unfiltered.
// When a link forces a register the trade does not list, the site shows it
// through the same filter if the trade has one, else unfiltered — which is
// what `TRADE_REGISTERS[trade][reg] || ALL` gives.
const awards = (c) => c.kind === 'AWARD';
export const TRADE_REGISTERS = {
  qewi: { facades: ALL, contracts: facadeBid },
  restoration: { facades: ALL, contracts: facadeBid },
  lender: { facades: ALL, gas: ALL, carbon: ALL, contracts: awards, openings: ALL },
  // Mandates only: App.jsx sets `facade: null` for this trade on purpose.
  elevator: { elevators: ALL },
  plumber: { gas: ALL },
  retrofit: { carbon: ALL },
  insurance: { facades: ALL, contracts: constrAward, openings: ALL },
  pos: { openings: ALL },
  fnb: { openings: isVenue },
  staffing: { contracts: awards, openings: ALL },
  equipment: {
    facades: (c) => has(c, 'SWARMP_CARRYOVER') || has(c, 'UNSAFE_PRIOR') || Boolean(c.shed),
    contracts: (c) => CONSTR.test(c.category || ''),
  },
  propmgmt: { facades: (c) => Boolean(c.ownerChange || c.mgmtChange) },
  legal: {
    facades: (c) => Boolean(c.nextHearing || c.freshHaz || (c.ecbBalance || 0) > 0 || has(c, 'UNSAFE_PRIOR')),
    gas: ALL,
    elevators: ALL,
    carbon: ALL,
  },
  cre: { facades: ALL, gas: ALL, carbon: ALL },
  marketing: { openings: isVenue },
  signage: { openings: ALL },
  explore: { facades: ALL, gas: ALL, elevators: ALL, carbon: ALL, contracts: ALL, openings: ALL },
};

// The name each trade goes by on the page (PROFILES[k].label), for the mail
// that would otherwise print an internal id like "qewi" at a stranger.
export const TRADE_LABELS = {
  qewi: 'Facade engineer',
  restoration: 'Restoration contractor',
  lender: 'C-PACE / lender',
  elevator: 'Elevator services',
  plumber: 'Licensed master plumber',
  retrofit: 'Energy retrofit contractor',
  insurance: 'Insurance / bonding',
  pos: 'POS / payments',
  fnb: 'F&B supplier',
  staffing: 'Staffing',
  equipment: 'Equipment / access',
  propmgmt: 'Property management',
  legal: 'Code attorney / expeditor',
  cre: 'CRE broker / investor',
  marketing: 'Local marketing',
  signage: 'Signs / storefront',
  explore: 'Just exploring',
};
