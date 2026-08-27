// The call list, built from our own output: every facade contractor and engineer
// already visible in DOB data for the boroughs we cover. Finding them this way is
// itself the demo — "this list came out of the product I want to show you".
import { readFileSync, writeFileSync } from 'node:fs';

const TODAY = new Date();
const BASE = 'https://data.cityofnewyork.us/resource';
const get = async (u) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};
const FACADE_RE = /FACADE|FISP|LOCAL LAW 11|PARAPET|EXTERIOR WALL|POINTING|LINTEL/i;
const since = new Date(TODAY - 540 * 86400000).toISOString().slice(0, 10);
const boros = process.argv[2] || 'Queens,Brooklyn';
const wanted = new Set(boros.split(',').map((b) => b.trim().toLowerCase()));

const firms = new Map();
const add = (name, boro, kind, extra = {}) => {
  if (!name || name.length < 3) return;
  const key = name.trim().toUpperCase();
  const f = firms.get(key) || { name: name.trim(), jobs: 0, sheds: 0, filings: 0, boroughs: new Set(), values: [] };
  f[kind] += 1;
  f.jobs += 1;
  if (boro) f.boroughs.add(boro);
  if (extra.cost > 50000) f.values.push(extra.cost);
  firms.set(key, f);
};

console.log(`Scanning facade filings since ${since}...`);
for (let off = 0; ; off += 5000) {
  const qs = new URLSearchParams({
    $where: `job_type='Alteration' and filing_date>='${since}'`,
    $select: 'bin,borough,job_description,applicant_business_name,initial_cost,owner_s_business_name',
    $limit: '5000',
    $offset: String(off),
  });
  const rows = await get(`${BASE}/w9ak-ipjd.json?${qs}`);
  for (const r of rows) {
    if (!FACADE_RE.test(r.job_description || '')) continue;
    if (r.borough && !wanted.has(String(r.borough).toLowerCase())) continue;
    add(r.applicant_business_name, r.borough, 'filings', { cost: Number(r.initial_cost || 0) });
  }
  if (rows.length < 5000) break;
}

console.log('Scanning active shed permits...');
for (let off = 0; ; off += 5000) {
  const qs = new URLSearchParams({
    $where: `work_type in('Sidewalk Shed','Suspended Scaffold','Supported Scaffold') and permit_status='Permit Issued' and issued_date>='${since}'`,
    $select: 'bin,borough,applicant_business_name,work_type',
    $limit: '5000',
    $offset: String(off),
  });
  const rows = await get(`${BASE}/rbx6-tga4.json?${qs}`);
  for (const r of rows) {
    if (r.borough && !wanted.has(String(r.borough).toLowerCase())) continue;
    add(r.applicant_business_name, r.borough, 'sheds');
  }
  if (rows.length < 5000) break;
}

const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const list = [...firms.values()]
  .filter((f) => f.jobs >= 2)
  .map((f) => ({
    name: f.name,
    jobs: f.jobs,
    filings: f.filings,
    sheds: f.sheds,
    boroughs: [...f.boroughs].join(' / '),
    medianCost: med(f.values),
  }))
  .sort((a, b) => b.filings - a.filings || b.jobs - a.jobs)
  .slice(0, 60);

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = [
  ['Firm', 'Facade filings (18mo)', 'Shed permits', 'Total jobs', 'Boroughs', 'Median declared cost', 'Search'],
  ...list.map((f) => [
    f.name, f.filings, f.sheds, f.jobs, f.boroughs,
    f.medianCost ? `$${f.medianCost.toLocaleString('en-US')}` : '',
    `https://www.google.com/search?q=${encodeURIComponent(f.name + ' NYC facade contractor phone')}`,
  ]),
]
  .map((r) => r.map(esc).join(','))
  .join('\r\n');
writeFileSync(new URL('../data/contractors.csv', import.meta.url), '﻿' + csv);
console.log(`Wrote data/contractors.csv — ${list.length} firms in ${boros}`);
console.log('Top 8:', list.slice(0, 8).map((f) => `${f.name} (${f.filings}f/${f.sheds}s)`).join(' · '));
