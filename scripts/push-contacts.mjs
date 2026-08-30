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
const tally = {};

// Every register that carries an agent, not just the first one written — the
// same mistake the redaction loop made when the second register was added.
const withAgents = [feed.facades.feed, ...['gas', 'elevators', 'carbon'].map((k) => feed[k]?.feed || [])].flat();
for (const c of withAgents) {
  if (!c.agent?.company) continue;
  const e = await enrichContact({ company: c.agent.company, address: c.agent.address });
  if (e.confidence === 'none' || (!e.phone && !e.email)) continue;
  out[c.bin] = {
    phone: e.phone || null,
    email: e.email || null,
    confidence: e.confidence,
    source: e.source,
    ...(e.via ? { via: e.via } : {}),
  };
  tally[e.confidence] = (tally[e.confidence] || 0) + 1;
}

try {
  await writeJson('contacts.json', out);
  const parts = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`push-contacts: ${Object.keys(out).length} published (${parts || 'none'})`);
} catch (e) {
  console.log(`push-contacts: store unavailable (${e.message}) — contacts stay local`);
}
