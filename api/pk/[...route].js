// Apple PassKit Web Service (spec: Wallet Developer Guide).
// Registrations live in the private Blob store as JSON: reg/{serial}.json
import { readJson, writeJson, removeJson, readDoc, updateDoc } from '../../lib/store.mjs';
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

// Apple's "get serial numbers" call carries no Authorization header, so it
// cannot be locked down — instead it must be cheap. One index document keyed by
// device replaces a list() plus a read per pass on every unauthenticated hit.
const REG_INDEX = 'reg-index.json';

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
      await updateDoc(REG_INDEX, (doc) => {
        const list = doc[deviceId] || [];
        if (list.includes(serial)) return null;
        doc[deviceId] = [...list, serial].slice(-50);
        return doc;
      });
      return res.status(existing ? 200 : 201).end();
    }
    if (req.method === 'DELETE' && serial) {
      if (!authed(req, serial)) return res.status(401).end();
      await removeJson(`reg/${serial}.json`);
      await updateDoc(REG_INDEX, (doc) => {
        const list = (doc[deviceId] || []).filter((x) => x !== serial);
        if (list.length === (doc[deviceId] || []).length) return null;
        if (list.length) doc[deviceId] = list;
        else delete doc[deviceId];
        return doc;
      });
      return res.status(200).end();
    }
    if (req.method === 'GET') {
      const serials = (await readDoc(REG_INDEX))[deviceId] || [];
      if (!serials.length) return res.status(204).end();
      return res.json({ serialNumbers: serials, lastUpdated: loadFeed().generatedAt });
    }
  }
  res.status(404).end();
}
