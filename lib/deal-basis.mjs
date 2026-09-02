// The one place the funnel's average contract value is decided.
//
// It exists because the same empty register once showed $375K on one machine
// and $12K on another — two deploys apart, but indistinguishable from a
// viewport-dependent formula to anyone watching. A single pure function with
// explicit inputs is the only shape that cannot regress that way: no component
// computes its own, nothing here reads state, storage, or the window.
//
// The correctness rule inside it: median DECLARED JOB COST is what the
// building spends on the work. That is the right basis for a trade that
// performs the work, and roughly thirty times too high for one that sells the
// inspection report on it. The basis follows what the USER sells.
/**
 * How many of these one crew can actually pursue before the deadline. The
 * expected figure is bounded by it — nobody works a whole register, and any
 * number that implies they do is a claim the reader rejects.
 * Default: ~1.6 pursuits a week over the window, clamped to something a crew
 * would recognise. ESTIMATED — the user's own figure always wins.
 */
export const medianOf = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export function defaultCapacity(weeksToDeadline, kind = 'work') {
  // A crew that performs the work manages ~1.6 pursuits a week; a firm that
  // sells the report or the inspection turns over several a week — 39 reports
  // per window priced a QEWI whole season at $36K, which no inspector would
  // recognise. Both are ESTIMATES; the user's own figure always wins.
  const perWeek = kind === 'fee' ? 5 : 1.6;
  const lo = kind === 'fee' ? 30 : 8;
  const hi = kind === 'fee' ? 240 : 48;
  if (!Number.isFinite(weeksToDeadline) || weeksToDeadline <= 0) return kind === 'fee' ? 120 : 40;
  return Math.max(lo, Math.min(hi, Math.round(weeksToDeadline * perWeek)));
}

// ---------------------------------------------------------------------------
// THE ONE FILE OF ASSUMED VALUES.
//
// A register does not have a contract value — a TRADE does, and it is the
// value of the relationship, not of the trigger transaction: a $2K gas
// inspection sells the repair it opens and returns every four years; a $2.6K
// CAT1 test sells an annual service contract that renews; a $4K POS install
// sells processing for the life of the venue.
//
// basis says where a figure comes from:
//   city-record — derived from data the city published (declared job costs,
//                 award amounts); never invented here.
//   assumption  — our estimate. EVERY assumption lives in this table and the
//                 UI labels it as one. Confirm or correct them here.
// recurring     — the unit repeats on this period; the UI says so.
// share         — the unit is this fraction of the actual award amount.
// pace          — how many of these one firm can pursue per week ('fast' ≈ 5,
//                 'slow' ≈ 1.6); defaults from unit size when absent.
// ---------------------------------------------------------------------------
export const TRADE_UNITS = {
  facades: {
    // Whole-job trades price at the city's own number.
    _default:    { source: 'medianCost', basis: 'city-record', what: 'median declared job cost' },
    restoration: { source: 'medianCost', basis: 'city-record', what: 'median declared job cost' },
    qewi:        { unit: 12000,  basis: 'assumption', what: 'FISP report fee' },
    equipment:   { unit: 45000,  basis: 'assumption', what: 'shed and scaffold package' },
    insurance:   { unit: 12000,  basis: 'assumption', what: 'policy and bond premium on one job' },
    lender:      { unit: 200000, basis: 'assumption', what: 'financing ticket on one job' },
    propmgmt:    { unit: 50000,  basis: 'assumption', recurring: 'year', what: 'management contract' },
    legal:       { unit: 7500,   basis: 'assumption', what: 'one violations matter' },
    cre:         { unit: 160000, basis: 'assumption', what: 'commission on one sale' },
  },
  gas: {
    // The inspection is ~$2K; the relationship is the inspection PLUS the
    // repair it uncovers, and LL152 returns every four years.
    _default: { unit: 10000, basis: 'assumption', recurring: 'four years', what: 'inspection plus the repair it opens' },
    lender:   { unit: 90000, basis: 'assumption', what: 'financing ticket on remediation' },
    propmgmt: { unit: 4000,  basis: 'assumption', recurring: 'year', what: 'compliance line of a management contract' },
    legal:    { unit: 6000,  basis: 'assumption', what: 'one violations matter' },
    cre:      { unit: 120000, basis: 'assumption', what: 'commission on one sale' },
  },
  elevators: {
    // A building that skipped a whole CAT1 cycle has no service contract.
    // The unit is the annual contract, and it renews.
    _default: { unit: 12000, basis: 'assumption', recurring: 'year', what: 'annual service contract, one building' },
    propmgmt: { unit: 6500,  basis: 'assumption', recurring: 'year', what: 'compliance line of a management contract' },
    legal:    { unit: 5000,  basis: 'assumption', what: 'one violations matter' },
  },
  // Carbon leads with aggregate priced exposure from the buildings' own
  // reports — no per-trade funnel, by design.
  carbon: {},
  contracts: {
    // Solicitations publish no dollar amounts, so trades that BID get
    // deadlines, never invented money. Trades that sell INTO an award price
    // as a share of the actual award amounts (city-record base × assumed share).
    _bid:      { basis: 'city-record', what: 'bid deadlines — notices publish no amounts' },
    insurance: { share: 0.015, basis: 'assumption', what: 'bond and insurance premium, ~1.5% of the award' },
    lender:    { share: 0.02,  basis: 'assumption', what: 'working capital, ~2% of the award' },
    staffing:  { share: 0.05,  basis: 'assumption', what: 'staffing spend, ~5% of the award' },
  },
  openings: {
    _default:  { unit: 4000,  basis: 'assumption', what: 'one venue setup' },
    pos:       { unit: 3600,  basis: 'assumption', recurring: 'year', life: 4, what: 'processing and software, per venue' },
    fnb:       { unit: 24000, basis: 'assumption', recurring: 'year', life: 3, what: 'supply account, per venue' },
    insurance: { unit: 4000,  basis: 'assumption', recurring: 'year', life: 4, what: 'venue policy' },
    marketing: { unit: 15000, basis: 'assumption', what: 'launch campaign' },
    signage:   { unit: 20000, basis: 'assumption', what: 'storefront package' },
    staffing:  { unit: 18000, basis: 'assumption', what: 'opening crew placement' },
    lender:    { unit: 120000, basis: 'assumption', what: 'equipment financing' },
  },
};

/**
 * The single resolution path for the money unit. Nothing else computes one.
 * Order: the user's own saved figure → the median of 3+ recorded wins → the
 * trade's entry in TRADE_UNITS (deriving city-record values from `derived`).
 * @param {object} i  { register, profileKey, explicitTicket, ticket,
 *                      winsRecorded, winsMedian,
 *                      derived: { medianCost, medianAward } }
 * @returns {{unit:number, basis:string, what:string, recurring?:string, life?:number, share?:number}|null}
 */
export function resolveMoney(i) {
  if (i.explicitTicket && i.ticket > 0)
    return { unit: i.ticket, basis: 'yours', what: 'your average contract' };
  if (i.winsRecorded >= 3 && i.winsMedian > 0)
    return { unit: i.winsMedian, basis: 'wins', what: `median of your recorded wins` };
  const table = TRADE_UNITS[i.register] || {};
  const spec = table[i.profileKey] || table._default || (i.register === 'contracts' ? table._bid : null);
  if (!spec) return null;
  if (spec.source === 'medianCost') {
    if (!i.derived?.medianCost) return null;
    return { unit: i.derived.medianCost, basis: 'city-record', what: spec.what };
  }
  if (spec.share) {
    if (!i.derived?.medianAward) return null;
    return { unit: Math.round(i.derived.medianAward * spec.share), basis: 'assumption', what: spec.what, share: spec.share };
  }
  if (!spec.unit) return { unit: 0, basis: spec.basis, what: spec.what };
  return { unit: spec.unit, basis: spec.basis, what: spec.what, recurring: spec.recurring, life: spec.life };
}
