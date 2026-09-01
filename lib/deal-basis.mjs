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
export const PERFORMS_WORK = new Set(['restoration']);

export const medianOf = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * @param {object} i
 * @param {boolean} i.explicitTicket  the user saved a figure by hand
 * @param {number}  i.ticket          that figure
 * @param {number}  i.winsRecorded    recorded wins with amounts
 * @param {number}  i.winsMedian      their median
 * @param {string|null} i.profileKey  chosen trade, null/explore = none
 * @param {number[]} i.viewCosts      declared job costs in the filtered view
 * @param {number[]} i.registerCosts  declared job costs, register-wide
 * @param {number}  i.profileFee      the trade's per-job constant for this register
 * @param {number}  i.fallbackFee     the facade engineer's constant (last resort)
 * @returns {{avg: number, basis: 'yours'|'wins'|'view'|'register'|'fee'|'constant'|'none'}}
 */
export function resolveDealBasis(i) {
  if (i.explicitTicket && i.ticket > 0) return { avg: i.ticket, basis: 'yours' };
  if (i.winsRecorded >= 3 && i.winsMedian > 0) return { avg: i.winsMedian, basis: 'wins' };
  const performs = !i.profileKey || i.profileKey === 'explore' || PERFORMS_WORK.has(i.profileKey);
  if (performs) {
    if (i.viewCosts.length >= 8) return { avg: medianOf(i.viewCosts), basis: 'view' };
    if (i.registerCosts.length >= 8) return { avg: medianOf(i.registerCosts), basis: 'register' };
  }
  const fee = i.profileFee || i.fallbackFee || 0;
  if (fee) return { avg: fee, basis: performs ? 'constant' : 'fee' };
  return { avg: 0, basis: 'none' };
}

/**
 * How many of these one crew can actually pursue before the deadline. The
 * expected figure is bounded by it — nobody works a whole register, and any
 * number that implies they do is a claim the reader rejects.
 * Default: ~1.6 pursuits a week over the window, clamped to something a crew
 * would recognise. ESTIMATED — the user's own figure always wins.
 */
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
