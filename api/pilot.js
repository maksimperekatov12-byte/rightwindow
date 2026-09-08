// Starting a pilot, with nobody in the loop.
//
// "Request a pilot" used to be a mailto to a person. A contractor who clicks a
// link from a cold email at seven in the morning will not wait for that reply,
// so this endpoint finishes the job: it stores the territory, sends the
// confirmation with the SAME link back, and the digest starts the next
// morning. A duplicate address is a success — somebody re-reading their own
// email and clicking again must not be told off.
import { canStorePrivate } from '../lib/artifacts.mjs';
import { addSubscriber, unsuppress } from '../lib/leads.mjs';
import { savePilot, logEvent, PILOT_DAYS } from '../lib/pilots.mjs';
import { mailHeaders, unsubUrl } from '../lib/unsub.mjs';

const EMAIL = /^[^\s@<>"'`;,()[\]\\]{1,64}@[^\s@<>"'`;,()[\]\\]{1,190}\.[a-z]{2,24}$/i;
const TRADE = /^[\w-]{1,32}$/;
const SITE = 'https://rightwindow.nyc';

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 8000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(d || '{}'));
      } catch {
        resolve(null);
      }
    });
  });

const clean = (s, max) => String(s || '').replace(/["'<>`\\]/g, '').trim().slice(0, max);

// The link that brought them is the link that goes back: the confirmation
// opens the same list they were looking at when they signed up.
function inviteLink({ trade, zips, reg, ref, company }) {
  const u = new URL(SITE);
  if (trade) u.searchParams.set('trade', trade);
  if (zips.length) u.searchParams.set('zips', zips.join(','));
  if (reg && reg !== 'facades') u.searchParams.set('reg', reg);
  if (company) u.searchParams.set('for', company);
  if (ref) u.searchParams.set('ref', ref);
  return u.toString();
}

async function confirm({ email, company, zips, link, until }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'no RESEND_API_KEY in this environment' };
  const where = zips.length ? `ZIPs ${zips.join(', ')}` : 'your registers';
  const text =
    `Your pilot is on${company ? `, ${company}` : ''}.\n\n` +
    `Every morning you get what the city published overnight for ${where} — and nothing on a quiet day.\n\n` +
    `Your list: ${link}\n\n` +
    `Free until ${until}. Three cards stay reserved to you at a time; nobody else sees them while they are yours.\n\n` +
    `Unsubscribe: ${unsubUrl(email)}\n`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM || 'Right Window <digest@rightwindow.nyc>',
        to: email,
        subject: 'Your Right Window pilot is on',
        ...mailHeaders(email),
        text,
        html:
          '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;color:#101613;line-height:1.6">' +
          `<p>Your pilot is on${company ? `, <b>${company}</b>` : ''}.</p>` +
          `<p>Every morning you get what the city published overnight for <b>${where}</b> — and nothing on a quiet day.</p>` +
          `<p><a href="${link}" style="color:#14594A">Open your list</a></p>` +
          `<p>Free until ${until}. Three cards stay reserved to you at a time; nobody else sees them while they are yours.</p>` +
          `<p style="font-size:12px;color:#5F6F69"><a href="${unsubUrl(email)}" style="color:#5F6F69">Unsubscribe</a></p>` +
          '</div>',
      }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? { sent: true } : { sent: false, reason: `resend ${r.status}` };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ ok: true, canStore: canStorePrivate(), days: PILOT_DAYS });
  if (req.method !== 'POST') return res.status(405).end();

  const body = await readBody(req);
  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ ok: false, error: 'That does not look like an email address.' });

  const company = clean(body?.company, 60) || null;
  const trade = TRADE.test(String(body?.trade || '')) ? String(body.trade) : null;
  const reg = TRADE.test(String(body?.reg || '')) ? String(body.reg) : null;
  const ref = clean(body?.ref, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '') || null;
  const zips = (String(body?.zips || '').match(/\d{5}/g) || []).slice(0, 12);

  if (!canStorePrivate())
    return res.status(503).json({ ok: false, error: 'We cannot store sign-ups yet on our side.' });

  try {
    const { record, already } = await savePilot({ email, company, trade, zips, ref, reg });
    // The pilot IS a subscriber; the digest reads both stores.
    await addSubscriber({ email, profile: trade, boro: null });
    await unsuppress(email).catch(() => {});
    const until = record.until.slice(0, 10);
    const link = inviteLink({ trade, zips, reg, ref, company });
    const mail = await confirm({ email, company, zips, link, until });
    logEvent({ kind: 'pilot_started', ref, trade, zips, reg, sid: clean(body?.sid, 40) || null }).catch(() => {});
    return res.status(200).json({ ok: true, already, until, link, confirmation: mail.sent, note: mail.reason || undefined });
  } catch (e) {
    return res.status(503).json({ ok: false, error: 'That did not save on our side.' });
  }
}
