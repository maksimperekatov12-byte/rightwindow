// Publish resolved contacts.
//
// Two destinations, and they are not equivalent.
//
// The private store (Vercel Blob) takes everything: the app reads it at request
// time and nothing is bulk-downloadable. The public `data` branch takes only the
// numbers a company published about itself. The enrichment provider's terms —
// data/source-policy.json, checked 2026-08-28 — bar redistributing the provider's
// result set, and a number whose only evidence is a Yelp or BBB listing is
// exactly that. A number read off the firm's own contact page is the firm's own
// published fact, republished here with its source named. lib/provenance.mjs
// draws that line and is the only thing that decides what leaves this script.
//
// Names never go to either destination. The managing agent's company, phone and
// email are business details; the individual named on an HPD registration is a
// person, and this file has never carried one.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { writeJson } from '../lib/store.mjs';
import { enrichContact } from '../lib/enrich.mjs';
import { republishable, provenanceOf, republishableEmail, republishableVia, namesAPerson } from '../lib/provenance.mjs';
import { isPersonToken, looksPersonal } from '../lib/personal.mjs';

const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
const all = {};
const publicOut = {};
const tally = {};
const held = {};

// Every register that carries an agent, not just the first one written — the
// same mistake the redaction loop made when the second register was added.
const withAgents = [feed.facades.feed, ...['gas', 'elevators', 'carbon'].map((k) => feed[k]?.feed || [])].flat();
for (const c of withAgents) {
  if (!c.agent?.company) continue;
  const e = await enrichContact({ company: c.agent.company, address: c.agent.address });
  if (e.confidence === 'none' || (!e.phone && !e.email)) continue;
  const row = {
    phone: e.phone || null,
    email: e.email || null,
    confidence: e.confidence,
    source: e.source,
    ...(e.via ? { via: e.via } : {}),
  };
  all[c.bin] = row;
  tally[e.confidence] = (tally[e.confidence] || 0) + 1;
  if (!republishable(e.source, c.agent.company, e.email, e.confidence)) {
    const why = provenanceOf(e.source, c.agent.company, e.email, e.confidence);
    held[why] = (held[why] || 0) + 1;
    continue;
  }
  // The number publishes; the mailbox has to earn it separately. A row that
  // ends up with neither is not worth a line.
  const email = republishableEmail(row.email, isPersonToken, looksPersonal) ? row.email : null;
  if (email !== row.email) held['with a personal mailbox'] = (held['with a personal mailbox'] || 0) + 1;
  if (!row.phone && !email) continue;
  // `via` is free prose and is where a name gets in. Keep the firm it names,
  // drop the person.
  const via = row.via ? republishableVia(row.via, looksPersonal) : null;
  if (row.via && via !== row.via) held['naming a person in a via note'] = (held['naming a person in a via note'] || 0) + 1;
  publicOut[c.bin] = { ...row, email, ...(via ? { via } : {}) };
  if (!via) delete publicOut[c.bin].via;
}

// A row that names a person is a bug, not a policy question. The first version
// of this guard listed the fields to check, and a name walked straight past it
// inside `via` — free prose in a field nobody had thought to name. The second
// version checked values but only recognised two- and three-word names, and
// "nyscar.org member profile 60314102 (Brandon Yasgur, Principal, YRC
// Management, 825 E. 233rd St, Bronx NY 10466)" walked past that. So the test
// lives in lib/provenance.mjs now, it strips the parts that are never a person
// before it looks, and it runs over every string on every row about to leave.
const leaked = Object.entries(publicOut).filter(([, r]) =>
  Object.values(r).some((v) => namesAPerson(v, looksPersonal)),
);
if (leaked.length) {
  console.error(
    `push-contacts: refusing to publish — ${leaked.length} rows carry what reads as a person's name:\n` +
      leaked.slice(0, 5).map(([bin, r]) => `  ${bin} ${JSON.stringify(r)}`).join('\n'),
  );
  process.exit(1);
}

// The artefact the workflow force-pushes to the `data` branch.
const dir = process.env.DATA_DIR || new URL('../.data/', import.meta.url).pathname;
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir.replace(/\/?$/, '/')}contacts.json`,
  JSON.stringify(
    {
      note: "Business telephone numbers and inboxes of the managing agents named on New York City HPD registrations, each read from the company's own website or from a government record, with that source named on every row. No private individuals. Numbers evidenced only by a third-party directory are not included.",
      generatedAt: new Date().toISOString(),
      count: Object.keys(publicOut).length,
      contacts: publicOut,
    },
    null,
    1,
  ),
);

const parts = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ');
const heldParts = Object.entries(held).map(([k, v]) => `${v} ${k}`).join(', ');
console.log(
  `push-contacts: ${Object.keys(all).length} resolved (${parts || 'none'}); ` +
    `${Object.keys(publicOut).length} publishable to the data branch` +
    (heldParts ? `, withheld ${heldParts}` : ''),
);

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('push-contacts: no blob token, private store skipped');
} else {
  try {
    await writeJson('contacts.json', all);
    console.log(`push-contacts: ${Object.keys(all).length} written to the private store`);
  } catch (e) {
    console.log(`push-contacts: store unavailable (${e.message}) — the data branch still carries the public set`);
  }
}
