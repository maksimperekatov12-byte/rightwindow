// The run report behind /status, exercised with the real recorder and fold.
//
// Why it exists: the publisher's clock (/api/views/<id>.json) is read after
// every data read and used to share the record's state, so it decided it — a
// City Record outage whose clock answered closed its own incident, and in the
// five-minute lane one twelve-hour outage became forty ten-minute incidents
// that pushed its own start off the list. A crash was hidden behind the
// search provider's standing 429, and an outage older than thirty days was
// reborn as a new one. Offline and instant: no request leaves this file.
import assert from 'node:assert/strict';
import { recorder, foldIncidents } from '../lib/health.mjs';
import { sourceKeyOf, readKindOf, clockKeys, SOURCES } from '../lib/sources.mjs';

const DAY = 24 * 3600 * 1000;
let now = Date.UTC(2026, 8, 23, 12, 5);
Date.now = () => now;

const rows = (id) => `https://data.cityofnewyork.us/resource/${id}.json?$limit=10`;
const clock = (key) => `https://${SOURCES[key].host || 'data.cityofnewyork.us'}/api/views/${SOURCES[key].id}.json`;
const ok = { ok: true, rows: 5 };
const down = { ok: false, status: 503, retries: 6, error: '503: Service unavailable' };

// The URL says what was read.
assert.equal(readKindOf(rows('dg92-zbpx')), 'rows');
assert.equal(readKindOf(clock('awards')), 'clock');
assert.equal(readKindOf('https://api.github.com/x'), null);
assert.equal(sourceKeyOf(rows('qyyg-4tf5')), 'awards');
assert.equal(sourceKeyOf(clock('awards')), 'awards');

// Hourly: the rows failed, the clock answered later. The record is down and
// opens an incident; one already open stays open.
{
  const h = recorder('hourly');
  h.request(rows('dg92-zbpx'), down);
  h.request(clock('awards'), { ok: true });
  const r = h.finish({ outcome: 'ok' });
  assert.equal(r.sources.awards.ok, false, 'a clock read cleared a failed data read');
  assert.equal(r.sources.awards.clock.ok, true);
  assert.equal(r.sources.awards.retries, 6, 'clock reads must not touch the data counters');
  const inc = foldIncidents([], r);
  assert.deepEqual(inc.map((i) => `${i.source}:${i.resolvedAt ? 'resolved' : 'open'}`), ['awards:open']);
  const again = foldIncidents([{ ...inc[0], at: now - 3600e3 }], r);
  assert.equal(again[0].resolvedAt, null, 'an open incident was resolved by a clock read');
  assert.equal(again[0].count, 2);
}

// The rows arrived, the clock did not: the record is fine, nothing opens.
{
  const h = recorder('hourly');
  h.request(rows('dg92-zbpx'), ok);
  h.request(clock('awards'), down);
  const r = h.finish({ outcome: 'ok' });
  assert.equal(r.sources.awards.ok, true, 'a failed clock read failed a record whose rows arrived');
  assert.equal(r.sources.awards.clock.ok, false);
  assert.deepEqual(foldIncidents([], r), []);
}

// Every data read counts, not the last one: a failed page stays failed.
{
  const h = recorder('hourly');
  h.request(rows('rbx6-tga4'), down);
  h.request(rows('rbx6-tga4'), ok);
  assert.equal(h.sources.permits.ok, false, 'a later read cleared an earlier failed one');
}

// The search provider reports through note() and keeps its latest outcome.
{
  const h = recorder('hourly');
  h.note('enrichment', { ok: false, status: 429 });
  h.note('enrichment', { ok: true });
  assert.equal(h.sources.enrichment.ok, true);
}

// A record read only by its clock has no data state and opens nothing.
{
  const h = recorder('fast');
  h.request(clock('facades'), down);
  const r = h.finish({ outcome: 'ok' });
  assert.equal(r.sources.facades.ok, null);
  assert.equal(r.sources.facades.calls, 0);
  assert.deepEqual(foldIncidents([], r), []);
}

// Five-minute lane, awards down for twelve hours from 12:05, clocks read on
// every third tick: one incident, open since 12:05, never a fragment.
{
  const start = now;
  let incidents = [];
  for (let tick = 1; tick <= 12 * 12; tick++) {
    now = start + (tick - 1) * 5 * 60000;
    const h = recorder('fast');
    h.request(rows('qyyg-4tf5'), down);
    h.request('https://data.ny.gov/resource/f8i8-k2gm.json?x', ok);
    if (tick % 3 === 0) for (const k of clockKeys()) h.request(clock(k), { ok: true });
    incidents = foldIncidents(incidents, h.finish({ outcome: 'degraded' }), 40);
  }
  assert.equal(incidents.length, 1, `the outage became ${incidents.length} incidents`);
  assert.equal(incidents[0].at, start, 'the start of the outage was lost');
  assert.equal(incidents[0].resolvedAt, null);
  assert.equal(incidents[0].count, 144);
  now = start;
}

// An incident a clock read opened before the change closes when that clock
// answers; one opened from the rows does not.
{
  const legacy = { at: now - 3600e3, lastAt: now - 3600e3, lane: 'fast', source: 'facades', status: 503, count: 3, resolvedAt: null };
  const current = { ...legacy, source: 'jobs', clockApart: true };
  const h = recorder('fast');
  h.request(clock('facades'), { ok: true });
  h.request(clock('jobs'), { ok: true });
  const out = foldIncidents([legacy, current], h.finish({ outcome: 'ok' }));
  assert.ok(out.find((i) => i.source === 'facades').resolvedAt, 'a legacy clock incident stayed open for good');
  assert.equal(out.find((i) => i.source === 'jobs').resolvedAt, null, 'a clock read closed an incident the rows opened');
}

// A crash is its own incident even while the search provider refuses; a quiet
// upstream stop explained by a city source is not; the next good run closes it.
{
  const h = recorder('hourly');
  h.note('enrichment', { ok: false, status: 429 });
  const crashed = foldIncidents([], h.finish({ outcome: 'failed', error: 'TypeError: x is undefined' }));
  assert.ok(crashed.some((i) => i.source === 'run' && !i.resolvedAt), 'the enrichment 429 hid a crash');

  const u = recorder('hourly');
  u.request(rows('xubg-57si'), down);
  assert.ok(!foldIncidents([], u.finish({ outcome: 'upstream' })).some((i) => i.source === 'run'), 'an explained stop said it twice');

  const q = recorder('hourly');
  q.note('enrichment', { ok: false, status: 429 });
  assert.ok(foldIncidents([], q.finish({ outcome: 'upstream' })).some((i) => i.source === 'run'), 'the enrichment 429 explained a stop');

  const next = recorder('hourly');
  next.request(rows('xubg-57si'), ok);
  assert.ok(foldIncidents(crashed, next.finish({ outcome: 'ok' })).find((i) => i.source === 'run').resolvedAt);
}

// Ageing: an outage open for 31 days keeps its start and count; an incident
// that ended 31 days ago leaves.
{
  const long = { at: now - 31 * DAY, lastAt: now - DAY, lane: 'hourly', source: 'enrichment', status: 429, count: 700, resolvedAt: null, clockApart: true };
  const old = { at: now - 40 * DAY, lastAt: now - 32 * DAY, lane: 'hourly', source: 'acris', status: 503, count: 1, resolvedAt: now - 31 * DAY };
  const h = recorder('hourly');
  h.note('enrichment', { ok: false, status: 429 });
  const out = foldIncidents([long, old], h.finish({ outcome: 'ok' }));
  const e = out.find((i) => i.source === 'enrichment');
  assert.equal(out.length, 1, 'an incident that ended 31 days ago was kept');
  assert.equal(e.at, long.at, 'a long outage was reborn as a new one');
  assert.equal(e.count, 701);
}

console.log('test-health: clocks kept apart, failures stick, crashes and long outages keep their line');
