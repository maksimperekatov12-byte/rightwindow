// The publishers' own clocks.
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
// about which records exist or what they are called.
const HOST = 'data.cityofnewyork.us';

export const SOURCES = {
  facades: { id: 'xubg-57si', label: 'DOB facade compliance filings' },
  permits: { id: 'rbx6-tga4', label: 'DOB approved permits' },
  jobs: { id: 'w9ak-ipjd', label: 'DOB job applications' },
  elevators: { id: 'e5aq-a4j2', label: 'DOB elevator compliance' },
  mandates: { id: '855j-jady', label: 'DOB safety violations' },
  ecb: { id: '6bgk-3dad', label: 'DOB ECB violations' },
  hpd: { id: 'tesw-yqqr', label: 'HPD building registrations' },
  awards: { id: 'dg92-zbpx', label: 'City Record awards' },
  dohmh: { id: '43nn-pn8j', label: 'Health Department food permits' },
  sla: { id: 'f8i8-k2gm', host: 'data.ny.gov', label: 'State Liquor Authority pending licenses' },
};

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

export async function sourceStamps(fetchJson) {
  const out = {};
  for (const key of Object.keys(SOURCES)) out[key] = await sourceStamp(key, fetchJson);
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
