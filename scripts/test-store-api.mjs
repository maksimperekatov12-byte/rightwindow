// The write endpoints are unauthenticated and the store behind them is one
// shared document per collection, so the limits that keep a script from
// wrecking it are worth a build failure if they regress. Offline: @vercel/blob
// is swapped for an in-memory stand-in that keeps the SDK's documented list()
// contract — at most 1,000 per page, then hasMore and a cursor.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Readable } from 'node:stream';

const STUB = `
const S = (globalThis.__rwBlob ||= { docs: new Map(), lists: 0 });
export async function get(pathname) {
  if (!S.docs.has(pathname)) return null;
  return { statusCode: 200, stream: new Response(S.docs.get(pathname)).body };
}
export async function put(pathname, body) { S.docs.set(pathname, String(body)); return { pathname }; }
export async function del(pathname) { S.docs.delete(pathname); }
export async function list({ prefix = '', limit = 1000, cursor } = {}) {
  S.lists++;
  const all = [...S.docs.keys()].filter((p) => p.startsWith(prefix)).sort();
  const from = cursor ? Number(cursor) : 0;
  const page = all.slice(from, from + Math.min(limit, 1000));
  const hasMore = from + page.length < all.length;
  return { blobs: page.map((pathname) => ({ pathname })), hasMore, ...(hasMore ? { cursor: String(from + page.length) } : {}) };
}`;
const HOOKS = `
export async function resolve(spec, ctx, next) {
  if (spec === '@vercel/blob') return { url: 'rw-test:blob', shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === 'rw-test:blob') return { format: 'module', source: ${JSON.stringify(STUB)}, shortCircuit: true };
  return next(url, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(HOOKS));

// A small cap keeps the run fast; it is read when the module loads.
process.env.CLAIMS_PER_IP_PER_DAY = '5';
const S = (globalThis.__rwBlob ||= { docs: new Map(), lists: 0 });
const { listJson } = await import('../lib/store.mjs');
const claims = (await import('../api/claims.js')).default;
const prefs = (await import('../api/prefs.js')).default;

// `open` leaves the request unfinished after its body, which is what a real
// client still sending looks like once the handler has destroyed the socket:
// no 'end' ever comes.
const call = (handler, { method = 'POST', body, raw, ip, open = false } = {}) =>
  new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.push(raw ?? JSON.stringify(body ?? {}));
    if (!open) req.push(null);
    req.method = method;
    req.headers = ip ? { 'x-real-ip': ip } : {};
    req.query = {};
    // A handler that never answers is the bug an oversize body used to cause.
    const timer = setTimeout(() => reject(new Error(`${method} never answered`)), 3000);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      setHeader() {},
      json(j) { done({ code: this.code, json: j }); },
      end() { done({ code: this.code }); },
    };
    handler(req, res);
  });
const uid = (n) => n.toString(16).padStart(36, '0');

// ---- listJson pages past 1,000 --------------------------------------------
for (let i = 0; i < 2500; i++) S.docs.set(`events/2026-10-08/${String(i).padStart(5, '0')}.json`, '{}');
for (let i = 0; i < 3; i++) S.docs.set(`pilots/${i}.json`, '{}');
S.lists = 0;
assert.equal((await listJson('events/')).length, 2500, 'listJson must page past the first 1,000');
assert.equal(S.lists, 3);
S.lists = 0;
assert.equal((await listJson('pilots/')).length, 3);
assert.equal(S.lists, 1, 'below one page it is still one list() call');

// ---- claims: capped per source address --------------------------------------
const A = '203.0.113.7';
for (let i = 0; i < 5; i++) {
  const r = await call(claims, { ip: A, body: { uid: uid(i + 1), key: `b:${1000 + i}` } });
  assert.equal(r.code, 201, `claim ${i + 1} from one address should land`);
}
let r = await call(claims, { ip: A, body: { uid: uid(99), key: 'b:1999' } });
assert.equal(r.code, 429, 'a fresh uid does not reset the per-address cap');
r = await call(claims, { ip: A, body: { uid: uid(99), key: 'b:1000' } });
assert.equal(r.json.status, 'taken', 'a held card still answers taken, not a rate limit');
r = await call(claims, { ip: '198.51.100.4', body: { uid: uid(100), key: 'b:1999' } });
assert.equal(r.code, 201, 'another address is unaffected');

// An IPv6 client walks its /64 for free, so the /64 is what is counted.
for (let i = 0; i < 5; i++)
  assert.equal((await call(claims, { ip: `2001:db8:1:2::${i + 1}`, body: { uid: uid(200 + i), key: `e:${i}` } })).code, 201);
r = await call(claims, { ip: '2001:db8:1:2:ffff:ffff:ffff:ffff', body: { uid: uid(210), key: 'e:9' } });
assert.equal(r.code, 429, 'a second address in the same /64 shares the cap');
r = await call(claims, { ip: '2001:db8:1:3::1', body: { uid: uid(211), key: 'e:9' } });
assert.equal(r.code, 201, 'the next /64 over does not');

// The source hash stays in the private document.
r = await call(claims, { method: 'GET' });
assert.ok(Object.values(r.json).every((v) => Object.keys(v).join() === 'at'), 'GET exposes only `at`');
const doc = JSON.parse(S.docs.get('claims.json'));
assert.ok(doc['b:1000'].src && doc['b:1000'].src !== doc['b:1999'].src);

// ---- prefs: no hang on an oversize body; a full document refuses NEW uids ----
r = await call(prefs, { raw: 'x'.repeat(70000), open: true });
assert.equal(r.code, 400, 'an oversize body is refused, not left hanging');
r = await call(claims, { raw: 'x'.repeat(6000), open: true });
assert.equal(r.code, 400, 'the same for a claim');

const secret = 's'.repeat(24);
assert.equal((await call(prefs, { body: { uid: uid(1), secret, data: { profile: 'qewi' } } })).code, 200);
const big = JSON.parse(S.docs.get('prefs.json'));
big.__ballast = 'x'.repeat(8e6);
S.docs.set('prefs.json', JSON.stringify(big));
r = await call(prefs, { body: { uid: uid(2), secret, data: { profile: 'qewi' } } });
assert.equal(r.code, 503, 'a new uid is refused once the document is past the breaker');
r = await call(prefs, { body: { uid: uid(1), secret, data: { profile: 'plumber' } } });
assert.equal(r.code, 200, 'an existing uid keeps saving');
assert.equal(JSON.parse(S.docs.get('prefs.json'))[uid(1)].profile, 'plumber');

console.log('test-store-api: listJson pages, claims are capped per address, prefs cannot grow without end');
