// Notify all registered Wallet passes via APNs (empty push -> device refetches the pass;
// the changed "fresh" field's changeMessage becomes the lock-screen notification).
// Env: APNS_KEY_P8_B64, APNS_KEY_ID, APPLE_TEAM_ID, PASS_TYPE_ID, BLOB_READ_WRITE_TOKEN
import { list } from '@vercel/blob';
import { createSign, createPrivateKey } from 'node:crypto';
import { connect } from 'node:http2';

const need = ['APNS_KEY_P8_B64', 'APNS_KEY_ID', 'APPLE_TEAM_ID', 'PASS_TYPE_ID', 'BLOB_READ_WRITE_TOKEN'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.log('push-passes: skipped, missing env:', missing.join(', '));
  process.exit(0);
}

const key = createPrivateKey(Buffer.from(process.env.APNS_KEY_P8_B64, 'base64'));
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = `${b64url({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${b64url({ iss: process.env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
const signer = createSign('SHA256');
signer.update(unsigned);
const jwt = `${unsigned}.${signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

const { blobs } = await list({ prefix: 'reg/', limit: 1000 });
if (!blobs.length) {
  console.log('push-passes: no registered devices');
  process.exit(0);
}
const client = connect('https://api.push.apple.com');
let ok = 0, fail = 0;
for (const b of blobs) {
  const reg = await fetch(b.url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!reg?.pushToken) continue;
  await new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${reg.pushToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': process.env.PASS_TYPE_ID,
      'apns-push-type': 'background',
    });
    req.setEncoding('utf8');
    let status;
    req.on('response', (h) => (status = h[':status']));
    req.on('data', () => {});
    req.on('end', () => {
      status === 200 ? ok++ : fail++;
      if (status !== 200) console.log(`push ${reg.pushToken.slice(0, 8)}…: ${status}`);
      resolve();
    });
    req.on('error', () => { fail++; resolve(); });
    req.end('{}');
  });
}
client.close();
console.log(`push-passes: ok=${ok} fail=${fail} of ${blobs.length}`);
