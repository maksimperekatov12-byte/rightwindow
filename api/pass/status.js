import { walletConfigured } from '../../lib/wallet.mjs';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300');
  res.json({ configured: walletConfigured() });
}
