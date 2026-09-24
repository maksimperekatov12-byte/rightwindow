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
import { enrichContact, confirmedOn, stillServed } from '../lib/enrich.mjs';
import { republishable, provenanceOf, republishableEmail, republishableVia, namesAPerson } from '../lib/provenance.mjs';
import { isPersonToken, looksPersonal } from '../lib/personal.mjs';

const feed = JSON.parse(readFileSync(new URL('../src/data/feed.json', import.meta.url), 'utf8'));
const all = {};
const publicOut = {};
const tally = {};
const held = {};

// Every register that carries an agent, not just the first one written — the
// same mistake the redaction loop made when the second register was added.
// Derived, not listed. The redaction loop in collect.mjs made exactly this
// mistake once — it was left pointing at one register when a second was added,
// and 399 people's names went into the public repo. A hard-coded list here would
// silently stop publishing contacts for the next register somebody adds.
const REGISTER_KEYS = Object.keys(feed).filter((k) => Array.isArray(feed[k]?.feed));
const withAgents = REGISTER_KEYS.map((k) => feed[k].feed).flat();
console.log(`push-contacts: registers found in the feed — ${REGISTER_KEYS.join(', ')}`);

// Contacts the collector's affiliate pass gave holding LLCs (scripts/collect.mjs
// writes them; it alone sees the head officer who ties the two firms). Each is
// published only while the number is still served for the firm it came from.
const DATA_DIR = process.env.DATA_DIR || new URL('../.data/', import.meta.url).pathname;
let inherited = {};
try {
  inherited = JSON.parse(readFileSync(`${DATA_DIR.replace(/\/?$/, '/')}affiliates.json`, 'utf8'));
} catch {}
let inheritedIn = 0;
let inheritedStale = 0;

for (const c of withAgents) {
  if (!c.agent?.company) continue;
  let e = await enrichContact({ company: c.agent.company, address: c.agent.address });
  // The day the number was last seen good — by its search, or by the daily
  // re-check reading its page again (lib/recheck.mjs). The card prints it, so
  // a caller can tell this morning's number from last month's.
  let checkedAt = null;
  if (e.confidence === 'none' || (!e.phone && !e.email)) {
    const inh = inherited[c.bin];
    if (!inh) continue;
    checkedAt = stillServed(inh.via, inh);
    if (!checkedAt) {
      inheritedStale++;
      continue;
    }
    e = { phone: inh.phone, email: inh.email, confidence: 'affiliate', source: inh.source, via: inh.via };
    inheritedIn++;
  } else {
    checkedAt = confirmedOn({ company: c.agent.company, address: c.agent.address });
  }
  const row = {
    phone: e.phone || null,
    email: e.email || null,
    confidence: e.confidence,
    source: e.source,
    ...(e.via ? { via: e.via } : {}),
    ...(checkedAt ? { checkedAt } : {}),
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

// A build that resolved almost nothing is a build with no cache, not a city
// where the firms stopped existing. The hourly CI cannot see the enrichment
// cache — it is gitignored — and one such run force-pushed a 391-byte artefact
// over 1,142 rows, zeroing every number in production within the hour. Neither
// destination may shrink drastically below what is already published: the
// existing set was validated when IT was published, and keeping it is strictly
// better than replacing it with an empty file.
async function refuseShrink(kind, next, readExisting) {
  const nextN = Object.keys(next).length;
  let existing = null;
  try {
    existing = await readExisting();
  } catch {
    existing = null;
  }
  const prevN = existing ? Object.keys(existing).length : 0;
  if (prevN > 20 && nextN < prevN * 0.5) {
    console.log(
      `push-contacts: REFUSING to shrink the ${kind} set from ${prevN} to ${nextN} rows — ` +
        'this build has no enrichment cache; the published set stands',
    );
    return existing;
  }
  return null;
}

// The artefact the workflow force-pushes to the `data` branch.
const dir = process.env.DATA_DIR || new URL('../.data/', import.meta.url).pathname;
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
{
  const kept = await refuseShrink('public', publicOut, async () => {
    const repo = process.env.DATA_REPO || 'maksimperekatov12-byte/rightwindow';
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/data/contacts.json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.contacts || null;
  });
  if (kept) Object.assign(publicOut, kept);
}
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
console.log(
  `push-contacts: ${inheritedIn} affiliate contacts from the collector's head-officer pass` +
    (inheritedStale ? `, ${inheritedStale} left out — the firm they came from no longer has that number` : ''),
);

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('push-contacts: no blob token, private store skipped');
} else {
  try {
    let existing = null;
    const kept = await refuseShrink('private', all, async () => {
      const { readJsonSoft } = await import('../lib/store.mjs');
      return (existing = await readJsonSoft('contacts.json'));
    });
    if (kept) Object.assign(all, kept);
    // A put is an advanced operation against a 2,000-a-month allowance, and
    // at one sweep an hour most runs resolve the same set. The read above is
    // already paid for; an identical set is not written again.
    const canonical = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    if (existing && canonical(existing) === canonical(all)) {
      console.log(`push-contacts: the private store already holds these ${Object.keys(all).length} rows — not rewritten`);
    } else {
      await writeJson('contacts.json', all);
      console.log(`push-contacts: ${Object.keys(all).length} written to the private store`);
    }
    markKnown();
  } catch (e) {
    console.log(`push-contacts: store unavailable (${e.message}) — the data branch still carries the public set`);
  }
}

// The feed's "a contact exists" flag, set to what the cards can now be given.
// The collector sets it from the cache as it stood before this run's re-check
// (lib/recheck.mjs), which may since have withdrawn the number — and a card
// flagged with nothing behind it read "on file · from a listing we cannot
// republish" beside a Find-the-number button (BIN 1064255, 2026-09-24). Only
// after the private store holds this set: it is what /api/live serves, and a
// run that could not write it leaves the collector's flags alone.
function markKnown() {
  let on = 0;
  let off = 0;
  for (const c of withAgents) {
    if (!c.agent?.company) continue;
    const known = Boolean(all[c.bin]);
    if (Boolean(c.agent.contactKnown) === known) continue;
    c.agent.contactKnown = known;
    known ? on++ : off++;
  }
  if (!on && !off) return;
  writeFileSync(new URL('../src/data/feed.json', import.meta.url), JSON.stringify(feed, null, 1));
  console.log(`push-contacts: the feed's contact flags now match the served set (${on} on, ${off} off)`);
}
