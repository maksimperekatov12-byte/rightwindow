// Vercel as the clock, GitHub as the worker.
//
// The hourly sweep is a GitHub Actions job — it runs seven to thirty minutes
// and ends in a git commit, which no serverless function should do — but
// GitHub's own scheduler starts an hourly cron every two to five hours on a
// busy public repo. Vercel Cron fires on time. This endpoint is what it fires:
// one workflow_dispatch, nothing else.
//
// Locked by default. CRON_SECRET is what Vercel sends with every cron call and
// what keeps strangers from spending the repo's Actions minutes;
// GITHUB_DISPATCH_TOKEN is a fine-grained token with Actions: write on the
// repo. Without either, the call is refused and says why.
import { timingSafeEqual } from 'node:crypto';

const REPO = () => process.env.DATA_REPO || 'maksimperekatov12-byte/rightwindow';
const WORKFLOW = 'refresh.yml';

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = (process.env.CRON_SECRET || '').trim();
  const token = (process.env.GITHUB_DISPATCH_TOKEN || '').trim();
  if (!secret || !token) {
    res.statusCode = 503;
    return res.json({ ok: false, error: `not configured: ${[!secret && 'CRON_SECRET', !token && 'GITHUB_DISPATCH_TOKEN'].filter(Boolean).join(', ')}` });
  }
  if (!same(req.headers.authorization || '', `Bearer ${secret}`)) {
    res.statusCode = 401;
    return res.json({ ok: false, error: 'unauthorized' });
  }
  const r = await fetch(`https://api.github.com/repos/${REPO()}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
    signal: AbortSignal.timeout(15000),
  }).catch((e) => ({ status: 0, text: async () => String(e?.message || e) }));
  // 204 is GitHub's "dispatched". Anything else is reported, not retried: the
  // next hour tries again, and the status page shows the gap.
  const ok = r.status === 204;
  res.statusCode = ok ? 200 : 502;
  res.json({ ok, github: r.status, ...(ok ? {} : { detail: (await r.text()).slice(0, 300) }), at: new Date().toISOString() });
}
