// One place that knows how a signal becomes a message: matching, urgency tiers,
// human copy. Shared by the digest, Slack delivery and instant alerts.
export const FACADE_PROFILES = new Set([
  'qewi', 'restoration', 'elevator', 'insurance', 'lender', 'equipment', 'propmgmt', 'legal', 'cre',
]);
export const CONTRACT_PROFILES = new Set(['insurance', 'lender', 'staffing', 'equipment', 'qewi', 'restoration']);
export const OPENING_PROFILES = new Set(['insurance', 'lender', 'staffing', 'pos', 'fnb', 'marketing', 'signage']);

const CONSTR = /construction|architect|engineer/i;
export const facadeMatch = {
  elevator: (c) => Boolean(c.elevator),
  propmgmt: (c) => Boolean(c.ownerChange || c.mgmtChange),
  legal: (c) => Boolean(c.nextHearing || c.freshHaz || (c.ecbBalance || 0) > 0),
  equipment: (c) => c.signals.some((s) => ['SWARMP_CARRYOVER', 'UNSAFE_PRIOR'].includes(s.kind)) || Boolean(c.shed),
};
export const contractMatch = {
  qewi: (c) => CONSTR.test(c.category || ''),
  restoration: (c) => CONSTR.test(c.category || ''),
  equipment: (c) => CONSTR.test(c.category || ''),
};

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

// Signals for a profile, newest first. `onlyNew` restricts to the 48h window.
export function matchFor(feed, profile, { onlyNew = true, portfolio = null } = {}) {
  const out = [];
  const inPortfolio = (c) => !portfolio?.length || portfolio.includes(c.bin);
  if (FACADE_PROFILES.has(profile)) {
    const m = facadeMatch[profile] || (() => true);
    for (const c of feed.facades.feed) {
      if (!m(c) || !inPortfolio(c)) continue;
      if (onlyNew && !(c.isNew || c.fresh?.length) && !portfolio?.includes(c.bin)) continue;
      out.push({
        kind: 'b',
        id: c.bin,
        title: `${titleCase(c.address)}, ${c.borough}`,
        why: whyNow(c),
        urgent: urgentReason(c),
        score: c.urgencyScore,
        raw: c,
      });
    }
  }
  if (CONTRACT_PROFILES.has(profile)) {
    const m = contractMatch[profile] || (() => true);
    for (const c of feed.contracts) {
      if (!m(c) || (onlyNew && !c.isNew)) continue;
      out.push({ kind: 'c', id: c.id, title: c.vendor, why: `Won ${money(c.amount)} from ${c.agency}.`, urgent: null, score: 5, raw: c });
    }
  }
  if (OPENING_PROFILES.has(profile)) {
    for (const o of feed.openings) {
      if (onlyNew && !o.isNew) continue;
      out.push({ kind: 'o', id: o.id, title: o.name, why: `${o.kind} opening in 2–4 months · ${o.address}.`, urgent: null, score: 4, raw: o });
    }
  }
  return out.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.score - a.score);
}
