// Daily personalized email digest from prefs/{uid}.json.
// Env: BLOB_READ_WRITE_TOKEN (required), RESEND_API_KEY (skip if missing),
//      DIGEST_FROM (default Resend onboarding sender), SITE (default prod URL).
import { readJson, writeJson, listJson } from '../lib/store.mjs';
import { readFileSync } from 'node:fs';

const SITE = process.env.SITE || 'https://rightwindow.vercel.app';
if (!process.env.RESEND_API_KEY) {
  console.log('send-digest: skipped, RESEND_API_KEY not set');
  process.exit(0);
}
const FROM = process.env.DIGEST_FROM || 'Right Window <onboarding@resend.dev>';
const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));

const FACADE = new Set(['qewi', 'restoration', 'elevator', 'insurance', 'lender', 'equipment', 'propmgmt', 'legal', 'cre']);
const CONTR = new Set(['insurance', 'lender', 'staffing', 'equipment', 'qewi', 'restoration']);
const OPEN = new Set(['insurance', 'lender', 'staffing', 'pos', 'fnb', 'marketing', 'signage']);
const fMatch = {
  elevator: (c) => Boolean(c.elevator),
  propmgmt: (c) => Boolean(c.ownerChange || c.mgmtChange),
  legal: (c) => Boolean(c.nextHearing || c.freshHaz || (c.ecbBalance || 0) > 0),
  equipment: (c) => c.signals.some((s) => ['SWARMP_CARRYOVER', 'UNSAFE_PRIOR'].includes(s.kind)) || Boolean(c.shed),
};

function itemsFor(profile) {
  const out = [];
  if (FACADE.has(profile)) {
    const m = fMatch[profile] || (() => true);
    for (const c of feed.facades.feed) {
      if (!(c.isNew || c.fresh?.length) || !m(c)) continue;
      out.push({ t: titleCase(c.address) + ', ' + c.borough, d: `${c.subCycle} deadline ${c.deadline} · ${c.monthsLeft} mo left`, u: `${SITE}/#b/${c.bin}` });
    }
  }
  if (CONTR.has(profile)) {
    for (const c of feed.contracts) {
      if (!c.isNew) continue;
      out.push({ t: c.vendor, d: `won $${c.amount.toLocaleString('en-US')} from ${c.agency}`, u: `${SITE}/#c/${c.id}` });
    }
  }
  if (OPEN.has(profile)) {
    for (const o of feed.openings) {
      if (!o.isNew) continue;
      out.push({ t: o.name, d: `${o.kind} opening soon · ${o.address}`, u: `${SITE}/#o/${o.id}` });
    }
  }
  return out.slice(0, 6);
}

const titleCase = (x) => (x || '').toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

function html(items, profile) {
  const rows = items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e3e8e6">
        <a href="${i.u}" style="color:#0c3e33;font-weight:700;text-decoration:none;font-size:15px">${i.t}</a>
        <div style="color:#465953;font-size:13px;margin-top:2px">${i.d}</div></td></tr>`,
    )
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="font-size:18px;font-weight:800;color:#0f1e1a">Right Window</div>
    <div style="color:#75867f;font-size:12px;margin-bottom:18px">New windows in NYC for ${profile}</div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <a href="${SITE}" style="display:inline-block;margin-top:18px;background:#0c3e33;color:#fff;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">Open the feed</a>
    <div style="color:#9aa7a2;font-size:11px;margin-top:22px">Signals matched to your trade from NYC public records. Reply STOP to unsubscribe.</div>
  </div>`;
}

const paths = await listJson('prefs/');
let sent = 0, skipped = 0;
for (const p of paths) {
  const pref = await readJson(p);
  const email = pref?.channels?.email;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped++; continue; }
  if (pref.lastDigestAt && Date.now() - pref.lastDigestAt < 20 * 3600 * 1000) { skipped++; continue; }
  const items = itemsFor(pref.profile || 'explore');
  if (!items.length) { skipped++; continue; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: `${items.length} new window${items.length > 1 ? 's' : ''} in NYC — Right Window`,
      html: html(items, pref.profile || 'your trade'),
    }),
  });
  if (res.ok) {
    sent++;
    await writeJson(p, { ...pref, lastDigestAt: Date.now() });
  } else {
    console.log('send failed', email.replace(/^(..).*@/, '$1***@'), res.status, (await res.text()).slice(0, 120));
  }
}
console.log(`send-digest: sent=${sent} skipped=${skipped} of ${paths.length}`);
