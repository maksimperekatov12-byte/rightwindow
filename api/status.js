// Everything /status needs in one response: the five-minute document (pulse,
// clocks, the fast lane's own health), the hourly lane's run report from the
// repo, and the workflow runs GitHub knows about — the last of which is what
// still tells the truth when a collector dies before it can write a report.
import { fetchLive } from '../lib/live-source.mjs';
import { SOURCES } from '../lib/sources.mjs';

const REPO = () => process.env.DATA_REPO || 'maksimperekatov12-byte/rightwindow';
const WORKFLOWS = new Set(['refresh-data', 'pinger', 'daily-digest', 'fast-refresh']);

async function json(url, headers = {}) {
  try {
    const r = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(7000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // The report is committed to main by the hourly workflow whether the run
  // finished or died. raw.githubusercontent caches for about five minutes,
  // which is the staleness the page declares.
  const health = json(`https://raw.githubusercontent.com/${REPO()}/main/data/health.json`);
  // Unauthenticated the runs API allows 60 reads an hour per address; the edge
  // cache below keeps this well under. A token raises the ceiling if one is set.
  const token = process.env.GITHUB_STATUS_TOKEN;
  const runs = json(`https://api.github.com/repos/${REPO()}/actions/runs?per_page=40`, {
    accept: 'application/vnd.github+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  const [live, hourly, gh] = await Promise.all([fetchLive(), health, runs]);

  const workflows = gh?.workflow_runs
    ? gh.workflow_runs
        .filter((r) => WORKFLOWS.has(r.name))
        .map((r) => ({
          id: r.id,
          name: r.name,
          event: r.event,
          status: r.status,
          conclusion: r.conclusion,
          startedAt: r.run_started_at,
          updatedAt: r.updated_at,
          url: r.html_url,
        }))
    : null;

  // Nothing here is personal; the whole document is public by design, like
  // the data branch it is read from.
  res.setHeader('Cache-Control', live ? 's-maxage=60, stale-while-revalidate=300' : 'no-store');
  res.json({
    at: Date.now(),
    repo: REPO(),
    sources: SOURCES,
    live: live
      ? {
          checkedAt: live.checkedAt,
          changedAt: live.changedAt,
          pulse: live.pulse || [],
          changeLog: live.changeLog || [],
          sourcesAt: live.sourcesAt || null,
          cityAt: live.cityAt || null,
          cityBy: live.cityBy || null,
          whatsNew: live.whatsNew || null,
          health: live.health || null,
        }
      : null,
    hourly: hourly || null,
    workflows,
  });
}
