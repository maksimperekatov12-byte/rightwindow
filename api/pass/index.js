import { randomUUID } from 'node:crypto';
import { walletConfigured, buildPass, loadFeed } from '../../lib/wallet.mjs';

export default async function handler(req, res) {
  if (!walletConfigured()) {
    res.status(503).json({ error: 'Wallet passes are not configured yet.' });
    return;
  }
  try {
    const serial = randomUUID();
    const buf = await buildPass(serial, loadFeed());
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', 'attachment; filename="right-window.pkpass"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    console.error('pass build failed', e);
    res.status(500).json({ error: 'Pass build failed.' });
  }
}
