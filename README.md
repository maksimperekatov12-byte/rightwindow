# Right Window

**Reads New York City's public records hourly and tells businesses who needs their services this week — with the deadline, the contact, and the reason to call.**

Live: **[rightwindow.vercel.app](https://rightwindow.vercel.app)**

---

## The idea

Every register the city publishes marks the moment a business turns into a buyer. A facade
deadline arrives with a fine meter attached. A building sells, and the new owner rebuilds the
vendor list. A contractor wins a city contract and has two weeks to line up bonding, crews and
equipment. A restaurant files for a liquor license and picks its POS, insurance and suppliers
before the doors ever open.

Those moments are public. Almost nobody reads them.

Right Window reads them for you, decides which ones belong to *your* trade, and hands you a
ranked feed: the address or company, the legal deadline behind the urgency, the decision-maker's
contact, and a ready-to-send opener.

It is not a list of leads. It is a list of **windows** — with the clock showing.

---

## What it does

**Pick what you sell.** Fifteen trades: facade engineering, restoration, elevator service,
insurance and bonding, C-PACE lending, equipment rental, property management, code attorneys,
CRE brokerage, staffing, POS, food and beverage, marketing, signage.

**Get only your windows.** The profile decides which registers you see, how the feed is ranked,
and what every card says. An elevator company never sees a POS signal, and vice versa.

**Every card answers four questions.**

| Section | Answer |
|---|---|
| Why now | the event, the deadline, the penalty meter — with an urgency score |
| Why it matches you | what this building or company needs *from your trade* |
| Source | which city register, and the date that register was last updated |
| Next action | the decision-maker, a ready opener, and a link to the city's own record |

**Shared and personal signals.** The open pool is visible to everyone: a green dot means nobody
has claimed it, amber means someone is already working it. On top of that, each user holds up to
three **personal** signals — exclusive for 48 hours, pinned to the top of the feed. Untouched,
they rotate to someone else.

**Track what happens.** Contacted, won, lost, dismissed. Watchlist, CSV export, deep links to a
single card, an optional daily email digest, and a self-updating Apple Wallet pass.

---

## The eight signal chains

Every chain is a rule written from domain knowledge, not a keyword match. That distinction is
the product: a scraper sees a row; the chain knows what the row means and when it expires.

| Chain | Event | Window it opens |
|---|---|---|
| No Cycle 10 filing | FISP facade report missing inside an open sub-cycle | building needs an engineer; $1,000/mo meter after the deadline |
| Open SWARMP | unsafe-but-not-yet-unsafe conditions carried from Cycle 9 | mandatory repair before the next filing |
| UNSAFE on file | facade declared unsafe | sidewalk shed and repairs, not optional |
| Fresh violation | DOB/ECB violation issued in the last 120 days | certified correction, often with a hearing date |
| Just sold | deed recorded in ACRIS | new owner rebuilds every vendor relationship |
| Management changed | HPD registration flipped | same reset, days after it happens |
| Elevator tests due | active devices with no CAT1 this year, or CAT5 overdue | tests must be filed by December 31 |
| Contract awarded / venue filing | city award or liquor-license application | mobilization and build-out purchasing |

Amplifiers: unpaid ECB balances, scheduled OATH hearings, expiring sidewalk-shed permits.

Current coverage: **12,352** buildings off the compliance calendar across Manhattan, Brooklyn,
Queens and the Bronx — of which **4,791** are unfiled for sub-cycle 10A with six months left.

---

## Data honesty

Every source passes a written license gate before a single request is made
([`data/source-policy.json`](data/source-policy.json)). A source without a recorded verdict and
license does not get collected — the collector throws rather than guesses.

The ACRIS web portal is marked **DENIED**: the city's own Bandwidth Policy prohibits robots and
points to the City Register's paid subscription feed instead. So deeds come from the monthly
open-data batch, and management changes are watched daily through HPD. No scraping, no evasion.

Freshness is the city's, not ours — so the app shows it per source, on every card and in the
footer, rather than promising "real time":

```
DOB NOW 2026-08-26 · ECB 2026-08-26 · elevators 2026-08-26 · awards 2026-08-26
SLA 2026-08-26 · HPD registrations 2026-08-12 · ACRIS deeds through 2026-07-31
```

Nothing about a private individual is collected or shown. The subjects are buildings and
companies: **buildings, not people.**

---

## How it runs

```
every 10 min   fast lane      contract awards + liquor filings, heartbeat, personal-signal rotation
every hour     full collect   all eight chains, HPD contact join, what's-new memory
every morning  digest         personalized email, only when something new matches you
```

Collection runs in GitHub Actions and commits the rebuilt feed; Vercel deploys on the commit.
The site polls a heartbeat endpoint, so the header shows two honest numbers — when we last
checked, and when data last changed.

---

## Stack

React + Vite + Motion on the front. Plain Node collectors, no framework. Vercel serverless
functions with a private Blob store for claims, personal assignments and preferences. Apple
Wallet passes via `passkit-generator` and APNs over HTTP/2.

```bash
npm install
npm run collect     # rebuild src/data/feed.json from live city APIs (~3 min)
npm run dev         # http://localhost:5205
```

Docs: [`docs/NOTIFY.md`](docs/NOTIFY.md) for the email digest, [`wallet/README.md`](wallet/README.md)
for the Apple Wallet pass.

---

## Where this comes from

The same engine runs in production in two unrelated industries: a sales-trigger product on
Kyrgyzstan's procurement and company registers, and a timing system that predicts when a film or
TV production reaches its music-licensing window. New York is the third instance — a bigger
register, the same machine.

Built by [Maxim Perekatov](mailto:maxim122090@gmail.com). Pilots are open.
