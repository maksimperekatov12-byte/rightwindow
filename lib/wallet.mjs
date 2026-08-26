// Shared pass builder. Configured entirely by env:
//   PASS_TYPE_ID, APPLE_TEAM_ID, PASS_AUTH_SECRET
//   PASS_CERT_PEM_B64, PASS_KEY_PEM_B64, WWDR_PEM_B64  (base64 of PEM files)
import { PKPass } from 'passkit-generator';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const b64 = (name) => (process.env[name] ? Buffer.from(process.env[name], 'base64') : null);

export function walletConfigured() {
  return Boolean(
    process.env.PASS_TYPE_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.PASS_AUTH_SECRET &&
      process.env.PASS_CERT_PEM_B64 &&
      process.env.PASS_KEY_PEM_B64 &&
      process.env.WWDR_PEM_B64,
  );
}

export const authTokenFor = (serial) =>
  createHmac('sha256', process.env.PASS_AUTH_SECRET).update(serial).digest('hex');

export function loadFeed() {
  return JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
}

export function freshLine(feed) {
  const w = feed.whatsNew || {};
  const parts = [];
  if (w.buildings) parts.push(`${w.buildings} building${w.buildings > 1 ? 's' : ''}`);
  if (w.signals) parts.push(`${w.signals} signal${w.signals > 1 ? 's' : ''}`);
  if (w.contracts) parts.push(`${w.contracts} contract${w.contracts > 1 ? 's' : ''}`);
  if (w.openings) parts.push(`${w.openings} opening${w.openings > 1 ? 's' : ''}`);
  return parts.length ? 'New: ' + parts.join(' · ') : 'Quiet for now';
}

export async function buildPass(serial, feed) {
  const pass = await PKPass.from(
    {
      model: new URL('../wallet/rw.pass', import.meta.url).pathname,
      certificates: {
        wwdr: b64('WWDR_PEM_B64'),
        signerCert: b64('PASS_CERT_PEM_B64'),
        signerKey: b64('PASS_KEY_PEM_B64'),
      },
    },
    {
      serialNumber: serial,
      passTypeIdentifier: process.env.PASS_TYPE_ID,
      teamIdentifier: process.env.APPLE_TEAM_ID,
      authenticationToken: authTokenFor(serial),
    },
  );
  const set = (arr, key, value) => {
    const f = arr.find((x) => x.key === key);
    if (f) f.value = value;
  };
  set(pass.headerFields, 'fresh', freshLine(feed));
  set(pass.primaryFields, 'windows', feed.facades.totals.candidates.toLocaleString('en-US'));
  set(pass.secondaryFields, 'urgent', feed.facades.totals.nonFilers10A.toLocaleString('en-US'));
  set(pass.secondaryFields, 'updated', new Date(feed.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  return pass.getAsBuffer();
}
