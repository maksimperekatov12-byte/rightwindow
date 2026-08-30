// What a dismissal teaches.
//
// Dismissing a card on its own hides one building. Asked why, the same click can
// spare the next twenty that would have been wrong for the same reason. Every
// reason reads a value straight off the card, so "similar" is a fact about the
// record rather than a guess: same borough, same sub-cycle, nobody to call.
//
// A rule only takes effect on the second dismissal for the same value. One bad
// building should not cost a contractor a whole borough, and everything learned
// is listed in the toolbar with a one-click undo — silent filtering would be a
// good way to lose someone real work without ever telling them.
export const REASON_MIN = 2;

export function title(s) {
  if (!s) return s;
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .replace(/\bLlc\b/g, 'LLC')
    .replace(/\bHdfc\b/g, 'HDFC')
    .replace(/\bIi\b/g, 'II')
    .replace(/\bIii\b/g, 'III');
}

export const REASON_SETS = {
  'b:': [
    { k: 'area', label: 'Wrong area', of: (c) => c.borough || null, says: (v) => `${v} buildings` },
    {
      k: 'taken',
      label: 'Already has a contractor',
      of: (c) => (c.occupied ? 'occupied' : null),
      says: () => 'buildings someone is already working',
    },
    {
      k: 'nocall',
      label: 'No one to call',
      of: (c) => (c.agent?.contactKnown ? null : 'nocontact'),
      says: () => 'buildings with no published contact',
    },
    { k: 'far', label: 'Deadline too far out', of: (c) => c.subCycle || null, says: (v) => `sub-cycle ${v}` },
    { k: 'other', label: 'Just not a fit', of: () => null, says: () => '' },
  ],
  'g:': [
    { k: 'area', label: 'Wrong area', of: (c) => c.borough || null, says: (v) => `${v} buildings` },
    {
      k: 'nocall',
      label: 'No one to call',
      of: (c) => (c.agent?.contactKnown ? null : 'nocontact'),
      says: () => 'buildings with no published contact',
    },
    { k: 'far', label: 'Deadline too far out', of: (c) => c.subCycle || null, says: (v) => `sub-cycle ${v}` },
    { k: 'other', label: 'Just not a fit', of: () => null, says: () => '' },
  ],
  'c:': [
    { k: 'agency', label: 'Wrong agency', of: (c) => c.agency || null, says: (v) => `awards from ${title(v)}` },
    { k: 'category', label: 'Wrong kind of work', of: (c) => c.category || null, says: (v) => `${title(v)} awards` },
    { k: 'other', label: 'Just not a fit', of: () => null, says: () => '' },
  ],
  'o:': [
    { k: 'county', label: 'Wrong area', of: (c) => c.county || null, says: (v) => `${title(v)} County` },
    { k: 'kind', label: 'Wrong kind of venue', of: (c) => c.kind || null, says: (v) => `${title(v)} filings` },
    { k: 'other', label: 'Just not a fit', of: () => null, says: () => '' },
  ],
};

export const reasonsFor = (prefix) => REASON_SETS[prefix] || [];

// "Just not a fit" is stored as 'once' and deliberately never reaches the
// threshold: it hides the card and teaches nothing.
export const NO_LESSON = 'once';

// Every (reason, value) pair a person has now rejected at least REASON_MIN times.
export function rulesFrom(fb) {
  const counts = new Map();
  for (const [k, v] of Object.entries(fb || {})) {
    if (v?.s !== 'dismissed' || !v.r || !v.v || v.v === NO_LESSON) continue;
    const id = `${k.slice(0, 2)}${v.r}|${v.v}`;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return new Map([...counts].filter(([, n]) => n >= REASON_MIN));
}

export function taughtAway(learned, prefix, card) {
  if (!learned || !learned.size) return false;
  for (const r of reasonsFor(prefix)) {
    const v = r.of(card);
    if (v && learned.has(`${prefix}${r.k}|${v}`)) return true;
  }
  return false;
}

export function describeRules(learned) {
  return [...(learned?.keys() || [])].map((id) => {
    const prefix = id.slice(0, 2);
    const cut = id.indexOf('|');
    const rk = id.slice(2, cut);
    const value = id.slice(cut + 1);
    const def = reasonsFor(prefix).find((r) => r.k === rk);
    return { id, prefix, rk, value, text: def ? def.says(value) : value };
  });
}
