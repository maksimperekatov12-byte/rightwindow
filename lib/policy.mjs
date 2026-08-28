// The license gate. The /data page and the README both promise that "every
// source is checked against data/source-policy.json before a request is made",
// so the check has to live where every collector can reach it — not only in the
// hourly one. A host without an ALLOWED verdict throws rather than guesses.
import { readFileSync } from 'node:fs';

const POLICY = JSON.parse(readFileSync(new URL('../data/source-policy.json', import.meta.url), 'utf8'));

export function assertCollectable(host) {
  const p = POLICY.find((x) => x.host === host);
  if (!p) throw new Error(`Source ${host} is not in data/source-policy.json — collection refused.`);
  if (p.verdict !== 'ALLOWED') throw new Error(`Source ${host} verdict is ${p.verdict} — collection refused. ${p.license}`);
  return p;
}

export { POLICY };
