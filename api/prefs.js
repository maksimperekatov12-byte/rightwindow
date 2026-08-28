// Per-user preferences: profile, ticket, boroughs, watchlist, channels.
// One document keyed by uid — see lib/store.mjs for why.
import { updateDoc, PREFS } from '../lib/store.mjs';

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 60000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await readBody(req);
  const uid = String(body?.uid || '');
  if (!/^[0-9a-f-]{36}$/.test(uid) || !body?.data) return res.status(400).json({ error: 'bad request' });
  try {
    await updateDoc(PREFS, (doc) => {
      doc[uid] = { ...(doc[uid] || {}), ...body.data, uid, savedAt: Date.now() };
      return doc;
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('prefs write failed', e.message);
    return res.status(500).json({ error: 'store failed' });
  }
}
