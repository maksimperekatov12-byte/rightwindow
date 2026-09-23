// What the two collectors publish has to be true and has to leave people's
// names out. These run in prebuild, offline, on fixture rows.
//
// The regressions that earned this file, all found live on 2026-09-23:
//  - the five-minute lane republished a liquour-licence applicant's name the
//    hourly build had withheld, and the site put it back on the card;
//  - its rows said "Kings" where the hourly said "Brooklyn", so the borough
//    chips lost every liquour venue in Manhattan and Staten Island, and an
//    application received in July wore a New badge;
//  - its "what's new" count replaced the hourly 80 venue filings with 2;
//  - an award whose amount was its PIN read as an $857B contract;
//  - the affiliate evidence spelled out a head officer's name on 55 public cards.
import assert from 'node:assert/strict';
import { carryIdentities } from '../lib/personal.mjs';
import { resolveAffiliates, VIA_EVIDENCE } from '../lib/affiliate.mjs';
import { slaRow, slaQuery, plausibleAward, isNewOpening, isNewAward, newAcross, BOROUGH_OF } from '../lib/notices.mjs';

const NOW = new Date('2026-09-23T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

// ---- identity: the hourly verdict carries; an unseen name needs evidence ----
{
  const hourly = [
    { id: 'NA-1', nameShown: false, evidence: [], identity: 'New restaurant at 19 Main St' },
    { id: 'NA-2', nameShown: true, evidence: ['suffix'], name: 'BLUE HERON BAKERY LLC' },
  ];
  const rows = [
    // Withheld by the hourly build: stays withheld, whatever this lane thinks.
    { id: 'NA-1', name: 'BLUE HERON BAKERY LLC', legal: 'BLUE HERON BAKERY LLC', kind: 'Restaurant', address: '19 Main St, Brooklyn' },
    { id: 'NA-2', name: 'BLUE HERON BAKERY LLC', legal: 'BLUE HERON BAKERY LLC', kind: 'Restaurant', address: '5 Elm St, Queens' },
    // Not seen by the hourly build: a forename and a surname with nothing behind them.
    { id: 'NA-3', name: 'JOHN SMITH', legal: 'JOHN SMITH', kind: 'Restaurant', address: '7 Oak Ave, Bronx' },
    // Not seen either, but the legal name filed alongside is a company.
    { id: 'NA-4', name: 'MARIA LOPEZ', legal: 'LOPEZ HOSPITALITY LLC', kind: 'Tavern', address: '9 Pine St, Manhattan' },
  ];
  carryIdentities(rows, hourly);
  const [a, b, c, d] = rows;
  assert.equal(a.nameShown, false);
  assert.ok(!('name' in a) && !('legal' in a), 'a name the hourly build withheld must not be republished');
  assert.equal(a.identity, 'New restaurant at 19 Main St');
  assert.equal(b.nameShown, true);
  assert.equal(b.name, 'BLUE HERON BAKERY LLC');
  assert.equal(c.nameShown, false);
  assert.ok(!('name' in c) && !('legal' in c), 'an unvouched name the hourly build has not judged must not be published');
  assert.equal(c.identity, 'New restaurant at 7 Oak Ave');
  assert.equal(d.nameShown, true);
  assert.deepEqual(d.evidence, ['entity']);
}

// ---- the SLA row: the hourly build's field names and borough names ----------
{
  const raw = {
    application_id: 'NA-9',
    premises_county: 'Kings',
    description: 'On Premises Liquor',
    legalname: 'X LLC',
    dba: 'X',
    actual_address_of_premises: '1 Court St',
    city: 'Brooklyn',
    zip_code: '11201-1234',
    received_date: '2026-09-20T00:00:00.000',
  };
  const r = slaRow(raw, NOW);
  assert.equal(r.county, 'Brooklyn', 'the liquour file says Kings; the register says Brooklyn');
  assert.equal(slaRow({ ...raw, premises_county: 'New York' }, NOW).county, 'Manhattan');
  assert.equal(slaRow({ ...raw, premises_county: 'Richmond' }, NOW).county, 'Staten Island');
  assert.equal(r.src, 'sla');
  assert.equal(r.zip, '11201');
  assert.equal(r.received, '2026-09-20');
  for (const v of Object.values(BOROUGH_OF)) assert.equal(BOROUGH_OF[v], v, `${v} must map to itself`);
  const where = slaQuery(NOW).get('$where');
  assert.match(where, /status in\('IntakeComplete','Under Review'\)/);
  assert.match(slaQuery(NOW).get('$order'), /application_id/, 'ties are cut the same way in both lanes');
}

// ---- New: first seen this week AND a city date inside the week --------------
{
  // Seen for the first time today, received in July: not new.
  assert.equal(isNewOpening(NOW.toISOString(), '2026-07-02', NOW), false);
  assert.equal(isNewOpening(daysAgo(1), '2026-09-20', NOW), true);
  // First seen eight days ago: not new, however recent the city's date.
  assert.equal(isNewOpening(daysAgo(8), '2026-09-22', NOW), false);
  assert.equal(isNewOpening('baseline', '2026-09-22', NOW), false);
  // A venue permit carries no date; first-seen is all there is.
  assert.equal(isNewOpening(daysAgo(2), null, NOW), true);
  assert.equal(isNewAward(daysAgo(1), '2026-09-01', NOW), false);
  assert.equal(isNewAward(daysAgo(1), '2026-09-21', NOW), true);
}

// ---- the header count covers the register the site shows --------------------
{
  const hourly = [
    ...Array.from({ length: 78 }, (_, i) => ({ id: `dohmh-${i}`, isNew: true })),
    { id: 'NA-1', isNew: true },
    { id: 'NA-2', isNew: false },
    { id: 'NA-3', isNew: false },
  ];
  const fast = [{ id: 'NA-1', isNew: false }, { id: 'NA-2', isNew: true }, { id: 'NA-3' }, { id: 'NA-4', isNew: true }];
  // 78 permits + NA-2 and NA-4 from this lane; NA-1 is overridden; NA-3 keeps the hourly verdict.
  assert.equal(newAcross(hourly, fast), 80);
  assert.equal(newAcross(undefined, fast), 2);
}

// ---- an award amount that is really the PIN never reaches a card ----------
{
  const a = { vendor_name: 'V', contract_amount: '857240030004', pin: '85724B0030004' };
  assert.equal(plausibleAward(a), false, 'the PIN with its letter dropped is not an amount');
  assert.equal(plausibleAward({ vendor_name: 'V', contract_amount: '96110045003001' }), false, 'no award is $96 trillion');
  assert.equal(plausibleAward({ vendor_name: 'V', contract_amount: '3984820000', pin: '85024I8008KXL' }), true);
  assert.equal(plausibleAward({ vendor_name: 'V', contract_amount: '250000', pin: '05727O0003001' }), true);
  assert.equal(plausibleAward({ vendor_name: 'V', contract_amount: '99999' }), false);
  assert.equal(plausibleAward({ contract_amount: '250000' }), false);
}

// ---- the affiliate evidence names the tie, not the person -------------------
{
  const officer = 'JANE Q EXAMPLE';
  const cards = [
    { agent: { company: 'OPERATOR MGMT CORP', headOfficer: officer, phone: '+1-646-480-7021', contactSource: 'operator.example' } },
    { agent: { company: 'HOLDING 12 LLC', headOfficer: officer } },
  ];
  assert.equal(resolveAffiliates(cards), 1);
  const a = cards[1].agent;
  assert.equal(a.confidence, 'affiliate');
  assert.equal(a.viaEvidence, VIA_EVIDENCE);
  assert.ok(!/JANE|EXAMPLE/i.test(a.viaEvidence), 'the head officer must not ride along in the evidence');
}

console.log('test-publish: both lanes publish the same rows, without the names they withheld');
