// Apple PassKit Web Service (spec: Wallet Developer Guide).
// Registrations live in the private Blob store as JSON: reg/{serial}.json
import { readJson, writeJson, removeJson, listJson } from '../../lib/store.mjs';
import { walletConfigured, buildPass, loadFeed, authTokenFor } from '../../lib/wallet.mjs';

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
    });
  });

const authed = (req, serial) => (req.headers.authorization || '') === `ApplePass ${authTokenFor(serial)}`;

export default async function handler(req, res) {
  if (!walletConfigured()) return res.status(503).end();
  const seg = [].concat(req.query.route || []);
  if (seg[0] === 'v1' && seg[1] === 'log') {
    const body = await readBody(req);
    console.log('passkit log:', JSON.stringify(body).slice(0, 500));
    return res.status(200).end();
  }
  if (seg[0] === 'v1' && seg[1] === 'passes' && seg.length === 4) {
    const serial = seg[3];
    if (!authed(req, serial)) return res.status(401).end();
    const feed = loadFeed();
    const modified = new Date(feed.generatedAt).toUTCString();
    if (req.headers['if-modified-since'] === modified) return res.status(304).end();
    const buf = await buildPass(serial, feed);
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Last-Modified', modified);
    return res.send(buf);
  }
  if (seg[0] === 'v1' && seg[1] === 'devices' && seg[3] === 'registrations') {
    const deviceId = seg[2];
    const serial = seg[5];
    if (req.method === 'POST' && serial) {
      if (!authed(req, serial)) return res.status(401).end();
      const body = await readBody(req);
      const existing = await readJson(`reg/${serial}.json`);
      await writeJson(`reg/${serial}.json`, { deviceId, pushToken: body.pushToken, ts: Date.now() });
      return res.status(existing ? 200 : 201).end();
    }
    if (req.method === 'DELETE' && serial) {
      if (!authed(req, serial)) return res.status(401).end();
      await removeJson(`reg/${serial}.json`);
      return res.status(200).end();
    }
    if (req.method === 'GET') {
      const paths = await listJson('reg/');
      const serials = [];
      for (const p of paths) {
        const r = await readJson(p);
        if (r?.deviceId === deviceId) serials.push(p.replace(/^reg\//, '').replace(/\.json$/, ''));
      }
      if (!serials.length) return res.status(204).end();
      return res.json({ serialNumbers: serials, lastUpdated: loadFeed().generatedAt });
    }
  }
  res.status(404).end();
}
