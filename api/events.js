// The first-party event log: one POST per thing that happened, and one
// token-guarded report that says whom to phone.
//
// Deliberately not analytics: no third-party script, no cookie, no identifier
// beyond the ref a salesperson wrote into the link and the anonymous session
// id the page already generates for claims. It answers exactly one question —
// which cold email produced somebody who opened cards and rang buildings.
import { logEvent, refReport } from '../lib/pilots.mjs';
import { canStorePrivate } from '../lib/artifacts.mjs';

const clean = (s, max) => String(s || '').replace(/["'<>`\\]/g, '').trim().slice(0, max);

// Chrome-on-a-phone vs Safari-on-a-laptop is the whole question; the rest of
// the user-agent string is somebody's fingerprint and is dropped here.
function uaFamily(ua = '') {
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : 'other';
  return `${browser}/${mobile ? 'mobile' : 'desktop'}`;
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 4000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(d || '{}'));
      } catch {
        resolve(null);
      }
    });
  });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // The report. Guarded by a token in the environment: without one set, the
  // route does not exist rather than existing unguarded.
  if (req.method === 'GET') {
    const token = process.env.REPORT_TOKEN;
    const given = String(req.query?.token || '');
    if (!token || given !== token) return res.status(404).end();
    const rows = await refReport(Number(req.query?.days) || 30);
    if (String(req.query?.format) === 'json') return res.json({ rows });
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    return res
      .setHeader('content-type', 'text/html; charset=utf-8')
      .send(
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;margin:24px;color:#101613}' +
          'table{border-collapse:collapse;width:100%;max-width:900px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #e6e3db}' +
          'th{font:600 11px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#5F6F69}' +
          'td.n{font-family:ui-monospace,monospace}</style>' +
          '<h1 style="font-size:18px">Who came</h1>' +
          '<table><tr><th>ref</th><th>first</th><th>last</th><th>people</th><th>visits</th><th>cards</th><th>calls</th><th>openers</th><th>CSV</th><th>pilots</th></tr>' +
          rows
            .map(
              (r) =>
                `<tr><td>${esc(r.ref)}</td><td class=n>${esc(r.first.slice(0, 16).replace('T', ' '))}</td>` +
                `<td class=n>${esc(r.last.slice(0, 16).replace('T', ' '))}</td><td class=n>${r.people}</td>` +
                `<td class=n>${r.visits}</td><td class=n>${r.cards}</td><td class=n>${r.calls}</td>` +
                `<td class=n>${r.openers}</td><td class=n>${r.exports}</td><td class=n>${r.pilots}</td></tr>`,
            )
            .join('') +
          '</table>' +
          (rows.length ? '' : '<p style="color:#5F6F69">No events in this window yet.</p>'),
      );
  }

  if (req.method !== 'POST') return res.status(405).end();
  if (!canStorePrivate()) return res.status(204).end();

  const body = await readBody(req);
  const r = await logEvent({
    kind: clean(body?.kind, 24),
    ref: clean(body?.ref, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '') || null,
    card: clean(body?.card, 40) || null,
    trade: clean(body?.trade, 32) || null,
    zips: Array.isArray(body?.zips) ? body.zips.filter((z) => /^\d{5}$/.test(z)) : null,
    reg: clean(body?.reg, 16) || null,
    ua: uaFamily(req.headers['user-agent'] || ''),
    sid: clean(body?.sid, 40) || null,
  }).catch(() => ({ ok: false }));
  // Never let telemetry shape the visitor's experience: this always returns
  // quietly, whatever happened.
  return res.status(r.ok ? 204 : 202).end();
}
