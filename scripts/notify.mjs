// Instant alerts: runs in the 10-minute lane. Sends only signals whose clock is
// measured in days (fresh violations, hearings within a month, ownership flips)
// and never repeats one — per user, per signal, forever.
import { readDoc, updateDoc, PREFS } from '../lib/store.mjs';
import { matchFor, notDismissed } from '../lib/signals.mjs';
import { TRADE_LABELS } from '../lib/trade-filters.mjs';
import { signalBlocks, postToSlack } from '../lib/slack.mjs';
import { readFileSync } from 'node:fs';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('notify: skipped, no blob token');
  process.exit(0);
}
const SITE = process.env.SITE || 'https://rightwindow.nyc';
const { unsubUrl, mailHeaders } = await import('../lib/unsub.mjs');
const { suppressedSet } = await import('../lib/leads.mjs');
// Unsubscribed means unsubscribed here too. Read when the first email is about
// to go, not on every run: it is a list() of the store, an advanced operation
// against a 2,000-a-month allowance, and this runs every half hour — about
// 1,400 a month on its own — while most runs send nothing.
let suppressed = null;
const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
const MAX_PER_RUN = 3;

const COOLDOWN_MS = 45 * 60 * 1000; // never more than one interruption per 45 min
// All preferences live in one document: one read for every user, one write at
// the end, instead of a list() plus a get() and a put() per user.
const prefsDoc = await readDoc(PREFS);
let slackSent = 0, mailSent = 0, users = 0, seeded = 0, cooled = 0;
const touched = new Map();
// One alert email per address per run, however many uids name it: anyone can
// point a fresh uid at any address, and each would otherwise mail it again.
const mailed = new Set();

for (const pref of Object.values(prefsDoc)) {
  // Interruptions are for people who told us their trade. The daily digest
  // covers a visitor who is only exploring; an instant alert on every register
  // in the city is not something they asked for.
  if (!pref?.profile || pref.profile === 'explore') continue;
  const slack = pref.channels?.slack;
  const email = pref.channels?.email;
  const instant = pref.instant !== false; // opt-out, on by default
  if ((!slack && !email) || !instant) continue;
  users++;

  const sent = new Set(pref.sentKeys || []);
  const portfolio = pref.portfolio?.length ? pref.portfolio : null;
  // A dismissed card is never a candidate, so it is never seeded into sentKeys
  // either: if the user restores it on the site, it can still alert.
  const candidates = matchFor(feed, pref.profile, { onlyNew: true, portfolio })
    .filter(notDismissed(pref))
    .filter((i) => i.urgent || (portfolio && i.kind === 'b'))
    .filter((i) => !sent.has(`${i.kind}:${i.id}`));

  // First run for this user: absorb the existing backlog silently. Instant alerts
  // are for things that happen *after* you connect, not a blast of history.
  if (!pref.instantSeeded) {
    for (const i of candidates) sent.add(`${i.kind}:${i.id}`);
    pref.instantSeeded = true;
    pref.sentKeys = [...sent].slice(-400);
    touched.set(pref.uid, { instantSeeded: true, sentKeys: pref.sentKeys });
    seeded++;
    continue;
  }
  if (pref.lastInstantAt && Date.now() - pref.lastInstantAt < COOLDOWN_MS) { cooled++; continue; }

  const hits = candidates.slice(0, MAX_PER_RUN);
  if (!hits.length) continue;

  for (const it of hits) {
    if (slack) {
      const ok = await postToSlack(slack, signalBlocks(it, Object.hasOwn(TRADE_LABELS, pref.profile) ? TRADE_LABELS[pref.profile] : 'your list'), `${it.title} — ${it.urgent || it.why}`);
      if (ok) slackSent++;
    }
    sent.add(`${it.kind}:${it.id}`);
  }

  const addr = String(email || '').toLowerCase();
  if (
    !slack &&
    email &&
    process.env.RESEND_API_KEY &&
    !mailed.has(addr) &&
    !(suppressed ||= await suppressedSet()).has(addr)
  ) {
    mailed.add(addr);
    const rows = hits
      .map(
        (i) =>
          `<tr><td style="padding:10px 0;border-bottom:1px solid #e3e8e6"><a href="${SITE}/#${i.kind}/${i.id}" style="color:#0c3e33;font-weight:700;text-decoration:none">${i.title}</a><div style="color:#465953;font-size:13px">${i.urgent || i.why}</div></td></tr>`,
      )
      .join('');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM || 'Right Window <onboarding@resend.dev>',
        to: [email],
        subject: `Time-sensitive: ${hits[0].title}`,
        ...mailHeaders(email),
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px"><div style="font-size:17px;font-weight:800">Right Window · time-sensitive</div><table style="width:100%;border-collapse:collapse;margin-top:14px">${rows}</table><a href="${SITE}" style="display:inline-block;margin-top:16px;background:#0c3e33;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700">Open the feed</a><p style="font-size:12px;color:#5F6F69"><a href="${unsubUrl(email)}" style="color:#5F6F69">Unsubscribe</a></p></div>`,
      }),
    });
    if (r.ok) mailSent++;
  }

  pref.sentKeys = [...sent].slice(-400);
  pref.lastInstantAt = Date.now();
  touched.set(pref.uid, { sentKeys: pref.sentKeys, lastInstantAt: pref.lastInstantAt });
}
if (touched.size)
  await updateDoc(PREFS, (doc) => {
    for (const [uid, fields] of touched) if (doc[uid]) Object.assign(doc[uid], fields);
    return doc;
  });
console.log(
  `notify: users=${users} slack=${slackSent} email=${mailSent} seeded=${seeded} cooldown=${cooled}` +
    (touched.size ? '' : ' (no write)'),
);
