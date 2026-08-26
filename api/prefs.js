// Notification-ready preference store: anonymous uid -> profile, watchlist,
// feedback (contacted/won/lost/dismissed) and delivery channels placeholder.
import { writeJson } from '../lib/store.mjs';

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 60000) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); }
    });
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await readBody(req);
  const uid = String(body?.uid || '');
  if (!/^[0-9a-f-]{36}$/.test(uid) || !body?.data) return res.status(400).json({ error: 'bad request' });
  try {
    await writeJson(`prefs/${uid}.json`, { ...body.data, uid, savedAt: Date.now() });
    res.json({ ok: true });
  } catch (e) {
    console.error('prefs write failed', e.message);
    res.status(500).json({ error: 'store failed' });
  }
}
