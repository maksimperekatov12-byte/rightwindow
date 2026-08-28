// Publish resolved contacts to the private store.
//
// Numbers never travel through git: feed.json is committed hourly to a public
// repo, and provider-licensed contact data must not be bulk-downloadable and
// indexed there forever. The cache on disk is the working copy; this puts it
// where the app can read it at request time and nowhere else.
import { readFileSync, existsSync } from 'node:fs';
import { writeJson } from '../lib/store.mjs';
import { enrichContact } from '../lib/enrich.mjs';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('push-contacts: no blob token, skipped');
  process.exit(0);
}

const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
const out = {};
let verified = 0;
let listed = 0;

for (const c of feed.facades.feed) {
  if (!c.agent?.company) continue;
  const e = await enrichContact({ company: c.agent.company, address: c.agent.address });
  if (e.confidence === 'none' || !e.phone) continue;
  out[c.bin] = { phone: e.phone, email: e.email || null, confidence: e.confidence, source: e.source };
  if (e.confidence === 'verified') verified++;
  else listed++;
}

try {
  await writeJson('contacts.json', out);
  console.log(`push-contacts: ${Object.keys(out).length} published (verified ${verified}, listed ${listed})`);
} catch (e) {
  console.log(`push-contacts: store unavailable (${e.message}) — contacts stay local`);
}
