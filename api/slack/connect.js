// Store a Slack incoming webhook against a uid, and send a test card.
import { updateDoc, PREFS } from '../../lib/store.mjs';

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 8000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = await readBody(req);
  const uid = String(b?.uid || '');
  const webhook = String(b?.webhook || '');
  if (!/^[0-9a-f-]{36}$/.test(uid)) return res.status(400).json({ error: 'bad uid' });
  if (webhook && !/^https:\/\/hooks\.slack\.com\/services\/[\w/+-]+$/.test(webhook))
    return res.status(400).json({ error: 'That does not look like a Slack incoming webhook URL.' });

  await updateDoc(PREFS, (doc) => {
    const pref = doc[uid] || { uid };
    pref.channels = { ...(pref.channels || {}), slack: webhook || null };
    doc[uid] = pref;
    return doc;
  });

  if (webhook) {
    const ok = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Right Window is connected. New matching windows will land here.',
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: ":white_check_mark: *Right Window is connected.*\nNew windows matched to your trade will land in this channel — with Claim buttons so nobody double-calls." } },
        ],
      }),
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (!ok) return res.status(502).json({ error: 'Slack rejected the webhook. Check the URL and try again.' });
  }
  res.json({ ok: true, connected: Boolean(webhook) });
}
