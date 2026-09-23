// A directory page vouches for a number only when it shows where the city says
// the firm is. These run in prebuild, offline, against fixture pages.
//
// The regression that earned this file: the slide-3 building's managing agent
// files with HPD at 118-09 83rd Ave, Kew Gardens 11415, and the number on its
// card came off a directory listing for a firm of the same name in East Meadow,
// Nassau County. Nothing but the name tied the two.
//
// The numbers below are made up for the fixtures and belong to nobody we know.
import assert from 'node:assert/strict';
import { acceptPage, pageShowsAddress } from '../lib/enrich.mjs';

const company = 'IMPERIAL CONSULTING GROUP';
const address = '118-09 83RD AVE, KEW GARDENS NY 11415';

const page = (lines) => lines.join('\n');

// The same name in another town: a directory page for it is not evidence.
const otherTown = page([
  'Imperial Consulting Group',
  'Mold assessment and general contracting',
  '2400 Hempstead Tpke, East Meadow, NY 11554',
  'Call (646) 480-7021',
]);
assert.equal(
  acceptPage({ company, address, url: 'https://www.yellowpages.com/east-meadow-ny/mip/imperial-consulting-group', page: otherTown }),
  null,
  'a same-name firm in another town must not pass as the agent',
);

// The same listing where it shows the filing's street: accepted, as 'listed'.
const sameStreet = page(['Imperial Consulting Group', '118-09 83rd Avenue', 'Queens, New York', 'Call (646) 480-7021']);
const listed = acceptPage({ company, address, url: 'https://www.yellowpages.com/queens-ny/mip/imperial-consulting-group', page: sameStreet });
assert.equal(listed?.confidence, 'listed');
assert.equal(listed?.phone, '+1-646-480-7021');
assert.equal(listed?.email, null, 'a directory never vouches for a mailbox');

// The filing's ZIP alone ties it too.
assert.ok(pageShowsAddress(page(['Imperial Consulting Group', 'Kew Gardens, NY 11415']), address));
// A ZIP inside a longer run of digits is not that ZIP.
assert.ok(!pageShowsAddress(page(['Ref 7181141500', 'East Meadow, NY 11554']), address));
// The same street spelled another way still matches; another street does not.
assert.ok(pageShowsAddress('118-09 83rd Ave, Queens', address));
assert.ok(pageShowsAddress('20 West 34th Street', '20 W 34TH ST, NEW YORK NY 10001'));
assert.ok(!pageShowsAddress('118-09 84th Ave, Queens', address));
// A short address must not match any "5 3" a page happens to contain.
assert.ok(!pageShowsAddress('Rated 4.5 3 reviews · Brooklyn NY 11201', '5 3RD AVE, NEW YORK NY 10003'));
// No address on the filing, no tie: fail closed.
assert.equal(acceptPage({ company, address: null, url: 'https://www.bbb.org/us/ny/imperial', page: sameStreet }), null);
assert.ok(!pageShowsAddress(sameStreet, ''));

// The firm's own domain is its own word, wherever the page says it is.
const own = acceptPage({ company, address, url: 'https://imperialconsultinggroup.com/contact', page: otherTown });
assert.equal(own?.confidence, 'verified');

// A directory the policy has not listed is not evidence at all, tie or no tie.
assert.equal(
  acceptPage({ company, address, url: 'https://nextdoor.com/pages/imperial-consulting-group-east-meadow-ny', page: otherTown }),
  null,
);
assert.equal(
  acceptPage({ company, address, url: 'https://nextdoor.com/pages/imperial-consulting-group-kew-gardens-ny', page: sameStreet }),
  null,
);

console.log('test-enrich-accept: directory numbers need the filing\'s address');
