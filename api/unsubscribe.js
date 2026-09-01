// One click out. GET is a person on the link; POST is the mail client's
// one-click (RFC 8058). Both verify the signature, drop the address from the
// subscriber list and add it to the suppression set that every sender checks.
import { removeSubscriber, suppress } from '../lib/leads.mjs';
import { unsubOk } from '../lib/unsub.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = new URL(req.url, 'https://rightwindow.nyc').searchParams;
  const email = String(q.get('e') || '').trim().toLowerCase();
  const sig = String(q.get('s') || '');

  if (!email || !unsubOk(email, sig)) {
    res.statusCode = 400;
    return res.end('This unsubscribe link is not valid.');
  }

  try {
    await suppress(email);
    await removeSubscriber(email);
  } catch {
    res.statusCode = 503;
    return res.end('That did not save on our side — email us and we will remove you by hand.');
  }

  if (req.method === 'POST') {
    res.statusCode = 200;
    return res.end('Unsubscribed.');
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  return res.end(
    `<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;color:#101613"><h2 style="font-weight:600">You are unsubscribed.</h2><p style="color:#5F6F69">${email} will get no more email from Right Window. Signing up again on the site turns it back on.</p><p><a href="https://rightwindow.nyc/" style="color:#14594A">rightwindow.nyc</a></p></body>`,
  );
}
