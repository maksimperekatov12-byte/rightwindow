// The two intraday records — City Record awards and the Liquor Authority's
// pending licences — are read by both collectors: the hourly build and the
// five-minute lane. The site overlays the second on the first row by row, so
// any rule the two lanes hold separately is a rule they will one day disagree
// on. They did: the five-minute lane printed "Kings" where the hourly printed
// "Brooklyn", called a row new on 48 hours of first-seen where the hourly
// wanted seven days AND a city date inside them, and its borough chips and New
// badges replaced the hourly's on every card it touched. So the rules live
// here once, and both lanes import them.

// The liquour file prints the legal county (Kings, New York, Richmond) and the
// health file prints the borough. One register showing both is the register
// contradicting itself.
export const BOROUGH_OF = {
  Kings: 'Brooklyn',
  'New York': 'Manhattan',
  Richmond: 'Staten Island',
  Bronx: 'Bronx',
  Queens: 'Queens',
  Brooklyn: 'Brooklyn',
  Manhattan: 'Manhattan',
  'Staten Island': 'Staten Island',
};

// Seven days, not forty-eight hours. The city's own files land a day or two
// behind, so a two-day window from now can never catch anything and the counter
// reads zero on a week where the city published plenty.
export const NEW_WINDOW_MS = 7 * 24 * 3600 * 1000;

// First seen by us inside the window. 'baseline' is what a register's first
// build stamps, and it is never new.
export const isFreshSeen = (ts, now) => Boolean(ts) && ts !== 'baseline' && now - new Date(ts) <= NEW_WINDOW_MS;

// A date the city itself put on the record, inside the window (and not more
// than a day in the future, which is a typo rather than news).
export const withinWindow = (iso, now) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t <= NEW_WINDOW_MS && t <= new Date(now).getTime() + 86400000;
};

// "New" means the city published something, not that our sampler first looked.
// An award carries its start date; a licence carries the date the Authority
// received it. A venue permit carries no date at all, and there first-seen is
// all there is.
export const isNewAward = (seenTs, date, now) => isFreshSeen(seenTs, now) && withinWindow(date, now);
export const isNewOpening = (seenTs, received, now) => isFreshSeen(seenTs, now) && (received ? withinWindow(received, now) : true);

// 'Under Review' alone is the middle of the Authority's queue. The newest
// stage, 'IntakeComplete', is where an application sits for its first weeks —
// the earliest moment, and the one the register sells — and reading only
// 'Under Review' kept every one of them off it until three or four months after
// receipt. Measured on 2026-09-23: the forty newest 'Under Review' applications
// were received between 07-02 and 09-16; with 'IntakeComplete' read as well,
// the forty run from 09-17 to 09-22. The later stages (Conditionally
// Approved, Reconsideration) were never read and still are not.
export const SLA_STATUSES = ['IntakeComplete', 'Under Review'];

export function slaQuery(now) {
  const since = new Date(now - 150 * 86400000).toISOString().slice(0, 10);
  return new URLSearchParams({
    $where:
      `premises_county in('Kings','Queens','New York','Bronx','Richmond') and ` +
      `status in(${SLA_STATUSES.map((s) => `'${s}'`).join(',')}) and received_date >= '${since}'`,
    // The id breaks ties: several applications share a received date, and
    // without it the two lanes could cut the forty at different rows.
    $order: 'received_date DESC, application_id DESC',
    $limit: '60',
    $select: 'application_id,premises_county,description,legalname,dba,actual_address_of_premises,city,zip_code,received_date',
  });
}

// The same row from both lanes. Fields are named as the hourly feed names them;
// the identity decision (lib/personal.mjs) runs on these rows afterwards.
export const slaRow = (o, now) => ({
  id: o.application_id,
  name: o.dba || o.legalname,
  legal: o.legalname,
  kind: o.description,
  address: `${o.actual_address_of_premises || ''}, ${o.city || ''}`.trim(),
  county: BOROUGH_OF[o.premises_county] || o.premises_county,
  zip: String(o.zip_code || '').trim().slice(0, 5) || null,
  received: o.received_date?.slice(0, 10),
  daysAgo: o.received_date ? Math.max(0, Math.round((now - new Date(o.received_date)) / 86400000)) : null,
  src: 'sla',
});

// City Record's contract_amount is keyed by hand, and at least once it holds
// the PIN with its letter dropped: request 20240124139 (DCAS, 2024-01-31)
// reads $857,240,030,004 against PIN 85724B0030004, and inside the window the
// opener the site drafts would congratulate the vendor on an $857B award.
// 20210524108 (HRA) reads $96 trillion and carries no PIN at all. The largest
// awards in the file since 2023 that are not a PIN are Design and
// Construction's at just under $4B, so ten billion is a ceiling no real award
// has come near. Such a row is dropped rather than shown with a guessed
// amount: the amount is what the register sorts on and what the opener
// congratulates.
export const AWARD_CEILING = 1e10;
export function plausibleAward(a) {
  const amount = Number(a?.contract_amount);
  if (!a?.vendor_name || !Number.isFinite(amount) || amount < 100000 || amount >= AWARD_CEILING) return false;
  const pin = String(a.pin || '').replace(/\D/g, '');
  return !(pin.length >= 6 && String(Math.round(amount)) === pin);
}

// How many rows the merged register shows as new. The site lays the
// five-minute rows over the hourly ones by id and keeps every hourly row the
// fast lane did not re-read, so the count has to be taken over the same union;
// counting the fast slice alone put "2 venue filings" in the header over an
// hourly 80. A fast row with no verdict leaves the hourly one standing, as the
// merge does.
export function newAcross(hourlyRows, fastRows) {
  const isNew = new Map((hourlyRows || []).map((r) => [r.id, Boolean(r.isNew)]));
  for (const r of fastRows || []) if (r.isNew != null) isNew.set(r.id, Boolean(r.isNew));
  let n = 0;
  for (const v of isNew.values()) if (v) n++;
  return n;
}
