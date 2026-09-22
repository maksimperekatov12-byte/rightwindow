// The publishers' own clocks, and one table of everything the collectors read.
//
// On a Monday morning the header read "city published 57h ago" while DOB had
// refreshed four of its datasets the evening before and the Liquor Authority
// had loaded rows that night. The figure was never the city's. It was the last
// tick on which the two intraday lists differed from the tick before — blind
// to the other nine records the product reads, and bumped at midnight UTC when
// the 14-day awards window slides and a week-old notice drops off the end.
//
// Every Socrata dataset carries rowsUpdatedAt: the moment its owner last loaded
// rows. That is what "published" means, and it is read from here by both
// collectors, so the hourly feed and the five-minute document cannot disagree
// about which records exist or what they are called. The same table names the
// source behind every request the collectors make, which is how /status can
// say WHICH record fell off rather than that "the run failed".
const HOST = 'data.cityofnewyork.us';

// staleAfter: hours without a load before the publisher, not us, is the one
// that has gone quiet. DOB NOW loads nightly, weekends included; the City
// Record only on business days, so a long weekend must not read as an outage.
// lookup: read for context on a card, not a record of its own — no clock.
export const SOURCES = {
  facades: { id: 'xubg-57si', label: 'DOB facade compliance filings', agency: 'DOB', staleAfter: 60 },
  permits: { id: 'rbx6-tga4', label: 'DOB approved permits', agency: 'DOB', staleAfter: 60 },
  jobs: { id: 'w9ak-ipjd', label: 'DOB job applications', agency: 'DOB', staleAfter: 60 },
  elevators: { id: 'e5aq-a4j2', label: 'DOB elevator compliance', agency: 'DOB', staleAfter: 60 },
  mandates: { id: '855j-jady', label: 'DOB safety violations', agency: 'DOB', staleAfter: 60 },
  ecb: { id: '6bgk-3dad', label: 'DOB ECB violations', agency: 'DOB', staleAfter: 60 },
  hpd: { id: 'tesw-yqqr', label: 'HPD building registrations', agency: 'HPD', staleAfter: 24 * 60 },
  awards: { id: 'dg92-zbpx', also: ['qyyg-4tf5'], label: 'City Record awards', agency: 'DCAS', staleAfter: 96 },
  dohmh: { id: '43nn-pn8j', label: 'Health Department food permits', agency: 'DOHMH', staleAfter: 96 },
  sla: { id: 'f8i8-k2gm', host: 'data.ny.gov', label: 'State Liquor Authority pending licenses', agency: 'NYS SLA', staleAfter: 60 },
  hpdContacts: { id: 'feu5-w2e2', label: 'HPD registration contacts', agency: 'HPD', lookup: true },
  acris: { id: 'bnx9-e6tj', also: ['8h5j-fqxa'], label: 'ACRIS deeds', agency: 'DOF', lookup: true },
  energy: { id: '5zyy-y8am', label: 'LL84 energy benchmarking', agency: 'DOB', lookup: true },
  laa: { id: 'xxbr-ypig', label: 'DOB limited alteration applications', agency: 'DOB', lookup: true },
  dcwp: { id: 'w7w3-xahh', label: 'DCWP issued licenses', agency: 'DCWP', lookup: true },
  pluto: { id: '64uk-42ks', label: 'PLUTO tax lots', agency: 'DCP', lookup: true },
};

// Which record a request was for, from its URL. Null for anything that is not
// a Socrata dataset we know — the caller decides what to call that.
export function sourceKeyOf(url) {
  const m = String(url).match(/\/(?:resource|api\/views)\/([a-z0-9]{4}-[a-z0-9]{4})/);
  if (!m) return null;
  for (const [key, s] of Object.entries(SOURCES)) if (s.id === m[1] || s.also?.includes(m[1])) return key;
  return null;
}

async function plainJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// Epoch ms, or null. A blip on a metadata endpoint must never fail a collection
// run, and an unknown clock has to read as unknown — never as "just now".
export async function sourceStamp(key, fetchJson = plainJson) {
  const s = SOURCES[key];
  if (!s) return null;
  try {
    const r = await fetchJson(`https://${s.host || HOST}/api/views/${s.id}.json`);
    const t = Number(r?.rowsUpdatedAt) * 1000;
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

export const clockKeys = () => Object.keys(SOURCES).filter((k) => !SOURCES[k].lookup);

export async function sourceStamps(fetchJson) {
  const out = {};
  for (const key of clockKeys()) out[key] = await sourceStamp(key, fetchJson);
  return out;
}

// The one figure the header prints: the newest clock among the records read,
// and which record set it. Values may be ms or ISO.
export function newestStamp(stamps) {
  let best = 0;
  let key = null;
  for (const [k, v] of Object.entries(stamps || {})) {
    const t = v ? +new Date(v) : 0;
    if (t > best) {
      best = t;
      key = k;
    }
  }
  return best ? { at: best, key } : null;
}
