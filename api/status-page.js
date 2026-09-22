// /status — served from here, not from the static folder, so the door in
// lib/status-auth.mjs is the only way in.
//
//   GET  without a session  → the sign-in form (a page that admits to existing
//                             but shows nothing)
//   POST key                → cookie + redirect to /status
//   GET  ?key=…             → the same, as one link that works on a phone. The
//                             key then sits in Vercel's request log, which only
//                             the project owner reads; the form is the way in
//                             when even that is too much.
//   GET  with a session     → the page
//   GET  ?signout=1         → cookie cleared
import PAGE from '../lib/status-page.generated.mjs';
import { cookieHeader, clearCookieHeader, isSignedIn, keyMatches, statusKey } from '../lib/status-auth.mjs';

// The HTML is a module (scripts/make-status-page.mjs), so it travels with the
// function by the one mechanism that is certain — an import — and never
// through the public build.
const page = () => PAGE;

const FORM = (msg = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Right Window — Status</title><meta name="robots" content="noindex">
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 'Public Sans',-apple-system,'Segoe UI',sans-serif;background:#F1EFE9;color:#101613}
  @media(prefers-color-scheme:dark){body{background:#0D1211;color:#E5ECE9}}
  form{display:grid;gap:10px;width:min(360px,90vw)}
  label{font:500 11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
  input{font:inherit;padding:10px 12px;border:1px solid rgba(127,127,127,.4);border-radius:8px;background:transparent;color:inherit}
  button{font:600 14px/1 inherit;padding:11px 14px;border:0;border-radius:8px;background:#14594A;color:#fff;cursor:pointer}
  .m{font-size:13px;color:#A63A28;min-height:1.2em}
</style></head><body>
<form method="post" action="/status" autocomplete="off">
  <label for="k">Right Window · status key</label>
  <input id="k" name="key" type="password" autofocus required>
  <button type="submit">Open</button>
  <div class="m">${msg}</div>
</form></body></html>`;

const readBody = (req) =>
  new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(new URLSearchParams(req.body).toString());
    let s = '';
    req.on('data', (d) => {
      s += d;
      if (s.length > 4096) req.destroy();
    });
    req.on('end', () => resolve(s));
    req.on('error', () => resolve(''));
  });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  // Locked by default: no key configured, nothing here.
  if (!statusKey()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  const url = new URL(req.url || '/', 'http://x');

  if (req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const key = String(body.get('key') || '').trim();
    if (keyMatches(key)) {
      res.setHeader('Set-Cookie', cookieHeader(key));
      res.statusCode = 303;
      res.setHeader('Location', '/status');
      return res.end();
    }
    // A wrong guess costs half a second; the key is a passphrase, not a PIN.
    await new Promise((r) => setTimeout(r, 500));
    res.statusCode = 401;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(FORM('That is not the key.'));
  }

  const linkKey = url.searchParams.get('key');
  if (linkKey != null) {
    if (keyMatches(linkKey.trim())) res.setHeader('Set-Cookie', cookieHeader(linkKey.trim()));
    else await new Promise((r) => setTimeout(r, 500));
    // Always leave the key behind: the redirect lands on the clean address
    // whether the key was right (page) or wrong (form).
    res.statusCode = 303;
    res.setHeader('Location', '/status');
    return res.end();
  }

  if (url.searchParams.get('signout') === '1') {
    res.setHeader('Set-Cookie', clearCookieHeader());
    res.statusCode = 303;
    res.setHeader('Location', '/status');
    return res.end();
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!isSignedIn(req)) {
    res.statusCode = 401;
    return res.end(FORM());
  }
  res.statusCode = 200;
  res.end(page());
}
