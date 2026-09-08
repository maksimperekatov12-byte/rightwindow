// The link in a cold email is the whole first impression.
//
// A contractor who clicks it must land on HIS list — his trade, his ZIPs, his
// register — with no modal, no sign-up and nobody to talk to. Everything that
// personalises the page therefore lives in the URL, and this module is the one
// place that reads and writes it. Nothing here touches storage: `for` is a
// greeting we render once and never keep, because a name pulled from a
// prospect list has no business persisting on somebody's device.
export const TRADE_ALIASES = {
  'facade-engineer': 'qewi',
  facade: 'qewi',
  qewi: 'qewi',
  restoration: 'restoration',
  elevator: 'elevator',
  plumber: 'qewi', // LL152 filings are a plumber's work; the gas register is his page
  retrofit: 'lender',
  equipment: 'equipment',
  insurance: 'insurance',
  lender: 'lender',
  propmgmt: 'propmgmt',
  legal: 'legal',
  cre: 'cre',
  staffing: 'staffing',
  pos: 'pos',
  fnb: 'fnb',
  marketing: 'marketing',
  signage: 'signage',
};

const REGS = new Set(['facades', 'carbon', 'elevators', 'gas', 'contracts', 'openings']);
// The register a trade-specific link should open when it names no register.
export const REG_FOR_TRADE = { plumber: 'gas', elevator: 'elevators', retrofit: 'carbon' };

const clean = (s, max = 80) =>
  String(s || '')
    // Strip only what has no business being rendered from a prospect list.
    // Written once as a character RANGE, this quietly ate every digit in
    // ?zips — hence the explicit set, and scripts/test-invite.mjs below it.
    .replace(/["'<>`\\]/g, '')
    .trim()
    .slice(0, max);

/** Read the invitation out of a query string. Every field is optional. */
export function readInvite(search = location.search) {
  const q = new URLSearchParams(search);
  const rawTrade = clean(q.get('trade'), 24).toLowerCase();
  const trade = TRADE_ALIASES[rawTrade] || null;
  const zips = (clean(q.get('zips'), 120).match(/\d{5}/g) || []).slice(0, 12);
  const regParam = clean(q.get('reg'), 16).toLowerCase();
  const reg = REGS.has(regParam) ? regParam : REG_FOR_TRADE[rawTrade] || null;
  return {
    trade,
    rawTrade: rawTrade || null,
    zips,
    reg,
    // Shown once, above the strip; never stored.
    for: clean(q.get('for'), 60) || null,
    // Attribution rides the whole session and lands on the subscriber record.
    ref: clean(q.get('ref'), 40).toLowerCase().replace(/[^a-z0-9._-]/g, '') || null,
  };
}

/**
 * Keep the address bar shareable: as the visitor filters, the link updates so
 * copying it hands somebody the same view. Clearing the filters drops the
 * params rather than leaving a lie in the URL.
 */
export function syncInvite({ trade, zips, reg, ref, forName }) {
  try {
    const u = new URL(location.href);
    const set = (k, v) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    set('trade', trade || '');
    set('zips', zips?.length ? zips.join(',') : '');
    set('reg', reg || '');
    set('ref', ref || '');
    set('for', forName || '');
    if (u.toString() !== location.href) history.replaceState(null, '', u.toString());
  } catch {}
}
