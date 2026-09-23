// When did the last full sweep start? The one question the three things that
// can start refresh-data have to agree on.
//
// GitHub's own schedule asks for the sweep hourly and starts it every two to
// five hours (median 3.6 h in September), so it is only the backstop now. The
// pinger's loop, which already keeps five-minute time, dispatches the sweep
// once the last one started 55 minutes ago; Vercel's cron (api/cron/refresh.js)
// may do the same when its secrets exist; and a scheduled run that lands within
// 45 minutes of another sweep steps aside. All three read the answer here, from
// GitHub's run history, so none of them needs a clock of its own to go wrong.
//
// "Started" is when the run was created — a run waiting in the data-writes
// queue has been asked for and will sweep. Two kinds of run do not count: a
// cancelled one (a queued run replaced by a newer one never ran), and a
// scheduled one whose collect job was skipped by the gate. Counting those
// would let a run that swept nothing hold the next sweep back for an hour.
const API = 'https://api.github.com';
export const SWEEP_WORKFLOW = 'refresh.yml';

const ms = (v) => Date.parse(v || '') || 0;

// runs: GitHub's workflow_runs, any order. collectSkipped(run) answers for a
// finished scheduled run whether its collect job was skipped; it is asked
// only about a run that would otherwise be the answer.
export async function pickLastSweep(runs, { exclude = null, collectSkipped }) {
  let best = null;
  for (const r of runs || []) {
    if (exclude != null && String(r.id) === String(exclude)) continue;
    if (r.conclusion === 'cancelled') continue;
    // A re-run starts again under its original creation time.
    const at = Math.max(ms(r.created_at), ms(r.run_started_at));
    if (!at || (best && at <= best.at)) continue;
    if (r.event === 'schedule' && r.status === 'completed' && (await collectSkipped(r))) continue;
    best = { at, id: r.id, event: r.event, status: r.status, conclusion: r.conclusion };
  }
  return best;
}

// Null when GitHub has no sweep on record; throws when GitHub cannot be read,
// so each caller decides which way to fail.
export async function lastSweep({ repo, token, exclude = null, fetchImpl = fetch }) {
  const gh = async (path) => {
    const r = await fetchImpl(`${API}/repos/${repo}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`GitHub ${r.status} on ${path.split('?')[0]}`);
    return r.json();
  };
  const { workflow_runs: runs } = await gh(`/actions/workflows/${SWEEP_WORKFLOW}/runs?per_page=10`);
  return pickLastSweep(runs, {
    exclude,
    collectSkipped: async (run) => {
      const { jobs } = await gh(`/actions/runs/${run.id}/jobs?per_page=10`);
      const collect = (jobs || []).find((j) => j.name === 'collect');
      return !collect || collect.conclusion === 'skipped';
    },
  });
}

// Due when no sweep started within `minutes`, or none is on record.
export function sweepDue(last, minutes, now = Date.now()) {
  return !last || now - last.at >= minutes * 60000;
}
