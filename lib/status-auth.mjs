// The gate in front of /status and /api/status.
//
// The page is for the operator only. It carries nothing personal — every
// number on it is public on the data branch or in the repo — but "only I can
// see it" is the requirement, so it is a locked door, not a hidden one:
// without STATUS_KEY in the environment nothing is served at all.
//
// Sign-in is one POST of the key from a small form; the key never travels in a
// URL, where Vercel's request logs would keep it. What the browser keeps is a
// cookie holding an HMAC of the key, so a leaked cookie does not leak the key
// and rotating the key invalidates every session at once.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'rw_status';
const YEAR = 365 * 24 * 3600;

export const statusKey = () => (process.env.STATUS_KEY || '').trim();

export const tokenFor = (key) => createHmac('sha256', key).update('rw-status-v1').digest('hex');

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// True only with a key configured AND a cookie that matches it.
export function isSignedIn(req) {
  const key = statusKey();
  if (!key) return false;
  const c = parseCookies(req.headers?.cookie)[COOKIE];
  return Boolean(c) && same(c, tokenFor(key));
}

export const keyMatches = (candidate) => {
  const key = statusKey();
  return Boolean(key) && same(candidate, key);
};

export const cookieHeader = (key) =>
  `${COOKIE}=${tokenFor(key)}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;

export const clearCookieHeader = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
