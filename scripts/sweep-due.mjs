// Is a full sweep due? Asked by the pinger's loop before it dispatches
// refresh-data, and by refresh-data's gate before a scheduled run sweeps.
// lib/sweep-clock.mjs says what counts as a sweep.
//
//   node scripts/sweep-due.mjs <minutes>
//
// exit 0  due: no sweep started within <minutes>
// exit 3  not due
// other   GitHub could not be read. The caller picks the safe side: the
//         pinger does not dispatch, the gate lets the scheduled run sweep.
//
// The run this is called from is left out of the history (GITHUB_RUN_ID), so
// the gate does not find itself. In the pinger that id is a pinger run, which
// is not in refresh-data's history anyway.
import { lastSweep, sweepDue } from '../lib/sweep-clock.mjs';

const minutes = Number(process.argv[2]);
if (!(minutes > 0)) {
  console.error('usage: node scripts/sweep-due.mjs <minutes>');
  process.exit(2);
}
const repo = process.env.GITHUB_REPOSITORY || process.env.DATA_REPO || 'maksimperekatov12-byte/rightwindow';
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

try {
  const last = await lastSweep({ repo, token, exclude: process.env.GITHUB_RUN_ID || null });
  const due = sweepDue(last, minutes);
  const age = last ? `${Math.round((Date.now() - last.at) / 60000)} min ago (run ${last.id}, ${last.event}, ${last.status})` : 'never';
  console.log(`sweep-due: last sweep started ${age} — ${due ? 'due' : `not due until ${minutes} min`}`);
  process.exit(due ? 0 : 3);
} catch (e) {
  console.log(`sweep-due: could not read the run history (${e.message})`);
  process.exit(1);
}
