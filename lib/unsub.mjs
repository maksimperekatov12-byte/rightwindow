// One-click unsubscribe, signed so nobody can unsubscribe somebody else.
//
// Gmail and Yahoo's bulk-sender rules want a working List-Unsubscribe with
// One-Click POST, and a fresh domain that lacks one reads as exactly the kind
// of sender the spam folder exists for. The link carries an HMAC of the address
// under a server-side secret; the endpoint honours it for GET (a person
// clicking) and POST (the mail client's one-click).
import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = () => process.env.UNSUB_SECRET || '';

export const unsubSig = (email) =>
  createHmac('sha256', secret()).update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);

export function unsubOk(email, sig) {
  if (!secret() || !sig) return false;
  const want = Buffer.from(unsubSig(email));
  const got = Buffer.from(String(sig).slice(0, 32).padEnd(32, '0'));
  try {
    return want.length === got.length && timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

export const unsubUrl = (email) =>
  `https://rightwindow.nyc/api/unsubscribe?e=${encodeURIComponent(String(email).trim().toLowerCase())}&s=${unsubSig(email)}`;

// The headers every outbound message carries. reply_to lands on a mailbox a
// human actually reads — the domain has no inbound mail yet, and a reply that
// vanishes is worse for trust than one that reaches the founder directly.
export const mailHeaders = (email) => ({
  reply_to: 'Maxim Perekatov <maxim122090@gmail.com>',
  headers: {
    'List-Unsubscribe': `<${unsubUrl(email)}>, <mailto:maxim122090@gmail.com?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
});
