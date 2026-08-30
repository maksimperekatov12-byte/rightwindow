// Re-read the city's record for one building, on demand.
//
// The feed is rebuilt hourly and in practice drifts further, so a card a client
// opens at 4pm can be describing the city as it stood that morning. Most of the
// time nothing has moved. But the changes that do land are exactly the ones that
// make a call go wrong: the building filed its Cycle 10 report overnight (it is
// no longer a non-filer), or somebody pulled the facade job (it is already
// taken). Those are the two ways a contractor can be embarrassed by us.
//
// So when a card is opened, we ask DOB NOW about that single BIN and let the
// browser compare the answer with what the card shipped with. Three small
// queries per building, cached at the edge for ten minutes, which is well inside
// the daily cadence of the underlying datasets.
const SOCRATA = 'https://data.cityofnewyork.us/resource';
const FACADE_RE = /FACADE|FISP|LOCAL LAW 11|PARAPET|EXTERIOR WALL|POINTING|LINTEL/i;

async function q(dataset, params) {
  const url = new URL(`${SOCRATA}/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${dataset} ${r.status}`);
  return r.json();
}

const ymd = (s) => (s ? String(s).slice(0, 10) : null);

export default async function handler(req, res) {
  const bin = String(req.query.bin || '');
  if (!/^\d{6,8}$/.test(bin)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'bin required' });
  }

  let fisp, jobs, permits;
  try {
    [fisp, jobs, permits] = await Promise.all([
      q('xubg-57si', {
        $where: `bin='${bin}' and cycle in('9','10')`,
        $select: 'cycle,current_status,submitted_on,filing_date,qewi_bus_name',
        $order: 'submitted_on DESC',
        $limit: '20',
      }),
      q('w9ak-ipjd', {
        $where: `bin='${bin}' and job_type='Alteration' and filing_status not in('Filing Withdrawn')`,
        $select: 'job_description,filing_status,filing_date,first_permit_date,applicant_business_name',
        $order: 'filing_date DESC',
        $limit: '30',
      }),
      q('rbx6-tga4', {
        $where: `bin='${bin}' and work_type in('Sidewalk Shed','Suspended Scaffold','Supported Scaffold') and permit_status='Permit Issued'`,
        $select: 'work_type,issued_date,expired_date,applicant_business_name',
        $order: 'issued_date DESC',
        $limit: '10',
      }),
    ]);
  } catch (e) {
    // A timeout upstream is not evidence about the building, so never cache it
    // and never let the card claim it was verified.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'source unavailable', detail: String(e.message || e) });
  }

  // Latest filing per cycle, same rule the collector uses.
  const latest = (cycle) =>
    fisp
      .filter((f) => f.cycle === cycle)
      .sort((a, b) => (b.submitted_on || '').localeCompare(a.submitted_on || ''))[0] || null;
  const c9 = latest('9');
  const c10 = latest('10');
  const src = c10 || c9;

  // The collector ignores filings older than two years, so this has to as well:
  // otherwise a 2022 job the card deliberately left out would read as brand new.
  const cutoff = Date.now() - 730 * 86400000;
  const facade =
    jobs.filter(
      (j) => FACADE_RE.test(j.job_description || '') && Date.parse(j.filing_date || '') > cutoff,
    )[0] || null;
  const permit = permits[0] || null;

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  res.json({
    bin,
    checkedAt: Date.now(),
    lastCycle: c10 ? '10' : c9 ? '9' : null,
    lastStatus: src?.current_status || '',
    lastFiling: ymd(src?.submitted_on),
    qewi: src?.qewi_bus_name || null,
    filing: facade
      ? {
          filed: ymd(facade.filing_date),
          status: facade.filing_status || null,
          permitted: Boolean(facade.first_permit_date),
          who: facade.applicant_business_name || null,
        }
      : null,
    permit: permit
      ? {
          type: permit.work_type,
          issued: ymd(permit.issued_date),
          until: ymd(permit.expired_date),
          who: permit.applicant_business_name || null,
        }
      : null,
  });
}
