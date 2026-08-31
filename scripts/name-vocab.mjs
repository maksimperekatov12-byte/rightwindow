// The city already labels entities for us. DCWP issues 17,179 licences to an
// "Individual" and 55,273 to a "Premises", and prints the name on both. That is
// a free, public, and checkable training set for the one question the openings
// register needs answered: is this name a person or a business?
const page = async (type) => {
  const out = [];
  for (let off = 0; ; off += 50000) {
    const u = `https://data.cityofnewyork.us/resource/w7w3-xahh.json?$select=business_name&$where=license_type='${type}'&$limit=50000&$offset=${off}&$order=:id`;
    const r = await fetch(u);
    const j = await r.json();
    out.push(...j.map((x) => (x.business_name || '').trim()).filter(Boolean));
    if (j.length < 50000) break;
  }
  return out;
};
const [people, premises] = await Promise.all([page('Individual'), page('Premises')]);
console.log('individual names:', people.length, '| premises names:', premises.length);

const toks = (s) => (s.toUpperCase().match(/[A-Z]{2,}/g) || []);
const count = (arr) => { const m = new Map(); for (const s of arr) for (const t of new Set(toks(s))) m.set(t, (m.get(t) || 0) + 1); return m; };
const P = count(people), B = count(premises);

// A token is a person-token when it shows up in individual names and is rare in
// premises names, normalised for how much bigger the premises file is.
const scale = premises.length / people.length;
const person = [], business = [];
for (const [t, n] of P) {
  if (n < 3) continue;
  const b = (B.get(t) || 0) / scale;
  if (b < n * 0.25) person.push(t);
}
for (const [t, n] of B) {
  if (n < 20) continue;
  const p = (P.get(t) || 0) * scale;
  if (p < n * 0.25) business.push(t);
}
console.log('person tokens:', person.length, '| business tokens:', business.length);
console.log('sample person :', person.slice(0, 25).join(' '));
console.log('sample business:', business.slice(0, 25).join(' '));
const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/vocab.json', JSON.stringify({ person, business }));
