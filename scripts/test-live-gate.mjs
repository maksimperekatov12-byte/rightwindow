// /api/live answers anyone, with no uid, in one edge-cached GET, and it merges
// the private contact store into that answer. The store holds every resolved
// row ungated, and before gateStored() existed the response carried 175
// mailboxes the project's own gate calls personal, 18 via notes naming someone
// and 3 rows naming a person. These run in prebuild, on made-up rows — nothing
// here reads the real store.
import assert from 'node:assert/strict';
import { gateStored } from '../api/live.js';
import { republishableEmail, namesAPerson } from '../lib/provenance.mjs';
import { isPersonToken, looksPersonal } from '../lib/personal.mjs';

const stored = {
  // A directory-tier row with a personal inbox and a person as the via note:
  // the phone is a disclosed product choice and stays; the rest goes.
  1000001: {
    phone: '+1-212-555-0101',
    email: 'jsmith1970@gmail.com',
    confidence: 'listed',
    source: 'yelp.com listing',
    via: 'Joseph Popack',
  },
  // The firm's own role inbox publishes, and a via note is cut back to the firm.
  // The day its number was last seen on its page rides along, as a date.
  1000002: {
    phone: '+1-212-555-0102',
    email: 'info@acmeproperty.com',
    confidence: 'verified',
    source: 'acmeproperty.com/contact',
    via: 'Acme Property Management (the firm that runs the building)',
    checkedAt: '2026-09-24',
  },
  // A person named in the source prose sinks the row; the card falls back to
  // its branch copy.
  1000003: {
    phone: '+1-212-555-0103',
    email: null,
    confidence: 'listed',
    source: 'nyscar.org member profile 60314102 (Brandon Yasgur, Principal, YRC Management, 825 E. 233rd St, Bronx NY 10466)',
  },
  // An initial and a surname on the firm's domain is a person, and with no
  // phone there is nothing left to show.
  1000004: { phone: null, email: 'mgrant@acmeproperty.com', confidence: 'verified', source: 'acmeproperty.com' },
  // A domain that is itself somebody's name makes contact@ personal too.
  1000005: { phone: '+1-212-555-0105', email: 'contact@josephpopack.com', confidence: 'weird', source: 'josephpopack.com' },
  // A person hiding behind a verb in the via note.
  1000006: { phone: '+1-212-555-0106', email: 'office@acmeproperty.com', confidence: 'listed', source: 'bbb.org', via: 'contact Isack Hagar' },
  // Everything that ends up in a tel: or a mailto: has to be the right shape.
  1000007: { phone: 'javascript:alert(1)', email: 'info@x"onmouseover.com', confidence: 'listed' },
  // A checkedAt that is not a date, and the cache's private fields, go nowhere.
  1000008: {
    phone: '+1-212-555-0108',
    email: null,
    confidence: 'verified',
    source: 'acmeproperty.com',
    checkedAt: '<img src=x onerror=alert(1)>',
    url: 'https://acmeproperty.com/contact',
    was: { phone: '+1-212-555-0199' },
  },
  abc: { phone: '+1-212-555-0199' },
  1000009: null,
};
const branch = {
  1000003: { phone: '+1-212-555-0133', email: null, confidence: 'verified', source: 'hpd.nyc.gov' },
};

const out = gateStored(stored);

// The two the brief names outright: a personal mailbox and a person in `via`.
assert.equal(out[1000001].email, null, 'a gmail inbox must not leave the store');
assert.equal(out[1000001].phone, '+1-212-555-0101', 'the directory phone survives the gate');
assert.ok(!('via' in out[1000001]), 'a via note that is a person is dropped');
assert.ok(!('via' in out[1000006]), 'a via note that names a person is dropped');
assert.equal(out[1000006].phone, '+1-212-555-0106', 'a name in via costs the note, not the phone');

assert.equal(out[1000002].email, 'info@acmeproperty.com');
assert.equal(out[1000002].checkedAt, '2026-09-24', 'the day a number was last seen on its page reaches the card');
assert.ok(!('checkedAt' in out[1000008]), 'a checkedAt that is not a date is dropped');
assert.ok(!('url' in out[1000008]) && !('was' in out[1000008]), "the cache's private fields never leave the store");
assert.equal(out[1000002].via, 'Acme Property Management');
assert.equal(out[1000005].email, null);
assert.equal(out[1000005].confidence, 'listed', 'an unknown confidence reads as the weakest tier');
for (const bin of ['1000003', '1000004', '1000007', 'abc', '1000009']) assert.ok(!(bin in out), `${bin} must not pass`);

// Fail closed: a stored row the gate rejects leaves the vetted branch row alone.
const merged = { ...branch, ...gateStored(stored) };
assert.deepEqual(merged[1000003], branch[1000003]);

// And the invariant itself, over everything that came out.
for (const [bin, r] of Object.entries(out)) {
  assert.deepEqual(
    Object.keys(r).filter((k) => !['phone', 'email', 'confidence', 'source', 'via', 'checkedAt'].includes(k)),
    [],
    `${bin} carries a field the browser never needs`,
  );
  if (r.email) assert.ok(republishableEmail(r.email, isPersonToken, looksPersonal), `${bin} personal mailbox`);
  for (const v of Object.values(r)) assert.ok(!(typeof v === 'string' && namesAPerson(v, looksPersonal)), `${bin} names a person`);
}

// Nothing in, nothing out — the store blinking must not throw.
assert.deepEqual(gateStored(null), {});
assert.deepEqual(gateStored('nonsense'), {});

console.log('test-live-gate: the private store reaches browsers only through the publication gate');
