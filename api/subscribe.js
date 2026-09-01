// The daily digest sign-up. The only lead capture on the site, and the person
// using it is the person who has just read the pitch.
//
// It used to POST into /api/prefs, which writes to Vercel Blob — suspended since
// 2026-08-28 for exceeding its operation allowance — so it returned 500 and the
// page apologised. Subscribers now go through the storage adapter instead.
//
// One thing this endpoint will NOT do: store an address anywhere world-readable.
// lib/artifacts.mjs marks the subscriber list private, and the github-branch
// driver refuses to write a private artefact rather than force-pushing people's
// email addresses to a public repository. Under that driver this endpoint
// reports honestly that it cannot store, and the page keeps the route that does
// work. It starts storing the moment STORAGE_DRIVER=r2 is configured, with no
// further change here.
import { readArtifact, publishArtifact, canStorePrivate, VisibilityError } from '../lib/artifacts.mjs';
import { mailHeaders, unsubUrl } from '../lib/unsub.mjs';

const EMAIL = /^[^\s@<>"'`;,()[\]\\]{1,64}@[^\s@<>"'`;,()[\]\\]{1,190}\.[a-z]{2,24}$/i;
const PROFILE = /^[\w-]{1,32}$/;
const BORO = new Set(['all', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']);

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

// A confirmation is worth sending because it is the only proof the person has
// that anything happened. It is not worth failing the request over: the address
// is already stored by the time this runs.
async function confirm(email, profile) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'no RESEND_API_KEY in this environment' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM || 'Right Window <onboarding@resend.dev>',
        to: email,
        subject: 'You are on the Right Window digest',
        ...mailHeaders(email),
        text:
          'You will get one email each morning with what the city published overnight' +
          (profile ? ` for ${profile}` : '') +
          ', and nothing on a quiet day.\n\n' +
          'Every card links back to the city record it came from.\n\n' +
          'https://rightwindow.nyc/\n\n' +
          `Unsubscribe: ${unsubUrl(email)}\n`,
        html:
          '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;color:#101613;line-height:1.6">' +
          '<p>You will get one email each morning with what the city published overnight' +
          (profile ? ` for <b>${profile}</b>` : '') +
          ', and nothing on a quiet day.</p>' +
          '<p>Every card links back to the city record it came from.</p>' +
          '<p><a href="https://rightwindow.nyc/" style="color:#14594A">rightwindow.nyc</a></p>' +
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
  // A status probe that leaks nothing but booleans: which storage the function
  // can actually see. Diagnosing "cannot store" blind cost more than this line.
  if (req.method === 'GET')
    return res.json({
      canStore: canStorePrivate(),
      blobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      resend: Boolean(process.env.RESEND_API_KEY),
      driver: process.env.STORAGE_DRIVER || 'github-branch',
    });
  if (req.method !== 'POST') return res.status(405).end();

  const body = await readBody(req);
  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ ok: false, error: 'That does not look like an email address.' });
  const profile = PROFILE.test(String(body?.profile || '')) ? String(body.profile) : null;
  const boro = BORO.has(body?.boro) ? body.boro : null;

  if (!canStorePrivate())
    return res.status(503).json({
      ok: false,
      canStore: false,
      // Said plainly, because the page has to tell the truth about whose fault
      // it is and offer the route that still works.
      error: 'We cannot store sign-ups yet on our side.',
    });

  try {
    const doc = (await readArtifact('subscribers')) || { subscribers: {} };
    const list = doc.subscribers || {};
    // A second sign-up with the same address is a success, not an error: the
    // person wants the digest and now they are on it.
    const already = Boolean(list[email]);
    try {
      const sup = (await readArtifact('suppressed')) || { emails: {} };
      if (sup.emails?.[email]) {
        delete sup.emails[email];
        await publishArtifact('suppressed', sup);
      }
    } catch {}
    list[email] = {
      email,
      profile: profile || list[email]?.profile || null,
      boro: boro || list[email]?.boro || null,
      since: list[email]?.since || new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    await publishArtifact('subscribers', { subscribers: list, count: Object.keys(list).length });

    const mail = await confirm(email, profile);
    return res.status(200).json({ ok: true, already, confirmation: mail.sent, note: mail.reason || undefined });
  } catch (e) {
    if (e instanceof VisibilityError)
      return res.status(503).json({ ok: false, canStore: false, error: 'We cannot store sign-ups yet on our side.' });
    return res.status(503).json({ ok: false, error: 'That did not save on our side.' });
  }
}
