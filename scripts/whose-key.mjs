// Which service issued this key?
//
// serper.dev and serpapi.com both hand out 64 hexadecimal characters, and the
// names differ by two letters — a key from one was pasted as the other and
// produced a clean run of 403s that looked like a broken pipeline rather than
// a wrong provider. This asks each service once, with the cheapest query it
// accepts, and prints the answer. It never prints the key.
//
//     node --env-file=.env.enrich scripts/whose-key.mjs
const key = process.env.ENRICH_API_KEY || '';
if (!key) {
  console.error('No ENRICH_API_KEY in the environment.');
  process.exit(1);
}

const probes = [
  ['serper', 'https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': key, 'content-type': 'application/json' }, body: JSON.stringify({ q: 'test' }) }],
  ['serpapi', `https://serpapi.com/search.json?engine=google&q=test&api_key=${encodeURIComponent(key)}`, {}],
  ['brave-search', 'https://api.search.brave.com/res/v1/web/search?q=test', { headers: { 'X-Subscription-Token': key, accept: 'application/json' } }],
];

let winner = null;
for (const [id, url, opt] of probes) {
  try {
    const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(20000) });
    console.log(`${id.padEnd(13)} ${r.status}${r.ok ? '  ← this one' : ''}`);
    if (r.ok && !winner) winner = id;
  } catch (e) {
    console.log(`${id.padEnd(13)} network: ${String(e.message).slice(0, 50)}`);
  }
}

if (!winner) {
  console.log('\nNo service accepted this key. Check it was copied whole, and that the account is active.');
  process.exit(1);
}
console.log(`\nProvider: ${winner}. Add this line to .env.enrich (next to the key):\n  ENRICH_PROVIDER=${winner}`);
