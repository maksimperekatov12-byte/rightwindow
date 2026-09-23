// One place that knows how a signal becomes a message: matching, urgency tiers,
// human copy. Shared by the digest, Slack delivery and instant alerts.
// What a trade is emailed must be what it sees on the site, so the matching
// itself is not written here: it reads lib/trade-filters.mjs, the site's trade
// filters in a file both sides can import (scripts/test-trade-filters.mjs holds
// the two together). This file only turns a matched row into a message.
import { REGISTER_KIND, REGISTERS, TRADE_REGISTERS, ALL, registerRows, isOpenNotice, noticeLabel } from './trade-filters.mjs';

export const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
export const titleCase = (s) => (s || '').toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

// "Urgent" = the clock is measured in days, not months. These are the only
// signals worth interrupting someone for.
export function urgentReason(c) {
  if (c.freshHaz && c.freshHaz.daysAgo <= 21)
    return `${c.freshHaz.hazardous ? 'Hazardous violation' : 'New violation'} issued ${c.freshHaz.daysAgo} day${c.freshHaz.daysAgo === 1 ? '' : 's'} ago`;
  if (c.nextHearing) {
    const days = Math.round((new Date(c.nextHearing) - Date.now()) / 86400000);
    if (days >= 0 && days <= 30) return `OATH hearing in ${days} day${days === 1 ? '' : 's'} (${c.nextHearing})`;
  }
  if (c.mgmtChange) return 'Management just changed — vendor relationships reset';
  if (c.ownerChange && c.ownerChange.daysAgo <= 45) return `Sold ${c.ownerChange.daysAgo} days ago`;
  return null;
}

export function whyNow(c) {
  if (c.mgmtChange) return 'HPD registration changed — new management or a quiet sale.';
  if (c.ownerChange) return `Sold ${c.ownerChange.recorded}${c.ownerChange.amount ? ` for ${money(Math.round(c.ownerChange.amount))}` : ''}.`;
  if (c.freshHaz) return `DOB violation ${c.freshHaz.daysAgo} days ago${c.nextHearing ? `, hearing ${c.nextHearing}` : ''}.`;
  if (c.signals.some((s) => s.kind === 'SWARMP_CARRYOVER')) return 'Open SWARMP from Cycle 9 — presumed UNSAFE at the next filing.';
  if (c.signals.some((s) => s.kind === 'UNSAFE_PRIOR')) return 'UNSAFE on file — shed and repairs are mandatory.';
  return `No Cycle 10 filing · ${c.subCycle} deadline ${c.deadline} (${c.monthsLeft} mo left).`;
}

// The building registers other than facades carry one obligation each, so one
// line says what it is — written from the row, never from a fixed promise.
function mandateWhy(reg, c) {
  if (reg === 'gas') return `Open Local Law 152 gas-piping violation${c.deadline ? ` · filing due ${c.deadline}` : ''}.`;
  if (reg === 'carbon')
    return c.ghg?.usd > 0
      ? `Named on a Local Law 97 violation · exposure about ${money(c.ghg.usd)}/yr.`
      : 'Named on a Local Law 97 violation — emissions report owed.';
  return `${c.devices === 1 ? 'One device' : `${c.devices} devices`} last filed CAT1 for ${c.lastCat1 || 'no year on record'} — a skipped cycle.`;
}

// A licence or a permit is a venue on its way, not a date. Matched against
// Health Department inspections, a Brooklyn sample of new liquor licences had
// about a third filed before the venue opened and more filed once it was
// already trading, so the old "opening in 2–4 months" was a promise the record
// does not make. A permit row makes no timing claim at all: nobody measured one.
const openingWhy = (o) =>
  o.src === 'dohmh'
    ? `${o.kind} · new Health Department permit · ${o.address}.`
    : `${o.kind} · liquor licence filed, often before it opens · ${o.address}.`;

function toItem(reg, c) {
  const kind = REGISTER_KIND[reg];
  if (reg === 'facades')
    return {
      kind,
      id: c.bin,
      title: `${titleCase(c.address)}, ${c.borough}`,
      why: whyNow(c),
      urgent: urgentReason(c),
      score: c.urgencyScore,
      raw: c,
    };
  // An open notice has no vendor yet: its name is the notice, and nobody has
  // "won" anything. The card on the site reads the same way.
  if (reg === 'contracts')
    return isOpenNotice(c)
      ? {
          kind,
          id: c.id,
          title: c.title,
          why: `${noticeLabel(c)} · ${c.agency}${c.dueDate ? ` · due ${String(c.dueDate).slice(0, 10)}` : ''}.`,
          urgent: null,
          score: 5,
          raw: c,
        }
      : { kind, id: c.id, title: c.vendor, why: `Won ${money(c.amount)} from ${c.agency}.`, urgent: null, score: 5, raw: c };
  if (reg === 'openings') return { kind, id: c.id, title: c.name, why: openingWhy(c), urgent: null, score: 4, raw: c };
  return { kind, id: c.bin, title: `${titleCase(c.address)}, ${c.borough}`, why: mandateWhy(reg, c), urgent: null, score: c.urgencyScore ?? 3, raw: c };
}

// Signals for a profile, most urgent first. `onlyNew` restricts to the 48h
// window. `register` narrows to one register — a pilot's "this list" — and, as
// on the site, a register the trade does not list is shown unfiltered rather
// than refused. A trade the site does not know is exploring, as it is there.
export function matchFor(feed, profile, { onlyNew = true, portfolio = null, register = null } = {}) {
  const trade = TRADE_REGISTERS[profile] || TRADE_REGISTERS.explore;
  const regs = register ? (REGISTER_KIND[register] ? [register] : []) : REGISTERS.filter((r) => trade[r]);
  const inPortfolio = (c) => !portfolio?.length || portfolio.includes(c.bin);
  const out = [];
  for (const reg of regs) {
    const m = trade[reg] || ALL;
    // Buildings follow the portfolio: with one set, only its buildings, and
    // those every day rather than only when something new landed on them.
    const building = reg !== 'contracts' && reg !== 'openings';
    for (const c of registerRows(feed, reg)) {
      if (!m(c)) continue;
      if (building && !inPortfolio(c)) continue;
      const fresh = reg === 'facades' ? c.isNew || c.fresh?.length : c.isNew;
      if (onlyNew && !fresh && !(building && portfolio?.includes(c.bin))) continue;
      out.push(toItem(reg, c));
    }
  }
  return out.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.score - a.score);
}

// A card the user dismissed on the site never comes back by email, Slack or
// alert. The keys are the site's own: b:<bin>, c:<id>, o:<id>, g:/e:/k:<bin>.
export const notDismissed = (pref) => (i) => pref?.feedback?.[`${i.kind}:${i.id}`]?.s !== 'dismissed';

// A pilot's territory. The ZIP is on the source row: matchFor wraps each row
// as {kind, id, title, ..., raw}, and reading `zip` off the wrapper kept
// nothing, so every pilot with a ZIP was silently sent nothing at all. A row
// with no ZIP (a City Record notice) is outside every territory, as it is on
// the site, where a ZIP search lists no contracts.
export const inTerritory = (zips) => {
  const set = new Set(zips || []);
  return (i) => !set.size || set.has(String(i.raw?.zip ?? ''));
};

// What a pilot is sent: "this list, every morning" — the register it was
// started on, through its trade's filter, in its ZIPs. A pilot started with no
// trade is exploring, as the visitor was. A pilot saved before pilots recorded
// a register keeps its trade's registers. A register the mail does not know
// gets silence, never another register's cards.
export function pilotMatch(feed, p, { onlyNew = true } = {}) {
  if (p.reg && !REGISTER_KIND[p.reg]) return [];
  return matchFor(feed, p.trade || 'explore', { onlyNew, register: p.reg || null }).filter(inTerritory(p.zips));
}
