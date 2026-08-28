// Slack interactivity endpoint: Claim / Not for us.
// Verified with Slack's signing secret; Claim writes the same global claim state
// the website reads, so the dot turns amber for everyone.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { updateDoc, CLAIMS } from '../../lib/store.mjs';

export const config = { api: { bodyParser: false } };

const raw = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 200000) req.destroy(); });
    req.on('end', () => resolve(d));
  });

function verify(req, body) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const mine = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(mine), Buffer.from(String(sig)));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await raw(req);
  if (!verify(req, body)) return res.status(401).send('bad signature');

  const payload = JSON.parse(new URLSearchParams(body).get('payload') || '{}');
  const action = payload.actions?.[0];
  if (!action) return res.status(200).end();
  const key = String(action.value || '');
  const who = payload.user?.name || payload.user?.username || 'someone';

  if (action.action_id === 'claim' && /^[bco]:[\w-]{1,40}$/.test(key)) {
    let taken = false;
    await updateDoc(CLAIMS, (doc) => {
      if (doc[key]) { taken = true; return null; }
      doc[key] = { uid: `slack:${payload.user?.id || 'unknown'}`, at: Date.now(), via: 'slack' };
      return doc;
    });
    if (taken) {
      return res.json({ replace_original: false, response_type: 'ephemeral', text: 'Already claimed — someone got there first.' });
    }
    return res.json({
      replace_original: false,
      response_type: 'in_channel',
      text: `:white_check_mark: *${who}* claimed this one — it's now amber for everyone else.`,
    });
  }
  if (action.action_id === 'skip') {
    return res.json({ replace_original: false, response_type: 'ephemeral', text: 'Skipped — it stays in the open pool.' });
  }
  res.status(200).end();
}
