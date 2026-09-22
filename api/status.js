// Everything /status needs in one response: the five-minute document (pulse,
// clocks, the fast lane's own health), the hourly lane's run report from the
// repo, and the workflow runs GitHub knows about — the last of which is what
// still tells the truth when a collector dies before it can write a report.
import { fetchLive } from '../lib/live-source.mjs';
import { SOURCES } from '../lib/sources.mjs';
import { isSignedIn } from '../lib/status-auth.mjs';

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

// The response is per-session now, so the edge must not cache it — and the
// runs API, unauthenticated, allows 60 reads an hour per address. A warm
// instance remembers the last answer for a minute instead; a token raises the
// ceiling if one is set.
let ghCache = { at: 0, value: null };
async function githubRuns() {
  if (Date.now() - ghCache.at < 60000) return ghCache.value;
  const token = process.env.GITHUB_STATUS_TOKEN;
  const value = await json(`https://api.github.com/repos/${REPO()}/actions/runs?per_page=40`, {
    accept: 'application/vnd.github+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  if (value) ghCache = { at: Date.now(), value };
  return value || ghCache.value;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  // The operator's page, and only theirs — lib/status-auth.mjs.
  if (!isSignedIn(req)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  // The report is committed to main by the hourly workflow whether the run
  // finished or died. raw.githubusercontent caches for about five minutes,
  // which is the staleness the page declares.
  const health = json(`https://raw.githubusercontent.com/${REPO()}/main/data/health.json`);
  const [live, hourly, gh] = await Promise.all([fetchLive(), health, githubRuns()]);

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
