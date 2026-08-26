// Apple PassKit Web Service (spec: Wallet Developer Guide).
// Registrations live in Vercel Blob as JSON: reg/{serial}.json
import { list, put, del } from '@vercel/blob';
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

async function readReg(serial) {
  const { blobs } = await list({ prefix: `reg/${serial}.json`, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url);
  return r.ok ? r.json() : null;
}

export default async function handler(req, res) {
  if (!walletConfigured()) return res.status(503).end();
  const seg = [].concat(req.query.route || []);
  // /v1/log
  if (seg[0] === 'v1' && seg[1] === 'log') {
    const body = await readBody(req);
    console.log('passkit log:', JSON.stringify(body).slice(0, 500));
    return res.status(200).end();
  }
  // /v1/passes/{passTypeId}/{serial}
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
  // /v1/devices/{deviceId}/registrations/{passTypeId}[/{serial}]
  if (seg[0] === 'v1' && seg[1] === 'devices' && seg[3] === 'registrations') {
    const deviceId = seg[2];
    const serial = seg[5];
    if (req.method === 'POST' && serial) {
      if (!authed(req, serial)) return res.status(401).end();
      const body = await readBody(req);
      const existing = await readReg(serial);
      await put(`reg/${serial}.json`, JSON.stringify({ deviceId, pushToken: body.pushToken, ts: Date.now() }), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      return res.status(existing ? 200 : 201).end();
    }
    if (req.method === 'DELETE' && serial) {
      if (!authed(req, serial)) return res.status(401).end();
      const { blobs } = await list({ prefix: `reg/${serial}.json`, limit: 1 });
      if (blobs.length) await del(blobs[0].url);
      return res.status(200).end();
    }
    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: 'reg/', limit: 1000 });
      const serials = [];
      for (const b of blobs) {
        const r = await fetch(b.url).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (r?.deviceId === deviceId) serials.push(b.pathname.replace(/^reg\//, '').replace(/\.json$/, ''));
      }
      if (!serials.length) return res.status(204).end();
      const feed = loadFeed();
      return res.json({ serialNumbers: serials, lastUpdated: feed.generatedAt });
    }
  }
  res.status(404).end();
}
