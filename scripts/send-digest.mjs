// Daily personalized digest: email and/or Slack, built from prefs.
import { readDoc, updateDoc, PREFS } from '../lib/store.mjs';
import { matchFor } from '../lib/signals.mjs';
import { digestBlocks, postToSlack } from '../lib/slack.mjs';
import { readFileSync } from 'node:fs';

const SITE = process.env.SITE || 'https://rightwindow.nyc';
const FROM = process.env.DIGEST_FROM || 'Right Window <onboarding@resend.dev>';
const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));

function html(items, profile) {
  const rows = items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e3e8e6">
        <a href="${SITE}/#${i.kind}/${i.id}" style="color:#0c3e33;font-weight:700;text-decoration:none;font-size:15px">${i.title}</a>
        <div style="color:#465953;font-size:13px;margin-top:2px">${i.urgent || i.why}</div></td></tr>`,
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

if (process.env.DIGEST_TEST) {
  if (!process.env.RESEND_API_KEY) { console.log('test send: no RESEND_API_KEY'); process.exit(1); }
  const items = matchFor(feed, 'qewi', { onlyNew: false }).slice(0, 6);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [process.env.DIGEST_TEST], subject: 'Right Window — test digest', html: html(items, 'test') }),
  });
  console.log('test send:', res.status, res.ok ? 'ok' : (await res.text()).slice(0, 200));
  process.exit(res.ok ? 0 : 1);
}

// Unsubscribed means unsubscribed everywhere: the digest consults the same
// suppression set the one-click endpoint writes.
const { unsubUrl, mailHeaders } = await import('../lib/unsub.mjs');
const { suppressedSet } = await import('../lib/leads.mjs');
const suppressed = await suppressedSet();

const prefsDoc = await readDoc(PREFS);
const everyone = Object.values(prefsDoc);
let mail = 0, slack = 0, skipped = 0;
const touched = new Map();
for (const pref of everyone) {
  if (!pref?.profile) { skipped++; continue; }
  if (pref.lastDigestAt && Date.now() - pref.lastDigestAt < 20 * 3600 * 1000) { skipped++; continue; }
  const portfolio = pref.portfolio?.length ? pref.portfolio : null;
  const items = matchFor(feed, pref.profile, { onlyNew: true, portfolio }).slice(0, 6);
  if (!items.length) { skipped++; continue; }

  if (pref.channels?.slack) {
    const ok = await postToSlack(
      pref.channels.slack,
      digestBlocks(items, pref.profile, `${items.length} new window${items.length > 1 ? 's' : ''} today`),
      `${items.length} new windows today`,
    );
    if (ok) slack++;
  }
  const email = pref.channels?.email;
  if (
    email &&
    process.env.RESEND_API_KEY &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) &&
    !suppressed.has(email.toLowerCase())
  ) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: `${items.length} new window${items.length > 1 ? 's' : ''} in NYC — Right Window`,
        ...mailHeaders(email),
        html:
          html(items, pref.profile) +
          `<p style="font-size:12px;color:#5F6F69;font-family:-apple-system,sans-serif"><a href="${unsubUrl(email)}" style="color:#5F6F69">Unsubscribe</a></p>`,
      }),
    });
    if (res.ok) mail++;
  }
  if (pref.channels?.slack || email) {
    pref.lastDigestAt = Date.now();
    touched.set(pref.uid, { lastDigestAt: pref.lastDigestAt });
  }
}
if (touched.size)
  await updateDoc(PREFS, (doc) => {
    for (const [uid, fields] of touched) if (doc[uid]) Object.assign(doc[uid], fields);
    return doc;
  });

// Pilots started from the site are their own list: a trade and a set of ZIPs,
// with no device behind them. They get exactly their territory — that is what
// was promised in the confirmation, and it is the whole product for them.
const { allPilots } = await import('../lib/pilots.mjs');
let pilotMail = 0;
let pilotSkipped = 0;
for (const p of await allPilots()) {
  const email = String(p.email || '').toLowerCase();
  if (!email || suppressed.has(email)) { pilotSkipped++; continue; }
  if (p.until && new Date(p.until) < new Date()) { pilotSkipped++; continue; }
  if (!process.env.RESEND_API_KEY) { pilotSkipped++; continue; }

  const zips = new Set(p.zips || []);
  const inTerritory = (c) => !zips.size || zips.has(String(c.zip || ''));
  const items = matchFor(feed, p.trade || 'qewi', { onlyNew: true }).filter(inTerritory).slice(0, 6);
  if (!items.length) { pilotSkipped++; continue; }

  // The link back is the link they arrived on — their trade, their ZIPs.
  const link = new URL(SITE);
  if (p.trade) link.searchParams.set('trade', p.trade);
  if (p.zips?.length) link.searchParams.set('zips', p.zips.join(','));
  if (p.reg && p.reg !== 'facades') link.searchParams.set('reg', p.reg);
  if (p.ref) link.searchParams.set('ref', p.ref);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: `${items.length} new window${items.length > 1 ? 's' : ''}${p.zips?.length ? ` in ${p.zips.join(', ')}` : ''} — Right Window`,
      ...mailHeaders(email),
      html:
        html(items, p.trade || 'your trade') +
        `<p style="font-family:-apple-system,sans-serif;font-size:13px"><a href="${link}" style="color:#14594A">Open your list</a></p>` +
        `<p style="font-size:12px;color:#5F6F69;font-family:-apple-system,sans-serif"><a href="${unsubUrl(email)}" style="color:#5F6F69">Unsubscribe</a></p>`,
    }),
  });
  if (res.ok) pilotMail++;
}

console.log(`send-digest: email=${mail} slack=${slack} skipped=${skipped} of ${everyone.length} · pilots sent=${pilotMail} skipped=${pilotSkipped}`);
