// The five-minute lane (scripts/collect-fast.mjs, served by /api/live)
// re-checks a narrow slice — award notices and liquor licences — straight from
// the source, and publishes only what it saw. It must never REPLACE a register:
// it was still writing the old 29-award, 40-venue shape after the build moved
// to 156 City Record notices and 400 openings, so production was serving a
// third of the product and none of the open solicitations. Rows are merged by
// id.
//
// It must not overwrite the build either. The hourly build normalises and vets
// what it publishes — the liquor file's legal county becomes the borough
// ("Kings" is Brooklyn), a notice title is stripped of its HTML, and a
// licensee's name is printed only where something vouches that it is a
// business (lib/personal.mjs). The fast lane does none of that. Spreading its
// rows over the build's relabelled 29 of 40 venues to "New York" / "Kings" /
// "Richmond", so the borough chips silently lost them, and put back the
// private individual's name the build had withheld. So a row the build
// already vetted takes only the fields that genuinely move between builds.
export const LIVE_VOLATILE = ['isNew', 'daysAgo'];

// The same table the build applies (scripts/collect.mjs BOROUGH_OF).
const BOROUGH_OF = {
  Kings: 'Brooklyn',
  'New York': 'Manhattan',
  Richmond: 'Staten Island',
  Bronx: 'Bronx',
  Queens: 'Queens',
  Brooklyn: 'Brooklyn',
  Manhattan: 'Manhattan',
};

// A licence the hourly build has not seen yet: no identity evidence has been
// weighed, so no name — the card is identified by its address until the build
// vets it, exactly as the build itself shows an unvouched licensee. A producer
// that runs the build's gate may say so with nameShown: true.
function unvettedOpening(r) {
  const county = BOROUGH_OF[r.county] || r.county;
  // The fast lane reads the liquor file only; without a source tag the
  // NOT_A_VENUE filter (wholesalers, importers) would let the row through.
  const src = r.src || 'sla';
  if (r.nameShown === true) return { ...r, county, src };
  const { name, legal, ...rest } = r;
  const addr = String(r.address || '').split(',')[0].trim();
  return {
    ...rest,
    county,
    src,
    nameShown: false,
    identity: r.identity || (addr ? `New ${String(r.kind || 'business').toLowerCase()} at ${addr}` : 'New business, address on file'),
  };
}

// An award the build has not seen yet. The fast lane reads award notices only
// and does not tag them; the staffing filter and the CSV read `kind`.
const plainTitle = (t) => (t == null ? t : String(t).replace(/<[^>]*>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
function unvettedContract(r) {
  return { ...r, kind: r.kind || 'AWARD', title: plainTitle(r.title) };
}

/**
 * Merge a fast-lane list into the build's list of the same register.
 * `kind` is 'openings' or 'contracts'; it picks how an unseen row is vetted.
 */
export function mergeLive(base, fresh, kind) {
  if (!Array.isArray(fresh) || !fresh.length) return base;
  const byId = new Map(base.map((r) => [r.id, r]));
  for (const r of fresh) {
    if (!r || r.id == null) continue;
    const had = byId.get(r.id);
    if (had) {
      const next = { ...had };
      for (const k of LIVE_VOLATILE) if (r[k] != null) next[k] = r[k];
      byId.set(r.id, next);
    } else {
      byId.set(r.id, kind === 'openings' ? unvettedOpening(r) : kind === 'contracts' ? unvettedContract(r) : r);
    }
  }
  return [...byId.values()];
}
