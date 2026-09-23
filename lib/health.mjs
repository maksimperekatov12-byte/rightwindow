// What each collector did with each source, so /status can say which record
// fell off and when — instead of an email from GitHub that says "failed".
//
// A run records one line per source: how many calls, how many of them had to
// retry, and whether every read of its rows succeeded. Incidents are derived
// from that, not declared by hand: a source with a failed read opens one, the
// next run that reads it cleanly closes it, and a run that crashes — or stops
// for a reason no source explains — opens one of its own. Both lanes fold into
// the same shape, so the page tells one story.
//
// The publisher's clock (/api/views/<id>.json, lib/sources.mjs) is read from a
// different endpoint, after the data, and is kept on its own line under the
// record. It used to share the record's state, and since it is read last it
// decided it: a City Record outage whose clock still answered closed its own
// incident, and in the five-minute lane every clock tick closed and reopened
// the same outage until the incident list was full of ten-minute fragments.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { sourceKeyOf, readKindOf } from './sources.mjs';

const DAY = 24 * 3600 * 1000;
const INCIDENT_DAYS = 30;
const MAX_INCIDENTS = 60;
const MAX_RUNS = 96;

// Anything that is not a Socrata dataset we know is attributed by host: the
// search provider, the data branch, the store.
function otherKey(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  if (/serpapi|serper|google/.test(host)) return 'enrichment';
  if (/githubusercontent|github\.com/.test(host)) return 'dataBranch';
  if (/vercel-storage|blob/.test(host)) return 'store';
  return host || 'other';
}

// The recorder of the running process, for modules that are not handed one —
// the enrichment provider reports its refusals through it.
let current = null;
export const currentRecorder = () => current;

export function recorder(lane) {
  const startedAt = Date.now();
  const sources = {};
  const touch = (key) => (sources[key] ||= { ok: null, calls: 0, retries: 0, failures: 0, rows: 0, ms: 0 });
  const rec = {
    lane,
    startedAt,
    sources,
    // One finished request — after its own retries — attributed to a record.
    request(url, outcome) {
      const key = sourceKeyOf(url) || otherKey(url);
      if (readKindOf(url) === 'clock') return rec.clock(key, outcome);
      rec.note(key, outcome);
      // Within one run a failed read sticks: a later read of the same record
      // does not bring back the rows the failed one was for, and the stage
      // that caught it carried the previous hour's instead.
      if (sources[key].failures) sources[key].ok = false;
    },
    // A read of the publisher's clock. It neither clears a failed data read
    // nor fails a record whose rows arrived; /status shows it beside them.
    // Each run reads a clock once, so the latest outcome is the state.
    clock(key, { ok, status = null, ms = 0, error = null }) {
      const c = (touch(key).clock ||= { ok: null, calls: 0, failures: 0, ms: 0 });
      c.calls++;
      c.ms += ms;
      c.ok = Boolean(ok);
      c.at = Date.now();
      if (ok) {
        c.lastOkAt = c.at;
      } else {
        c.failures++;
        c.status = status;
        c.error = String(error || '').slice(0, 200);
        c.failedAt = c.at;
      }
    },
    // Callers that are not a URL — the enrichment provider — keep the latest
    // outcome as the state: its breaker absorbs a refusal and carries on.
    note(key, { ok, status = null, ms = 0, rows = 0, retries = 0, error = null }) {
      const s = touch(key);
      s.calls++;
      s.ms += ms;
      s.retries += retries;
      // The latest outcome is the state; the counters keep the history of the run.
      s.ok = Boolean(ok);
      if (ok) {
        s.rows += rows;
        s.lastOkAt = Date.now();
      } else {
        s.failures++;
        s.status = status;
        s.error = String(error || '').slice(0, 200);
        s.failedAt = Date.now();
      }
    },
    finish({ outcome, error = null, counts = null, feedAt = null }) {
      current = null;
      const finishedAt = Date.now();
      return {
        lane,
        startedAt: rec.startedAt,
        finishedAt,
        ms: finishedAt - rec.startedAt,
        outcome,
        error: error ? String(error).slice(0, 300) : null,
        counts,
        feedAt,
        sources,
      };
    },
  };
  current = rec;
  return rec;
}

// One incident per (lane, source) while it keeps failing; closed by the next
// clean read. A crash always gets its own line; a quiet 'upstream' stop gets
// one only when no failing source explains it — otherwise it would say the
// same thing twice.
export function foldIncidents(prev, report, keep = MAX_INCIDENTS) {
  const at = report.finishedAt;
  // Aged by the end of the incident, not its start: an outage still open after
  // five weeks is one outage that began five weeks ago, not a new one that
  // began today with a count of one.
  const out = (prev || [])
    .filter((i) => at - (i.resolvedAt || i.lastAt || i.at) < INCIDENT_DAYS * DAY)
    .map((i) => ({ ...i }));
  const open = (source) => out.find((i) => !i.resolvedAt && i.source === source && i.lane === report.lane);
  let explained = false;
  for (const [key, s] of Object.entries(report.sources || {})) {
    const cur = open(key);
    if (s.ok === false) {
      // The search provider's breaker catches its own refusals and never ends
      // a run, and its 429 stands for days: it explains no stop.
      if (key !== 'enrichment') explained = true;
      if (cur) {
        cur.lastAt = s.failedAt || at;
        cur.status = s.status ?? cur.status;
        cur.error = s.error || cur.error;
        cur.count = (cur.count || 1) + 1;
      } else {
        // clockApart: opened from the record's own state, which a clock read
        // can no longer set — see the legacy case below.
        out.push({ at: s.failedAt || at, lastAt: s.failedAt || at, lane: report.lane, source: key, status: s.status ?? null, error: s.error || null, count: 1, resolvedAt: null, clockApart: true });
      }
    } else if (s.ok === true && cur) {
      cur.resolvedAt = s.lastOkAt || at;
    } else if (s.ok === null && s.clock?.ok && cur && !cur.clockApart) {
      // An incident from before clocks were kept apart, in a lane that reads
      // only this record's clock (the five-minute lane reads two records' rows
      // and every clock): a failed clock read opened it, no read of the rows
      // will ever come to close it, and without this it would stand as "down"
      // for thirty days. A clock that answers closes what a clock opened.
      cur.resolvedAt = s.clock.lastOkAt || at;
    }
  }
  const runFailed = report.outcome === 'failed' || report.outcome === 'upstream';
  const cur = open('run');
  if (report.outcome === 'failed' || (runFailed && !explained)) {
    if (cur) {
      cur.lastAt = at;
      cur.error = report.error || cur.error;
      cur.count = (cur.count || 1) + 1;
    } else {
      out.push({ at, lastAt: at, lane: report.lane, source: 'run', status: null, error: report.error || null, count: 1, resolvedAt: null });
    }
  } else if (!runFailed && cur) {
    cur.resolvedAt = at;
  }
  return out.sort((a, b) => b.at - a.at).slice(0, keep);
}

// The hourly lane's history lives in the repo next to the feed, committed by
// the same step whether the run succeeded or not. The fast lane keeps its own
// inside the intraday document (scripts/collect-fast.mjs).
export const HEALTH_PATH = new URL('../data/health.json', import.meta.url);

export function readHealth(path = HEALTH_PATH) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { runs: [], incidents: [] };
  }
}

export function writeHealth(report, path = HEALTH_PATH) {
  const prev = readHealth(path);
  const failed = Object.entries(report.sources || {})
    .filter(([, s]) => s.ok === false)
    .map(([k]) => k);
  const run = { at: report.startedAt, ms: report.ms, outcome: report.outcome, failed, feedAt: report.feedAt, counts: report.counts, error: report.error };
  const doc = {
    updatedAt: report.finishedAt,
    last: report,
    runs: [...(prev.runs || []), run].slice(-MAX_RUNS),
    incidents: foldIncidents(prev.incidents, report),
  };
  try {
    mkdirSync(new URL('.', path), { recursive: true });
  } catch {}
  writeFileSync(path, JSON.stringify(doc, null, 1));
  return doc;
}
