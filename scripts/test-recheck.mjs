// The daily re-check keeps a card's number only while its page still vouches
// for it, and holds directory numbers found before 2026-09-23 to the rule
// that day brought in. These run in prebuild, offline, against fixture pages
// and a fake fetch; the cache they use is a temporary file, never the real
// one, and the store is a fake that counts writes.
//
// The regressions that earned this file, both found on 2026-09-24:
//  - nearly every contact was resolved 2026-08-28..31 and served for thirty
//    days from its search, and with the search key out of quota every number
//    on every card was four days from disappearing;
//  - BIN 4079440's card carried a directory number for a same-name firm in
//    East Meadow, because the directory rule bound only new searches.
//
// The numbers below are made up for the fixtures and belong to nobody we know.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'rw-recheck-'));
const CACHE = join(dir, 'enrich-cache.json');
process.env.ENRICH_CACHE_PATH = CACHE;
delete process.env.ENRICH_API_KEY;
delete process.env.ENRICH_PROVIDER;

const E = await import('../lib/enrich.mjs');
const R = await import('../lib/recheck.mjs');
const H = await import('../lib/health.mjs');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 24, 14);
const AUG28 = Date.UTC(2026, 7, 28, 15);

const filler = '<p>Residential property management across Queens, Brooklyn and Manhattan since 1987. Rent-stabilized and co-op buildings.</p>';
const html = (body) => `<!doctype html><html><head><title>t</title></head><body>${filler}${body}</body></html>`;

// A fake web: url -> page, a status number, or an Error to throw. Anything
// not listed is a 404. Every request is counted.
function web(pages) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const p = pages[url];
    if (p instanceof Error) throw p;
    if (typeof p === 'number') return new Response('', { status: p });
    if (p === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(p, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  return { fetchImpl, calls, get: R.pageGetter(fetchImpl) };
}

const HARBOR = { company: 'HARBORVIEW PROPERTY MANAGEMENT', address: '41-12 MAIN ST, Flushing NY 11355' };
const own = (source, extra = {}) => ({
  at: NOW - 27 * DAY,
  value: { company: HARBOR.company, phone: '+1-718-402-3316', email: null, confidence: 'verified', source, via: null, ...extra },
});

// ---- the page a number came from ---------------------------------------------
{
  assert.deepEqual(R.sourcePage({ source: 'fsresidential.com/new-york/contact-us' }), { url: 'https://fsresidential.com/new-york/contact-us', host: 'fsresidential.com', exact: true });
  assert.deepEqual(R.sourcePage({ source: "amsterdampropny.com (company's own site)" }), { url: 'https://amsterdampropny.com/', host: 'amsterdampropny.com', exact: false });
  assert.equal(R.sourcePage({ source: 'yellowpages.com (Jrc Management Co, 9354 Queens Blvd, Rego Park NY 11374)' }).exact, false);
  assert.equal(R.sourcePage({ source: 'yellowpages.com/new-york-ny/mip/x-4117585, read on-page; HPD reg 104122' }).url, 'https://yellowpages.com/new-york-ny/mip/x-4117585');
  assert.equal(R.sourcePage({ source: 'kmr-management.com / kmrequity.com; NYC HPD' }).url, 'https://kmr-management.com/');
  assert.equal(R.sourcePage({ source: 'NYC HPD registration contacts' }), null, 'prose with no host names no page');
  // A recorded url wins over the prose.
  assert.equal(R.sourcePage({ url: 'https://www.harborviewpm.com/contact', source: 'harborviewpm.com' }).exact, true);
}

// ---- a tel: link confirms ----------------------------------------------------
{
  const w = web({ 'https://harborviewpm.com/contact': html('<h1>Contact us</h1><a href="tel:+17184023316" class="btn">Call the office</a>') });
  const e = own('harborviewpm.com/contact');
  const res = await R.checkEntry(e, HARBOR, w.get);
  assert.equal(res.outcome, 'confirmed', 'a number declared only in a tel: link is on the page');
  const after = R.applyCheck(e, res, NOW);
  assert.equal(after.checkedAt, NOW);
  assert.equal(after.at, e.at, 'a re-check never restamps the search');
  assert.deepEqual(after.lastCheck, { at: NOW, outcome: 'confirmed' });
  assert.equal(after.value.url, 'https://harborviewpm.com/contact');
  assert.equal(w.calls.length, 1, 'stops at the first confirmation');
}

// ---- a host-only source: the homepage, its contact-ish links, then /contact ---
{
  const w = web({
    'https://harborviewpm.com/': html('<nav><a href="/our-story">About us</a> <a href="/listings">Listings</a></nav>'),
    'https://harborviewpm.com/our-story': html('<h1>Our story</h1>'),
    'https://harborviewpm.com/contact': html('<h1>Reach us</h1><p>Office: (718) 402-3316</p>'),
    'https://harborviewpm.com/contact-us': html('<p>(718) 402-3316</p>'),
  });
  const res = await R.checkEntry(own('harborviewpm.com'), HARBOR, w.get);
  assert.equal(res.outcome, 'confirmed');
  assert.equal(res.url, 'https://harborviewpm.com/contact');
  assert.deepEqual(w.calls, ['https://harborviewpm.com/', 'https://harborviewpm.com/our-story', 'https://harborviewpm.com/contact']);
}
{
  // Nothing anywhere, and only guessed pages loaded: unconfirmed, never absent.
  const w = web({ 'https://harborviewpm.com/': html('<a href="/contact">Contact</a>'), 'https://harborviewpm.com/contact': html('<form>Write to us</form>') });
  assert.equal((await R.checkEntry(own('harborviewpm.com'), HARBOR, w.get)).outcome, 'unconfirmed');
  assert.ok(w.calls.length <= 4, 'at most four fetches per entry');
  // Nothing loaded at all: unreachable.
  const down = web({ 'https://harborviewpm.com/': new Error('getaddrinfo ENOTFOUND'), 'https://harborviewpm.com/contact': 403, 'https://harborviewpm.com/contact-us': 503 });
  assert.equal((await R.checkEntry(own('harborviewpm.com'), HARBOR, down.get)).outcome, 'unreachable');
  // A bot wall answers 200 and is not the page.
  const wall = web({ 'https://harborviewpm.com/contact': '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>' });
  assert.equal((await R.checkEntry(own('harborviewpm.com/contact'), HARBOR, wall.get)).outcome, 'unreachable');
}

// ---- the firm's own site now carries another number: changed ------------------
{
  const w = web({ 'https://harborviewpm.com/contact': html('<p>Call <a href="tel:7184029900">(718) 402-9900</a></p>') });
  const e = own('harborviewpm.com/contact');
  const res = await R.checkEntry(e, HARBOR, w.get);
  assert.equal(res.outcome, 'changed');
  const after = R.applyCheck(e, res, NOW);
  assert.equal(after.value.phone, '+1-718-402-9900');
  assert.equal(after.value.was.phone, '+1-718-402-3316', 'the replaced number is kept, privately');
  assert.equal(after.checkedAt, NOW);
}

// ---- directory numbers under today's rule -------------------------------------
const IMPERIAL = { company: 'IMPERIAL CONSULTING GROUP', address: '118-09 83RD AVE, Kew Gardens NY 11415' };
const listed = (source, extra = {}) => ({
  at: AUG28,
  value: { company: IMPERIAL.company, phone: '+1-646-480-7021', email: null, confidence: 'listed', source, via: null, ...extra },
});
{
  // The East Meadow page: the same name, another town, the filing's ZIP nowhere.
  const url = 'https://nextdoor.com/pages/imperial-consulting-group-east-meadow-ny';
  const w = web({ [url]: html('<h1>Imperial Consulting Group</h1><p>2400 Hempstead Tpke, East Meadow, NY 11554</p><p>Call (646) 480-7021</p>') });
  const e = listed('nextdoor.com/pages/imperial-consulting-group-east-meadow-ny');
  const res = await R.checkEntry(e, IMPERIAL, w.get);
  assert.equal(res.outcome, 'rejected');
  assert.match(res.reason, /does not show the filing's address/);
  const t = R.applyCheck(e, res, NOW);
  assert.equal(t.at, NOW, 'a tombstone is stamped now, so it beats every older copy');
  assert.equal(t.value.confidence, 'none');
  assert.equal(t.value.phone, null);
  assert.equal(t.value.email, null);
  assert.equal(t.value.company, IMPERIAL.company);
  assert.equal(t.value.rejected, res.reason);
  assert.equal(t.lastCheck.outcome, 'rejected');
  assert.ok(!R.checkable(t), 'a tombstone is never checked again');
}
{
  // The filing's ZIP is on the page, but a screen away from the number: a
  // results page, or a "nearby" rail. Nothing ties the two.
  const url = 'https://www.yellowpages.com/search?q=imperial';
  const page = html(`<p>Imperial Consulting Group · East Meadow, NY 11554 · (646) 480-7021</p>${'<p>other listing</p>'.repeat(60)}<p>People also viewed: businesses near Kew Gardens, NY 11415</p>`);
  const res = await R.checkEntry(listed('', { url }), IMPERIAL, web({ [url]: page }).get);
  assert.equal(res.outcome, 'rejected');
}
{
  // The filing's ZIP sits nearest another number: that one is taken.
  const url = 'https://yellowpages.com/queens-ny/imperial-consulting-group';
  const page = html(
    '<div>Imperial Consulting Group 118-09 83rd Ave, Kew Gardens NY 11415 (718) 402-2310</div>' +
      '<div>Imperial Consulting Group, East Meadow NY 11554 (646) 480-7021</div>',
  );
  const e = listed('yellowpages.com/queens-ny/imperial-consulting-group');
  const res = await R.checkEntry(e, IMPERIAL, web({ [url]: page }).get);
  assert.equal(res.outcome, 'changed');
  const after = R.applyCheck(e, res, NOW);
  assert.equal(after.value.phone, '+1-718-402-2310');
  assert.equal(after.value.was.phone, '+1-646-480-7021');
  assert.equal(after.value.confidence, 'listed');
  // And the same page with the recorded number beside the ZIP confirms it.
  const ok = html('<div>Imperial Consulting Group 118-09 83rd Ave, Kew Gardens NY 11415 (646) 480-7021</div>');
  assert.equal((await R.checkEntry(e, IMPERIAL, web({ [url]: ok }).get)).outcome, 'confirmed');
}
{
  // A listing that answers 403. Found before the rule, it is kept only on the
  // address its own source note records — kept, not refreshed.
  const JRC = { company: 'JRC MANAGEMENT CO', address: '9354 QUEENS BLVD, Rego Park NY 11374' };
  const blocked = web({ 'https://yelp.com/biz/jrc-management-rego-park': 403, 'https://bbb.org/us/ny/rego-park/profile/jrc': 403 });
  const withNote = { at: AUG28, value: { company: JRC.company, phone: '+1-718-897-4410', email: null, confidence: 'listed', source: 'yelp.com/biz/jrc-management-rego-park (Jrc Management Co, 9354 Queens Blvd, Rego Park NY 11374)', via: null } };
  const kept = await R.checkEntry(withNote, JRC, blocked.get);
  assert.equal(kept.outcome, 'unreachable');
  const keptAfter = R.applyCheck(withNote, kept, NOW);
  assert.equal(keptAfter.checkedAt, undefined, 'kept on its note, not refreshed');
  assert.equal(keptAfter.lastCheck.outcome, 'unreachable');

  const bare = { ...withNote, value: { ...withNote.value, source: 'bbb.org/us/ny/rego-park/profile/jrc' } };
  const gone = await R.checkEntry(bare, JRC, blocked.get);
  assert.equal(gone.outcome, 'rejected');
  assert.equal(gone.reason, "directory number with no demonstrable tie to the filing's address");
  // A bare directory host names no listing at all: the same, with no fetch.
  const hostOnly = web({});
  assert.equal((await R.checkEntry({ ...withNote, value: { ...withNote.value, source: 'yelp.com' } }, JRC, hostOnly.get)).outcome, 'rejected');
  assert.equal(hostOnly.calls.length, 0, "a directory's homepage vouches for nothing and is not fetched");

  // Found by a search under today's rule, it merely cannot be read again.
  const fresh = { at: NOW - 2 * HOUR, value: { ...bare.value, url: 'https://bbb.org/us/ny/rego-park/profile/jrc' } };
  assert.equal((await R.checkEntry(fresh, JRC, blocked.get)).outcome, 'unreachable');
  // As does one a re-check already held to the rule.
  assert.equal((await R.checkEntry({ ...bare, checkedAt: NOW - DAY }, JRC, blocked.get)).outcome, 'unreachable');
}

// ---- two absences a day apart withdraw a number; one does not -----------------
{
  const w = web({ 'https://harborviewpm.com/contact': html('<h1>Contact</h1><form>Write to us</form>'), 'https://harborviewpm.com/': html('<p>Welcome</p>') });
  let e = own('harborviewpm.com/contact');
  const check = async (at) => (e = R.applyCheck(e, await R.checkEntry(e, HARBOR, w.get), at));
  await check(NOW);
  assert.equal(e.lastCheck.outcome, 'absent');
  assert.equal(e.value.phone, '+1-718-402-3316', 'one absence withdraws nothing');
  await check(NOW + 5 * HOUR);
  assert.equal(e.lastCheck.outcome, 'absent', 'two absences five hours apart are one bad day');
  assert.equal(e.lastCheck.since, NOW);
  await check(NOW + 21 * HOUR);
  assert.equal(e.value.rejected, 'no longer on its source page since 2026-09-24');
  assert.equal(e.lastCheck.outcome, 'withdrawn');
  assert.equal(e.value.phone, null);
  // A confirmation in between starts the count again.
  let f = R.applyCheck(own('harborviewpm.com/contact'), { outcome: 'absent' }, NOW);
  f = R.applyCheck(f, { outcome: 'confirmed' }, NOW + 21 * HOUR);
  f = R.applyCheck(f, { outcome: 'absent' }, NOW + 42 * HOUR);
  assert.equal(f.lastCheck.outcome, 'absent');
  assert.equal(f.value.phone, '+1-718-402-3316');
}

// ---- serving: fresh, grace, tombstone ----------------------------------------
const put = (doc) => {
  writeFileSync(CACHE, JSON.stringify(doc));
  E.reloadContactCache();
};
const entryFor = (company, address, entry) => ({ [E.keyOf({ company, address })]: entry });
const now = Date.now();
{
  const A = { company: 'ALDER MANAGEMENT', address: '10 A ST, New York NY 10001' };
  const B = { company: 'BIRCH MANAGEMENT', address: '10 B ST, New York NY 10001' };
  const C = { company: 'CEDAR MANAGEMENT', address: '10 C ST, New York NY 10001' };
  const D = { company: 'DOGWOOD MANAGEMENT', address: '10 D ST, New York NY 10001' };
  const v = (company, phone) => ({ company, phone, email: null, confidence: 'verified', source: 'example.org', via: null });
  put({
    // Confirmed on its page today: fresh, though its search was 40 days ago.
    ...entryFor(A.company, A.address, { at: now - 40 * DAY, checkedAt: now - HOUR, lastCheck: { at: now - HOUR, outcome: 'confirmed' }, value: v(A.company, '+1-212-402-1001') }),
    // Its site is down: served through the grace month...
    ...entryFor(B.company, B.address, { at: now - 45 * DAY, lastCheck: { at: now - HOUR, outcome: 'unreachable' }, value: v(B.company, '+1-212-402-1002') }),
    // ...but not past sixty days.
    ...entryFor(C.company, C.address, { at: now - 61 * DAY, lastCheck: { at: now - HOUR, outcome: 'unconfirmed' }, value: v(C.company, '+1-212-402-1003') }),
    // An absence is not an unreadable page: no grace.
    ...entryFor(D.company, D.address, { at: now - 45 * DAY, lastCheck: { at: now - HOUR, outcome: 'absent', since: now - HOUR }, value: v(D.company, '+1-212-402-1004') }),
  });
  assert.equal((await E.enrichContact(A)).phone, '+1-212-402-1001', 'confirmed today is fresh, whatever the age of the search');
  assert.equal((await E.enrichContact(B)).phone, '+1-212-402-1002', 'an unreachable page keeps its number through the grace month');
  assert.equal((await E.enrichContact(C)).phone, null, 'grace ends at sixty days');
  assert.equal((await E.enrichContact(D)).phone, null);
  assert.equal(E.confirmedOn(A), new Date(now - HOUR).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));

  // The whole path: the site goes down, the re-check records it, the card keeps the number.
  const K = { company: 'ELM MANAGEMENT', address: '10 E ST, New York NY 10001' };
  const e = { at: now - 35 * DAY, value: { ...v(K.company, '+1-212-402-1005'), source: 'elm-management.com' } };
  const down = web({ 'https://elm-management.com/': new Error('connect ETIMEDOUT') });
  const after = R.applyCheck(e, await R.checkEntry(e, K, down.get), now);
  put(entryFor(K.company, K.address, after));
  assert.equal((await E.enrichContact(K)).phone, '+1-212-402-1005');
  put(entryFor(K.company, K.address, { ...after, at: now - 61 * DAY }));
  assert.equal((await E.enrichContact(K)).phone, null);
}

// ---- a tombstone survives the merge and serves nothing ------------------------
{
  const k = E.keyOf(IMPERIAL);
  const old = listed('nextdoor.com/pages/imperial-consulting-group-east-meadow-ny');
  const tomb = R.tombstone(old, 'directory listing for a same-name firm in East Meadow', 'rejected', now);
  // This machine still holds the August copy; the store holds the tombstone.
  put({ [k]: old });
  await E.pullCache(async () => ({ [k]: tomb }));
  assert.equal(E.contactCache()[k].value.rejected, tomb.value.rejected);
  const served = await E.enrichContact(IMPERIAL);
  assert.equal(served.phone, null, 'a tombstone serves nothing');
  assert.equal(served.confidence, 'none');
  assert.equal(JSON.parse(readFileSync(CACHE, 'utf8'))[k].value.rejected, tomb.value.rejected, 'and is what lands on disk');
  // The other way round: the store's older copy does not undo a local tombstone.
  put({ [k]: tomb });
  await E.pullCache(async () => ({ [k]: old }));
  assert.ok(E.contactCache()[k].value.rejected);
  assert.equal((await E.enrichContact(IMPERIAL)).phone, null);
  // A re-check beats an older copy even though neither search moved.
  const seen = { ...old, lastCheck: { at: now, outcome: 'unreachable' } };
  put({ [k]: old });
  await E.pullCache(async () => ({ [k]: seen }));
  assert.equal(E.contactCache()[k].lastCheck?.outcome, 'unreachable');
  // A same-name firm's verified number does not travel onto a withdrawn pair.
  put({
    [k]: tomb,
    ...entryFor(IMPERIAL.company, '2400 HEMPSTEAD TPKE, East Meadow NY 11554', { at: now - DAY, value: { company: IMPERIAL.company, phone: '+1-516-402-7000', email: null, confidence: 'verified', source: 'imperialconsultinggroup.com', via: null } }),
  });
  assert.equal((await E.enrichContact(IMPERIAL)).phone, null);
  // Nor is a tombstone a search made today.
  put({ [k]: tomb });
  assert.equal(E.searchesToday(), 0);
}

// ---- which pairs are due -------------------------------------------------------
{
  const pairs = ['a', 'b', 'c', 'd'].map((x) => ({ key: x, company: x, address: '', bins: ['1'] }));
  const doc = {
    a: { at: NOW - 30 * HOUR, value: { confidence: 'verified', phone: '+1-212-402-1001' } },
    b: { at: NOW - 5 * DAY, lastCheck: { at: NOW - 14 * HOUR, outcome: 'confirmed' }, value: { confidence: 'listed', phone: '+1-212-402-1002' } },
    c: { at: NOW - 5 * DAY, lastCheck: { at: NOW - 3 * HOUR, outcome: 'confirmed' }, value: { confidence: 'affiliate', phone: '+1-212-402-1003' } },
    d: { at: NOW, value: { confidence: 'none', phone: null, rejected: 'x' } },
  };
  assert.deepEqual(R.dueBatch(doc, pairs, NOW).map((x) => x.p.key), ['a', 'b'], 'a run takes what is due and what is nearly due, oldest first');
  assert.deepEqual(R.dueBatch(doc, pairs, NOW, 1).map((x) => x.p.key), ['a']);
  doc.a.lastCheck = { at: NOW - 2 * HOUR, outcome: 'unreachable' };
  assert.deepEqual(R.dueBatch(doc, pairs, NOW), [], 'nothing due, nothing checked — even what is nearly due');
  // Every register that carries agents, derived from the feed.
  const feed = {
    facades: { feed: [{ bin: 1, agent: { company: 'X', address: 'A' } }, { bin: 2, agent: { company: 'X', address: 'A' } }] },
    brandNew: { feed: [{ bin: 3, agent: { company: 'Y', address: 'B' } }, { bin: 4 }] },
    contracts: [{ id: 1 }],
  };
  const fp = R.feedPairs(feed);
  assert.deepEqual(fp.registers, ['facades', 'brandNew']);
  assert.equal(fp.pairs.length, 2);
  assert.deepEqual(fp.pairs[0].bins, ['1', '2']);
}

// ---- the runner: a dry run writes nothing; a real run writes once -------------
{
  const pair = { company: HARBOR.company, address: HARBOR.address };
  const k = E.keyOf(pair);
  const feed = { facades: { feed: [{ bin: 9000001, agent: pair }] } };
  const storeDoc = { [k]: own('harborviewpm.com/contact') };
  storeDoc[k].at = Date.now() - 27 * DAY;
  const snapshot = JSON.stringify(storeDoc);
  const w = web({ 'https://harborviewpm.com/contact': html('<p>(718) 402-3316</p>') });

  rmSync(CACHE, { force: true });
  E.reloadContactCache();
  let writes = 0;
  const dry = await R.runRecheck({
    feed,
    readJson: async () => JSON.parse(snapshot),
    writeJson: async () => {
      writes++;
    },
    fetchImpl: w.fetchImpl,
    dryRun: true,
  });
  assert.equal(dry.results.length, 1, 'the dry run does run the check');
  assert.equal(dry.results[0].outcome, 'confirmed');
  assert.equal(writes, 0, 'a dry run never writes to the store');
  assert.ok(!existsSync(CACHE), 'nor to the local cache');
  assert.equal(E.contactCache()[k], undefined, 'nor into the cache this process serves from');

  // The real thing: one write for a pass that changed something...
  let store = JSON.parse(snapshot);
  const readJson = async () => JSON.parse(JSON.stringify(store));
  const writeJson = async (_, d) => {
    writes++;
    store = JSON.parse(JSON.stringify(d));
  };
  const run = await R.runRecheck({ feed, readJson, writeJson, fetchImpl: w.fetchImpl });
  assert.equal(run.results[0].outcome, 'confirmed');
  assert.equal(writes, 1);
  assert.ok(store[k].checkedAt > 0);
  // ...and none for the next hour's run, which finds nothing due.
  const next = await R.runRecheck({ feed, readJson, writeJson, fetchImpl: w.fetchImpl });
  assert.equal(next.results.length, 0);
  assert.equal(writes, 1, 'a run with nothing due writes nothing');
}

// ---- /status: a line with its counts, never an incident ------------------------
{
  const path = pathToFileURL(join(dir, 'health.json'));
  const h = H.recorder('hourly');
  h.note('socrata', { ok: true });
  H.writeHealth(h.finish({ outcome: 'ok' }), path);
  const r = H.recorder('hourly');
  r.note('contacts', { ok: false, error: 'the shared contact cache could not be read' });
  H.amendHealth(r.finish({ outcome: 'ok' }), { contacts: { fullPassAt: 123 } }, path);
  let doc = H.readHealth(path);
  assert.equal(doc.runs.length, 1, 'the re-check is not a second sweep');
  assert.equal(doc.last.sources.contacts.ok, false);
  assert.ok(!doc.incidents.some((i) => i.source === 'contacts'));
  // The next collector replaces `last` and keeps what the re-check carries.
  H.writeHealth(H.recorder('hourly').finish({ outcome: 'ok' }), path);
  doc = H.readHealth(path);
  assert.equal(doc.carry.contacts.fullPassAt, 123);
  // Folded as part of a run, it neither opens an incident nor explains a stop.
  const q = H.recorder('hourly');
  q.note('contacts', { ok: false, error: 'x', detail: { confirmed: 3 } });
  assert.equal(q.sources.contacts.detail.confirmed, 3);
  const inc = H.foldIncidents([], q.finish({ outcome: 'upstream' }));
  assert.ok(!inc.some((i) => i.source === 'contacts'));
  assert.ok(inc.some((i) => i.source === 'run'), 'a failing re-check line explained a stop');
}

rmSync(dir, { recursive: true, force: true });
console.log('test-recheck: a card keeps a number only while its page still vouches for it');
