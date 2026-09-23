// What counts as "the last sweep" for the hourly clock (lib/sweep-clock.mjs).
//
// Why it exists: three things can start refresh-data — the pinger's loop, the
// Vercel cron and GitHub's own schedule — and they only stay one sweep an hour
// between them if they agree on this. A skipped or cancelled run that counted
// would hold the next sweep back an hour; a real one that did not count would
// let two sweeps start back to back. Offline: GitHub is a stub here.
import assert from 'node:assert/strict';
import { pickLastSweep, lastSweep, sweepDue, SWEEP_WORKFLOW } from '../lib/sweep-clock.mjs';

const MIN = 60000;
const now = Date.UTC(2026, 8, 23, 12, 0);
const iso = (minAgo) => new Date(now - minAgo * MIN).toISOString();
const run = (id, minAgo, event, status = 'completed', conclusion = status === 'completed' ? 'success' : null, startedMinAgo = minAgo) => ({
  id,
  event,
  status,
  conclusion,
  created_at: iso(minAgo),
  run_started_at: iso(startedMinAgo),
});

// Answers for the jobs lookup, and a log of what was asked.
const asked = [];
const skippedIds = new Set();
const collectSkipped = async (r) => {
  asked.push(r.id);
  return skippedIds.has(r.id);
};
const pick = async (runs, opts = {}) => {
  asked.length = 0;
  return pickLastSweep(runs, { collectSkipped, ...opts });
};

// A dispatched run is a sweep, running or not, and needs no lookup.
{
  const last = await pick([run(3, 10, 'workflow_dispatch', 'in_progress'), run(2, 70, 'schedule')]);
  assert.equal(last.id, 3);
  assert.deepEqual(asked, []);
}

// A scheduled run the gate skipped is not a sweep; the one before it is.
{
  skippedIds.add(5);
  const last = await pick([run(5, 20, 'schedule'), run(4, 58, 'workflow_dispatch')]);
  assert.equal(last.id, 4, 'a stepped-aside run held the next sweep back');
  assert.deepEqual(asked, [5]);
}

// A scheduled run that swept counts; so does one whose gate is still deciding.
assert.equal((await pick([run(6, 20, 'schedule'), run(4, 58, 'workflow_dispatch')])).id, 6);
assert.equal((await pick([run(7, 1, 'schedule', 'in_progress'), run(4, 58, 'workflow_dispatch')])).id, 7);
assert.deepEqual(asked, [], 'an unfinished scheduled run was looked up');

// A cancelled run swept nothing (a queued run replaced by a newer one never
// started); the run this is asked from never counts itself.
assert.equal((await pick([run(9, 5, 'workflow_dispatch', 'completed', 'cancelled'), run(4, 58, 'workflow_dispatch')])).id, 4);
assert.equal((await pick([run(10, 0, 'schedule', 'in_progress'), run(4, 58, 'workflow_dispatch')], { exclude: 10 })).id, 4);

// A re-run of an older run is sweeping now, under its old creation time.
assert.equal((await pick([run(12, 30, 'workflow_dispatch'), run(11, 300, 'schedule', 'in_progress', null, 2)])).id, 11);

// Nothing on record is due; the boundary is inclusive.
assert.equal(await pick([]), null);
assert.equal(sweepDue(null, 55, now), true);
assert.equal(sweepDue({ at: now - 54 * MIN }, 55, now), false);
assert.equal(sweepDue({ at: now - 55 * MIN }, 55, now), true);

// Through the stubbed API: the right workflow, the jobs of a finished
// scheduled run, and an error that reaches the caller instead of reading as
// "no sweep on record" — which would mean "due" and a dispatch.
{
  const urls = [];
  const fake = (routes) => async (url) => {
    urls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: hit[1].status === undefined, status: hit[1].status || 200, json: async () => hit[1] };
  };
  const last = await lastSweep({
    repo: 'o/r',
    token: 't',
    fetchImpl: fake({
      [`/actions/workflows/${SWEEP_WORKFLOW}/runs`]: { workflow_runs: [run(21, 10, 'schedule'), run(20, 57, 'workflow_dispatch')] },
      '/actions/runs/21/jobs': { jobs: [{ name: 'gate', conclusion: 'success' }, { name: 'collect', conclusion: 'skipped' }] },
    }),
  });
  assert.equal(last.id, 20);
  assert.ok(urls[0].includes('/repos/o/r/actions/workflows/refresh.yml/runs'));
  await assert.rejects(lastSweep({ repo: 'o/r', token: 't', fetchImpl: fake({ '/runs': { status: 503 } }) }), /GitHub 503/);
}

console.log('test-cadence: skipped and cancelled runs do not count, running and re-run ones do');
