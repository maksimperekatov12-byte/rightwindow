import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue, lazy, Suspense } from 'react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion, animate } from 'motion/react';
import data from './data/feed.json';
import MapSkeleton from './MapSkeleton.jsx';
import DataPage from './Data.jsx';
import { NO_LESSON, reasonsFor, reasonsForFeed, rulesFrom, taughtAway as taughtBy, describeRules, title } from './learn.js';
import { resolveDealBasis, defaultCapacity, medianOf, PERFORMS_WORK } from '../lib/deal-basis.mjs';
import TradesPage from './Trades.jsx';

const YEAR = new Date().getFullYear();

// One place for how people reach Maxim. Add PHONE when there is a US number.
const CONTACT = {
  name: 'Maxim Perekatov',
  // Inbound on the product's own domain (forwarded), not a personal mailbox in
  // the markup of a site whose thesis is professional data hygiene.
  email: 'hello@rightwindow.nyc',
  phone: '', // e.g. '+1 (917) 555-0134' — shown as a tap-to-call link when set
};
const byUrgency = (a, b) => b.urgencyScore - a.urgencyScore || a.monthsLeft - b.monthsLeft;
const has = (c, kind) => c.signals.some((s) => s.kind === kind);
const rank = (c, kind) => c.signals.find((x) => x.kind === kind)?.urgency ?? 0;
const money = (n) => '$' + n.toLocaleString('en-US');

// The City Record carries three kinds of notice and they ask for different
// things. An award names the firm that already took the money, so you sell to
// it. A solicitation names an agency that wants bids by a date, so the window
// is still open and the contact printed on it is the officer to ask. An intent
// to award is the objection window on a sole-source deal — the shortest window
// in the product and the only one where saying nothing forfeits it.
const isOpenNotice = (c) => c.kind === 'SOLICITATION' || c.kind === 'INTENT';
const noticeLabel = (c) => (c.kind === 'INTENT' ? 'Intent to award' : 'Open for bids');

const CONSTR = /construction|architect|engineer/i;

function signalStory(c) {
  if (c.payingForNothing)
    return `Shed up ${Math.round(c.shed.ageDays / 30)} months and no repair filed — they pay for the shed, not the fix.`;
  if (c.filing?.stalled)
    return `Facade work filed ${usShort(c.filing.filed)} and approved, but no permit pulled — the project stalled.`;
  if (c.mgmtChange) return 'Registration just changed — new management or a quiet sale.';
  if (c.ownerChange)
    return `Sold ${usShort(c.ownerChange.recorded)}${c.ownerChange.amount ? ` for ${money(Math.round(c.ownerChange.amount))}` : ''} — the vendor list resets.`;
  if (c.freshHaz)
    return `Violation ${c.freshHaz.daysAgo} days ago${c.nextHearing ? `, hearing ${usShort(c.nextHearing)}` : ''} — correction is mandatory.`;
  if (has(c, 'NON_FILER') && c.monthsLeft <= 7)
    return `${c.monthsLeft} months to the ${c.subCycle} deadline, nothing filed. Then $1,000/month.`;
  if (has(c, 'SWARMP_CARRYOVER')) return 'Open SWARMP — presumed UNSAFE at the next filing.';
  if (has(c, 'UNSAFE_PRIOR')) return 'UNSAFE on file — shed and repairs are mandatory.';
  return `Off the ${c.subCycle} calendar — a forced-spend window with a legal deadline.`;
}

const GENERIC_FACADE = {
  // The explanatory sentence leads and the metaphor demotes to the eyebrow: a
  // stranger cannot decode "forced-spend window", and the line that says what
  // the product does was hiding underneath it.
  hero: 'Every building over six stories runs on a *public compliance clock*.',
  subline: 'We surface the ones that fell off it — with the deadline and the person to call.',
  eyebrow: 'Buildings in a forced-spend window',
  hint: 'Ranked by urgency — deadlines, fresh violations, ownership changes, penalty balances.',
  sort: byUrgency,
  why: (c) => signalStory(c),
  opener: (c) =>
    `Re: ${title(c.address)} — city records show mandated facade work ahead of the ${c.deadline} deadline. Worth a quick conversation before the penalty meter starts.`,
};

const PROFILES = {
  qewi: {
    cohorts: ['notReengaged', 'stalled', 'owes', 'callable'],
    mandates: {
      gas: (c) =>
        `${c.violations > 1 ? `${c.violations} open gas-piping violations` : 'An open gas-piping violation'} and the sub-cycle ${c.subCycle} deadline is ${usDate(c.deadline)} — the inspection has to be filed by a licensed master plumber.`,
      elevators: (c) =>
        `A skipped CAT1 cycle usually travels with the rest of a building's filings — the same owner is behind on more than the lift.`,
    },
    label: 'Facade engineer',
    tile: 'Facade engineering / inspections (QEWI)',
    facade: {
      hero: 'Buildings that need a facade engineer — *before they know it*',
      hint: 'Buildings with no engineer engaged for Cycle 10 — ranked by urgency, then by how little time is left.',
      sort: byUrgency,
      why: (c) => {
        const incumbent = c.filing?.who && c.priorQewi && c.filing.who.toUpperCase() === c.priorQewi.toUpperCase();
        if (incumbent) return `${title(c.priorQewi)} filed Cycle 9 and is back on the current job — a harder door.`;
        if (c.filing?.who) return `${title(c.filing.who)} is on the job filing, but no Cycle 10 report is on record.`;
        return `${title(c.priorQewi || 'The last engineer')} filed Cycle 9 and has not been re-engaged.`;
      },
      opener: (c) =>
        `Re: ${title(c.address)} — DOB shows no Cycle 10 facade filing and the ${c.subCycle} deadline is ${c.deadline}. We can inspect this month, before the $1,000/mo penalty meter starts.`,
    },
    cNeed: (c) => `A ${money(c.amount)} construction award usually means inspections and special-inspection sign-offs down the line.`,
    cFilter: (c) => CONSTR.test(c.category || ''),
    oNeed: null,
  },
  restoration: {
    cohorts: ['paying', 'stalled', 'priced', 'shedEnd'],
    label: 'Restoration contractor',
    tile: 'Facade restoration / exterior repair',
    facade: {
      hero: 'Repair work *the law has already sold* for you',
      hint: 'Open SWARMP and UNSAFE conditions — mandatory scopes, before they go out to bid.',
      sort: (a, b) =>
        rank(b, 'SWARMP_CARRYOVER') + rank(b, 'UNSAFE_PRIOR') - rank(a, 'SWARMP_CARRYOVER') - rank(a, 'UNSAFE_PRIOR') || byUrgency(a, b),
      why: (c) =>
        c.occupied
          ? `${c.filing?.who ? title(c.filing.who) : 'Someone'} is already on this scope — call only if you can take work over.`
          : c.filing
            ? `Filed ${usShort(c.filing.filed)} and still unpermitted — the scope is defined but nobody is building it.`
            : 'Mandatory scope, no contractor attached yet.',
      opener: (c) =>
        has(c, 'SWARMP_CARRYOVER')
          ? `Re: ${title(c.address)} — the open SWARMP from Cycle 9 becomes presumed-unsafe at the next filing. We can walk the scope and price it this week.`
          : has(c, 'UNSAFE_PRIOR')
            ? `Re: ${title(c.address)} — the facade is on file as UNSAFE, so the repair is mandatory. We can walk the scope and price it this week.`
            : `Re: ${title(c.address)} — city records show mandated facade work ahead of the ${c.deadline} deadline. We can walk the scope and price it this week.`,
    },
    cNeed: (c) => `${c.vendor} just took on ${money(c.amount)} of city work — subcontract scopes get placed in the first weeks.`,
    cFilter: (c) => CONSTR.test(c.category || ''),
    oNeed: null,
  },
  lender: {
    cohorts: ['priced', 'stalled', 'owes', 'sold'],
    mandates: {
      gas: () => `Open gas-piping violations are a mandatory-capex item a lender sees before the borrower raises it.`,
      carbon: (c) =>
        `A named Local Law 97 violation is forced capital work with a public record attached — the clearest reason a building needs money before it asks for it.`,
    },
    label: 'C-PACE / lender',
    tile: 'Financing (C-PACE, bridge, equipment)',
    facade: {
      hero: 'Forced capital projects, found *before the loan request*',
      hint: 'Mandatory capex with a fine meter — financeable projects that cannot be postponed.',
      sort: (a, b) => byUrgency(a, b) || (b.finesOwed || 0) + (b.ecbBalance || 0) - (a.finesOwed || 0) - (a.ecbBalance || 0),
      why: (c) => {
        const owed = (c.finesOwed || 0) + (c.ecbBalance || 0);
        return `${owed ? `${money(owed)} owed. ` : ''}Non-deferrable capex — financeable, with a legal reason to spend.`;
      },
      opener: (c) =>
        `Re: ${title(c.address)} — this building has city-mandated facade work ahead of the ${c.deadline} deadline. C-PACE can fund it before the penalty meter starts.`,
    },
    cNeed: (c) => `Mobilizing a ${money(c.amount)} contract takes working capital — payroll and equipment come before the city's first payment.`,
    oNeed: () => `Build-outs run on borrowed money — kitchen equipment and fit-out financing get arranged in exactly this window.`,
  },
  elevator: {
    cohorts: ['lifts', 'callable'],
    label: 'Elevator services',
    tile: 'Elevator service / modernization',
    facade: {
      hero: 'Elevators that missed a test — *not the ones running late*',
      hint: 'Buildings whose devices skipped a CAT1 cycle outright, or are due a five-year CAT5. Not filing yet this year is the calendar; skipping a year is the signal.',
      sort: (a, b) =>
        (b.elevator?.cat1Overdue || 0) + (b.elevator?.cat5Due || 0) - (a.elevator?.cat1Overdue || 0) - (a.elevator?.cat5Due || 0) ||
        byUrgency(a, b),
      why: (c) =>
        c.elevator
          ? `${c.elevator.cat1Overdue ? `${c.elevator.cat1Overdue}/${c.elevator.devices} skipped a CAT1 cycle` : ''}${c.elevator.cat1Overdue && c.elevator.cat5Due ? ', ' : ''}${c.elevator.cat5Due ? `${c.elevator.cat5Due} due for CAT5` : ''} — this year's filing still closes December 31.`
          : 'Forced-work windows usually bundle elevator capex.',
      opener: (c) =>
        c.elevator?.cat1Overdue
          ? `Re: ${title(c.address)} — DOB shows ${c.elevator.cat1Overdue} elevator device(s) that skipped a CAT1 cycle entirely. We can test and file both the missed one and this year's before December 31.`
          : `Re: ${title(c.address)} — DOB shows ${c.elevator?.cat5Due || 'several'} elevator device(s) with a five-year CAT5 coming due. We can test and file before the December 31 deadline.`,
      // A device that simply has not been tested yet this year is half the city
      // in August. Only a skipped cycle or a due CAT5 earns a card.
      fFilter: (c) => Boolean(c.elevator && (c.elevator.cat1Overdue > 0 || c.elevator.cat5Due > 0)),
    },
    mandates: {
      elevators: (c) =>
        `${c.devices === 1 ? 'One device' : `${c.devices} devices`} that last filed for ${c.lastCat1 || 'no year on record'} — a skipped cycle, so the backlog and this year's test are one visit.`,
    },
    cNeed: null,
    oNeed: null,
  },
  insurance: {
    cohorts: ['sold', 'shedEnd', 'priced'],
    label: 'Insurance / bonding',
    tile: 'Insurance / surety bonds',
    facade: {
      hero: 'Risk that just moved — and scopes that need *covering*',
      hint: 'New owners re-shop coverage; active violations raise liability; mandated work needs builder’s risk.',
      sort: (a, b) =>
        (b.ownerChange ? 3 : 0) + (b.freshHaz ? 2 : 0) - (a.ownerChange ? 3 : 0) - (a.freshHaz ? 2 : 0) || byUrgency(a, b),
      why: (c) =>
        c.ownerChange || c.mgmtChange
          ? 'New ownership re-shops every policy in year one.'
          : c.freshHaz || (c.ecbBalance || 0) > 0
            ? 'Open violations change the liability picture before renewal.'
            : 'Mandated facade work ahead — the scope needs builder\u2019s risk before it starts.',
      opener: (c) => {
        const violations = Boolean(c.freshHaz || (c.ecbBalance || 0) > 0);
        return `Re: ${title(c.address)} — city records show mandated facade work${violations ? ' and open violations' : ''}${
          c.ownerChange || c.mgmtChange ? ' under new ownership' : ''
        }. Worth reviewing coverage before the repair scope starts?`;
      },
    },
    cNeed: (c) => `${c.vendor} must post performance bonds and certificates of insurance before mobilizing ${money(c.amount)} of city work — usually within two weeks of the award.`,
    cOpener: (c) =>
      `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you need bonding or COIs lined up before mobilization, we can quote it this week.`,
    oNeed: () => `A new venue needs general liability and liquor liability before the doors open — and underwriting takes weeks.`,
    oOpener: (c) =>
      `Re: ${venueName(c)} — saw the license application for ${c.address}. GL and liquor liability take a few weeks to bind; we can have you covered before opening day.`,
  },
  pos: {
    label: 'POS / payments',
    tile: 'POS, payments, restaurant tech',
    facade: null,
    cNeed: null,
    oNeed: () => `POS and payments get chosen during build-out — before opening day, not after. This venue is deciding right now.`,
    oOpener: (c) =>
      `Re: ${venueName(c)} — saw the license application for ${c.address}. If you're still picking a POS, we can have you set up and trained before the doors open.`,
  },
  fnb: {
    label: 'F&B supplier',
    tile: 'Food and beverage supply',
    facade: null,
    cNeed: null,
    oNeed: () => `Opening menus are being costed right now — supplier lists lock in before the first delivery, not after.`,
    oOpener: (c) => `Re: ${venueName(c)} — saw the license application for ${c.address}. We supply venues like yours; happy to quote your opening order before the rush.`,
  },
  staffing: {
    label: 'Staffing',
    tile: 'Staffing / recruiting',
    facade: null,
    cNeed: (c) => `${c.vendor} needs crews to deliver ${money(c.amount)} of new work — hiring happens in the first weeks after an award.`,
    cOpener: (c) => `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you're staffing up to deliver, we can have vetted crews ready this month.`,
    oNeed: () => `A venue opening in 2–4 months hires its whole team in the last six weeks — the search starts now.`,
    oOpener: (c) => `Re: ${venueName(c)} — congrats on the upcoming opening at ${c.address}. We staff openings; want a bench of vetted candidates ready for your hiring window?`,
  },
  equipment: {
    cohorts: ['shedEnd', 'stalled', 'paying'],
    label: 'Equipment / access',
    tile: 'Equipment rental / scaffolding',
    facade: {
      hero: 'Mandated repairs that need *access equipment*',
      hint: 'SWARMP and UNSAFE scopes mean sheds, scaffolding and hoists — booked by whoever calls first.',
      sort: (a, b) =>
        rank(b, 'SWARMP_CARRYOVER') + rank(b, 'UNSAFE_PRIOR') + (b.shed ? 2 : 0) - rank(a, 'SWARMP_CARRYOVER') - rank(a, 'UNSAFE_PRIOR') - (a.shed ? 2 : 0) ||
        byUrgency(a, b),
      why: (c) =>
        c.payingForNothing
          ? 'Shed has been up over a year with no repair filed — that rental is running with nothing to show.'
          : 'Mandated exterior work means shed and scaffold — booked before the first brick moves.',
      opener: (c) =>
        `Re: ${title(c.address)} — city records show mandated facade work ahead. We can quote shed and scaffold access before the scope goes out to bid.`,
      fFilter: (c) => has(c, 'SWARMP_CARRYOVER') || has(c, 'UNSAFE_PRIOR') || Boolean(c.shed),
    },
    cNeed: (c) => `Delivering ${money(c.amount)} of new work usually means renting equipment in the first weeks — before the city's first payment lands.`,
    cFilter: (c) => CONSTR.test(c.category || ''),
    oNeed: null,
  },
  propmgmt: {
    cohorts: ['sold', 'owes', 'callable'],
    mandates: {
      gas: (c) => `The building has been carrying this violation for ${Math.round((c.openDays || 0) / 30)} months and owes another filing by ${usDate(c.deadline)}.`,
      elevators: (c) => `${c.devices === 1 ? 'The lift' : 'The lifts'} here skipped a test cycle outright, which is a management gap rather than a scheduling one.`,
      carbon: () => `An emissions report is the managing agent's filing, and this one is late enough that DOB has written it down.`,
    },
    label: 'Property management',
    tile: 'Property management',
    facade: {
      hero: 'Buildings that just changed hands — *before the management RFP*',
      hint: 'Sales and registration changes only: the window when owners re-bid the management contract.',
      sort: (a, b) => (b.mgmtChange ? 4 : 0) + (b.ownerChange ? 3 : 0) - (a.mgmtChange ? 4 : 0) - (a.ownerChange ? 3 : 0) || byUrgency(a, b),
      why: () => 'New owners review the management contract in year one — and this one carries open compliance work.',
      opener: (c) =>
        `Re: ${title(c.address)} — congratulations on the acquisition. The building carries open facade obligations; we manage compliance-heavy properties and can take this off your plate from day one.`,
      fFilter: (c) => Boolean(c.ownerChange || c.mgmtChange),
    },
    cNeed: null,
    oNeed: null,
  },
  legal: {
    cohorts: ['hearing', 'owes', 'callable'],
    mandates: {
      gas: (c) => `An uncured LL152 violation is an OATH matter with a penalty attached, and a second deadline lands ${usDate(c.deadline)}.`,
      elevators: () => `A skipped CAT1 cycle is what an elevator violation is written from — this is the stage before the hearing.`,
      carbon: () => `Local Law 97 penalties are assessed per tonne over the cap, and the unfiled report is the first thing to answer.`,
    },
    label: 'Code attorney / expeditor',
    tile: 'Code attorneys / expeditors',
    facade: {
      hero: 'Hearings on the calendar, *violations on the clock*',
      hint: 'Buildings with OATH hearings ahead, fresh violations, unpaid balances or an UNSAFE order — clients with a date.',
      sort: (a, b) =>
        (b.nextHearing ? 4 : 0) + (b.freshHaz ? 2 : 0) - (a.nextHearing ? 4 : 0) - (a.freshHaz ? 2 : 0) ||
        (b.ecbBalance || 0) - (a.ecbBalance || 0),
      why: (c) =>
        c.nextHearing
          ? `Hearing ${usShort(c.nextHearing)} — representation decides what it costs.`
          : c.ecbBalance
            ? `${money(c.ecbBalance)} unpaid — dismissals and settlements are on the table.`
            : 'Active violations need certified correction.',
      opener: (c) =>
        `Re: ${title(c.address)} — city records show ${c.nextHearing ? `an OATH hearing on ${c.nextHearing}` : 'open violations with penalties accruing'}. We handle cures, dismissals and hearings; worth 15 minutes before the date?`,
      fFilter: (c) => Boolean(c.nextHearing || c.freshHaz || (c.ecbBalance || 0) > 0 || has(c, 'UNSAFE_PRIOR')),
    },
    cNeed: null,
    oNeed: null,
  },
  cre: {
    mandates: {
      gas: (c) => `An open gas-piping violation on a building you already farm — a reason to call that is not "are you selling?".`,
      carbon: () => `A named Local Law 97 violation is a capital bill the owner has not budgeted for, which is the polite version of motivated.`,
    },
    cohorts: ['wholeBuilding', 'owes', 'sold'],
    label: 'CRE broker / investor',
    tile: 'CRE brokerage / investment',
    facade: {
      hero: 'Owners under compliance pressure — *before they list*',
      hint: 'Penalty balances, mandated capex and hearings — the polite word is “motivated”.',
      sort: (a, b) =>
        (b.ecbBalance || 0) + (b.finesOwed || 0) + (b.freshHaz ? 50000 : 0) - (a.ecbBalance || 0) - (a.finesOwed || 0) - (a.freshHaz ? 50000 : 0) ||
        byUrgency(a, b),
      why: (c) => {
        const owed = (c.finesOwed || 0) + (c.ecbBalance || 0);
        return `${owed ? `${money(owed)} owed plus mandated work — ` : 'Mandated capex ahead — '}the owner is doing disposition math right now.`;
      },
      opener: (c) =>
        `Re: ${title(c.address)} — no ask, just context: buildings carrying open facade obligations are trading at interesting numbers right now. If a quiet valuation is ever useful, happy to run one.`,
    },
    cNeed: null,
    oNeed: null,
  },
  marketing: {
    label: 'Local marketing',
    tile: 'Marketing / launch PR',
    facade: null,
    cNeed: null,
    oNeed: () => `Opening night happens once — launch campaigns, socials and local press get planned six to eight weeks out. This venue is picking who runs that right now.`,
    oOpener: (c) =>
      `Re: ${venueName(c)} — saw the filing for ${c.address}. Opening night only happens once; we build launch campaigns for new venues. Want the neighborhood talking before the doors open?`,
  },
  signage: {
    label: 'Signs / storefront',
    tile: 'Signage / storefronts',
    facade: null,
    cNeed: null,
    oNeed: () => `A storefront sign takes weeks: design, DOB sign permit, fabrication, install. It gets ordered during build-out — which is exactly where this venue is today.`,
    oOpener: (c) =>
      `Re: ${venueName(c)} — saw the filing for ${c.address}. Signage takes weeks to design, permit and fabricate; we can have your storefront ready before opening day.`,
  },
  explore: {
    label: 'Just exploring',
    tile: 'Just exploring',
    facade: null,
    cNeed: null,
    oNeed: null,
  },
};

// A phrase wrapped in *asterisks* comes out in the display italic. It is the one
// thing the serif can do that the grotesque cannot, so it is spent on the
// clause that carries the argument.
// The block model is the heaviest thing on the page, so it is code-split and
// only ever mounted on a wide screen with motion allowed.
const blank = { default: () => null };
const Massing = lazy(() => import('./Massing.jsx').catch(() => blank));
const CivicWorks = lazy(() => import('./CivicWorks.jsx').catch(() => blank));
const Storefronts = lazy(() => import('./Storefronts.jsx').catch(() => blank));
const CityMap = lazy(() => import('./CityMap.jsx').catch(() => blank));

// Each register gets its own object and its own line under it. The caption is
// the object's job: it says which fact of the register the brand-coloured
// element stands for.
// The building registers other than facades all read the same way — a public
// record of a missed obligation, a building, and someone to call — so one
// description each is enough and the card is rendered once.
const MANDATES = {
  gas: {
    label: 'Gas piping',
    prefix: 'g:',
    source: 'DOB Safety Violations (Local Law 152)',
    sourceKey: 'mandates',
    dataset: 'https://data.cityofnewyork.us/Housing-Development/DOB-Safety-Violations/855j-jady',
    // Every card here shares one deadline, so the head row has to differ on
    // something else or four hundred rows read identically.
    badge: (c) =>
      `${c.violations > 1 ? `${c.violations} open · ` : ''}` +
      (c.openDays ? `open ${Math.round(c.openDays / 30)} mo` : 'open violation'),
    clock: (c) => `${c.monthsLeft} mo left`,
    tight: (c) => c.monthsLeft <= 6,
    why: (c) =>
      `DOB cited this building for failing to file its gas-piping inspection${c.issued ? ` on ${usDate(c.issued)}` : ''}` +
      `${c.openDays ? ` — ${Math.round(c.openDays / 30)} months ago` : ''}, and it is still open. Sub-cycle ${c.subCycle} runs out ` +
      `${usDate(c.deadline)}, so the next filing is due before the first has been cured.`,
    whoWins: 'Licensed master plumber for the inspection · management · violation cure · the capex behind it.',
    facts: (c) => [
      ['Deadline', `${usDate(c.deadline)} — sub-cycle ${c.subCycle}, Community District ${c.cd}`],
      ['Violation open since', c.issued ? usDate(c.issued) : 'unknown'],
      // The one thing that separates two cards in a legally uniform register:
      // whether a licensed plumber has ever filed gas work here. An LAA is a
      // repair filing, not the LL152 certification (which the city does not
      // publish), and the copy is careful to say which.
      c.laa
        ? [
            'Gas work on record',
            c.laa.filed
              ? `LAA filed ${usDate(c.laa.filed)}${c.laa.signedOff ? `, signed off ${usDate(c.laa.signedOff)}` : c.laa.status ? ` · ${c.laa.status.toLowerCase()}` : ''} — the owner has engaged a plumber before`
              : // A pre-filing application has no date yet, and is the stronger
                // fact: a plumber is engaged right now.
                `LAA in ${(c.laa.status || 'pre-filing').toLowerCase()} — a plumber is engaged right now`,
          ]
        : ['Gas work on record', 'None in the city\u2019s LAA file — no plumber has filed here'],
    ],
    opener: (c) =>
      c.laa
        ? `Re: ${title(c.address)} — DOB shows an open Local Law 152 violation with the sub-cycle ${c.subCycle} deadline on ${usDate(c.deadline)}. Your file shows gas work ${c.laa.filed ? `as recently as ${usDate(c.laa.filed)}` : 'in progress right now'}, but the inspection itself is still owed. We can close both out in one visit.`
        : `Re: ${title(c.address)} — DOB shows an open Local Law 152 gas-piping violation, no gas work on record at all, and the sub-cycle ${c.subCycle} deadline is ${usDate(c.deadline)}. We can get the inspection filed before it lapses again.`,
  },
  elevators: {
    label: 'Elevators',
    prefix: 'e:',
    source: 'DOB NOW Elevator Compliance',
    sourceKey: 'elevatorCompliance',
    dataset: 'https://data.cityofnewyork.us/Housing-Development/Elevator-Compliance/e5aq-a4j2',
    badge: (c) =>
      c.yearsBehind == null ? 'Never filed' : `${c.yearsBehind} ${c.yearsBehind === 1 ? 'year' : 'years'} behind`,
    clock: (c) => `${c.monthsLeft} mo left`,
    tight: (c) => c.monthsLeft <= 4,
    why: (c) =>
      `${c.devices === 1 ? 'The elevator here' : `${c.devices} elevators here`} last filed a CAT1 test ` +
      `${c.lastCat1 ? `for ${c.lastCat1}` : 'with no year on record'}, so at least one annual cycle was skipped outright — ` +
      `not simply left late. This year's filing still closes ${usDate(c.deadline)}, which is the window to catch both up in.`,
    whoWins: 'Elevator testing and filing · modernization · management · the violation that follows a missed cycle.',
    facts: (c) => [
      ['Filing closes', `${usDate(c.deadline)} — the annual CAT1 deadline`],
      [
        'Last CAT1 filed',
        c.lastCat1
          ? `for ${c.lastCat1}${c.lastCat1On ? `, submitted ${usDate(c.lastCat1On)}` : ''}`
          : 'no filing on record',
      ],
      ['Devices', `${c.devices} active`],
      ...(c.lastCat5 ? [['Last CAT5 filed', usDate(c.lastCat5)]] : []),
    ],
    opener: (c) =>
      `Re: ${title(c.address)} — DOB shows the elevator${c.devices > 1 ? 's' : ''} here last filed a CAT1 test ${c.lastCat1 ? `for ${c.lastCat1}` : 'with no year on record'}, so a cycle was missed. We can test and file the backlog and this year's before ${usDate(c.deadline)}.`,
  },
  carbon: {
    label: 'Carbon',
    prefix: 'k:',
    source: 'DOB Safety Violations (Local Law 97)',
    sourceKey: 'mandates',
    dataset: 'https://data.cityofnewyork.us/Housing-Development/DOB-Safety-Violations/855j-jady',
    badge: (c) => (c.violations > 1 ? `${c.violations} open violations` : 'Emissions report owed'),
    // There is no window in this record, so the card counts up from the citation
    // rather than down to a date it would have to invent.
    clock: (c) => (c.openDays != null ? `cited ${c.openDays}d ago` : 'cited'),
    tight: (c) => (c.openDays || 0) <= 45,
    why: (c) =>
      `DOB cited this building under Local Law 97 for not filing its emissions report` +
      `${c.issued ? ` on ${usDate(c.issued)}` : ''}, and it is still open. About four thousand buildings citywide have been ` +
      `cited against tens of thousands covered, so this is not a building that is merely late — it is one that has been named.`,
    whoWins: 'Energy consulting and the report itself · the retrofit behind it · financing · the violation to cure.',
    facts: (c) => [
      ['Cited', c.issued ? `${usDate(c.issued)}${c.openDays ? ` — ${c.openDays} days ago` : ''}` : 'unknown'],
      ['Open violations', String(c.violations)],
      // The dollar line, where the city's own benchmarking allows one. Both
      // halves are estimates and the copy says so — the reported figure is
      // Portfolio Manager's, the cap is computed from the statutory 2024-29
      // coefficients, and neither is DOB's official BEAM number.
      ...(c.ghg
        ? [
            [
              `Reported emissions (CY${c.ghg.y})`,
              `${c.ghg.t.toLocaleString('en-US')} tCO2e` +
                (c.ghg.cap != null ? ` against an estimated cap of ~${c.ghg.cap.toLocaleString('en-US')}` : '') +
                (c.ghg.type ? ` · ${c.ghg.type}` : ''),
            ],
            ...(c.ghg.usd > 0
              ? [[
                  'Estimated overage exposure',
                  `~${money(c.ghg.usd)}/year at $268 per ton over — an estimate on the city's own benchmarking, not DOB's calculation`,
                ]]
              : c.ghg.cap != null
                ? [[
                    'Against its cap',
                    `under by ~${(c.ghg.cap - c.ghg.t).toLocaleString('en-US')} t — the report is the job here, not the retrofit`,
                  ]]
                : []),
          ]
        : []),
      ...(c.sqft && !c.ghg?.usd
        ? [[
            'Failure-to-file meter',
            `up to ${money(Math.round(c.sqft * 0.5))}/month statutory ceiling on ${c.sqft.toLocaleString('en-US')} sq ft`,
          ]]
        : []),
    ],
    opener: (c) =>
      c.ghg?.usd > 0
        ? `Re: ${title(c.address)} — DOB has an open Local Law 97 violation here, and the building's own CY${c.ghg.y} benchmarking shows ${c.ghg.t.toLocaleString('en-US')} tCO2e against an estimated cap near ${c.ghg.cap.toLocaleString('en-US')} — roughly ${money(c.ghg.usd)}/year of exposure at $268/ton. We can file the report and scope the retrofit that gets you under.`
        : `Re: ${title(c.address)} — DOB has an open Local Law 97 violation on this building for an unfiled emissions report. We can get the report filed and scope what it takes to get under the cap.`,
  },
};
const mandateKeys = Object.keys(MANDATES);

// Nobody buys this for the three-dimensional block of buildings, so it must
// never sit between opening the page and reaching the first card. Three gates
// and a delay:
//
//   - a viewport under 980px never mounts it (the CSS hides the slot anyway)
//   - prefers-reduced-motion never mounts it
//   - a browser without a working WebGL context never mounts it
//   - and even when all three pass, the import waits for the browser to go idle,
//     so the feed is rendered and clickable before the WebGL chunk is asked for
//
// The slot keeps its height in every case, so nothing moves when the scene
// arrives or when it never does.
const webglOk = () => {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
};

function useSceneReady(enabled) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    if (!webglOk()) return;
    // requestIdleCallback where it exists, a timeout everywhere else. Either way
    // the first paint has happened and the list is interactive by now.
    const start = () => setReady(true);
    const id =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(start, { timeout: 2000 })
        : setTimeout(start, 600);
    return () => {
      if (typeof cancelIdleCallback === 'function' && typeof id === 'number') cancelIdleCallback(id);
      clearTimeout(id);
    };
  }, [enabled]);
  return ready;
}

const HEROES = {
  facades: { Scene: Massing, cap: 'Sub-cycle 10A · nothing filed' },
  // A block of buildings on a compliance clock is what every one of these is,
  // so they reuse the facade hero rather than inventing an object per statute.
  gas: { Scene: Massing, variant: 'gas', cap: 'Sub-cycle C · gas piping unfiled' },
  elevators: { Scene: Massing, variant: 'elevators', cap: 'CAT1 cycle skipped · Dec 31 still open' },
  carbon: { Scene: Massing, variant: 'carbon', cap: 'Emissions report owed · cited this summer' },
  contracts: { Scene: CivicWorks, cap: 'Bid window open · winner not named' },
  openings: { Scene: Storefronts, cap: 'Licence pending · vendors not chosen' },
};

// three.js cannot read CSS variables, so the live theme is handed over by hand.
const readThemeColors = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => (cs.getPropertyValue(n) || f).trim();
  return {
    ink: v('--ink', '#101613'),
    brand: v('--brand', '#14594A'),
    warm: v('--warm', '#8A6410'),
    line: v('--line-2', 'rgba(15,30,26,0.16)'),
    bg: v('--bg-0', '#F1EFE9'),
  };
};

// Each claim state gets its own shape, so the feed is readable without colour.
const STATUS_MARK = {
  open: { glyph: 'check', label: 'Open — no one has claimed it yet' },
  taken: { glyph: 'lock', label: 'Taken — someone is already on it' },
  personal: { glyph: 'star', label: 'Reserved for you' },
};
// What the city says about one building, asked at the moment a card is opened.
//
// A card is a photograph of the record at build time; the hourly rebuild drifts,
// so by the afternoon it can be describing the morning. Nothing usually moves.
// The exceptions are the ones that matter: the owner filed the report overnight,
// or a contractor took the job. Both turn a good call into an embarrassing one,
// and both are visible in DOB NOW within a day.
//
// Answers are memoised per building for the life of the page, so opening the
// same card twice costs one request.
const verifyCache = new Map();

function materialChanges(card, live, builtOn) {
  const out = [];

  if (card.lastCycle !== '10' && live.lastCycle === '10') {
    out.push(
      `A Cycle 10 report has been filed${live.lastFiling ? ` on ${usShort(live.lastFiling)}` : ''}` +
        `${live.qewi ? ` by ${title(live.qewi)}` : ''}. This building is no longer a non-filer.`,
    );
  } else if (live.lastCycle === card.lastCycle && live.lastStatus && live.lastStatus !== card.lastStatus) {
    out.push(`The filing status changed from ${card.lastStatus || 'none'} to ${live.lastStatus}.`);
  }

  const hadFiling = Boolean(card.filing?.filed);
  if (live.filing && !hadFiling) {
    out.push(
      `${live.filing.who ? title(live.filing.who) : 'A contractor'} filed for this facade` +
        `${live.filing.filed ? ` on ${usShort(live.filing.filed)}` : ''}. Someone is already on it.`,
    );
  } else if (live.filing && hadFiling && live.filing.permitted && !card.filing?.permitted) {
    out.push(
      `${live.filing.who ? title(live.filing.who) : 'The filed contractor'} has since pulled the permit.`,
    );
  }

  // Only a shed that went up after this card was built is news. Renewals of a
  // shed the card already describes are not, and they are the common case.
  if (live.permit && !card.shed && builtOn && live.permit.issued > builtOn.slice(0, 10)) {
    out.push(
      `A ${live.permit.type.toLowerCase()} went up on ${usShort(live.permit.issued)}` +
        `${live.permit.who ? `, permit pulled by ${title(live.permit.who)}` : ''}.`,
    );
  }

  return out;
}

function Recheck({ card, builtOn, reduce }) {
  const [state, setState] = useState(() => verifyCache.get(card.bin) || null);

  useEffect(() => {
    if (state) return;
    let live = true;
    fetch(`/api/verify?bin=${encodeURIComponent(card.bin)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        // An empty answer is not the same as "nothing changed": if the city has
        // no record for this building at all, the card must not claim it was
        // confirmed.
        if (!j || (!j.lastCycle && !j.filing && !j.permit)) {
          const none = { ok: false };
          verifyCache.set(card.bin, none);
          if (live) setState(none);
          return;
        }
        const next = { ok: true, changes: materialChanges(card, j, builtOn), at: j.checkedAt };
        verifyCache.set(card.bin, next);
        if (live) setState(next);
      })
      .catch(() => {
        // Silence beats a false "verified": if we could not reach the city, the
        // card simply stays what it was and says nothing new.
        const next = { ok: false };
        verifyCache.set(card.bin, next);
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, [card.bin, state, builtOn]);

  if (!state || !state.ok) return null;

  if (!state.changes.length) {
    return (
      <p className="recheck ok">
        Checked against DOB just now — the record still reads as described.
      </p>
    );
  }

  return (
    <motion.div
      className="recheck changed"
      initial={reduce ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      role="status"
    >
      <div className="recheck-k">Changed since this card was built</div>
      <ul>
        {state.changes.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </motion.div>
  );
}

function StatusDot({ status, note, legend }) {
  const mark = STATUS_MARK[status] || STATUS_MARK.open;
  return (
    <span className={'found ' + status + (legend ? ' legend-dot' : '')} title={legend ? undefined : note || mark.label}>
      {mark.glyph === 'star' ? (
        <span aria-hidden="true">★</span>
      ) : mark.glyph === 'lock' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      <span className="sr-only">{note || mark.label}</span>
    </span>
  );
}

// The callable-first sort orders the feed by whether anyone answers; this makes
// that order visible on the collapsed row. A published number is printed in
// full — the number is the product's promise — an inbox or a confirmed agent is
// a glyph, and silence shows nothing rather than a placeholder.
function ContactHint({ phone, mail }) {
  if (phone)
    return (
      <span className="c-hint tel" title="Published number — expand the card for the source">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.4 19.4 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.27a2 2 0 0 1 2.1-.45c.9.34 1.85.57 2.8.7a2 2 0 0 1 1.7 2.03z" />
        </svg>
        <i>{phone}</i>
      </span>
    );
  if (mail)
    return (
      <span className="c-hint mail" title="Reachable by email — expand the card">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-10 6L2 7" />
        </svg>
      </span>
    );
  return null;
}

// "11215" is a territory, "11215 11217 11231" is the territory a crew actually
// covers. Anything else in the box is a free-text search as before.
const ZIP_QUERY = /^\s*\d{5}(?:\s*[,;\s]\s*\d{5})*\s*$/;
const zipsIn = (q) => (ZIP_QUERY.test(q) ? q.match(/\d{5}/g) : null);

const emphasize = (text) =>
  String(text)
    .split(/(\*[^*]+\*)/)
    .map((p, i) => (p.startsWith('*') && p.endsWith('*') ? <em key={i}>{p.slice(1, -1)}</em> : p));

const fmtUsd = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

// Three significant figures, then the same $K / $M split as everywhere else.
const sig3 = (n) => {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 2);
  return Math.round(n / mag) * mag;
};
const fmtMoney = (n) => {
  const v = sig3(n);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${v}`;
};

// Facts are chosen by trade, not by what happens to be in the row. Order is the
// order they appear, so each trade's own evidence leads. Measured against the
// 400-card feed: elevator data sits on 250 cards and was being shown to code
// attorneys and lenders alike, while every card carried the same 10A window.
const ALL_FACTS = ['report', 'engineer', 'filing', 'shed', 'elevators', 'sold', 'mgmt', 'ecb', 'hearing', 'penalty', 'owner'];
const FACTS = {
  qewi: ['report', 'engineer', 'filing', 'penalty', 'owner', 'ecb'],
  restoration: ['report', 'filing', 'shed', 'engineer', 'penalty', 'owner'],
  equipment: ['shed', 'filing', 'report', 'penalty', 'owner'],
  elevator: ['elevators', 'report', 'owner', 'penalty'],
  insurance: ['sold', 'mgmt', 'ecb', 'hearing', 'report', 'owner'],
  lender: ['penalty', 'ecb', 'report', 'filing', 'sold', 'owner'],
  propmgmt: ['sold', 'mgmt', 'ecb', 'penalty', 'report', 'owner'],
  legal: ['hearing', 'ecb', 'penalty', 'report', 'owner'],
  cre: ['penalty', 'ecb', 'sold', 'report', 'owner', 'hearing'],
  explore: ALL_FACTS,
};
const factsFor = (k) => FACTS[k] || ALL_FACTS;

// The cohort each trade actually works. Every one of these facts is already on
// the card and none of them could be asked for: four separate walkthroughs
// reached the same wall, an estimator scrolling 400 rows looking for the 25
// buildings that are paying shed rent for nothing.
const days = (iso) => (iso ? (new Date(iso) - Date.now()) / 86400000 : null);
const COHORTS = {
  // Carbon: the cards whose exposure is priced, and the ones over their cap.
  // (pricedGhg, because facades already use 'priced' for a declared job cost.)
  pricedGhg: { label: 'Priced exposure', of: (c) => c.ghg?.usd > 0 },
  overcap: { label: 'Over the cap', of: (c) => c.ghg?.over > 0 },
  // Gas: the owner has engaged a plumber before — a different first call.
  hasPlumber: { label: 'Plumber on record', of: (c) => Boolean(c.laa) },
  paying: { label: 'Paying for nothing', of: (c) => Boolean(c.payingForNothing) },
  stalled: { label: 'Approved, no permit', of: (c) => Boolean(c.filing && c.filing.status === 'Approved' && !c.filing.permitted) },
  shedEnd: { label: 'Shed expires <60d', of: (c) => { const d = days(c.shed?.until); return d != null && d > 0 && d < 60; } },
  priced: { label: 'Cost declared', of: (c) => Boolean(c.filing?.cost > 0) },
  owes: { label: 'Unpaid at OATH', of: (c) => (c.ecbBalance || 0) > 0 },
  sold: { label: 'Just sold', of: (c) => Boolean(c.ownerChange) },
  hearing: { label: 'Hearing <30d', of: (c) => { const d = days(c.nextHearing); return d != null && d >= 0 && d < 30; } },
  lifts: { label: 'Lift cycle skipped', of: (c) => (c.elevator?.cat1Overdue || 0) > 0 },
  callable: { label: 'Has a contact', of: (c) => Boolean(c.agent?.contactKnown) },
  // The engineer who filed Cycle 9 and has not been brought back. It is the
  // warmest call this trade can make and it was only reachable by typing a
  // competitor's name into the search box and knowing to try.
  notReengaged: { label: 'Prior engineer, not re-engaged', of: (c) => Boolean(c.priorQewi && !c.filing) },
  // A co-op or a condominium cannot be bought whole, so for a buyer it is not a
  // building at all. Offered as a filter rather than removed, because hiding
  // rows without saying so is the one thing this product does not do.
  wholeBuilding: {
    label: 'Whole building only',
    of: (c) => !/\b(HDFC|CONDO|CONDOMINIUM|OWNERS CORP|TENANTS CORP|CO-?OP)\b/i.test(c.owner || ''),
  },
  // The other registers answer different questions with the same shape.
  openLong: { label: 'Open over a year', of: (c) => (c.openDays || 0) > 365 },
  multi: { label: 'More than one', of: (c) => (c.violations || 0) > 1 },
  behind2: { label: 'Two cycles behind', of: (c) => c.yearsBehind == null || c.yearsBehind >= 2 },
  manyLifts: { label: '3+ lifts', of: (c) => (c.devices || 0) >= 3 },
  reachable: { label: 'Has a contact', of: (c) => Boolean(c.agent?.contactKnown || c.phone || c.email || c.contact?.phone) },
  openBid: { label: 'Still open', of: (c) => c.kind === 'SOLICITATION' || c.kind === 'INTENT' },
  buildWork: { label: 'Construction', of: (c) => /construction|architect|engineer/i.test(c.category || '') },
  notOpenYet: { label: 'Not open yet', of: (c) => c.src === 'dohmh' },
  pouring: { label: 'Liquour licence', of: (c) => c.src === 'sla' },
};
// Which cohorts a register offers. The trade's own list wins on facades.
const REG_COHORTS = {
  gas: ['reachable', 'hasPlumber', 'openLong', 'multi'],
  elevators: ['reachable', 'behind2', 'manyLifts'],
  carbon: ['pricedGhg', 'overcap', 'reachable', 'multi'],
  contracts: ['openBid', 'buildWork', 'reachable'],
  openings: ['reachable', 'notOpenYet', 'pouring'],
};

// What a venue is called on screen and in an opener. Where nothing vouched for
// the licensee's name it was never shipped, and the card is identified by its
// address instead — see lib/personal.mjs for what counts as vouching.
const venueName = (o) => o?.name || o?.identity || `New business at ${String(o?.address || '').split(',')[0]}`;

// 8%, not 3%: three per cent is a cold-outbound rate, and this is not cold
// outbound — the owner is legally required to hire somebody, the penalty meter
// is already running, and the caller opens with the specific reason. Still an
// assumption, so the UI says so and hands over the pencil; three recorded wins
// replace it with the device's own ratio.
const DEFAULT_CLOSE_RATE = 0.08;
// The borough-plan price is not public yet. This is the one place it lives;
// set the real figure when it exists. ESTIMATED.
const PLAN_PRICE_YEAR = 6000;

const clampRate = (v) => Math.min(1, Math.max(0.01, v));


// Typical contract size per trade *and per register* — the same firm does not
// bill the same for a mandated facade scope, a subcontract off a city award and
// a build-out. Used until the user tells us their own number.
// Every figure a profile can be shown, keyed by profile and then by register.
// Values marked ESTIMATED below were not measured against anything — they are
// plausible New York numbers put in so the block has something to show, and they
// are the first thing to correct once a real contractor gives their own. The
// user's own override always wins and stays on their device.
const TICKET = {
  qewi: { facades: 12000, contracts: 9000, gas: 1800, elevators: 2600, openings: 3500 /* ESTIMATED */ },
  restoration: { facades: 180000, contracts: 120000, openings: 40000 /* ESTIMATED: a storefront scope */ },
  equipment: { facades: 45000, contracts: 30000, openings: 20000 /* ESTIMATED */ },
  elevator: { facades: 25000, elevators: 9000, contracts: 60000 /* ESTIMATED */, openings: 35000 /* ESTIMATED */ },
  insurance: { facades: 12000, contracts: 18000, openings: 9000 },
  lender: { facades: 200000, contracts: 150000, openings: 120000, gas: 90000, carbon: 350000 },
  propmgmt: {
    facades: 50000,
    gas: 4000,
    elevators: 6500,
    carbon: 12000,
    contracts: 30000 /* ESTIMATED */,
    openings: 9000 /* ESTIMATED */,
  },
  legal: {
    facades: 7500,
    gas: 6000,
    elevators: 5000,
    carbon: 15000,
    contracts: 12000 /* ESTIMATED */,
    openings: 4500 /* ESTIMATED */,
  },
  cre: { facades: 160000, gas: 120000, carbon: 220000, contracts: 90000 /* ESTIMATED */, openings: 70000 /* ESTIMATED */ },
  staffing: { contracts: 25000, openings: 18000 },
  pos: { openings: 4000, contracts: 12000 /* ESTIMATED */ },
  fnb: { openings: 60000, contracts: 45000 /* ESTIMATED */ },
  marketing: { openings: 15000, contracts: 20000 /* ESTIMATED */ },
  signage: { openings: 20000, contracts: 18000 /* ESTIMATED */ },
  // Deliberately empty: somebody who has not said what they do has no pipeline
  // we can honestly put a number on, so the block does not appear for them.
  explore: {},
};
const homeVertical = (k) =>
  PROFILES[k]?.facade ? 'facades' : PROFILES[k]?.cNeed ? 'contracts' : PROFILES[k]?.oNeed ? 'openings' : 'facades';
// Exact, with no fallback in either direction. Borrowing another profile's
// number would put a restoration contractor's figure in front of an inspector;
// borrowing the same profile's figure from another register is the same error
// one step smaller — facade restoration is not gas-piping work and does not
// bill like it. A pair with no number hides the pipeline block instead, because
// a figure nobody can check is worse than no figure.
const ticketFor = (k, v) => TICKET[k]?.[v] || 0;

// A register holding almost nothing is worse than no register — it makes the
// whole product read as empty. Below this, the tab does not appear at all.
const MIN_LIST = 4;

const BADGE = {
  NON_FILER: 'No Cycle 10 filing',
  SWARMP_CARRYOVER: 'Open SWARMP',
  UNSAFE_PRIOR: 'UNSAFE on file',
  CHRONIC_NON_FILER: 'No Cycle 9 report',
  OWNER_CHANGE: 'Just sold',
  NEW_MGMT: 'Management changed',
  ELEV_DUE: 'Elevator tests due',
  SHED_NO_REPAIR: 'Shed up, no repair filed',
  FILING_STALLED: 'Filing stalled',
};

// The conversion banner names the buyer of the register it sits under — a
// facade pitch under the carbon tab reads as a template left unfilled.
const PILOT_COPY = {
  facades: ['One facade contractor per borough.', 'Territory plans give you every FISP signal in your borough, exclusively — nobody else on the block sees them.'],
  gas: ['One licensed master plumber per borough.', 'Territory plans give you every LL152 citation in your borough, exclusively — nobody else on the block sees them.'],
  elevators: ['One elevator contractor per borough.', 'Territory plans give you every skipped-cycle lift in your borough, exclusively — nobody else on the block sees them.'],
  carbon: ['One retrofit partner per borough.', 'Territory plans give you every priced LL97 exposure in your borough, exclusively — nobody else on the block sees them.'],
  contracts: ['One firm per trade on city work.', 'Territory plans give you the solicitations and awards that match your trade, exclusively.'],
  openings: ['One vendor per category, per borough.', 'Territory plans give you every pre-opening venue in your borough, exclusively.'],
};

const VERTICALS = [
  { key: 'facades', label: 'Building facades' },
  { key: 'gas', label: 'Gas piping' },
  { key: 'elevators', label: 'Elevators' },
  { key: 'carbon', label: 'Carbon' },
  { key: 'contracts', label: 'City contracts' },
  { key: 'openings', label: 'New openings' },
];

function CountUp({ value, prefix = '' }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = prefix + value.toLocaleString('en-US');
      return;
    }
    const ctrl = animate(0, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = prefix + Math.round(v).toLocaleString('en-US');
      },
    });
    return () => ctrl.stop();
  }, [value, prefix, reduce]);
  return <span ref={ref} />;
}

// CountUp always starts from zero, which is right the first time a figure
// appears and wrong every time after: what makes the pipeline persuasive is
// watching it MOVE when you type your own ZIPs into the search box, and a number
// that restarts from zero on every keystroke reads as a reload, not a response.
// This one animates from wherever it already was.
function Rolling({ value, format }) {
  const ref = useRef(null);
  const prev = useRef(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    // The correct figure is written FIRST, every time. A tab that is in the
    // background does not run transitions, and a number whose only path to its
    // true value is through an animation then sits there showing the previous
    // one — which is not a missing flourish, it is a wrong number on the screen.
    el.textContent = format(value);
    // Writing the true value first is not enough on its own: the animation
    // starts by emitting the FROM value synchronously, and in a tab that never
    // runs the rest of the tween that first frame is the last one — the figure
    // then sits showing the previous register's number. So a hidden document
    // does not animate at all, and the opening frame is ignored.
    if (reduce || from == null || from === value || document.hidden) return;
    let moved = false;
    const ctrl = animate(from, value, {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        if (!moved && v === from) return;
        moved = true;
        el.textContent = format(v);
      },
      onComplete: () => {
        el.textContent = format(value);
      },
    });
    return () => {
      ctrl.stop();
      el.textContent = format(value);
    };
  }, [value, format, reduce]);
  return <span ref={ref} />;
}

function WindowBar({ opens, deadline }) {
  const total = new Date(deadline) - new Date(opens);
  const gone = Date.now() - new Date(opens);
  const pct = Math.max(4, Math.min(100, Math.round((gone / total) * 100)));
  return (
    <div className="winbar" aria-hidden="true">
      <div className="winbar-fill" style={{ width: pct + '%' }} />
    </div>
  );
}

// Contact confidence, shown plainly. An honest "unverified" reads stronger than a
// button that quietly opens Google — and it is the same data-honesty rule as the
// license gate. Levels light up as enrichment providers are connected.
// Three states, always labelled. "none" shows no number at all rather than a
// number we cannot stand behind.
// The subject line carries the address, because that is what makes a cold email
// to a managing agent look like business rather than a blast.
const emailSubject = (c) => `${title(c.address)} — ${c.subCycle} facade compliance`;

// Writing to the operator is not writing to the registered owner, so the opener
// says which building it is about before it says anything else. Without this the
// message reads as though it were meant for someone else, which is how a cold
// email gets deleted.
const openerFor = (c, fv, ct) => {
  const body = fv.opener(c);
  if (!ct?.via) return body;
  return `${body}\n\n(Reaching you as the managing agent on record for ${title(c.address)}; the registration is held by ${title(ct.company || 'the owner')}.)`;
};

// Contacts arrive from a served document now, not from the bundle. An address
// with a query string or a control character in it would rewrite the mail the
// user believes they are sending, so nothing becomes a mailto: without passing
// this first.
const mailAddr = (e) => {
  const s = String(e || '').trim();
  return /^[^\s@<>"'`;,()[\]\\]{1,64}@[^\s@<>"'`;,()[\]\\]{1,190}\.[a-z]{2,24}$/i.test(s) ? s : null;
};

function contactOf(c, resolved) {
  const a = resolved ? { ...c.agent, ...resolved } : c.agent;
  if (!a) return null;
  const base = { name: a.name, company: a.company, from: 'HPD registration' };

  // Tested first, because it is the one case where the number is right but the
  // NAME is not: the registered entity is a holding company and this reaches the
  // firm that actually runs the building. A caller who does not know that opens
  // by asking for a company nobody there has heard of.
  if (a.via && (a.phone || a.email))
    return {
      ...base,
      phone: a.phone || null,
      email: a.email || null,
      via: a.via,
      level: `via ${a.via}`,
      tone: 'alt',
    };
  if (a.phone && a.confidence === 'verified')
    return {
      ...base,
      phone: a.phone,
      email: a.email || null,
      level: `verified · ${a.contactSource || 'company site'}`,
      tone: 'ok',
    };
  if (a.phone)
    return {
      ...base,
      phone: a.phone,
      email: a.email || null,
      level: `listed · ${a.contactSource || 'directory'}`,
      tone: 'mid',
    };
  // No line, but a published inbox. Worth saying which it is: a shared mailbox
  // is a slower door than a direct number, and the user should expect that.
  if (a.email)
    return {
      ...base,
      phone: null,
      email: a.email,
      level: `${/^(info|contact|management|office|admin|hello|leasing|inquiries)@/i.test(a.email) ? 'office inbox' : 'email'} · ${a.contactSource || 'company site'}`,
      tone: 'mid',
    };
  // We resolved a number for this firm and are not showing it. That is now a
  // deliberate, narrow case rather than a blanket redaction: the number's only
  // evidence is a third-party listing, and the search provider's terms do not
  // let us republish those. Saying so is more useful than "not in the public
  // build", because it tells the caller the number exists and is findable —
  // which is exactly what the button next to this offers to do.
  if (a.contactKnown)
    return { ...base, phone: null, email: null, level: 'on file · from a listing we cannot republish', tone: 'mid' };
  return { ...base, phone: null, email: null, level: 'no direct line on file', tone: 'low' };
}

const Star = ({ on }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
  </svg>
);

const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function saveLS(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export default function App() {
  // Routes: #data, #trades, #t/<trade>, or the feed. A trade in the URL means a
  // link can be sent to one contractor and open already set up for his work.
  const routeFromHash = () => {
    if (location.hash === '#data') return 'data';
    if (location.hash === '#trades') return 'trades';
    return 'feed';
  };
  const initialRoute = routeFromHash();
  const hashTrade = (location.hash.match(/^#t\/([a-z]+)$/) || [])[1] || null;
  const [route, setRoute] = useState(initialRoute);
  const deepLinked = useRef(Boolean(location.hash.match(/^#(b|c|g|e|k|o)\//)));
  const [profileKey, setProfileKey] = useState(() =>
    hashTrade && PROFILES[hashTrade] ? hashTrade : loadLS('rw.profile', null),
  );
  // Never open on arrival. A stranger gives this page twenty seconds, and a
  // modal over a blurred feed asks them to classify themselves before showing
  // them anything. The feed renders first; the question waits in the header.
  const [showOnboard, setShowOnboard] = useState(false);
  const [vertical, setVertical] = useState('facades');
  const [shown, setShown] = useState(7);
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [copiedLink, setCopiedLink] = useState(null);
  const [query, setQuery] = useState('');
  const [boro, setBoroRaw] = useState(() => loadLS('rw.boro', 'all'));
  const setBoro = (b) => { setBoroRaw(b); saveLS('rw.boro', b); };
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [watch, setWatch] = useState(() => loadLS('rw.watch', {}));
  const [walletReady, setWalletReady] = useState(false);
  const [slackInteractive, setSlackInteractive] = useState(false);
  const [email, setEmail] = useState(() => loadLS('rw.email', ''));
  // ?theme=dark is the dark page's own address. The parameter beats the saved
  // choice and then becomes it, so a shared dark link keeps meaning dark on
  // every later visit without the parameter.
  const [theme] = useState(() => {
    const q = new URLSearchParams(location.search).get('theme');
    if (q === 'dark' || q === 'light') {
      saveLS('rw.theme', q);
      return q;
    }
    return loadLS('rw.theme', null);
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [now, setNow] = useState(Date.now());
  const [checkedAt, setCheckedAt] = useState(null);
  const [claims, setClaims] = useState({});
  const [mine, setMine] = useState({});
  const [live, setLive] = useState(null);
  const [emailSaved, setEmailSaved] = useState(false);
  const [claimTaken, setClaimTaken] = useState(null);
  const [slackHook, setSlackHook] = useState(() => loadLS('rw.slack', ''));
  const [slackState, setSlackState] = useState('idle');
  const [portfolio, setPortfolio] = useState(() => loadLS('rw.portfolio', []));
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [showAllVerts, setShowAllVerts] = useState(false);
  // ?map=1 opens the map straight away; ?map=big opens it across the whole
  // window — a shareable view of the register on the city.
  const mapParam = useRef(new URLSearchParams(location.search).get('map')).current;
  const [showMap, setShowMap] = useState(() => mapParam === '1' || mapParam === 'big');
  const [portfolioText, setPortfolioText] = useState('');
  const [onlyPortfolio, setOnlyPortfolio] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [ticket, setTicket] = useState(() => loadLS('rw.ticket', 0));
  const [cohort, setCohort] = useState(null);
  const [onlyWorking, setOnlyWorking] = useState(false);
  const [capacitySaved, setCapacitySaved] = useState(() => Number(loadLS('rw.capacity', 0)) || 0);
  const [closeRate, setCloseRate] = useState(() => {
    const v = Number(loadLS('rw.closeRate', DEFAULT_CLOSE_RATE));
    return Number.isFinite(v) && v > 0 ? clampRate(v) : DEFAULT_CLOSE_RATE;
  });
  const [fb, setFb] = useState(() => loadLS('rw.fb', {}));
  const [showHidden, setShowHidden] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const lastPrefs = useRef('');
  const lastLive = useRef('');
  const [contacts, setContacts] = useState({});
  const [hashTick, setHashTick] = useState(0);
  const [themeColors, setThemeColors] = useState(readThemeColors);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 980px)').matches);
  const reduce = useReducedMotion();
  // Mounts the register's scene only once the page is idle, and never on a
  // narrow viewport, under reduced motion, or without WebGL.
  const sceneReady = useSceneReady(wide && !reduce);
  const uid = useRef(null);
  const secret = useRef(null);
  if (uid.current === null) {
    let u = loadLS('rw.uid', null);
    if (!u) {
      u = crypto.randomUUID();
      saveLS('rw.uid', u);
    }
    uid.current = u;
    let sec = loadLS('rw.secret', null);
    if (!sec) {
      sec = crypto.randomUUID().replace(/-/g, '');
      saveLS('rw.secret', sec);
    }
    secret.current = sec;
  }

  const [justDismissed, setJustDismissed] = useState(null);
  const mine_ = useRef(loadLS('rw.mine', {}));
  const mark = (k, st, card = null) => {
    // Toggling the status back off releases the claim this device made, so a
    // misclick does not lock a building amber for everyone, forever.
    if (fb[k]?.s === st && mine_.current[k]) {
      delete mine_.current[k];
      setClaims((c) => {
        const n = { ...c };
        delete n[k];
        return n;
      });
      fetch('/api/claims', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: uid.current, key: k, secret: secret.current }),
      }).catch(() => {});
    }
    if ((st === 'contacted' || st === 'won') && !claims[k]) {
      // Paint it amber straight away, but only keep ownership if the server
      // agrees — otherwise somebody claimed it a second before you did.
      setClaims((c) => ({ ...c, [k]: { at: Date.now() } }));
      fetch('/api/claims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: uid.current, key: k, secret: secret.current }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.status === 'claimed') {
            mine_.current[k] = 1;
            saveLS('rw.mine', { ...loadLS('rw.mine', {}), [k]: 1 });
            return;
          }
          if (j?.status === 'taken') {
            setClaimTaken(k);
            setTimeout(() => setClaimTaken((cur) => (cur === k ? null : cur)), 4000);
            return;
          }
          // Anything else means the claim never landed. Painting the card amber
          // and leaving it there tells four other people it is worked when it
          // is not, so the optimistic colour comes back off.
          setClaims((c) => {
            const n = { ...c };
            delete n[k];
            return n;
          });
        })
        .catch(() => {
          setClaims((c) => {
            const n = { ...c };
            delete n[k];
            return n;
          });
        });
    }
    setFb((f) => {
      const n = { ...f };
      const undoing = n[k]?.s === st;
      if (undoing) delete n[k];
      else n[k] = { s: st, t: Date.now() };
      saveLS('rw.fb', n);
      // A dismissed card leaves the list at once, so the only place left to ask
      // why is a strip above the feed.
      if (st === 'dismissed') setJustDismissed(undoing || !card ? null : { k, card });
      return n;
    });
  };
  const fbOf = (k) => fb[k]?.s || null;
  const isDismissed = (k) => fbOf(k) === 'dismissed';
  const reasonOf = (k) => fb[k]?.r || null;
  const noteOf = (k) => fb[k]?.n || '';
  // Marking a card Contacted recorded that it happened and nothing about it.
  // The note rides on the same entry, so it survives a reload and travels with
  // the status rather than living in a second store.
  const markNote = (k, text) => {
    setFb((f) => {
      const cur = f[k];
      if (!cur) return f;
      const n = { ...f, [k]: { ...cur, n: text.slice(0, 400) || undefined } };
      saveLS('rw.fb', n);
      return n;
    });
  };
  // A win without a size is why the funnel had to guess. The amount rides on
  // the same entry as the status and the note — optional, on-device, and a
  // skipped field never breaks any arithmetic downstream.
  const markAmount = (k, raw) => {
    const n = Number(String(raw).replace(/[^\d]/g, ''));
    setFb((f) => {
      const cur = f[k];
      if (!cur) return f;
      const next = { ...f, [k]: { ...cur, a: n > 0 ? n : undefined } };
      saveLS('rw.fb', next);
      return next;
    });
  };
  const amountOf = (k) => fb[k]?.a || 0;
  // Everything the funnel can learn from recorded outcomes, in one place:
  // the running total (the product's only real traction number), the median
  // win, and the observed close ratio against everything marked contacted.
  const winStats = useMemo(() => {
    const entries = Object.values(fb);
    const amounts = entries.filter((e) => e?.s === 'won' && e.a > 0).map((e) => e.a).sort((a, b) => a - b);
    const won = entries.filter((e) => e?.s === 'won').length;
    const touched = entries.filter((e) => e?.s === 'contacted' || e?.s === 'won').length;
    return {
      total: amounts.reduce((s, v) => s + v, 0),
      recorded: amounts.length,
      median: amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0,
      ratio: won >= 3 && touched > 0 ? Math.min(1, won / touched) : 0,
      won,
      touched,
    };
  }, [fb]);

  // The reason rides on the dismissal that already exists, so answering "why"
  // is optional: skip it and the card is still hidden, just silently.
  const markReason = (k, reasonKey, value) => {
    setJustDismissed((d) => (d?.k === k ? null : d));
    setFb((f) => {
      if (f[k]?.s !== 'dismissed') return f;
      const n = { ...f, [k]: { ...f[k], r: reasonKey, v: value || null } };
      saveLS('rw.fb', n);
      return n;
    });
  };
  // A rule is a (reason, value) pair somebody has now rejected twice.
  const learned = useMemo(() => rulesFrom(fb), [fb]);
  const taughtAway = (prefix, card) => taughtBy(learned, prefix, card);
  const learnedRules = useMemo(() => describeRules(learned), [learned]);
  // Undo strips the reason from the dismissals behind one rule. The buildings
  // stay dismissed — only the lesson drawn from them is withdrawn.
  const unlearn = (id) => {
    setFb((f) => {
      const n = { ...f };
      for (const [k, v] of Object.entries(n)) {
        if (v?.s === 'dismissed' && v.r && v.v && `${k.slice(0, 2)}${v.r}|${v.v}` === id) {
          n[k] = { s: v.s, t: v.t };
        }
      }
      saveLS('rw.fb', n);
      return n;
    });
  };
  const statusOf = (k) => (claims[k] ? 'taken' : mine[k] && mine[k] > now ? 'personal' : 'open');
  const hoursLeft = (k) => Math.max(1, Math.round((mine[k] - now) / 3600000));

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      const t = (location.hash.match(/^#t\/([a-z]+)$/) || [])[1];
      if (t && PROFILES[t]) {
        setProfileKey(t);
        saveLS('rw.profile', t);
        setShowOnboard(false);
      }
      // A card link pasted into an open tab must open that card, not just
      // change the address bar.
      if (/^#(b|c|g|e|k|o)\//.test(location.hash)) setHashTick((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (hashTrade && PROFILES[hashTrade]) saveLS('rw.profile', hashTrade);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const r = document.documentElement;
    if (theme) r.dataset.theme = theme;
    else delete r.dataset.theme;
  }, [theme]);

  // The attribute above lands in an effect, so the colours are re-read after it.
  useEffect(() => {
    setThemeColors(readThemeColors());
  }, [theme, systemDark]);

  // The sticky toolbar has to clear the sticky header, and the header grows a
  // row or two whenever its right-hand strip stops fitting. Measure it rather
  // than assuming one line.
  useEffect(() => {
    const el = document.querySelector('.top');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--top-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 980px)');
    const on = (e) => setWide(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // One request, and only while somebody is looking. Four endpoints polled
  // every 30 seconds from a tab left open all day is what exhausted the free
  // operation allowance and suspended the store on 2026-08-28.
  useEffect(() => {
    const i = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 30000);
    let last = 0;
    const pull = (force) => {
      if (!force && (document.hidden || Date.now() - last < 45000)) return;
      last = Date.now();
      fetch('/api/live?uid=' + uid.current)
        .then((r) => (r.ok ? r.text() : null))
        .then((text) => {
          if (!text || text === lastLive.current) return;
          lastLive.current = text;
          const j = JSON.parse(text);
          if (j.checkedAt) setCheckedAt(j.checkedAt);
          if (j.contracts) setLive(j);
          if (j.claims) setClaims(j.claims);
          // An empty object is truthy, so a failed fetch used to replace a good
          // map with nothing and every card lost its number until the next poll.
          if (j.contacts && Object.keys(j.contacts).length) setContacts(j.contacts);
          if (j.mine) {
            const m = {};
            for (const it of j.mine) m[it.key] = it.until;
            setMine(m);
          }
        })
        .catch(() => {});
    };
    pull(true);
    const h = setInterval(pull, 60000);
    const onVis = () => {
      if (!document.hidden) pull(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(i);
      clearInterval(h);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const body = JSON.stringify({
          uid: uid.current,
          secret: secret.current,
          data: {
            profile: profileKey,
            boro,
            watch: Object.keys(watch),
            feedback: fb,
            lastFeedSeen: data.generatedAt,
            channels: { email: email || null, slack: slackHook || null, walletSerial: null },
            portfolio,
          },
        });
      // Saving is a billed write; an unchanged payload is not worth one.
      if (body === lastPrefs.current) return;
      lastPrefs.current = body;
      fetch('/api/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [profileKey, watch, fb, boro, email, slackHook, portfolio, ticket, closeRate]);

  useEffect(() => {
    fetch('/api/pass/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setWalletReady(Boolean(j?.configured)))
      .catch(() => {});
    fetch('/api/slack/connect')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSlackInteractive(Boolean(j?.interactive)))
      .catch(() => {});
  }, []);

  const profile = PROFILES[profileKey] || PROFILES.explore;
  const fv = profile.facade || GENERIC_FACADE;
  const [sortMode, setSortMode] = useState('profile');
  const [showTop, setShowTop] = useState(false);
  const searchRef = useRef(null);

  const forcedVert = useRef(null);
  if (forcedVert.current === null) {
    const m = location.hash.match(/^#(b|c|g|e|k|o)\//);
    forcedVert.current = m ? { b: 'facades', g: 'gas', e: 'elevators', k: 'carbon', c: 'contracts', o: 'openings' }[m[1]] : '';
  }
  const isExplore = !profile.facade && !profile.cNeed && !profile.oNeed;

  const vertPrefix = MANDATES[vertical]
    ? MANDATES[vertical].prefix
    : vertical === 'facades'
      ? 'b:'
      : vertical === 'contracts'
        ? 'c:'
        : 'o:';
  const watchCount = Object.keys(watch).filter((k) => k.startsWith(vertPrefix)).length;
  const isWatched = (k) => Boolean(watch[k]);
  const toggleWatch = (k) => {
    setWatch((w) => {
      const n = { ...w };
      if (n[k]) delete n[k];
      else n[k] = 1;
      saveLS('rw.watch', n);
      return n;
    });
  };

  const saveCapacity = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) return;
    setCapacitySaved(n);
    saveLS('rw.capacity', n);
  };
  const saveTicket = (v) => {
    setTicket(v);
    saveLS('rw.ticket', v);
  };

  const saveCloseRate = (v) => {
    const r = Number.isFinite(v) && v > 0 ? clampRate(v) : DEFAULT_CLOSE_RATE;
    setCloseRate(r);
    saveLS('rw.closeRate', r);
  };

  const goTrade = (k) => {
    try {
      history.replaceState(null, '', k === 'explore' ? location.pathname : `#t/${k}`);
    } catch {}
  };

  const pickProfile = (k) => {
    setProfileKey(k);
    saveLS('rw.profile', k);
    goTrade(k);
    setRoute('feed');
    if (!loadLS('rw.ticket', 0) && k !== 'explore') setTicket(ticketFor(k, homeVertical(k)));
    else setShowOnboard(false);
    setShown(7);
    const p = PROFILES[k];
    setVertical(p?.facade ? 'facades' : p?.cNeed ? 'contracts' : p?.oNeed ? 'openings' : 'facades');
    setSortMode('profile');
  };

  // monthsLeft is the same number on every card in a register — they share one
  // sub-cycle — so sorting by it was a no-op that silently fell through to
  // urgency. A hearing date is the one date that actually differs.
  // Every register can now be ordered, and only on fields it actually varies on.
  // A sort offered where the value is constant is worse than no sort: it looks
  // like it did something.
  // A firm that runs eleven buildings is one call worth eleven jobs. The count is
  // stamped by the collector; where those buildings sit is read off the feed, so
  // the card can say which other registers hold the rest.
  const agentSpread = useCallback(
    (company) => {
      if (!company) return [];
      const key = company.toUpperCase().trim();
      return [['facades', 'facades'], ...mandateKeys.map((k) => [k, MANDATES[k].label.toLowerCase()])]
        .map(([k, label]) => [k, label, (data[k]?.feed || []).filter((c) => (c.agent?.company || '').toUpperCase().trim() === key).length])
        .filter(([, , n]) => n > 0);
    },
    [data],
  );

  // What the user asked of the default order, in one sentence: a card you can
  // ACT on now sits above one you can only write to, and both sit above one
  // with nobody to reach. Tier 2 is a dialable number (served or printed on the
  // record), tier 1 is an inbox or a findable number, tier 0 is silence. The
  // explicit sorts (next hearing, penalties owed…) stay pure — this shapes only
  // the defaults. Declared before every table that calls it: a const in this
  // body is dead until its line runs, and the first deploy of this feature
  // proved it by taking the whole page down.
  const actTier = useCallback(
    (c) => {
      const srv = contacts[c.bin] || {};
      if (srv.phone || c.phone || c.contact?.phone) return 2;
      if (srv.email || c.email || c.contact?.email || c.agent?.contactKnown) return 1;
      return 0;
    },
    [contacts],
  );
  const tierFirst = useCallback(
    (cmp) => (a, b) => actTier(b) - actTier(a) || cmp(a, b),
    [actTier],
  );

  // Contracts and openings order themselves. An open solicitation always sits
  // above a closed one, and an award above neither — the deadline is the point.
  const CONTRACT_SORTS = {
    closing: tierFirst((a, b) => {
      const live = (c) => (c.daysLeft == null ? 2 : c.daysLeft < 0 ? 1 : 0);
      return live(a) - live(b) || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9);
    }),
    posted: (a, b) => String(b.date || '').localeCompare(String(a.date || '')),
    value: (a, b) => (b.amount || 0) - (a.amount || 0) || String(b.date || '').localeCompare(String(a.date || '')),
    reachable: (a, b) =>
      Number(Boolean(b.contact?.phone || b.contact?.email)) - Number(Boolean(a.contact?.phone || a.contact?.email)) ||
      (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9),
  };
  const OPENING_SORTS = {
    recent: tierFirst((a, b) => openingRank(a) - openingRank(b)),
    callable: (a, b) => Number(Boolean(b.phone)) - Number(Boolean(a.phone)) || Number(b.camis || 0) - Number(a.camis || 0),
    borough: (a, b) => String(a.county || '').localeCompare(String(b.county || '')) || Number(b.camis || 0) - Number(a.camis || 0),
  };

  const REG_SORTS = {
    contracts: [
      ['closing', 'closing soonest'],
      ['posted', 'newest first'],
      ['value', 'largest award'],
      ['reachable', 'has a named officer'],
    ],
    openings: [
      ['recent', 'newest first'],
      ['callable', 'has a number'],
      ['borough', 'by borough'],
    ],
    facades: [
      ['profile', 'for you'],
      ['hearing', 'next hearing'],
      ['money', 'penalties owed'],
      ['cost', 'declared job cost'],
      ['callable', 'contact first'],
    ],
    gas: [
      ['profile', 'for you'],
      ['holdings', 'biggest landlord'],
      ['open', 'longest open'],
      ['callable', 'contact first'],
    ],
    elevators: [
      ['profile', 'for you'],
      ['holdings', 'biggest landlord'],
      ['devices', 'most lifts'],
      ['behind', 'years behind'],
      ['callable', 'contact first'],
    ],
    // LL97 was cited citywide in one summer, so age and count barely separate
    // four hundred cards. Whether there is anyone to ring is the real order.
    // Exposure leads: the priced 120 are the registry's whole point, and a
    // chip nobody clicks is where they used to hide.
    carbon: [
      ['exposure', 'dollar exposure'],
      ['profile', 'for you'],
      ['holdings', 'biggest landlord'],
      ['callable', 'contact first'],
      ['open', 'most violations'],
    ],
  };
  const MANDATE_SORTS = {
    profile: tierFirst((a, b) => b.urgencyScore - a.urgencyScore),
    open: (a, b) => (b.openDays || 0) - (a.openDays || 0) || b.violations - a.violations,
    holdings: (a, b) => (b.agent?.portfolio || 0) - (a.agent?.portfolio || 0) || b.urgencyScore - a.urgencyScore,
    exposure: (a, b) => (b.ghg?.usd || 0) - (a.ghg?.usd || 0) || (b.ghg?.t || 0) - (a.ghg?.t || 0) || b.urgencyScore - a.urgencyScore,
    devices: (a, b) => (b.devices || 0) - (a.devices || 0) || b.urgencyScore - a.urgencyScore,
    behind: (a, b) => (b.yearsBehind ?? 99) - (a.yearsBehind ?? 99) || b.urgencyScore - a.urgencyScore,
    callable: (a, b) =>
      Number(Boolean(b.agent?.contactKnown)) - Number(Boolean(a.agent?.contactKnown)) || b.urgencyScore - a.urgencyScore,
  };
  const SORTS = {
    profile: tierFirst(fv.sort),
    cost: (a, b) => (b.filing?.cost || 0) - (a.filing?.cost || 0) || byUrgency(a, b),
    callable: (a, b) =>
      Number(Boolean(b.agent?.contactKnown)) - Number(Boolean(a.agent?.contactKnown)) || byUrgency(a, b),
    hearing: (a, b) =>
      (a.nextHearing ? Date.parse(a.nextHearing) : Infinity) - (b.nextHearing ? Date.parse(b.nextHearing) : Infinity) ||
      byUrgency(a, b),
    money: (a, b) => (b.ecbBalance || 0) + (b.finesOwed || 0) - (a.ecbBalance || 0) - (a.finesOwed || 0),
  };
  const facadeFeed = useMemo(
    () => data.facades.feed.filter(fv.fFilter || (() => true)).sort(SORTS[sortMode] || SORTS.profile),
    [profileKey, sortMode, contacts],
  );
  const deferredQuery = useDeferredValue(query);
  // Split in two on purpose: everything EXCEPT the borough chip first, then the
  // chip. The borough counts must be faceted — computed against the rows every
  // other filter has left — or a ZIP territory search shows "Brooklyn 200" next
  // to a map that honestly says twelve. Two contradicting sets of numbers on
  // screen during the single most persuasive interaction.
  const filteredNoBoro = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const zips = zipsIn(q);
    return facadeFeed.filter((c) => {
      if (showHidden !== isDismissed('b:' + c.bin)) return false;
      if (!showHidden && taughtAway('b:', c)) return false;
      if (hideBusy && c.occupied) return false;
      if (cohort && !(COHORTS[cohort]?.of(c) ?? true)) return false;
      if (onlyWorking && !['contacted', 'won'].includes(fb['b:' + c.bin]?.s)) return false;
      if (onlyPortfolio && !portfolio.includes(c.bin)) return false;
      if (onlyWatch && !isWatched('b:' + c.bin)) return false;
      if (onlyNew && !(c.isNew || c.fresh?.length)) return false;
      if (!q) return true;
      if (zips) return Boolean(c.zip) && zips.includes(c.zip);
      return [c.address, c.owner, c.priorQewi, c.agent?.company, c.agent?.name, c.zip]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [facadeFeed, deferredQuery, onlyNew, onlyWatch, watch, fb, showHidden, onlyPortfolio, portfolio, hideBusy, cohort, onlyWorking]);
  const filteredFeed = useMemo(() => {
    const base = boro === 'all' ? filteredNoBoro : filteredNoBoro.filter((c) => c.borough === boro);
    const at = Date.now();
    const isMine = (c) => (mine['b:' + c.bin] && mine['b:' + c.bin] > at ? 0 : 1);
    return [...base].sort((a, b) => isMine(a) - isMine(b));
  }, [filteredNoBoro, boro, mine]);
  const boroCounts = useMemo(() => {
    const m = { all: filteredNoBoro.length };
    for (const c of filteredNoBoro) m[c.borough] = (m[c.borough] || 0) + 1;
    return m;
  }, [filteredNoBoro]);
  // The five-minute lane re-checks a narrow slice — award notices and liquor
  // licences — and publishes only what it saw. It must never REPLACE a register:
  // it was still writing the old 29-award, 40-venue shape after the build moved
  // to 156 City Record notices and 400 openings, so production was serving a
  // third of the product and none of the open solicitations. Merge by id, keep
  // the richer record, and let genuinely new rows through.
  const mergeLive = (base, fresh) => {
    if (!Array.isArray(fresh) || !fresh.length) return base;
    const byId = new Map(base.map((r) => [r.id, r]));
    for (const r of fresh) {
      const had = byId.get(r.id);
      // A fast-lane row carries fewer fields, so it may only refresh what it has.
      byId.set(r.id, had ? { ...had, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null)) } : r);
    }
    return [...byId.values()];
  };
  const liveContracts = useMemo(() => mergeLive(data.contracts, live?.contracts), [live]);
  const liveOpenings = useMemo(() => mergeLive(data.openings, live?.openings), [live]);
  // The liquour file dates its applications and the health file does not, so
  // there is no single number both sources can be ordered by: comparing them
  // directly put all 350 undated rows below all 39 dated ones and called it
  // "newest permit". Each source is ranked within itself instead — days since
  // application for one, the sequentially-issued permit number for the other —
  // and the two are interleaved by relative position, so the newest of each
  // sits at the top.
  const openingRank = useMemo(() => {
    const rank = new Map();
    for (const [rows, key] of [
      [liveOpenings.filter((o) => o.daysAgo != null), (o) => o.daysAgo],
      [liveOpenings.filter((o) => o.daysAgo == null), (o) => -Number(o.camis || 0)],
    ]) {
      const sorted = [...rows].sort((a, b) => key(a) - key(b));
      sorted.forEach((o, i) => rank.set(o.id, sorted.length > 1 ? i / (sorted.length - 1) : 0));
    }
    return (o) => rank.get(o.id) ?? 1;
  }, [liveOpenings]);
  const contractsBase = useMemo(() => liveContracts.filter(profile.cFilter || (() => true)), [profileKey, liveContracts]);
  const contractsList = useMemo(
    () =>
      contractsBase.filter((c) => {
        if (showHidden !== isDismissed('c:' + c.id)) return false;
        if (!showHidden && taughtAway('c:', c)) return false;
        if (onlyWatch && !isWatched('c:' + c.id)) return false;
        if (cohort && !(COHORTS[cohort]?.of(c) ?? true)) return false;
        const q = deferredQuery.trim().toLowerCase();
        if (!q) return true;
        return [c.vendor, c.agency, c.title, c.category, c.contact?.name, c.epin]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
      }).sort(CONTRACT_SORTS[sortMode] || CONTRACT_SORTS.closing),
    [contractsBase, onlyWatch, watch, fb, showHidden, deferredQuery, cohort, sortMode, contacts],
  );
  const mandateLists = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const zips = zipsIn(q);
    const out = {};
    const counts = {};
    for (const key of mandateKeys) {
      const pre = MANDATES[key].prefix;
      // Borough excluded here so the chips can count faceted — see filteredNoBoro.
      const noBoro = (data[key]?.feed || []).filter((c) => {
        if (showHidden !== isDismissed(pre + c.bin)) return false;
        if (!showHidden && taughtAway(pre, c)) return false;
        if (onlyWatch && !isWatched(pre + c.bin)) return false;
        if (onlyWorking && !['contacted', 'won'].includes(fb[pre + c.bin]?.s)) return false;
        if (cohort && !(COHORTS[cohort]?.of(c) ?? true)) return false;
        if (!q) return true;
        if (zips) return Boolean(c.zip) && zips.includes(c.zip);
        return [c.address, c.agent?.company, c.zip, c.bin]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
      });
      counts[key] = { all: noBoro.length };
      for (const c of noBoro) counts[key][c.borough] = (counts[key][c.borough] || 0) + 1;
      const rows = boro === 'all' ? noBoro : noBoro.filter((c) => c.borough === boro);
      const cmp = MANDATE_SORTS[sortMode] || MANDATE_SORTS.profile;
      const sorted = [...rows].sort(cmp);
      // LL97 and LL152 cite whole complexes in one sweep, so the register opens
      // on six near-identical addresses under one agent and one phone — correct,
      // and it reads as broken data. Rows that share an agent, a served number
      // and a ZIP collapse into one: "SLJ Property Management — 6 buildings,
      // one call", exposure summed, members listed inside. This is also the
      // portfolio argument (141 firms hold three or more buildings) finally
      // appearing in the UI instead of only in the pitch.
      if (key === 'carbon' || key === 'gas') {
        const nameKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/(LLC|INC|CORP|CO|LP|LLP)$/,'');
        const phoneOf = (c) => contacts[c.bin]?.phone || c.phone || c.contact?.phone || null;
        const byGroup = new Map();
        for (const c of sorted) {
          const ph = phoneOf(c);
          const gk = c.agent?.company && ph && c.zip ? `${nameKey(c.agent.company)}|${ph}|${c.zip}` : null;
          if (gk) byGroup.set(gk, (byGroup.get(gk) || 0) + 1);
        }
        const emitted = new Set();
        const grouped = [];
        for (const c of sorted) {
          const ph = phoneOf(c);
          const gk = c.agent?.company && ph && c.zip ? `${nameKey(c.agent.company)}|${ph}|${c.zip}` : null;
          if (!gk || byGroup.get(gk) < 2) {
            grouped.push(c);
            continue;
          }
          if (emitted.has(gk)) continue;
          emitted.add(gk);
          const cards = sorted.filter((m) => {
            const mp = phoneOf(m);
            return m.agent?.company && mp && m.zip && `${nameKey(m.agent.company)}|${mp}|${m.zip}` === gk;
          });
          // A campus files ONE benchmarking report and the city stamps the same
          // tonnage on every BIN in it — twelve identical $311,602 rows are one
          // figure, not twelve. Identical (tons, dollars) pairs inside a group
          // count once; genuinely distinct exposures still sum.
          const uniqFigures = new Map();
          for (const m of cards) if (m.ghg?.usd > 0) uniqFigures.set(`${m.ghg.t}|${m.ghg.usd}`, m.ghg.usd);
          const pricedMembers = cards.filter((m) => m.ghg?.usd > 0).length;
          grouped.push({
            group: true,
            id: 'grp-' + gk.replace(/[^A-Za-z0-9]/g, '').slice(0, 40),
            cards,
            company: cards[0].agent.company,
            phone: ph,
            zip: cards[0].zip,
            borough: cards[0].borough,
            usd: [...uniqFigures.values()].reduce((s, v) => s + v, 0),
            oneFigure: uniqFigures.size === 1 && pricedMembers > 1,
            violations: cards.reduce((s, m) => s + (m.violations || 0), 0),
          });
        }
        out[key] = grouped;
      } else {
        out[key] = sorted;
      }
    }
    out._counts = counts;
    return out;
  }, [onlyWatch, watch, fb, showHidden, deferredQuery, boro, sortMode, onlyWorking, cohort, contacts]);
  // A sort that does not exist on the register you just switched to would leave
  // the control showing nothing while the list quietly reordered itself.
  useEffect(() => {
    const allowed = (REG_SORTS[vertical] || []).map(([v]) => v);
    if (allowed.length && !allowed.includes(sortMode)) setSortMode(allowed[0]);
    // Carbon defaults to priced exposure; only the untouched generic default is
    // overridden, a sort the user picked survives the tab switch.
    if (vertical === 'carbon' && sortMode === 'profile') setSortMode('exposure');
    const chips = vertical === 'facades' ? profile.cohorts || [] : REG_COHORTS[vertical] || [];
    if (cohort && !chips.includes(cohort)) setCohort(null);
  }, [vertical]);

  // Two shapes of the same list: the feed renders the grouped rows, everything
  // that counts or maps buildings works on the flat one.
  const mandateRows = mandateLists[vertical] || [];
  const mandateList = useMemo(() => mandateRows.flatMap((r) => (r.group ? r.cards : [r])), [mandateRows]);
  const openingsNoBoro = useMemo(
    () =>
      liveOpenings.filter((o) => {
        if (showHidden !== isDismissed('o:' + o.id)) return false;
        if (!showHidden && taughtAway('o:', o)) return false;
        if (onlyWatch && !isWatched('o:' + o.id)) return false;
        if (cohort && !(COHORTS[cohort]?.of(o) ?? true)) return false;
        const q = deferredQuery.trim().toLowerCase();
        if (!q) return true;
        return [o.name, o.identity, o.legal, o.address, o.county, o.kind, o.zip, o.phone]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
      }),
    [liveOpenings, onlyWatch, watch, fb, showHidden, deferredQuery, cohort],
  );
  const openingsCounts = useMemo(() => {
    const m = { all: openingsNoBoro.length };
    for (const o of openingsNoBoro) m[o.county] = (m[o.county] || 0) + 1;
    return m;
  }, [openingsNoBoro]);
  const openingsList = useMemo(
    () =>
      openingsNoBoro
        .filter((o) => boro === 'all' || o.county === boro)
        .sort(OPENING_SORTS[sortMode] || OPENING_SORTS.recent),
    [openingsNoBoro, sortMode, boro, contacts],
  );
  // How common each signal is across the rows on screen, so a card can lead with
  // what makes it different.
  // A bare urgency score means nothing to someone reading their first card. What
  // they can act on is where it sits against the rest of the register.
  const urgencyRank = useMemo(() => {
    const scores = facadeFeed.map((c) => c.urgencyScore).sort((a, b) => b - a);
    return (score) => {
      const above = scores.filter((x) => x > score).length;
      const pct = Math.max(1, Math.round((100 * (above + 1)) / (scores.length || 1)));
      return pct <= 25 ? `top ${pct}%` : `${pct}th percentile`;
    };
  }, [facadeFeed]);

  const signalFreq = useMemo(() => {
    const m = {};
    for (const c of filteredFeed) for (const sg of c.signals) m[sg.kind] = (m[sg.kind] || 0) + 1;
    return m;
  }, [filteredFeed]);

  const visibleForReasons =
    vertical === 'facades'
      ? filteredFeed
      : MANDATES[vertical]
        ? mandateList
        : vertical === 'contracts'
          ? contractsList
          : openingsList;
  const keepShown = useRef(0);
  useEffect(() => {
    // A deep link has just asked for enough rows to reach its target; the
    // vertical it set must not immediately snap the list back to seven.
    if (keepShown.current) {
      setShown(keepShown.current);
      keepShown.current = 0;
      return;
    }
    setShown(7);
  }, [query, boro, onlyNew, onlyWatch, vertical, showHidden, onlyPortfolio, hideBusy]);

  // The expanded card is the product — the address, the deadline, the money,
  // the source, the number to ring. A stranger gives this page twenty seconds
  // and must not have to dig for it, so the top-ranked card of each register
  // arrives already open. Once per register, never over a deep link, and
  // closing it closes it like any other card.
  const autoOpened = useRef({});
  useEffect(() => {
    if (deepLinked.current || autoOpened.current[vertical]) return;
    const top = (visibleForReasons || [])[0];
    if (!top) return;
    autoOpened.current[vertical] = true;
    setOpenId(top.bin || top.id);
  }, [vertical, visibleForReasons]);

  // A register shows up only if this trade can act on it *and* there is enough
  // in it to be worth a page. Counted before the search box and the filters, so
  // typing never makes a tab vanish. A deep link always opens its own register.
  const vertSize = {
    facades: facadeFeed.length,
    // Counted from the whole register, not the filtered view: typing in the
    // search box must never make a tab disappear.
    ...Object.fromEntries(mandateKeys.map((k) => [k, (data[k]?.feed || []).length])),
    contracts: contractsBase.length,
    openings: liveOpenings.length,
  };
  const matchedVerts = VERTICALS.filter(
    (v) =>
      isExplore ||
      v.key === forcedVert.current ||
      (v.key === 'facades' && profile.facade) ||
      (MANDATES[v.key] && profile.mandates?.[v.key]) ||
      (v.key === 'contracts' && profile.cNeed) ||
      (v.key === 'openings' && profile.oNeed),
  );
  const bigEnough = matchedVerts.filter((v) => v.key === forcedVert.current || vertSize[v.key] >= MIN_LIST);
  const matchedVertKeys = (bigEnough.length ? bigEnough : matchedVerts).map((v) => v.key);
  // Hiding the registers a trade cannot act on keeps the strip honest, but it
  // also hides that they exist. The trailing button opens the rest without
  // discarding the trade, and folds them away again.
  const restVerts = VERTICALS.filter((v) => !matchedVertKeys.includes(v.key) && vertSize[v.key] >= MIN_LIST);
  const visibleVerts = (
    bigEnough.length ? bigEnough : matchedVerts.length ? matchedVerts.slice(0, 1) : VERTICALS.slice(0, 1)
  ).concat(showAllVerts ? restVerts : []);
  const pickedVert = useRef(false);
  useEffect(() => {
    const here = visibleVerts.some((v) => v.key === vertical);
    // A deep link, or a tab this visitor chose, always wins.
    if (here && (pickedVert.current || forcedVert.current)) return;
    // Otherwise open where the work is. Property management matched on facades
    // and landed on seven cards while its twelve hundred sat two tabs away.
    const best = [...visibleVerts].sort((a, b) => (vertSize[b.key] || 0) - (vertSize[a.key] || 0))[0];
    const next = (best || visibleVerts[0]).key;
    if (next !== vertical) setVertical(next);
  }, [profileKey, visibleVerts.map((v) => v.key).join()]);

  // How much work each trade can act on right now: facade rows that pass its own
  // filter, plus the awards and venue filings it can use. The picker is ordered
  // by that number, so the trades with a real feed sit in front.
  const tradeVolume = useMemo(() => {
    const m = {};
    for (const k of Object.keys(PROFILES)) {
      const p = PROFILES[k];
      const f = p.facade ? data.facades.feed.filter(p.facade.fFilter || (() => true)).length : 0;
      const c = p.cNeed ? liveContracts.filter(p.cFilter || (() => true)).length : 0;
      const o = p.oNeed ? liveOpenings.length : 0;
      // The building registers count too, or the picker ranks a trade by the
      // one register it happens to share with everyone else.
      const mand = mandateKeys.reduce((n, key) => n + (p.mandates?.[key] ? (data[key]?.feed || []).length : 0), 0);
      m[k] = { facades: f, contracts: c, openings: o, mandates: mand, total: k === 'explore' ? -1 : f + c + o + mand };
    }
    return m;
  }, [liveContracts, liveOpenings]);
  const orderedTrades = useMemo(
    () => Object.keys(PROFILES).sort((a, b) => tradeVolume[b].total - tradeVolume[a].total),
    [tradeVolume],
  );
  // "Just exploring" is offered as its own row below rather than buried at the
  // end of fifteen tiles, so a visitor who does not want to classify themselves
  // can see a way in without expanding anything.
  const pickable = orderedTrades.filter((k) => k !== 'explore');
  // Facade engineering leads the grid by hand: it is the product's deepest
  // register and the trade a first visitor most likely is. Everything else
  // keeps the measured-volume order.
  const primaryTrades = ['qewi', ...pickable.filter((k) => k !== 'qewi')].slice(0, 6);
  const otherTrades = pickable.filter((k) => !primaryTrades.includes(k));

  const hiddenCount = Object.keys(fb).filter((k) => k.startsWith(vertPrefix) && fb[k]?.s === 'dismissed').length;
  // What this device has already picked up. Without it, a follow-up list means
  // scrolling four hundred rows looking for amber dots.
  const isWorking = (k) => ['contacted', 'won'].includes(fb[k]?.s);
  const workingCount = Object.keys(fb).filter((k) => k.startsWith(vertPrefix) && isWorking(k)).length;
  const wn = { ...(data.whatsNew || { buildings: 0, signals: 0, gas: 0, contracts: 0, openings: 0 }), ...(live?.whatsNew || {}) };
  const hasNew =
    wn.buildings + wn.signals + wn.contracts + wn.openings + mandateKeys.reduce((n, k) => n + (wn[k] || 0), 0) > 0;
  const pulled = new Date(data.generatedAt);
  const ago = (t) => {
    const m = Math.max(0, Math.round((now - t) / 60000));
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
  };
  const checksToday = (live?.pulse || []).filter((t) => now - t < 86400000).length;
  // The newness flags are baked at collection time; past a few hours the window
  // they describe is no longer "this week" from the reader's position.
  const feedStale = now - new Date(data.generatedAt).getTime() > 3 * 3600000;
  const lastChangeAt = live?.changedAt || pulled.getTime();
  const lastChangeLabel = ago(lastChangeAt);
  // Each changeLog entry records a tick on which the published feed differed
  // from the one before it. It does NOT record how many items arrived — the
  // counts it carries are the standing 48-hour-fresh population, so summing
  // them counts the same building on every tick it is still fresh.
  const recentDays = useMemo(() => {
    const days = [];
    const log = live?.changeLog || [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const n = log.filter((c) => new Date(c.at).toISOString().slice(0, 10) === key).length;
      days.push({ day: key.slice(5), n });
    }
    return days;
  }, [live, now]);
  const dataAt = live?.changedAt || pulled.getTime();
  const agoLabel = ago(dataAt);
  const isDark = theme ? theme === 'dark' : systemDark;
  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    saveLS('rw.theme', next);
    // A reload, not a repaint: the map style, the 3D materials and every
    // canvas are built from the palette they were born under, and each theme
    // is its own page at ?theme=…, so the switch navigates there.
    const u = new URL(location.href);
    u.searchParams.set('theme', next);
    location.assign(u.toString());
  };

  // Keyed by the hash, not a one-shot boolean: a map pick writes the same kind
  // of deep link, and the boolean meant the FIRST click opened a card and every
  // later one was silently swallowed.
  const lastDeepLink = useRef(null);
  useEffect(() => {
    const m = location.hash.match(/^#(b|c|g|e|k|o)\/(.+)$/);
    if (!m) {
      lastDeepLink.current = null;
      return;
    }
    if (lastDeepLink.current === location.hash) return;
    const [, t, id] = m;
    // idx must be the card's position in the list AS RENDERED — the same sort,
    // the same grouping — or "show idx rows" reveals the wrong slice and the
    // scroll aims at an element that was never mounted. That was the map click
    // that worked every other time: the raw-feed index only sometimes agreed
    // with the tiered sort on screen. The scroll retries once, because the
    // rows it asks for may still be mounting on the first attempt.
    const open = (vert, idx, targetId = id) => {
      lastDeepLink.current = location.hash;
      keepShown.current = Math.max(7, idx + 1);
      setVertical(vert);
      setOpenId(targetId);
      setShown(keepShown.current);
      const scroll = () => document.getElementById(`rw-${targetId}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => {
        if (document.getElementById(`rw-${targetId}`)) return scroll();
        // Still not mounted: the register re-sorted after this index was
        // computed (switching to carbon flips the default sort, for one).
        // Reveal the whole list and poll until the row exists — a fixed second
        // timeout raced an 800-card render and lost.
        setShown(100000);
        let tries = 0;
        const poll = setInterval(() => {
          tries += 1;
          const el = document.getElementById(`rw-${targetId}`);
          if (el || tries > 12) {
            clearInterval(poll);
            // Instant, not smooth: a sixty-thousand-pixel smooth scroll is an
            // animation frame loop, and it dies against a list that is still
            // mounting (and in any backgrounded tab).
            el?.scrollIntoView({ behavior: 'auto', block: 'center' });
          }
        }, 400);
      }, 500);
    };
    if (t === 'b') {
      // A shared building must open for the recipient whatever their saved
      // filters say — a Manhattan-only view, a watchlist filter or an earlier
      // dismissal used to swallow the link with no sign anything happened.
      const target = data.facades.feed.find((c) => c.bin === id);
      const curIdx = filteredFeed.findIndex((c) => c.bin === id);
      if (target && curIdx < 0) {
        setBoro('all');
        setOnlyWatch(false);
        setOnlyNew(false);
        setOnlyPortfolio(false);
        setHideBusy(false);
        setShowHidden(isDismissed('b:' + id));
      }
      const rawIdx = [...data.facades.feed].sort(byUrgency).findIndex((c) => c.bin === id);
      // Filters were just reset for this link: the list re-sorts on the next
      // render and no index computed now is trustworthy — reveal everything
      // once rather than guess and miss.
      const idx = target && curIdx < 0 ? data.facades.feed.length : Math.max(curIdx, rawIdx);
      if (idx >= 0) open('facades', idx);
    } else if (mandateKeys.some((k) => MANDATES[k].prefix[0] === t)) {
      const key = mandateKeys.find((k) => MANDATES[k].prefix[0] === t);
      // The rendered list is grouped: a card inside a portfolio group has no
      // row of its own, so the link opens the GROUP that holds it.
      const rows = mandateLists[key] || [];
      const rowIdx = rows.findIndex((r) => (r.group ? r.cards.some((c) => c.bin === id) : r.bin === id));
      if (rowIdx >= 0) {
        const row = rows[rowIdx];
        open(key, rowIdx, row.group ? row.id : id);
      } else {
        const idx = (data[key]?.feed || []).findIndex((c) => c.bin === id);
        if (idx >= 0) {
          setShowHidden(isDismissed(MANDATES[key].prefix + id));
          setOnlyWatch(false);
          setBoro('all');
          open(key, idx);
        }
      }
    } else if (t === 'c') {
      const idx = Math.max(contractsList.findIndex((c) => c.id === id), liveContracts.findIndex((c) => c.id === id));
      if (idx >= 0) open('contracts', idx);
    } else {
      const idx = Math.max(openingsList.findIndex((o) => o.id === id), liveOpenings.findIndex((o) => o.id === id));
      if (idx >= 0) open('openings', idx);
    }
    // live arrives after mount; a row that only exists there resolves on retry.
  }, [live, reduce, hashTick]);

  // A dialog that does not take focus, hold it, and give it back is unusable
  // with a keyboard or a screen reader.
  const dialogRef = useRef(null);
  const restoreFocus = useRef(null);
  const dialogOpen = showOnboard || portfolioOpen;
  useEffect(() => {
    if (!dialogOpen) {
      restoreFocus.current?.focus?.();
      restoreFocus.current = null;
      return;
    }
    restoreFocus.current = document.activeElement;
    const node = dialogRef.current;
    const focusables = () =>
      [...(node?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])].filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );
    focusables()[0]?.focus();
    const onTab = (e) => {
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onTab);
    return () => document.removeEventListener('keydown', onTab);
  }, [dialogOpen]);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e) => {
      if (!e.target.closest?.('.menu, .btn.dots')) setMenuFor(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuFor]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && showOnboard && profileKey) setShowOnboard(false);
      if (e.key === 'Escape' && portfolioOpen) setPortfolioOpen(false);
      if (e.key === 'Escape' && menuFor) setMenuFor(null);
      if (e.key === '/' && !showOnboard && !/input|textarea|select/i.test(e.target.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    const onScroll = () => setShowTop(window.scrollY > 700);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, [showOnboard, profileKey, portfolioOpen, menuFor]);

  const toggleCard = (type, id, wasOpen) => {
    setOpenId(wasOpen ? null : id);
    try {
      history.replaceState(null, '', wasOpen ? location.pathname : `#${type}/${id}`);
    } catch {}
  };

  const copy = (id, text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    });
  };
  const copyLink = (type, id) => {
    navigator.clipboard?.writeText(`${location.origin}/#${type}/${id}`).then(() => {
      setCopiedLink(id);
      setTimeout(() => setCopiedLink(null), 1600);
    });
  };

  const downloadCsv = (name, header, rows) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportCurrent = () => {
    if (vertical === 'facades') {
      downloadCsv(
        'right-window-buildings.csv',
        ['Address', 'Borough', 'BIN', 'Signals', 'Sub-cycle', 'Deadline', 'Months left', 'Why now', 'DOB facade penalties', 'Unpaid at OATH', 'Next hearing', 'Sold', 'Elevators due', 'Managing agent', 'Agent contact', 'Agent address', 'Suggested opener', 'DOB record', 'Link'],
        filteredFeed.map((c) => [
          title(c.address), c.borough, c.bin,
          c.signals.map((s) => BADGE[s.kind]).join('; '),
          c.subCycle, c.deadline, c.monthsLeft,
          fv.why(c),
          c.finesOwed || 0, c.ecbBalance || 0, c.nextHearing || '',
          c.ownerChange ? `${c.ownerChange.recorded}${c.ownerChange.amount ? ' ' + money(Math.round(c.ownerChange.amount)) : ''}` : '',
          c.elevator ? `${c.elevator.cat1Missing} no CAT1 / ${c.elevator.cat5Due} CAT5 due` : '',
          title(c.agent?.company || ''),
          (() => {
            const ct = contactOf(c, contacts[c.bin]);
            return ct?.phone || ct?.email || '';
          })(),
          title(c.agent?.address || ''),
          fv.opener(c),
          `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${c.bin}`,
          `${location.origin}/#b/${c.bin}`,
        ]),
      );
    } else if (MANDATES[vertical]) {
      const m = MANDATES[vertical];
      const factKeys = mandateList.length ? m.facts(mandateList[0]).map(([k]) => k) : [];
      downloadCsv(
        `right-window-${vertical}.csv`,
        ['Address', 'Borough', 'ZIP', 'BIN', ...factKeys, 'Why now', 'Managing agent', 'Agent address', 'Suggested opener', 'Link'],
        mandateList.map((c) => [
          title(c.address), c.borough, c.zip || '', c.bin,
          ...m.facts(c).map(([, v]) => v),
          profile.mandates?.[vertical]?.(c) || m.whoWins,
          c.agent?.company ? title(c.agent.company) : '',
          c.agent?.address ? title(c.agent.address) : '',
          m.opener(c),
          `${location.origin}/#${m.prefix[0]}/${c.bin}`,
        ]),
      );
    } else if (vertical === 'contracts') {
      downloadCsv(
        'right-window-contracts.csv',
        ['Kind', 'Vendor or title', 'Amount', 'Agency', 'Contract', 'Awarded', 'Days ago', 'Bids due', 'Days to bid', 'PIN', 'Contact', 'Phone', 'Email', 'Why you', 'Vendor address', 'Suggested opener', 'Link'],
        contractsList.map((c) => [
          c.kind === 'SOLICITATION' ? 'Open for bids' : c.kind === 'INTENT' ? 'Intent to award' : 'Award',
          isOpenNotice(c) ? c.title : c.vendor,
          c.amount ?? '', c.agency, c.title, c.date ?? '', c.daysAgo ?? '',
          c.dueDate ? c.dueDate.slice(0, 10) : '', c.daysLeft ?? '', c.epin || '',
          c.contact?.name || '', c.contact?.phone || '', c.contact?.email || '',
          isOpenNotice(c)
            ? c.scope || `${c.category} · ${c.method}`
            : profile.cNeed?.(c) || 'Winner is mobilizing: subs, bonding, insurance, staffing, equipment.',
          c.vendorAddress || '',
          (profile.cOpener || defaultCOpener)(c),
          `${location.origin}/#c/${c.id}`,
        ]),
      );
    } else {
      downloadCsv(
        'right-window-openings.csv',
        ['Venue', 'Type', 'County', 'Premises', 'Legal name', 'Filed', 'Why you', 'Suggested opener', 'Link'],
        openingsList.map((o) => [
          venueName(o), o.kind, o.county, o.address, o.legal || '', o.received || '',
          profile.oNeed?.(o) || 'Opening in 2–4 months: POS, insurance, suppliers, furniture, marketing get chosen now.',
          (profile.oOpener || defaultOOpener)(o),
          `${location.origin}/#o/${o.id}`,
        ]),
      );
    }
  };

  // Gross is arithmetic; expected is what a contractor will actually close.
  // Both are shown — the arrow between them is the honest part. Counted per
  // vertical: a signal someone else already claimed is not yours to count.
  // Counted against the live pool, not the current view: with the "Hidden"
  // toggle on, the view lists hold only dismissed rows, and sizing a pipeline
  // from buildings the user threw away is worse than showing nothing.
  const openCount = useMemo(() => {
    if (vertical === 'facades')
      return filteredFeed.filter(
        (c) => !isDismissed('b:' + c.bin) && !c.occupied && statusOf('b:' + c.bin) !== 'taken',
      ).length;
    if (MANDATES[vertical])
      return mandateList.filter(
        (c) => !isDismissed(vertPrefix + c.bin) && statusOf(vertPrefix + c.bin) !== 'taken',
      ).length;
    if (vertical === 'contracts')
      return contractsList.filter((c) => !isDismissed('c:' + c.id) && statusOf('c:' + c.id) !== 'taken').length;
    return openingsList.filter((o) => !isDismissed('o:' + o.id) && statusOf('o:' + o.id) !== 'taken').length;
  }, [vertical, filteredFeed, mandateList, vertPrefix, contractsList, openingsList, claims, mine, now, fb]);

  // The base is the ACTIONABLE set, not the register: openCount counts the rows
  // left after the trade profile, the register tab, the borough and cohort chips,
  // the ZIP territory filter, the search box and everything hidden or taught
  // away. It moves as the filters move, which is the point — a crew typing its
  // own ZIPs should watch the figure answer.
  //
  // The horizon comes from the register's own deadline where the visible rows
  // share one, because a sum with no period attached cannot be checked, and a
  // number that cannot be checked is not believed. Where there is no deadline in
  // the data, the figure is labelled per year rather than given a made-up date.
  const myPipeline = useMemo(() => {
    const n = openCount;
    if (!n) return null;
    const rows = visibleForReasons || [];

    // The EARLIEST deadline the visible rows carry — the one a contractor is
    // racing — computed first because both the arrivals term and the default
    // crew capacity are sized to it.
    const todayIso = new Date(now).toISOString().slice(0, 10);
    let horizon = null;
    for (const c of rows) {
      const d = c?.deadline;
      if (typeof d === 'string' && d.length === 10 && d >= todayIso && (!horizon || d < horizon)) horizon = d;
    }
    const weeks = horizon ? Math.max(0, (new Date(horizon) - now) / (7 * 86400000)) : 0;

    // The contract value: one pure resolution path, no matter the viewport,
    // the register opened first, or anything stored. lib/deal-basis.mjs is the
    // only place the order lives, and scripts/test-basis.mjs locks it.
    const { avg, basis } = resolveDealBasis({
      explicitTicket: Number(loadLS('rw.ticket', 0)) > 0,
      ticket: Number.isFinite(ticket) ? ticket : 0,
      winsRecorded: winStats.recorded,
      winsMedian: winStats.median,
      profileKey,
      viewCosts: rows.map((c) => c?.filing?.cost).filter((v) => Number.isFinite(v) && v > 0),
      registerCosts:
        vertical === 'facades' ? facadeFeed.map((c) => c.filing?.cost).filter((v) => Number.isFinite(v) && v > 0) : [],
      profileFee: ticketFor(profileKey, vertical),
      fallbackFee: ticketFor('qewi', vertical),
    });
    if (!avg) return null;
    const assumed = basis === 'constant' || basis === 'fee';

    const explicitRate = loadLS('rw.closeRate', null) != null;
    const rate = explicitRate && Number.isFinite(closeRate) && closeRate > 0
      ? clampRate(closeRate)
      : winStats.ratio > 0
        ? clampRate(winStats.ratio)
        : DEFAULT_CLOSE_RATE;
    const rateBasis = explicitRate ? 'yours' : winStats.ratio > 0 ? 'wins' : 'default';

    // Nobody works a whole register. Expected is bounded by what one crew can
    // actually pursue before the deadline — the user's figure if they set one,
    // else sized to the window.
    const capSaved = capacitySaved;
    const capacity = capSaved > 0 ? Math.round(capSaved) : defaultCapacity(weeks);
    const workN = Math.min(n, capacity);
    const wins = Math.max(1, Math.round(workN * rate));
    const winSum = wins * avg;

    // The gross stays whole-register context: today's list plus the measured
    // arrival rate carried to the deadline, scaled to the filtered share.
    const perWeek = vertical === 'facades' ? wn.buildings || 0 : vertical === 'contracts' ? wn.contracts || 0 : vertical === 'openings' ? wn.openings || 0 : wn[vertical] || 0;
    const registerSize = vertSize[vertical] || n;
    const share = registerSize > 0 ? Math.min(1, n / registerSize) : 1;
    const arriving = Math.round(perWeek * weeks * share);
    const gross = (n + arriving) * avg;
    if (!Number.isFinite(gross) || gross <= 0) return null;

    return {
      n,
      avg,
      rate,
      gross,
      expected: winSum,
      capacity,
      capExplicit: capSaved > 0,
      workN,
      wins,
      arriving,
      weeks: Math.round(weeks),
      horizon,
      assumed,
      basis,
      rateBasis,
    };
  }, [ticket, closeRate, capacitySaved, openCount, profileKey, vertical, visibleForReasons, facadeFeed, winStats, now, wn, vertSize]);

  // Below ~40 actionable signals, "win N" replaces expected value: a plainly
  // reachable share, floored at two so it never reads as a dare.
  const winTarget = (n) => Math.min(n, Math.max(2, Math.round(n * 0.2)));
  // Every funnel figure names its basis, because the number is only believed
  // when the reader can see where it came from.
  const basisLabel = (p) =>
    p.basis === 'yours'
      ? `${fmtMoney(p.avg)} avg contract — yours`
      : p.basis === 'wins'
        ? `${fmtMoney(p.avg)} — median of your ${winStats.recorded} recorded wins`
        : p.basis === 'view'
          ? `${fmtMoney(p.avg)} — median declared job cost in this view`
          : p.basis === 'register'
            ? `${fmtMoney(p.avg)} — median declared job cost on this register`
            : p.basis === 'fee'
              ? `${fmtMoney(p.avg)} — your trade's fee per building`
              : `assuming a ${fmtMoney(p.avg)} average job`;
  const rateLabel = (p) =>
    p.rateBasis === 'yours'
      ? `${Math.round(p.rate * 100)}% close rate — yours`
      : p.rateBasis === 'wins'
        ? `${Math.round(p.rate * 100)}% close — based on your ${winStats.touched} recorded outcomes`
        : `${Math.round(p.rate * 100)}% close rate — assumed for mandated work`;
  // Carbon's money is the city's arithmetic summed over the filtered view.
  const carbonMoney = useMemo(() => {
    if (vertical !== 'carbon') return { n: 0, priced: 0, sum: 0, max: 0 };
    const priced = mandateList.filter((c) => c.ghg?.usd > 0);
    // Same rule as the grouped rows: a campus's one benchmarking figure stamped
    // on every BIN counts once in the aggregate, or the headline number
    // multiplies a single report by the number of doors it covers.
    const seen = new Map();
    for (const c of priced) {
      const agent = String(c.agent?.company || c.zip || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      seen.set(`${agent}|${c.ghg.t}|${c.ghg.usd}`, c.ghg.usd);
    }
    return {
      n: mandateList.length,
      priced: priced.length,
      sum: [...seen.values()].reduce((s, v) => s + v, 0),
      max: priced.reduce((m, c) => Math.max(m, c.ghg.usd), 0),
    };
  }, [vertical, mandateList]);

  const heroText =
    vertical === 'facades'
      ? fv.hero
      : vertical === 'gas'
        ? 'Buildings already cited — *with another deadline closing*'
        : vertical === 'elevators'
          ? 'Lifts that skipped a test — *not the ones running late*'
          : vertical === 'carbon'
            ? 'Buildings the city has *named on carbon*'
        : vertical === 'contracts'
          ? 'City work you can still *bid on today*'
          : 'Venues that will open their doors *in a few months*';

  const heroSub =
    vertical === 'facades'
      ? fv.subline ||
        "Every building over six stories runs on a public compliance clock. We surface the ones that fell off it — with the deadline and the person to call."
      : vertical === 'gas'
        ? 'Local Law 152 puts every gas-piped building on a four-year clock by community district. These are the ones DOB has already cited and whose next filing is due. Every one is in sub-cycle C, so they share a deadline: 31 December 2026.'
        : vertical === 'elevators'
          ? 'Half the city has not filed this year\u2019s CAT1 test yet, which is the calendar, not a signal. These are the buildings that skipped a whole cycle — and still have until December 31 to put both right.'
          : vertical === 'carbon'
            ? 'Local Law 97 covers tens of thousands of buildings and DOB has cited about four thousand for not filing an emissions report. These are the cited buildings whose own benchmarking lets us price the exposure — reported CO2e against an estimated cap, at \u0024268 a ton over.'
        : vertical === 'contracts'
          ? 'Open solicitations with a filed deadline and the agency officer named on the notice — plus the awards that just landed, where the winner has two weeks to line up subs and bonding.'
          : 'Two records, both public. A liquor licence names a venue two to four months out. A Health Department permit with no inspection against it names one that has not opened at all — and prints the number to ring.';

  // The 30-second hook: a hard city deadline with a countdown, not a product pitch.
  const deadlineIso = '2027-02-21';
  const monthsToDeadline = Math.max(0, Math.round((new Date(deadlineIso) - now) / (30.44 * 86400000)));
  const monthsToCarbon = Math.max(0, Math.round((new Date('2027-05-01') - now) / (30.44 * 86400000)));

  const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 };
  const fade = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1], delay },
        };

  // Every register gets a way to cut its list. A Brooklyn crew handed 400 cards
  // across four boroughs with no filter is being handed a spreadsheet.
  // What a column's tooltip says: the address, the firm, and the fact that makes
  // this card a call. One line, because it follows the pointer.
  const mapDescribe = useCallback(
    (c) => {
      const who = c.agent?.company ? ` · ${title(c.agent.company)}` : c.name ? ` · ${c.name}` : '';
      const fact = c.nextHearing
        ? ` · hearing ${usShort(c.nextHearing)}`
        : c.finesOwed > 0
          ? ` · ${money(c.finesOwed)} assessed`
          : c.lastCat1 === null && c.devices
            ? ' · never filed'
            : c.monthsLeft != null
              ? ` · ${c.monthsLeft} mo left`
              : '';
      return `${title(c.address || '')}${who}${fact}`;
    },
    [],
  );
  // The popup's number: the same waterfall the feed rows use — served contact
  // first, then whatever the city printed on the record.
  const mapContact = useCallback(
    (c) => contacts[c.bin]?.phone || c.phone || c.contact?.phone || null,
    [contacts],
  );
  const mapPick = useCallback(
    (p) => {
      const id = p.card.bin || p.card.id;
      if (!id) return;
      // The deep link the cards already answer to: it forces the list to show
      // enough rows to reach the target and opens it. Re-picking the card the
      // hash already names fires no hashchange, so that case re-arms the
      // handler by hand — closing a card and tapping its dot again must work.
      const target = `#${vertPrefix.replace(':', '')}/${id}`;
      if (location.hash === target) {
        lastDeepLink.current = null;
        setHashTick((n) => n + 1);
      } else {
        location.hash = target;
      }
    },
    [vertPrefix],
  );

  const mapSlot = (
    <>
      {HEROES[vertical] && (
          <div className={'massing-slot' + (vertical === 'contracts' ? ' scene-only' : '')}>
            {/* Registers with coordinates put the register ITSELF in the hero:
                the live map of the filtered list, not an illustration of the
                kind of thing the list contains. Contracts keep their built
                scene — a solicitation has no address to stand on. The skeleton
                is the same outline twice over: the loading state before
                MapLibre arrives, and the whole map on a phone, where MapLibre
                never loads at all. */}
            {vertical !== 'contracts' && <MapSkeleton cards={visibleForReasons || []} loading={sceneReady} onPick={mapPick} />}
            {sceneReady &&
              (vertical !== 'contracts' ? (
                <Suspense fallback={null}>
                  <CityMap
                    compact
                    rows={(visibleForReasons || []).map((card) => ({ card }))}
                    colors={themeColors}
                    reduced={reduce}
                    onPick={mapPick}
                    describe={mapDescribe} contactFor={mapContact}
                  />
                </Suspense>
              ) : (
                <Suspense fallback={null}>
                  {React.createElement(HEROES[vertical].Scene, {
                    colors: themeColors,
                    reduced: reduce,
                    className: 'massing',
                    ...(HEROES[vertical].variant ? { variant: HEROES[vertical].variant } : {}),
                  })}
                </Suspense>
              ))}
            {vertical === 'contracts' && <span className="massing-cap">{HEROES[vertical].cap}</span>}
          </div>
      )}
    </>
  );

  const mapPanel = (list) =>
    showMap && sceneReady ? (
      <Suspense fallback={<div className="citymap-wrap" aria-hidden="true" />}>
        <CityMap
          rows={list.map((card) => ({ card }))}
          colors={themeColors}
          reduced={reduce}
          onPick={mapPick}
          describe={mapDescribe}
          contactFor={mapContact}
          startBig={mapParam === 'big'}
        />
      </Suspense>
    ) : null;

  const miniToolbar = (list, total, { boroughs = false, counts = null } = {}) => (
    <div className="toolbar">
      {(REG_SORTS[vertical] || []).length > 0 && (
        <select className="sel" value={sortMode} onChange={(e) => setSortMode(e.target.value)} aria-label="Sort">
          {REG_SORTS[vertical].map(([v, l]) => (
            <option key={v} value={v}>
              Sort: {l}
            </option>
          ))}
        </select>
      )}
      <input
        type="search"
        className="search"
        placeholder={boroughs ? 'Search address, agent, or ZIP…' : 'Search name, agency, or title…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search this register"
      />
      {boroughs && (
        <div className="chips" role="group" aria-label="Borough">
          {['all', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'].map((b) => {
            // Faceted: counted against the rows the other filters left, so the
            // chips can never contradict the map. A borough the register never
            // touches stays hidden; one the current filters empty is dimmed.
            const pool = data[vertical]?.feed || (Array.isArray(data[vertical]) ? data[vertical] : []);
            const ever = b === 'all' || pool.some((c) => (c.borough || c.county) === b);
            if (!ever) return null;
            const n = counts ? counts[b === 'all' ? 'all' : b] || 0 : b === 'all' ? total : pool.filter((c) => (c.borough || c.county) === b).length;
            return (
              <button
                key={b}
                className={'chip' + (boro === b ? ' on' : '') + (!n && boro !== b ? ' dim' : '')}
                aria-pressed={boro === b}
                onClick={() => setBoro(b)}
              >
                {b === 'all' ? 'All' : b} <i>{n}</i>
              </button>
            );
          })}
        </div>
      )}
      {(REG_COHORTS[vertical] || []).map((k) => {
        const def = COHORTS[k];
        if (!def) return null;
        const pool = data[vertical]?.feed || data[vertical] || [];
        const n = pool.filter(def.of).length;
        // A filter that selects the whole register tells you nothing.
        if (!n || n === pool.length) return null;
        return (
          <button
            key={k}
            className={'chip-btn' + (cohort === k ? ' on' : '')}
            aria-pressed={cohort === k}
            onClick={() => setCohort(cohort === k ? null : k)}
          >
            {def.label} ({n})
          </button>
        );
      })}
      {workingCount > 0 && (
        <button
          className={'chip-btn' + (onlyWorking ? ' on' : '')}
          aria-pressed={onlyWorking}
          onClick={() => setOnlyWorking((v) => !v)}
          title="Everything you have marked Contacted or Won on this device"
        >
          Working ({workingCount})
        </button>
      )}
      <button className={'chip-btn' + (onlyWatch ? ' on' : '')} aria-pressed={onlyWatch} onClick={() => setOnlyWatch((v) => !v)}>
        ★ Watchlist{watchCount ? ` (${watchCount})` : ''}
      </button>
      {hiddenCount > 0 && (
        <button className={'chip-btn' + (showHidden ? ' on' : '')} aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
          Hidden ({hiddenCount})
        </button>
      )}
      {sceneReady && vertical !== 'contracts' && (
        <button
          className={'chip-btn' + (showMap ? ' on' : '')}
          aria-pressed={showMap}
          onClick={() => setShowMap((v) => !v)}
          title="Every located card on a map of the five boroughs — the same filtered list as below"
        >
          Map
        </button>
      )}
      <button className="chip-btn" onClick={exportCurrent}>Export CSV</button>
      <span className="count">
        {list.length}
        {list.length !== total ? ` of ${total}` : ''} shown
      </span>
    </div>
  );

  if (route === 'trades')
    return (
      <TradesPage
        isDark={isDark}
        onTheme={toggleTheme}
        profiles={PROFILES}
        primary={primaryTrades}
        other={otherTrades}
        volume={tradeVolume}
        onPick={(k) => {
          pickProfile(k);
          window.scrollTo({ top: 0 });
        }}
        onBack={() => {
          goTrade(profileKey || 'explore');
          setRoute('feed');
        }}
      />
    );

  if (route === 'data')
    return (
      <DataPage
        live={live}
        isDark={isDark}
        onTheme={toggleTheme}
        onBack={() => {
          history.replaceState(null, '', location.pathname);
          setRoute('feed');
        }}
      />
    );

  return (
    <div className="wrap">
      <AnimatePresence>
        {showOnboard && (
          <motion.div
            className="modal-back"
            role="dialog"
            aria-modal="true"
            aria-label="What do you do"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? {} : { opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="modal"
              ref={dialogRef}
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? {} : { opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2>What do you do?</h2>
              <p>
                Six registers of New York City public records where somebody has a legal deadline — and the firm to
                call about it. Pick your trade and we will show the ones that are yours this week.
              </p>
              <div className="tiles">
                {primaryTrades.map((k) => (
                  <button key={k} className={'tile' + (profileKey === k ? ' on' : '')} aria-pressed={profileKey === k} onClick={() => pickProfile(k)}>
                    {PROFILES[k].tile}
                  </button>
                ))}
              </div>
              {/* The way out is a real button, not a consolation prize set in
                  the same tertiary caps as a docs link. */}
              <button className="btn solid everything" onClick={() => pickProfile('explore')}>
                Just show me everything
              </button>
              {!showOther ? (
                <div className="more-row-inline">
                  <button className="more-trades" onClick={() => setShowOther(true)}>
                    Other trades ({otherTrades.length})
                  </button>
                  <button
                    className="more-trades"
                    onClick={() => {
                      setShowOnboard(false);
                      history.pushState(null, '', '#trades');
                      setRoute('trades');
                    }}
                  >
                    See all trade pages
                  </button>
                </div>
              ) : (
                <div className="tiles secondary">
                  {otherTrades.map((k) => (
                    <button key={k} className={'tile' + (profileKey === k ? ' on' : '')} aria-pressed={profileKey === k} onClick={() => pickProfile(k)}>
                      {PROFILES[k].tile}
                    </button>
                  ))}
                </div>
              )}
              {profileKey && profileKey !== 'explore' && (
                <div className="ticket">
                  <label htmlFor="tk">Your average contract</label>
                  <div className="ticket-row">
                    {[50000, 180000, 500000].map((v) => (
                      <button key={v} className={'chip-btn' + (ticket === v ? ' on' : '')} aria-pressed={ticket === v} onClick={() => saveTicket(v)}>
                        {fmtUsd(v)}
                      </button>
                    ))}
                    <input
                      id="tk"
                      type="text"
                      inputMode="numeric"
                      placeholder="or type it"
                      defaultValue={ticket ? String(ticket) : ''}
                      onBlur={(e) => {
                        const n = Number(String(e.target.value).replace(/[^\d]/g, ''));
                        if (n > 0) saveTicket(n);
                      }}
                    />
                  </div>
                  <label htmlFor="cr" className="second">How many of those do you close?</label>
                  <div className="ticket-row">
                    {[2, 3, 5, 10].map((p) => (
                      <button
                        key={p}
                        className={'chip-btn' + (Math.round(closeRate * 100) === p ? ' on' : '')}
                        aria-pressed={Math.round(closeRate * 100) === p}
                        onClick={() => saveCloseRate(p / 100)}
                      >
                        {p}%
                      </button>
                    ))}
                    <input
                      id="cr"
                      type="number"
                      min="1"
                      max="100"
                      inputMode="numeric"
                      placeholder="%"
                      defaultValue={Math.round(closeRate * 100)}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        saveCloseRate(Number.isFinite(n) && n > 0 ? Math.min(100, Math.max(1, n)) / 100 : DEFAULT_CLOSE_RATE);
                      }}
                    />
                  </div>
                  <label htmlFor="cap" className="second">How many can your crew pursue before the deadline?</label>
                  <div className="ticket-row">
                    {[20, 40, 60].map((v) => (
                      <button key={v} className={'chip-btn' + (capacitySaved === v ? ' on' : '')} aria-pressed={capacitySaved === v} onClick={() => saveCapacity(v)}>
                        {v}
                      </button>
                    ))}
                    <input
                      id="cap"
                      type="number"
                      min="1"
                      inputMode="numeric"
                      placeholder="buildings"
                      defaultValue={capacitySaved || ''}
                      onBlur={(e) => saveCapacity(e.target.value)}
                    />
                  </div>
                  <span className="ticket-note">
                    All three stay on this device and only size your pipeline. The default 8% close rate assumes
                    deadline work the owner is required to buy; unset capacity sizes itself to the window. Set your
                    own if you know them.
                  </span>
                </div>
              )}
              {profileKey && (
                <button className="modal-close" onClick={() => setShowOnboard(false)}>
                  Keep “{profile.label}”
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {portfolioOpen && (
          <motion.div
            className="modal-back"
            role="dialog"
            aria-modal="true"
            aria-label="My buildings"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? {} : { opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.target === e.currentTarget && setPortfolioOpen(false)}
          >
            <motion.div
              className="modal"
              ref={dialogRef}
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? {} : { opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2>My buildings</h2>
              <p>
                Paste the addresses you already work on, one per line. Anything that happens to them reaches you first.
                {portfolio.length > 0 && <> Currently watching <b>{portfolio.length}</b>.</>}
              </p>
              <textarea
                className="pf-input"
                aria-label="Addresses of buildings you work on, one per line"
                rows={7}
                placeholder={'350 5th Ave\n1 Wall St\n255 W 43rd St'}
                value={portfolioText}
                onChange={(e) => setPortfolioText(e.target.value)}
              />
              <div className="pf-actions">
                <button
                  className="btn solid"
                  onClick={() => {
                    const lines = portfolioText.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean);
                    const found = [];
                    const missed = [];
                    for (const line of lines) {
                      const norm = line.replace(/[.,]/g, '').replace(/\b(street|str)\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\s+/g, ' ');
                      const hit = data.facades.feed.find((c) => {
                        const a = c.address.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
                        return a === norm || a.startsWith(norm) || norm.startsWith(a);
                      });
                      if (hit) found.push(hit.bin);
                      else missed.push(line);
                    }
                    const next = [...new Set([...portfolio, ...found])];
                    setPortfolio(next);
                    saveLS('rw.portfolio', next);
                    setPortfolioText(missed.join('\n'));
                    if (found.length) setOnlyPortfolio(true);
                    if (!missed.length) setPortfolioOpen(false);
                  }}
                >
                  Add to my list
                </button>
                {portfolio.length > 0 && (
                  <button
                    className="modal-close"
                    onClick={() => {
                      setPortfolio([]);
                      saveLS('rw.portfolio', []);
                      setOnlyPortfolio(false);
                    }}
                  >
                    Clear list
                  </button>
                )}
                <button className="modal-close" onClick={() => setPortfolioOpen(false)}>Done</button>
              </div>
              {portfolioText.trim() && (
                <p className="pf-miss">Not among the 400 buildings we rank today — the register is far bigger.</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="top">
        <a className="logo" href={theme ? `/?theme=${theme}` : '/'} aria-label="Right Window — back to the front page">
          <svg className="mark" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2.5" y="2.5" width="19" height="19" rx="4.5" stroke="currentColor" strokeWidth="2" />
            <rect x="12.6" y="6.4" width="5.4" height="5.4" rx="1.4" fill="var(--brand)" stroke="none" />
            <path d="M7 12.5v4.5M7 7v1.8M12.5 17h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.35" />
          </svg>
          <b>Right Window</b>
          <span>NYC public records</span>
        </a>
        <div className="top-right">
          <button
            className="theme-btn"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light' : 'Switch to dark'}
            aria-label={isDark ? 'Switch to light' : 'Switch to dark'}
            aria-pressed={isDark}
          >
            {isDark ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
          </button>
          <a
            className="contact-chip"
            href={`mailto:${CONTACT.email}?subject=Right%20Window`}
            title={`Email ${CONTACT.name}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
              <path d="m3 6 9 7 9-7" />
            </svg>
            Contact
          </a>
          <button className="profile-chip" onClick={() => setShowOnboard(true)}>
            {profileKey ? `${profile.label} — not you?` : 'What do you do?'} <span aria-hidden="true">›</span>
          </button>
          <div className="pulled">
            <motion.span
              className="dot"
              animate={reduce ? {} : { opacity: [1, 0.35, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span title={`We check every 5 minutes and sweep the buildings hourly; the second figure is when a city department last published something new, which is their cadence and not ours. Last build: ${pulled.toLocaleString('en-US')}`}>
              {checkedAt || live?.checkedAt
                ? `checked ≤${ago(live?.checkedAt || checkedAt)} · city published ${agoLabel}`
                : `city published ${agoLabel}`}
            </span>
            <span className="etclock" title="New York time">
              {new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET
            </span>
          </div>
        </div>
      </header>

      <LayoutGroup>
        <div className="verticals" role="tablist" aria-label="Pick a register">
          {visibleVerts.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={vertical === v.key}
              tabIndex={vertical === v.key ? 0 : -1}
              className={vertical === v.key ? 'on' : ''}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const i = visibleVerts.findIndex((x) => x.key === vertical);
                const next = visibleVerts[(i + d + visibleVerts.length) % visibleVerts.length];
                pickedVert.current = true;
                setVertical(next.key);
                setOpenId(null);
                setShown(7);
                e.currentTarget.parentElement?.querySelectorAll('[role=tab]')[
                  visibleVerts.indexOf(next)
                ]?.focus();
              }}
              onClick={() => {
                pickedVert.current = true;
                setVertical(v.key);
                setOpenId(null);
                setShown(7);
              }}
            >
              {vertical === v.key && (
                <motion.span className="vpill" layoutId="vertical-pill" transition={spring} aria-hidden="true" />
              )}
              <span className="tlabel">{v.label}</span>
            </button>
          ))}
          {restVerts.length > 0 && (
            <button className="vmore" onClick={() => setShowAllVerts((v) => !v)}>
              {showAllVerts ? 'Fewer' : `+${restVerts.length} more`}
            </button>
          )}
        </div>
      </LayoutGroup>

      <div className="lede">
        <section className="hero">
          {vertical === 'facades' ? (
            <motion.div className="hook" {...fade(0)}>
              <b>
                <CountUp value={data.facades.totals.nonFilers10A} />
              </b>
              <i>buildings</i>
              <span>
                have not filed their sub-cycle 10A facade report. The deadline is {usDate(deadlineIso)} —{' '}
                <strong>{monthsToDeadline} months out</strong>. After that: $1,000 a month, per building.
              </span>
            </motion.div>
          ) : vertical === 'carbon' ? (
            <motion.div className="hook" {...fade(0)}>
              <b>
                <CountUp value={data.carbon?.totals?.cited || 0} />
              </b>
              <i>buildings</i>
              <span>
                cited under Local Law 97 with no accepted emissions report. The next report is due May 1, 2027 —{' '}
                <strong>{monthsToCarbon} months out</strong>. Over the cap: $268 a ton, every year.
              </span>
            </motion.div>
          ) : (
            <div className="eyebrow">New York City · public records, read hourly</div>
          )}
          {vertical === 'facades' && fv.eyebrow && <div className="eyebrow">{fv.eyebrow}</div>}
          {/* No AnimatePresence here on purpose. The crossfade leaves the old
              headline mounted until its exit transition finishes, and a tab that
              is in the background does not run transitions — so switching
              register while hidden left the previous register's headline on
              screen at full opacity and the real one at zero. The headline names
              what you are looking at; it must never be able to lag behind it. */}
          <motion.h1
            key={vertical + profileKey}
            // Rises, never fades. An element whose only visible state is the end
            // of an animation is invisible if that animation does not run.
            initial={reduce ? false : { y: 10 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {emphasize(heroText)}
          </motion.h1>
          <motion.p {...fade(0.05)}>{heroSub}</motion.p>
          {vertical === 'carbon' ? (
            carbonMoney.n > 0 && (
              <motion.div className="pipe" {...fade(0.1)}>
                <b>
                  <Rolling value={carbonMoney.sum} format={fmtMoney} />/year
                </b>
                <span className="pipe-note">
                  {/* Not a close-rate funnel on purpose: this buyer sells against a
                      recurring penalty, and the register prices it from each
                      building's own reported emissions — the one register where
                      the dollar figure is the city's arithmetic, not ours. */}
                  of priced exposure across {carbonMoney.priced.toLocaleString('en-US')} of{' '}
                  {carbonMoney.n.toLocaleString('en-US')} buildings shown — $268 a ton over the cap, every year, from
                  each building's own reported emissions against an estimated cap; a campus that files one report is
                  counted once{carbonMoney.max > 0 ? ` · largest ${fmtMoney(carbonMoney.max)}/yr` : ''}
                </span>
              </motion.div>
            )
          ) : myPipeline && (vertical === 'facades' || MANDATES[vertical]) ? (
            <motion.div className="pipe" {...fade(0.1)}>
              {/* The big-figure arrow is back by request — what the register
                  holds, and what a crew takes home — but the expected side
                  stays BOUNDED: it is the win count times the contract value,
                  never the whole register times a rate. The sentence that
                  says what has to happen moved into the note, leading it. */}
              <span className="gross">
                <Rolling value={myPipeline.gross} format={fmtMoney} /> open
              </span>
              <span className="arrow" aria-hidden="true">→</span>
              <b
                title={
                  myPipeline.n > myPipeline.capacity
                    ? `work ${myPipeline.capacity} of ${myPipeline.n} × ${Math.round(myPipeline.rate * 100)}% close = ${myPipeline.wins} won × ${fmtMoney(myPipeline.avg)} = ${fmtMoney(myPipeline.expected)}`
                    : `win ${winTarget(myPipeline.n)} of ${myPipeline.n} × ${fmtMoney(myPipeline.avg)} = ${fmtMoney(winTarget(myPipeline.n) * myPipeline.avg)}`
                }
              >
                ~<Rolling
                  value={myPipeline.n > myPipeline.capacity ? myPipeline.expected : winTarget(myPipeline.n) * myPipeline.avg}
                  format={fmtMoney}
                />{' '}
                expected{' '}
                <em>
                  {myPipeline.horizon
                    ? `by ${usShort(myPipeline.horizon)} ${myPipeline.horizon.slice(0, 4)}`
                    : 'per year'}
                </em>
              </b>
              <span className="pipe-note">
                <b className="pipe-win">
                  {myPipeline.n.toLocaleString('en-US')} building{myPipeline.n === 1 ? '' : 's'}
                  {zipsIn(deferredQuery) ? ' in your ZIPs' : boro !== 'all' ? ` in ${boro}` : ''} must file
                  {myPipeline.horizon ? ` before ${usShort(myPipeline.horizon)}` : ''} —{' '}
                  {myPipeline.n > myPipeline.capacity
                    ? `work ${myPipeline.capacity}, win ${myPipeline.wins}.`
                    : `win ${winTarget(myPipeline.n)}.`}
                </b>{' '}
                <em className="pipe-asof">for one crew, on today's register — it refills as the city publishes</em>
                {myPipeline.arriving ? (
                  <span className="pipe-arr">
                    {' '}· +{myPipeline.arriving.toLocaleString('en-US')} more by the deadline at this week's rate
                  </span>
                ) : null}{' '}
                · {basisLabel(myPipeline)} · {rateLabel(myPipeline)} ·{' '}
                <button className="linkish" onClick={() => setShowOnboard(true)}>change</button>
              </span>
            </motion.div>
          ) : myPipeline ? (
            <motion.div className="pipe" {...fade(0.1)}>
              <span className="gross">
                <Rolling value={myPipeline.gross} format={fmtMoney} /> open
              </span>
              <span className="arrow" aria-hidden="true">→</span>
              <b
                title={
                  myPipeline.arriving
                    ? `(${myPipeline.n} shown + ${myPipeline.arriving} arriving over ${myPipeline.weeks} weeks at the measured rate) × ${fmtMoney(myPipeline.avg)} × ${Math.round(myPipeline.rate * 100)}% = ${fmtMoney(myPipeline.expected)}`
                    : `${myPipeline.n} shown × ${fmtMoney(myPipeline.avg)} × ${Math.round(myPipeline.rate * 100)}% close rate = ${fmtMoney(myPipeline.expected)}`
                }
              >
                ~<Rolling value={myPipeline.expected} format={fmtMoney} /> expected{' '}
                <em>
                  {myPipeline.horizon
                    ? `by ${usShort(myPipeline.horizon)} ${myPipeline.horizon.slice(0, 4)}`
                    : 'per year'}
                </em>
              </b>
              <span className="pipe-note">
                {/* "shown", not "open": the figure is the filtered view, and
                    saying so is what makes it move credibly when you filter. */}
                <em className="pipe-asof">for one crew, on today's register — it refills as the city publishes</em>{' '}
                · {myPipeline.n.toLocaleString('en-US')}{' '}
                {vertical === 'contracts'
                  ? `${myPipeline.n === 1 ? 'opportunity' : 'opportunities'}`
                  : (vertical === 'openings' ? 'opening' : MANDATES[vertical] ? 'building' : 'signal') +
                    (myPipeline.n === 1 ? '' : 's')}{' '}
                shown{myPipeline.arriving ? ` + ${myPipeline.arriving.toLocaleString('en-US')} more by then at this week's rate` : ''} ·{' '}
                {basisLabel(myPipeline)} · {rateLabel(myPipeline)} ·{' '}
                <button className="linkish" onClick={() => setShowOnboard(true)}>change</button>
              </span>
            </motion.div>
          ) : null}
          {/* Pipeline math shrinks exactly when the user makes it personal;
              payback does not. */}
          {myPipeline && vertical !== 'carbon' && (vertical === 'facades' || MANDATES[vertical]) && myPipeline.avg >= PLAN_PRICE_YEAR && (
            <motion.p className="payback" {...fade(0.14)}>
              One filing at {fmtMoney(myPipeline.avg)} covers a year of your borough plan.
            </motion.p>
          )}
          {winStats.total > 0 && (
            <p className="recorded-line">{fmtMoney(winStats.total)} recorded through Right Window</p>
          )}

        </section>
      {/* The hero map on desktop; on a phone it moves BELOW the feed — the
          first card inside 1.2 screens beats the visual, and the drawing is
          still there for whoever scrolls. */}
        {wide && mapSlot}
      </div>

      <motion.div
        key={vertical}
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
      <motion.div className="livestrip" {...fade(0.08)}>
        <button
          className={'news' + (onlyNew ? ' on' : '') + (vertical !== 'facades' || !hasNew ? ' plain' : '')}
          onClick={() => vertical === 'facades' && hasNew && setOnlyNew((v) => !v)}
        >
          <span className="news-dot" aria-hidden="true" />
          <span>
            {hasNew ? (
              <>
                <b>
                  {feedStale ? `New in the week to ${usShort(data.generatedAt.slice(0, 10))}:` : 'New this week:'}
                </b>{' '}
                {[
                  wn.buildings && wn.buildings < data.facades.feed.length
                    ? `${wn.buildings} building${wn.buildings > 1 ? 's' : ''}`
                    : null,
                  wn.signals && `${wn.signals} fresh signal${wn.signals > 1 ? 's' : ''}`,
                  // A register cannot be a hundred per cent new in forty-eight
                  // hours. If the count equals the register, it is a first build
                  // being announced as news and is not shown.
                  ...mandateKeys.map((k) => {
                    const n = wn[k] || 0;
                    const size = (data[k]?.feed || []).length;
                    if (!n || n >= size) return null;
                    return `${n} ${MANDATES[k].noun || 'building'}${n > 1 ? 's' : ''} on ${MANDATES[k].label.toLowerCase()}`;
                  }),
                  wn.contracts && `${wn.contracts} contract${wn.contracts > 1 ? 's' : ''}`,
                  wn.openings && `${wn.openings} venue filing${wn.openings > 1 ? 's' : ''}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </>
            ) : (
              <>
                <b>Nothing new this week.</b> These registers move in sweeps, so a quiet week is normal — the deadlines
                below are still running. We keep checking.
              </>
            )}
          </span>
          {vertical === 'facades' && hasNew && <span className="news-cta">{onlyNew ? 'show all' : 'show only new'}</span>}
        </button>
        <div className="pulseline">
          <span title="Every check writes a timestamp, whether the city published anything or not">
            {/* "checks paused" read as "nobody maintains this" — the one thing
                the header must never say. A short gap is the scheduler being a
                scheduler; only a real one (>3× cadence) is surfaced, sized, and
                worded as a delay rather than neglect. */}
            {!checkedAt || now - checkedAt > 15 * 60000
              ? `checks delayed — last ran ${checkedAt ? ago(checkedAt) : 'before this build'}, resuming`
              : checksToday >= 24
                ? `${checksToday} checks in the last 24h`
                : 'checking every 5 minutes'}
          </span>
          <span aria-hidden="true">·</span>
          <span>last new signal {lastChangeLabel}</span>
          {recentDays.some((d) => d.n > 0) && (
            <span className="spark" aria-label="days the city published something, last 7 days">
              {recentDays.map((d) => (
                <i
                  key={d.day}
                  className={d.n ? 'on' : ''}
                  style={{ height: Math.min(18, 4 + Math.min(14, d.n * 3)) }}
                  title={`${d.day}: the city published ${d.n} ${d.n === 1 ? 'time' : 'times'}`}
                />
              ))}
            </span>
          )}
        </div>
      </motion.div>

        {justDismissed && justDismissed.k.startsWith(vertPrefix) && (
          <motion.div
            className="asked"
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="asked-k">Hidden. Why? Two of the same and we stop showing them</span>
            {reasonsForFeed(vertPrefix, justDismissed.card, visibleForReasons)
              .map((r) => (
                <button
                  key={r.k}
                  className="asked-r"
                  onClick={() => markReason(justDismissed.k, r.k, r.of(justDismissed.card) || NO_LESSON)}
                >
                  {r.label}
                </button>
              ))}
            <button className="asked-x" onClick={() => setJustDismissed(null)} aria-label="Skip the question">
              ×
            </button>
          </motion.div>
        )}
        {learnedRules.filter((r) => r.prefix === vertPrefix).length > 0 && (
          <div className="taught">
            <span className="taught-k">You taught this feed to skip</span>
            {learnedRules
              .filter((r) => r.prefix === vertPrefix)
              .map((r) => (
                <button key={r.id} className="taught-rule" onClick={() => unlearn(r.id)} title="Show these again">
                  {r.text} <span aria-hidden="true">×</span>
                </button>
              ))}
          </div>
        )}

      {vertical === 'facades' && (
        <>
          {(() => {
            // One meter for the whole feed: the sub-cycle clock is the same for
            // every building on it, so drawing it per card said nothing. It used
            // to appear only when a filter narrowed the list to one sub-cycle —
            // the strongest line on the page, hidden from anyone who did not
            // type a ZIP. Now the earliest-deadline sub-cycle carries the bar in
            // every view, with an honest count when the list holds more than one.
            if (!filteredFeed.length) return null;
            const byCycle = {};
            for (const c of filteredFeed) if (c.subCycle && c.deadline) byCycle[c.subCycle] = byCycle[c.subCycle] || { n: 0, deadline: c.deadline };
            for (const c of filteredFeed) if (c.subCycle && byCycle[c.subCycle]) byCycle[c.subCycle].n += 1;
            const cycles = Object.entries(byCycle).sort((a, b) => a[1].deadline.localeCompare(b[1].deadline));
            if (!cycles.length) return null;
            const [cyc, { n: cnt, deadline }] = cycles[0];
            const opens = subOpens(cyc);
            if (!opens || !deadline) return null;
            const elapsed = Math.round(((now - new Date(opens)) / (new Date(deadline) - new Date(opens))) * 100);
            const mixed = cnt < filteredFeed.length;
            return (
              <div className="cycle-bar" title={`Sub-cycle ${cyc} opened ${usDate(opens)}`}>
                <div className="cycle-head">
                  <b>Sub-cycle {cyc}</b>
                  <span>
                    {mixed ? `${cnt.toLocaleString('en-US')} of ${filteredFeed.length.toLocaleString('en-US')} buildings here · ` : ''}
                    <strong>{elapsed}% of the window is gone</strong> · {monthsToDeadline} months to {usDate(deadline)}
                  </span>
                </div>
                <WindowBar opens={opens} deadline={deadline} />
              </div>
            );
          })()}
          <p className="personas-hint">{fv.hint}</p>

          {Object.keys(mine).filter((k) => mine[k] > now).length > 0 && (
            <div className="p-banner">
              <span className="found personal" aria-hidden="true">★</span>
              <span>
                <b>{Object.keys(mine).filter((k) => mine[k] > now).length} reserved for you</b> — a taste of exclusivity.
                On a territory plan every FISP signal in your borough is yours alone, and nobody else sees it.
              </span>
            </div>
          )}
          <div className="legend" aria-hidden="true">
            <span><StatusDot status="open" legend /> open — no one has claimed it</span>
            <span><StatusDot status="taken" legend /> taken — someone is already on it</span>
            <span><StatusDot status="personal" legend /> reserved — yours for 48h</span>
          </div>

          <div className="toolbar">
            <input
              ref={searchRef}
              type="search"
              className="search"
              placeholder="Search address, owner, agent, or ZIP…  ( / )"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search buildings"
            />
            <select className="sel" value={sortMode} onChange={(e) => setSortMode(e.target.value)} aria-label="Sort">
              {REG_SORTS.facades.map(([v, l]) => (
                <option key={v} value={v}>
                  Sort: {l}
                </option>
              ))}
            </select>
            <div className="chips" role="group" aria-label="Borough">
              {[
                ['all', 'All', '', ''],
                ['Manhattan', 'Manhattan', 'mn', '4'],
                ['Brooklyn', 'Brooklyn', 'bk', 'B'],
                ['Queens', 'Queens', 'qn', 'N'],
                ['Bronx', 'Bronx', 'bx', '2'],
              ].map(([b, label, line, glyph]) => {
                const n = b === 'all' ? boroCounts.all : boroCounts[b] || 0;
                // A borough the current filters empty is dimmed, not shown with
                // a stale register-wide count.
                return (
                  <button
                    key={b}
                    className={'chip-btn' + (boro === b ? ' on' : '') + (!n && boro !== b ? ' dim' : '')}
                    aria-pressed={boro === b}
                    onClick={() => setBoro(b)}
                  >
                    {line && <span className={'bullet ' + line} aria-hidden="true">{glyph}</span>}
                    {label}
                    <small>{n}</small>
                  </button>
                );
              })}
            </div>
            {(profile.cohorts || []).map((k) => {
              const def = COHORTS[k];
              if (!def) return null;
              const n = facadeFeed.filter(def.of).length;
              if (!n || n === facadeFeed.length) return null;
              return (
                <button
                  key={k}
                  className={'chip-btn' + (cohort === k ? ' on' : '')}
                  aria-pressed={cohort === k}
                  onClick={() => setCohort(cohort === k ? null : k)}
                >
                  {def.label} ({n})
                </button>
              );
            })}
            {workingCount > 0 && (
              <button
                className={'chip-btn' + (onlyWorking ? ' on' : '')}
                aria-pressed={onlyWorking}
                onClick={() => setOnlyWorking((v) => !v)}
                title="Everything you have marked Contacted or Won on this device"
              >
                Working ({workingCount})
              </button>
            )}
            <button className={'chip-btn' + (onlyWatch ? ' on' : '')} aria-pressed={onlyWatch} onClick={() => setOnlyWatch((v) => !v)}>
              ★ Watchlist{watchCount ? ` (${watchCount})` : ''}
            </button>
            <button className={'chip-btn' + (hideBusy ? ' on' : '')} aria-pressed={hideBusy} onClick={() => setHideBusy((v) => !v)} title="Hide buildings where a contractor already pulled a permit">
              Hide worked
            </button>
            <button className={'chip-btn' + (onlyPortfolio ? ' on' : '')} aria-pressed={onlyPortfolio} onClick={() => (portfolio.length ? setOnlyPortfolio((v) => !v) : setPortfolioOpen(true))}>
              My buildings{portfolio.length ? ` (${portfolio.length})` : ' +'}
            </button>
            {hiddenCount > 0 && (
              <button className={'chip-btn' + (showHidden ? ' on' : '')} aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
                Hidden ({hiddenCount})
              </button>
            )}
            {sceneReady && (
              <button
                className={'chip-btn' + (showMap ? ' on' : '')}
                aria-pressed={showMap}
                onClick={() => setShowMap((v) => !v)}
                title="Every located card on a map of the five boroughs — the same filtered list as below"
              >
                Map
              </button>
            )}
            <button className="chip-btn" onClick={exportCurrent}>Export CSV</button>
            <span className="count">
              {filteredFeed.length} buildings
              {(() => {
                const z = zipsIn(query.trim());
                if (!z) return null;
                return <span className="count-note"> in {z.length === 1 ? z[0] : `${z.length} ZIPs`}</span>;
              })()}
            </span>
          </div>
          {mapPanel(filteredFeed)}



          {filteredFeed.length === 0 && (
            <div className="empty">
              <b>Nothing matches</b>
              No buildings fit the current search and filters.
              <div>
                <button
                  onClick={() => {
                    setQuery('');
                    setBoro('all');
                    setOnlyNew(false);
                    setOnlyWatch(false);
                    setHideBusy(false);
                    setOnlyPortfolio(false);
                    setShowHidden(false);
                  }}
                >
                  Clear all filters
                </button>
              </div>
            </div>
          )}
          <div className="feed">
            <AnimatePresence mode="popLayout" initial={false}>
            {filteredFeed.slice(0, shown).map((c, i) => {
              const open = openId === c.bin;
              const wkey = 'b:' + c.bin;
              // The highest-urgency signal is often the one the whole register
              // shares — seven rows reading SHED UP, NO REPAIR FILED say nothing
              // about any of them. Lead with the signal that is rare in the list
              // you are actually looking at, and fall back to urgency to break
              // ties.
              const topSignal = [...c.signals].sort(
                (a, b) => (signalFreq[a.kind] || 0) - (signalFreq[b.kind] || 0) || b.urgency - a.urgency,
              )[0];
              return (
                <motion.article
                  layout={reduce ? false : true}
                  key={c.bin}
                  id={'rw-' + c.bin}
                  className={'card' + (open ? ' open' : '')}
                  initial={reduce ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
                  transition={{
                    duration: 0.4,
                    ease: [0.22, 1, 0.36, 1],
                    delay: Math.min(i * 0.04, 0.3),
                    layout: { type: 'spring', stiffness: 350, damping: 34 },
                  }}
                >
                  <div className="card-row">
                    <button
                      className="card-head"
                      aria-expanded={open}
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${title(c.address)}, ${c.borough}`}
                      onClick={() => toggleCard('b', c.bin, open)}
                    >
                      <StatusDot
                        status={statusOf('b:' + c.bin)}
                        note={
                          statusOf('b:' + c.bin) === 'personal'
                            ? `Reserved for you for ${hoursLeft('b:' + c.bin)}h`
                            : null
                        }
                      />
                      <span className="head-main">
                        <span className="addr">{title(c.address)}</span>
                        <span className="boro">
                          {c.borough}
                          {c.zip ? <span className="zip">{c.zip}</span> : null}
                          {c.agent?.company && <span className="who">{title(c.agent.company)}</span>}
                        </span>
                        <ContactHint
                          phone={contacts[c.bin]?.phone || c.phone || c.contact?.phone}
                          mail={Boolean(contacts[c.bin]?.email || c.email || c.contact?.email || c.agent?.contactKnown)}
                        />
                        {c.isNew && <span className="badge new">New</span>}
                        {!c.isNew && c.fresh?.length > 0 && <span className="badge new">New signal</span>}
                        {statusOf('b:' + c.bin) === 'personal' && (
                          <span className="badge pers">Yours · {hoursLeft('b:' + c.bin)}h left</span>
                        )}
                        {statusOf('b:' + c.bin) === 'taken' && !fbOf('b:' + c.bin) && <span className="badge tkn">Taken</span>}
                        {c.occupied && <span className="badge busy" title="A contractor already pulled a permit here">Contractor on site</span>}
                        {fbOf('b:' + c.bin) && fbOf('b:' + c.bin) !== 'dismissed' && (
                          <span className={'badge st ' + fbOf('b:' + c.bin)}>{fbOf('b:' + c.bin)}</span>
                        )}
                        <span className="badge">{BADGE[topSignal.kind]}</span>
                        {c.freshHaz && <span className="badge urgent">Violation {c.freshHaz.daysAgo}d ago</span>}
                        {c.signals.length > 1 && <span className="badge more">+{c.signals.length - 1}</span>}
                        {claimTaken === 'b:' + c.bin && <span className="badge urgent">Someone claimed it first</span>}
                      </span>
                      <span className="head-side">
                        <span className={'clock' + (c.monthsLeft <= 7 ? ' tight' : '')}>{c.monthsLeft} mo left</span>
                        <motion.span
                          className="chev"
                          animate={{ rotate: open ? 180 : 0 }}
                          transition={reduce ? { duration: 0 } : { duration: 0.25 }}
                          aria-hidden="true"
                        >
                          <Chevron />
                        </motion.span>
                      </span>
                    </button>
                    <motion.button
                      className={'star' + (isWatched(wkey) ? ' on' : '')}
                      onClick={() => toggleWatch(wkey)}
                      whileTap={reduce ? undefined : { scale: 0.78 }}
                      aria-label={isWatched(wkey) ? 'Remove from watchlist' : 'Add to watchlist'}
                      aria-pressed={isWatched(wkey)}
                    >
                      <motion.span
                        key={String(isWatched(wkey))}
                        initial={reduce ? false : { scale: 0.5 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 17 }}
                        style={{ display: 'flex' }}
                      >
                        <Star on={isWatched(wkey)} />
                      </motion.span>
                    </motion.button>
                  </div>

                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        key="body"
                        initial={reduce ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reduce ? {} : { height: 0, opacity: 0 }}
                        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="card-body">
                          <Recheck card={c} builtOn={data.generatedAt} reduce={reduce} />
                          <div className="sig">
                            <div className="sig-k">
                              Why now
                              <span className="score" title={`Urgency ${c.urgencyScore}, ranked against the other ${facadeFeed.length} buildings in this register`}>
                                {urgencyRank(c.urgencyScore)}
                              </span>
                            </div>
                            <div className="sig-v">{signalStory(c)}</div>
                          </div>
                          {c.occupied && (
                            <div className="sig busy">
                              <div className="sig-k">Already worked</div>
                              <div className="sig-v">
                                {c.filing?.permitted
                                  ? `${c.filing?.who ? title(c.filing.who) : 'A contractor'} pulled a permit`
                                  : `${c.filing?.who ? title(c.filing.who) : 'A contractor'} has a filing open and a shed up`}
                                {c.filing?.filed ? `, filed ${usShort(c.filing.filed)}` : ''}. Ranked low on purpose — call only if you
                                want the next cycle.
                              </div>
                            </div>
                          )}
                          {profile.facade && (
                            <div className="sig match">
                              <div className="sig-k">Why it matches you</div>
                              <div className="sig-v">{fv.why(c)}</div>
                            </div>
                          )}

                          <div className="facts">
                            {factsFor(profileKey).map((id) => {
                              const F = {
                                report: () => (
                                  <>
                                    <div className="k">Last report</div>
                                    <div className="v">
                                      Cycle {c.lastCycle}
                                      {c.lastFiling ? ` · ${usDate(c.lastFiling)}` : ''} · {c.lastStatus || 'n/a'}
                                    </div>
                                  </>
                                ),
                                engineer: () =>
                                  c.priorQewi && (
                                    <>
                                      <div className="k">Prior engineer</div>
                                      <div className="v">
                                        {title(c.priorQewi)}
                                        {c.filing?.who && c.filing.who.toUpperCase() === c.priorQewi.toUpperCase()
                                          ? ' — also the applicant on the current job'
                                          : ' — no Cycle 10 engagement on record'}
                                      </div>
                                    </>
                                  ),
                                owner: () =>
                                  c.owner && (
                                    <>
                                      <div className="k">Owner of record</div>
                                      <div className="v">
                                        {title(c.owner)}
                                        {c.lastFiling ? <span className="bdays"> · as of the Cycle 9 report</span> : null}
                                      </div>
                                    </>
                                  ),
                                mgmt: () =>
                                  c.mgmtChange && (
                                    <>
                                      <div className="k">Registration changed</div>
                                      <div className="v">
                                        detected {c.mgmtChange.detected}
                                        {c.mgmtChange.prevCompany ? ` · was ${title(c.mgmtChange.prevCompany)}` : ''} · HPD daily
                                      </div>
                                    </>
                                  ),
                                sold: () =>
                                  c.ownerChange && (
                                    <>
                                      <div className="k">Sold</div>
                                      <div className="v">
                                        {usDate(c.ownerChange.recorded)}
                                        {c.ownerChange.amount ? ` · ${money(Math.round(c.ownerChange.amount))}` : ''} · ACRIS deed
                                      </div>
                                    </>
                                  ),
                                elevators: () =>
                                  c.elevator && (
                                    <>
                                      <div className="k">Elevators</div>
                                      <div className="v">
                                        {c.elevator.cat1Missing > 0 ? `${c.elevator.cat1Missing} of ${c.elevator.devices} without a ${YEAR} CAT1 test` : ''}
                                        {c.elevator.cat1Missing > 0 && c.elevator.cat5Due > 0 ? ' · ' : ''}
                                        {c.elevator.cat5Due > 0 ? `${c.elevator.cat5Due} due for 5-year CAT5` : ''}
                                      </div>
                                    </>
                                  ),
                                ecb: () =>
                                  c.ecbBalance > 0 && (
                                    <>
                                      <div className="k">Unpaid at OATH</div>
                                      <div className="v fine">{money(c.ecbBalance)} across open ECB violations</div>
                                    </>
                                  ),
                                hearing: () =>
                                  c.nextHearing && (
                                    <>
                                      <div className="k">Next OATH hearing</div>
                                      <div className="v">
                                        {usDate(c.nextHearing)}
                                        {businessDaysUntil(c.nextHearing) != null && (
                                          <span className="bdays"> · {businessDaysUntil(c.nextHearing)} business days</span>
                                        )}
                                      </div>
                                    </>
                                  ),
                                shed: () =>
                                  c.shed && (
                                    <>
                                      <div className="k">Sidewalk shed</div>
                                      <div className={'v' + (c.shed.longStanding ? ' fine' : '')}>
                                        {c.shed.state === 'active' ? 'Up' : 'Permit lapsed'} {Math.round(c.shed.ageDays / 30)} months
                                        {c.shed.who ? ` · ${title(c.shed.who)}` : ''}
                                        {c.shed.longStanding ? ' · past the 1-year mark' : ''}
                                      </div>
                                    </>
                                  ),
                                filing: () =>
                                  c.filing && (
                                    <>
                                      <div className="k">Facade filing</div>
                                      <div className="v">
                                        {usShort(c.filing.filed)}
                                        {c.filing.who ? ` · ${title(c.filing.who)}` : ''} ·{' '}
                                        {c.filing.permitted ? 'permit pulled' : c.filing.stalled ? 'approved, no permit' : c.filing.status || 'in review'}
                                        {c.filing.cost ? ` · ${money(c.filing.cost)} declared` : ''}
                                      </div>
                                    </>
                                  ),
                                penalty: () => (
                                  <>
                                    <div className="k">DOB facade penalties</div>
                                    <div className={'v' + (c.finesOwed > 0 ? ' fine' : '')}>
                                      {c.finesOwed > 0
                                        ? `${money(c.finesOwed)} assessed on the Cycle 9 filing`
                                        : '$1,000/mo once the sub-cycle deadline passes'}
                                    </div>
                                  </>
                                ),
                              };
                              const body = F[id]?.();
                              return body ? (
                                <div className="fact" key={id}>
                                  {body}
                                </div>
                              ) : null;
                            })}
                            <div className="fact">
                              <div className="k source">Source</div>
                              <div className="v">
                                DOB NOW {data.sources?.facades || ''} · ECB {data.sources?.ecb || ''} · HPD {data.sources?.hpd || ''} — official city records ·{' '}
                                <button className="linkish" onClick={() => { history.pushState(null, '', '#data'); setRoute('data'); window.scrollTo({ top: 0 }); }}>how we source this</button>
                              </div>
                            </div>
                          </div>

                          <div className="na-cap">Next action</div>
                          <div className="call-block">
                            <div className="call-who">
                              {(() => {
                                const ct = contactOf(c, contacts[c.bin]);
                                if (!ct) return <span>No registered contact on file</span>;
                                return (
                                  <>
                                    <b>{title(ct.company || ct.name)}</b>
                                    {ct.company && ct.name ? ` — ${title(ct.name)}` : ''}
                                    <span className={'conf ' + ct.tone}>{ct.level}</span>
                                    <span className="from">from {ct.from}</span>
                                  </>
                                );
                              })()}
                            </div>
                            <div className="call-actions">
                              {(() => {
                                const ct = contactOf(c, contacts[c.bin]);
                                if (ct?.phone)
                                  return (
                                    <a className="btn solid big" href={`tel:${ct.phone.replace(/[^+\d]/g, '')}`}>
                                      Call {ct.phone}
                                    </a>
                                  );
                                // No line, but a published inbox: send the opener
                                // there rather than making the user retype it.
                                if (mailAddr(ct?.email))
                                  return (
                                    <a
                                      className="btn solid big"
                                      href={`mailto:${mailAddr(ct.email)}?subject=${encodeURIComponent(emailSubject(c))}&body=${encodeURIComponent(openerFor(c, fv, ct))}`}
                                    >
                                      Email {ct.email}
                                    </a>
                                  );
                                // We know this firm has a line and cannot serve
                                // it here. The next step is finding it, so make
                                // that the button rather than burying it in the
                                // overflow menu behind an opener they cannot send.
                                if (c.agent?.company)
                                  return (
                                    <a
                                      className="btn solid big"
                                      href={findUrl(`"${c.agent.company}" ${c.agent.address ? c.agent.address.split(',')[1] || 'New York' : 'New York'} phone`)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Find the number
                                    </a>
                                  );
                                return (
                                  <button className="btn solid big" onClick={() => copy(c.bin, openerFor(c, fv, ct))}>
                                    {copiedId === c.bin ? 'Opener copied' : 'Copy opener'}
                                  </button>
                                );
                              })()}
                              <div className="overflow">
                                <button
                                  className="btn ghost dots"
                                  aria-label="More actions"
                                  aria-expanded={menuFor === c.bin}
                                  aria-haspopup="true"
                                  onClick={() => setMenuFor(menuFor === c.bin ? null : c.bin)}
                                >
                                  …
                                </button>
                                {menuFor === c.bin && (
                                  <div className="menu">
                                    <button onClick={() => { copy(c.bin, openerFor(c, fv, contactOf(c, contacts[c.bin]))); setMenuFor(null); }}>Copy opener</button>
                                    <button onClick={() => { copyLink('b', c.bin); setMenuFor(null); }}>Copy link</button>
                                    {/* With no company and the name redacted this used to search the
                                        literal string "phone New York". Fall back to the building. */}
                                    {c.agent && (
                                      <a
                                        href={findUrl(
                                          c.agent.company || c.agent.name
                                            ? `${c.agent.company || ''} ${c.agent.name || ''} phone New York`.trim()
                                            : `"${c.address}" ${c.borough} managing agent phone`,
                                        )}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Search the web
                                      </a>
                                    )}
                                    {c.agent && (
                                      <a href={liUrl(`${c.agent.name || c.agent.company || ''} ${c.agent.company || ''}`)} target="_blank" rel="noreferrer">
                                        LinkedIn
                                      </a>
                                    )}
                                    <a href={mapsUrl(c.address, c.borough)} target="_blank" rel="noreferrer">Map</a>
                                    <a href={streetViewUrl(c.address, c.borough)} target="_blank" rel="noreferrer">Street View</a>
                                    <button
                                      onClick={() => {
                                        downloadIcs(
                                          c.nextHearing ? `OATH hearing — ${title(c.address)}` : `FISP deadline (${c.subCycle}) — ${title(c.address)}`,
                                          c.nextHearing || c.deadline,
                                          `${fv.why(c)}\n\n${location.origin}/#b/${c.bin}`,
                                          `${title(c.address)}, ${c.borough}, NY`,
                                        );
                                        setMenuFor(null);
                                      }}
                                    >
                                      {c.nextHearing ? 'Add hearing to calendar' : 'Add deadline to calendar'}
                                    </button>
                                    <a
                                      href={`https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${c.bin}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      DOB record
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <FeedbackRow k={'b:' + c.bin} card={c} fbOf={fbOf} mark={mark} reasonOf={reasonOf} markReason={markReason} noteOf={noteOf} markNote={markNote} amountOf={amountOf} markAmount={markAmount} feedForReasons={visibleForReasons} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              );
            })}
            </AnimatePresence>
          </div>

          {shown < filteredFeed.length && (
            <div className="more-row">
              <button onClick={() => setShown((n) => n + 14)}>Show more buildings ({filteredFeed.length - shown} left)</button>
            </div>
          )}
        </>
      )}

      {vertical === 'contracts' && (
        <>
          {miniToolbar(contractsList, data.contracts.length)}
          <SimpleFeed
            items={contractsList.slice(0, shown)}
            total={contractsList.length}
            shown={shown}
            onMore={() => setShown((n) => n + 7)}
            openId={openId}
            toggle={toggleCard}
            hashType="c"
            reduce={reduce}
            isWatched={(c) => isWatched('c:' + c.id)}
            onWatch={(c) => toggleWatch('c:' + c.id)}
            statusOf={statusOf}
            renderHead={(c) => (
              <>
                <span className="head-main">
                  <span className="addr">{isOpenNotice(c) ? c.title : c.vendor}</span>
                  {c.isNew && <span className="badge new">New</span>}
                  {fbOf('c:' + c.id) && fbOf('c:' + c.id) !== 'dismissed' && (
                    <span className={'badge st ' + fbOf('c:' + c.id)}>{fbOf('c:' + c.id)}</span>
                  )}
                  {isOpenNotice(c) ? (
                    <span className={'badge' + (c.kind === 'INTENT' ? ' urgent' : '')}>{noticeLabel(c)}</span>
                  ) : (
                    <span className="badge">Won {money(c.amount)}</span>
                  )}
                  {isOpenNotice(c) && <span className="boro">{c.agency}</span>}
                  <ContactHint phone={c.contact?.phone} mail={Boolean(c.contact?.email)} />
                </span>
                <span className="head-side">
                  <span
                    className={
                      'clock' +
                      (isOpenNotice(c)
                        ? c.daysLeft != null && c.daysLeft <= 5
                          ? ' tight'
                          : ''
                        : c.daysAgo != null && c.daysAgo <= 3
                          ? ' tight'
                          : '')
                    }
                  >
                    {isOpenNotice(c)
                      ? c.daysLeft != null
                        ? `${c.daysLeft}d to ${c.kind === 'INTENT' ? 'object' : 'bid'}`
                        : usShort(c.dueDate)
                      : c.daysAgo != null
                        ? `${c.daysAgo}d ago`
                        : c.date}
                  </span>
                </span>
              </>
            )}
            renderBody={(c) => (
              <>
                <div className="sig">
                  <div className="sig-k">Why now</div>
                  <div className="sig-v">
                    {c.kind === 'SOLICITATION' ? (
                      <>
                        {c.agency} is taking bids until {usDate(c.dueDate)}
                        {c.daysLeft != null ? ` — ${c.daysLeft} business ${c.daysLeft === 1 ? 'day' : 'days'} left` : ''}. This
                        window is still open; nobody has won it.
                      </>
                    ) : c.kind === 'INTENT' ? (
                      <>
                        {c.agency} intends to award this without competition. Objections close {usDate(c.dueDate)}
                        {c.daysLeft != null ? ` — ${c.daysLeft} business ${c.daysLeft === 1 ? 'day' : 'days'} left` : ''}. Saying
                        nothing forfeits it.
                      </>
                    ) : (
                      <>
                        Won {money(c.amount)} from {c.agency}
                        {c.daysAgo != null ? ` ${c.daysAgo === 0 ? 'today' : `${c.daysAgo}d ago`}` : ''} — purchasing starts now.
                      </>
                    )}
                  </div>
                </div>
                <div className="sig match">
                  <div className="sig-k">
                    {isOpenNotice(c) ? 'What this is' : profile.cNeed ? 'Why it matches you' : 'Who wins this window'}
                  </div>
                  <div className="sig-v">
                    {isOpenNotice(c)
                      ? c.scope || `${c.category} · ${c.method}`
                      : profile.cNeed?.(c) || 'Bonding · insurance · subs · staffing · equipment.'}
                  </div>
                </div>
                <div className="facts">
                  <div className="fact">
                    <div className="k">Contract</div>
                    <div className="v">{c.title}</div>
                  </div>
                  <div className="fact">
                    <div className="k">{isOpenNotice(c) ? 'Agency' : 'Awarded by'}</div>
                    <div className="v">{c.agency}</div>
                  </div>
                  <div className="fact">
                    <div className="k">Method</div>
                    <div className="v">{c.method}</div>
                  </div>
                  {isOpenNotice(c) && c.epin && (
                    <div className="fact">
                      <div className="k">PIN / EPIN</div>
                      <div className="v">
                        <span className="mono">{c.epin}</span> — quote this to the agency or search it in PASSPort
                      </div>
                    </div>
                  )}
                  {isOpenNotice(c) && c.submitTo && (
                    <div className="fact">
                      <div className="k">Bids to</div>
                      <div className="v">{c.submitTo}</div>
                    </div>
                  )}
                  {c.vendorAddress && (
                    <div className="fact">
                      <div className="k">Vendor address</div>
                      <div className="v">{c.vendorAddress}</div>
                    </div>
                  )}
                  <div className="fact">
                    <div className="k source">Source</div>
                    <div className="v">
                      City Record Online, as of {live?.sources?.awards || data.sources?.awards || 'today'} ·{' '}
                      <button className="linkish" onClick={() => { history.pushState(null, '', '#data'); setRoute('data'); window.scrollTo({ top: 0 }); }}>how we source this</button>
                    </div>
                  </div>
                </div>
                <div className="na-cap">Next action</div>
                <div className="call-block">
                  <div className="call-who">
                    <b>{isOpenNotice(c) ? c.contact?.name || c.agency : c.vendor}</b>
                    <span>
                      {isOpenNotice(c)
                        ? c.contact?.name
                          ? `${c.agency} — named on the notice`
                          : 'No officer named on this notice'
                        : `Opener written for ${profile.cNeed ? profile.label : 'this window'}`}
                    </span>
                  </div>
                  <div className="call-actions">
                    <button className="btn solid" onClick={() => copy(c.id, (profile.cOpener || defaultCOpener)(c))}>
                      {copiedId === c.id ? 'Copied' : 'Copy opener'}
                    </button>
                    {/* the city prints this contact so bidders can use it; no
                        search and no guessing */}
                    {isOpenNotice(c) && c.contact?.phone && (
                      <a className="btn ghost" href={`tel:${c.contact.phone.replace(/[^\d+]/g, '')}`}>
                        {c.contact.phone}
                      </a>
                    )}
                    {isOpenNotice(c) && c.contact?.email && (
                      <a className="btn ghost" href={`mailto:${c.contact.email}?subject=${encodeURIComponent(c.title || '')}`}>
                        Email ↗
                      </a>
                    )}
                    <button className="btn ghost" onClick={() => copyLink('c', c.id)}>
                      {copiedLink === c.id ? 'Copied' : 'Copy link'}
                    </button>
                    {!isOpenNotice(c) && (
                      <>
                        <a className="btn ghost" href={findUrl(`${c.vendor} phone contact`)} target="_blank" rel="noreferrer">
                          Find contact ↗
                        </a>
                        <a className="btn ghost" href={liUrl(c.vendor)} target="_blank" rel="noreferrer">
                          LinkedIn ↗
                        </a>
                      </>
                    )}
                    <a
                      className="btn ghost"
                      href="https://data.cityofnewyork.us/City-Government/City-Record-Online/dg92-zbpx"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source data ↗
                    </a>
                  </div>
                </div>
                <FeedbackRow k={'c:' + c.id} card={c} fbOf={fbOf} mark={mark} reasonOf={reasonOf} markReason={markReason} noteOf={noteOf} markNote={markNote} amountOf={amountOf} markAmount={markAmount} feedForReasons={visibleForReasons} />
              </>
            )}
            idOf={(c) => c.id}
            nameOf={(c) => (isOpenNotice(c) ? c.title : c.vendor)}
          />
        </>
      )}

      {MANDATES[vertical] && (
        <>
          {miniToolbar(mandateList, (data[vertical]?.feed || []).length, { boroughs: true, counts: mandateLists._counts?.[vertical] })}
          {mapPanel(mandateList)}
          <SimpleFeed
            items={mandateRows.slice(0, shown)}
            total={mandateRows.length}
            shown={shown}
            onMore={() => setShown((n) => n + 7)}
            openId={openId}
            toggle={toggleCard}
            hashType={vertPrefix[0]}
            reduce={reduce}
            isWatched={(c) => isWatched(vertPrefix + (c.group ? c.id : c.bin))}
            onWatch={(c) => toggleWatch(vertPrefix + (c.group ? c.id : c.bin))}
            statusOf={statusOf}
            idOf={(c) => (c.group ? c.id : c.bin)}
            nameOf={(c) => (c.group ? `${title(c.company)}, ${c.cards.length} buildings` : `${title(c.address)}, ${c.borough}`)}
            renderHead={(c) => {
              const m = MANDATES[vertical];
              if (c.group)
                return (
                  <>
                    <span className="head-main">
                      <span className="addr">{title(c.company)}</span>
                      <span className="boro">
                        {c.borough} <span className="zip">{c.zip}</span>
                      </span>
                      <ContactHint phone={c.phone} mail={false} />
                      <span className="badge">{c.cards.length} buildings · one call</span>
                    </span>
                    <span className="head-side">
                      <span className="clock">{c.usd > 0 ? `${fmtMoney(c.usd)}/yr` : `${c.violations} violations`}</span>
                    </span>
                  </>
                );
              const k = vertPrefix + c.bin;
              return (
                <>
                  <span className="head-main">
                    <span className="addr">{title(c.address)}</span>
                    <span className="boro">
                      {c.borough} {c.zip && <span className="zip">{c.zip}</span>}
                    </span>
                    <ContactHint
                      phone={contacts[c.bin]?.phone || c.phone || c.contact?.phone}
                      mail={Boolean(contacts[c.bin]?.email || c.email || c.contact?.email || c.agent?.contactKnown)}
                    />
                    {c.isNew && <span className="badge new">New</span>}
                    {fbOf(k) && fbOf(k) !== 'dismissed' && <span className={'badge st ' + fbOf(k)}>{fbOf(k)}</span>}
                    <span className="badge">{m.badge(c)}</span>
                  </span>
                  <span className="head-side">
                    <span className={'clock' + (m.tight(c) ? ' tight' : '')}>{m.clock(c)}</span>
                  </span>
                </>
              );
            }}
            renderBody={(c) => {
              const m = MANDATES[vertical];
              if (c.group) {
                const first = c.cards[0];
                const ct = contactOf(first, contacts[first.bin]);
                return (
                  <>
                    <div className="sig">
                      <div className="sig-k">One call, {c.cards.length} buildings</div>
                      <div className="sig-v">
                        {title(c.company)} is the registered agent for all {c.cards.length}
                        {c.usd > 0
                          ? c.oneFigure
                            ? ` — the complex benchmarks as one: ${fmtMoney(c.usd)} a year over the cap, estimated`
                            : ` — combined exposure ${fmtMoney(c.usd)} a year, estimated against computed caps`
                          : ` — ${c.violations} open violations between them`}.
                        The city cited the complex in one sweep; the fix is one conversation.
                      </div>
                    </div>
                    <div className="facts">
                      <div className="k">Buildings</div>
                      <div className="v">
                        {c.cards.map((b) => (
                          <div key={b.bin}>
                            {title(b.address)}
                            {c.oneFigure ? '' : b.ghg?.usd > 0 ? ` — ${fmtMoney(b.ghg.usd)}/yr` : b.violations ? ` — ${b.violations} violation${b.violations > 1 ? 's' : ''}` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                    {ct.phone && (
                      <div className="call-block">
                        <a className="btn solid" href={`tel:${String(ct.phone).replace(/[^+\d]/g, '')}`}>Call {ct.phone}</a>
                      </div>
                    )}
                    <FeedbackRow k={vertPrefix + c.id} card={null} fbOf={fbOf} mark={mark} reasonOf={reasonOf} markReason={markReason} noteOf={noteOf} markNote={markNote} amountOf={amountOf} markAmount={markAmount} feedForReasons={visibleForReasons} />
                  </>
                );
              }
              const mine = profile.mandates?.[vertical];
              const ct = contactOf(c, contacts[c.bin]);
              return (
                <>
                  <div className="sig">
                    <div className="sig-k">
                      Why now
                      <span className="score" title="Urgency score">{c.urgencyScore}</span>
                    </div>
                    <div className="sig-v">{m.why(c)}</div>
                  </div>
                  <div className="sig match">
                    <div className="sig-k">{mine ? 'Why it matches you' : 'Who wins this window'}</div>
                    <div className="sig-v">{mine ? mine(c) : m.whoWins}</div>
                  </div>
                  <div className="facts">
                    {m.facts(c).map(([k, v]) => (
                      <div className="fact" key={k}>
                        <div className="k">{k}</div>
                        <div className="v">{v}</div>
                      </div>
                    ))}
                    {c.agent && (
                      <div className="fact">
                        <div className="k">Managing agent</div>
                        <div className="v">
                          {c.agent.company ? title(c.agent.company) : c.agent.role}
                          {c.agent.address ? ` — ${title(c.agent.address)}` : ''}
                          {c.agent.portfolio > 1 && (
                            <>
                              {' · '}
                              <button className="linkish" onClick={() => setQuery(c.agent.company)}>
                                runs {c.agent.portfolio} buildings we track
                              </button>
                              <span className="spread">
                                {agentSpread(c.agent.company)
                                  .map(([, label, n]) => `${n} on ${label}`)
                                  .join(', ')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="fact">
                      <div className="k source">Source</div>
                      <div className="v">
                        {m.source}, as of {data.sources?.[m.sourceKey] || 'today'} ·{' '}
                        <button className="linkish" onClick={() => { history.pushState(null, '', '#data'); setRoute('data'); window.scrollTo({ top: 0 }); }}>how we source this</button>
                      </div>
                    </div>
                  </div>
                  <div className="na-cap">Next action</div>
                  <div className="call-block">
                    <div className="call-who">
                      <b>
                        {c.agent?.company
                          ? title(c.agent.company)
                          : 'No managing agent named on the HPD registration'}
                      </b>
                      <span>
                        {ct?.level ? `${c.agent.role} · ${ct.level}` : c.agent ? c.agent.role : 'The building registers itself'}
                      </span>
                    </div>
                    <div className="call-actions">
                      {/* the same cascade the facade card uses: a number if we
                          have one, an inbox if we do not, the text to paste if
                          we have neither */}
                      {ct?.phone ? (
                        <a className="btn solid" href={`tel:${ct.phone.replace(/[^+\d]/g, '')}`}>
                          Call {ct.phone}
                        </a>
                      ) : mailAddr(ct?.email) ? (
                        <a
                          className="btn solid"
                          href={`mailto:${mailAddr(ct.email)}?subject=${encodeURIComponent(title(c.address))}&body=${encodeURIComponent(m.opener(c))}`}
                        >
                          Email {ct.email}
                        </a>
                      ) : c.agent?.company ? (
                        <a
                          className="btn solid"
                          href={findUrl(`"${c.agent.company}" New York phone`)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Find the number
                        </a>
                      ) : (
                        <button className="btn solid" onClick={() => copy(c.bin, m.opener(c))}>
                          {copiedId === c.bin ? 'Copied' : 'Copy opener'}
                        </button>
                      )}
                      <button className="btn ghost" onClick={() => copyLink(vertPrefix[0], c.bin)}>
                        {copiedLink === c.bin ? 'Copied' : 'Copy link'}
                      </button>
                      <a className="btn ghost" href={mapsUrl(c.address, c.borough)} target="_blank" rel="noreferrer">
                        Map ↗
                      </a>
                      <a
                        className="btn ghost"
                        href={findUrl(`${c.agent?.company || c.address} ${c.borough} phone`)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Find contact ↗
                      </a>
                      <a className="btn ghost" href={m.dataset} target="_blank" rel="noreferrer">
                        Source data ↗
                      </a>
                    </div>
                  </div>
                  <FeedbackRow k={vertPrefix + c.bin} card={c} fbOf={fbOf} mark={mark} reasonOf={reasonOf} markReason={markReason} noteOf={noteOf} markNote={markNote} amountOf={amountOf} markAmount={markAmount} feedForReasons={visibleForReasons} />
                </>
              );
            }}
          />
        </>
      )}

      {vertical === 'openings' && (
        <>
          {miniToolbar(openingsList, data.openings.length, { boroughs: true, counts: openingsCounts })}
          {mapPanel(openingsList)}
          <SimpleFeed
            items={openingsList.slice(0, shown)}
            total={openingsList.length}
            shown={shown}
            onMore={() => setShown((n) => n + 7)}
            openId={openId}
            toggle={toggleCard}
            hashType="o"
            reduce={reduce}
            isWatched={(o) => isWatched('o:' + o.id)}
            onWatch={(o) => toggleWatch('o:' + o.id)}
            statusOf={statusOf}
            renderHead={(c) => (
              <>
                <span className="head-main">
                  <span className="addr">{venueName(c)}</span>
                  {c.isNew && <span className="badge new">New</span>}
                  {fbOf('o:' + c.id) && fbOf('o:' + c.id) !== 'dismissed' && (
                    <span className={'badge st ' + fbOf('o:' + c.id)}>{fbOf('o:' + c.id)}</span>
                  )}
                  <span className="boro">
                    {c.county} {c.zip && <span className="zip">{c.zip}</span>}
                  </span>
                  <span className="badge">
                    {c.src === 'dohmh' ? 'Permitted, not yet inspected' : `${c.kind} · licence pending`}
                  </span>
                  <ContactHint phone={c.phone} mail={Boolean(c.email)} />
                </span>
                <span className="head-side">
                  <span className="clock">
                    {c.src === 'dohmh' ? 'not open yet' : c.daysAgo != null ? `filed ${c.daysAgo}d ago` : '~2–4 mo'}
                  </span>
                </span>
              </>
            )}
            renderBody={(c) => (
              <>
                <div className="sig">
                  <div className="sig-k">Why now</div>
                  <div className="sig-v">
                    {c.src === 'dohmh' ? (
                      <>
                        The Health Department has permitted this address for food service and has never inspected it —
                        which means it has not opened, or has only just opened. It is not on a grade card, not in a
                        review, and not on anyone's supplier list yet.
                      </>
                    ) : (
                      <>
                        {c.kind} license filed{c.daysAgo != null ? ` ${c.daysAgo}d ago` : ''} — opens in 2–4 months,
                        choosing vendors now.
                      </>
                    )}
                  </div>
                </div>
                <div className="sig match">
                  <div className="sig-k">{profile.oNeed ? 'Why it matches you' : 'Who wins this window'}</div>
                  <div className="sig-v">
                    {profile.oNeed?.(c) || 'POS · insurance · suppliers · furniture · signage · marketing.'}
                  </div>
                </div>
                <div className="facts">
                  <div className="fact">
                    <div className="k">Premises</div>
                    <div className="v">{c.address}</div>
                  </div>
                  {c.legal && c.legal !== c.name && (
                    <div className="fact">
                      <div className="k">Legal name</div>
                      <div className="v">{c.legal}</div>
                    </div>
                  )}
                  {c.received && (
                    <div className="fact">
                      <div className="k">Application received</div>
                      <div className="v">{usDate(c.received)} · under review</div>
                    </div>
                  )}
                  {c.src === 'dohmh' && (
                    <div className="fact">
                      <div className="k">Permit</div>
                      <div className="v">
                        Issued, never inspected. Health Department permit numbers run in order, so this one was granted
                        inside the last year — the newest are at the top of the list.
                      </div>
                    </div>
                  )}
                  <div className="fact">
                    <div className="k source">Source</div>
                    <div className="v">
                      {c.src === 'dohmh'
                        ? `NYC Health Department — food service permits, as of ${data.sources?.dohmh || 'today'}`
                        : `NY State Liquor Authority — pending licenses, as of ${data.sources?.sla || 'today'}`}{' '}
                      ·{' '}
                      <button className="linkish" onClick={() => { history.pushState(null, '', '#data'); setRoute('data'); window.scrollTo({ top: 0 }); }}>how we source this</button>
                    </div>
                  </div>
                </div>
                <div className="na-cap">Next action</div>
                <div className="call-block">
                  <div className="call-who">
                    <b>{venueName(c)}</b>
                    <span>
                      {c.phoneVia
                        ? `From the food permit for ${title(c.phoneVia)} at this address`
                        : c.phone
                          ? 'Number published on the Health Department permit'
                          : `Opener written for ${profile.oNeed ? profile.label : 'this window'}`}
                    </span>
                  </div>
                  <div className="call-actions">
                    {/* the permit record carries the establishment's own line, so
                        this register can be dialled rather than searched */}
                    {c.phone ? (
                      <a className="btn solid" href={`tel:${c.phone}`}>
                        Call {c.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')}
                      </a>
                    ) : null}
                    <button className={'btn ' + (c.phone ? 'ghost' : 'solid')} onClick={() => copy(c.id, (profile.oOpener || defaultOOpener)(c))}>
                      {copiedId === c.id ? 'Copied' : 'Copy opener'}
                    </button>
                    <button className="btn ghost" onClick={() => copyLink('o', c.id)}>
                      {copiedLink === c.id ? 'Copied' : 'Copy link'}
                    </button>
                    <a className="btn ghost" href={mapsUrl(c.address, c.county)} target="_blank" rel="noreferrer">
                      Map ↗
                    </a>
                    <a className="btn ghost" href={findUrl(`"${c.legal}" ${c.address} phone`)} target="_blank" rel="noreferrer">
                      Find contact ↗
                    </a>
                    <a
                      className="btn ghost"
                      href={
                        c.src === 'dohmh'
                          ? 'https://data.cityofnewyork.us/d/43nn-pn8j'
                          : 'https://data.ny.gov/d/f8i8-k2gm'
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source data ↗
                    </a>
                  </div>
                </div>
                <FeedbackRow k={'o:' + c.id} card={c} fbOf={fbOf} mark={mark} reasonOf={reasonOf} markReason={markReason} noteOf={noteOf} markNote={markNote} amountOf={amountOf} markAmount={markAmount} feedForReasons={visibleForReasons} />
              </>
            )}
            idOf={(c) => c.id}
            nameOf={venueName}
          />
        </>
      )}

      </motion.div>

      {!wide && <div className="lede lede-after">{mapSlot}</div>}

      {/* The market stats moved below the feed on purpose: they sized the
          hero, and the hero's job is to put a real expanded card above the
          fold. The scale of the register is context, not the pitch. */}
      {vertical === 'facades' && (
        <div className="stats">
          {[
            [data.facades.totals.candidates, 'buildings off the compliance calendar, four boroughs'],
            [data.facades.totals.nonFilers10A, `unfiled for sub-cycle 10A — ${monthsToDeadline} months to deadline`],
            [data.facades.totals.swarmpCarryover, 'open SWARMP scopes carried from Cycle 9'],
            [1000, 'per month — the DOB penalty meter after a missed deadline', '$'],
          ].map(([n, l, pre], i) => (
            <motion.div className="stat" key={l} {...fade(0.08 + i * 0.06)}>
              <div className="n">
                <CountUp value={n} prefix={pre || ''} />
              </div>
              <div className="l">{l}</div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showTop && (
          <motion.button
            className="totop"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? {} : { opacity: 0, y: 10 }}
            aria-label="Back to top"
          >
            ↑ Top
          </motion.button>
        )}
      </AnimatePresence>

      <div className="skyline" aria-hidden="true">
        <svg viewBox="0 0 1200 90" preserveAspectRatio="none" width="100%" height="90">
          <path
            fill="currentColor"
            d="M0 90V64h28V44h14v20h22V30h10v-8h6v8h10v34h26V50h30v40h24V38h12V26h8v12h12v52h34V56h26v34h20V20h8l4-16 4 16h8v70h30V60h34v30h26V34h10V22h8v12h10v56h38V48h24v42h28V40h14v-8h6v8h14v50h32V26h6l3-22 3 22h6v64h36V58h30v32h24V44h26v46h30V16h6l3-14 3 14h6v74h38V54h28v36h26V36h12v-8h6v8h12v54h34V62h30v28h22V42h24v48h30V56h28v34H0z"
          />
        </svg>
      </div>

      <div className="pilot">
        <div>
          <b>{(PILOT_COPY[vertical] || PILOT_COPY.facades)[0]}</b>
          <span>
            {(PILOT_COPY[vertical] || PILOT_COPY.facades)[1]} The open pool above stays free. Pilots are free while we
            learn.
          </span>
        </div>
        <form
          className="digest-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = e.target.elements.em.value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return;
            setEmail(v);
            saveLS('rw.email', v);
            setEmailSaved('saving');
            // /api/subscribe owns the list; /api/prefs keeps carrying the address
            // for this device so the trade and borough it already holds stay
            // together with it.
            fetch('/api/subscribe', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: v, profile: profileKey || null, boro }),
            })
              .then(async (r) => {
                const j = await r.json().catch(() => ({}));
                // Three outcomes, not two: stored, our store is not configured
                // yet, or something else went wrong. Only the middle one should
                // offer the way round, and it must not clear itself — the last
                // version took the only route through with it after three
                // seconds.
                if (r.ok && j.ok) {
                  setEmailSaved(j.confirmation ? 'ok' : 'ok-nomail');
                  setTimeout(() => setEmailSaved(false), 4000);
                } else setEmailSaved(j.canStore === false ? 'nostore' : 'fail');
              })
              .catch(() => setEmailSaved('fail'));
            fetch('/api/prefs', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ uid: uid.current, secret: secret.current, data: { channels: { email: v } } }),
            }).catch(() => {});
          }}
        >
          <input name="em" type="email" required placeholder="you@company.com" defaultValue={email} aria-label="Email for the daily digest" />
          <button className="btn solid" type="submit">
            {emailSaved === 'saving'
              ? 'Signing you up…'
              : emailSaved === 'ok' || emailSaved === 'ok-nomail'
                ? "You're on the list"
                : emailSaved === 'fail' || emailSaved === 'nostore'
                  ? 'Try again'
                  : email
                    ? 'Update digest email'
                    : 'Get the daily digest'}
          </button>
          {emailSaved === 'ok' ? (
            <span className="digest-note">Check your inbox — we sent a confirmation.</span>
          ) : emailSaved === 'ok-nomail' ? (
            <span className="digest-note">Saved. One email each morning, nothing on a quiet day.</span>
          ) : emailSaved === 'fail' || emailSaved === 'nostore' ? (
            <span className="digest-note">
              That did not save, and the fault is at our end. One click sends it instead —{' '}
              <a
                href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('Daily digest')}&body=${encodeURIComponent(
                  `Please add me to the daily digest.\n\nEmail: ${email || '(the address I just typed)'}\nTrade: ${profile.label || profileKey || 'not set'}\nBorough: ${boro}\n`,
                )}`}
              >
                email it to us
              </a>{' '}
              and we will add you by hand.
            </span>
          ) : (
            email && !emailSaved && <span className="digest-note">Only when something new matches you</span>
          )}
        </form>
        <div className="pilot-row">
          <form
            className="digest-form slack"
            onSubmit={(e) => {
              e.preventDefault();
              const v = e.target.elements.hook.value.trim();
              setSlackState('saving');
              fetch('/api/slack/connect', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ uid: uid.current, secret: secret.current, webhook: v }),
              })
                .then((r) => r.json())
                .then((j) => {
                  if (j.error) {
                    setSlackState('error');
                  } else {
                    setSlackHook(v);
                    saveLS('rw.slack', v);
                    setSlackState('ok');
                    setTimeout(() => setSlackState('idle'), 3000);
                  }
                })
                .catch(() => setSlackState('error'));
            }}
          >
            <input name="hook" type="url" placeholder="Slack incoming webhook URL" defaultValue={slackHook} aria-label="Slack webhook" />
            <button className="btn solid" type="submit">
              {slackState === 'saving' ? 'Connecting…' : slackState === 'ok' ? 'Connected' : slackState === 'error' ? 'Try again' : slackHook ? 'Update Slack' : 'Send to Slack'}
            </button>
            <span className="digest-note">
              {slackState === 'error'
                ? 'That URL was rejected — check it in Slack.'
                : slackInteractive
                  ? 'Cards with Claim buttons'
                  : 'Signal cards, linked back to the feed'}
            </span>
          </form>
        </div>
        <div className="pilot-contact">
          <span>Questions? Reach {CONTACT.name} directly</span>
          <a href={`mailto:${CONTACT.email}?subject=Right%20Window`}>{CONTACT.email}</a>
          {CONTACT.phone && <a href={`tel:${CONTACT.phone.replace(/[^+\d]/g, '')}`}>{CONTACT.phone}</a>}
        </div>
        <div className="pilot-actions">
          {walletReady && (
            <a className="wallet-btn" href="/api/pass">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
                <path d="M3 9.5h13a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h5" />
              </svg>
              Add to Apple Wallet
            </a>
          )}
          <a href={`mailto:${CONTACT.email}?subject=Right%20Window%20pilot`}>Request a pilot</a>
        </div>
      </div>

      <footer>
        <p>
          Right Window reads New York's public registers and hands you the window — with a contact and a reason to
          call. Every card links to the city's own record.
        </p>
        {/* One flex row with real gaps and visible separators. Reported as
            running together twice — the second report after a margin-only fix —
            so the separators are now content, not spacing. */}
        <div className="foot-links">
          <button
            className="foot-toggle"
            onClick={() => {
              history.pushState(null, '', '#data');
              setRoute('data');
              window.scrollTo({ top: 0 });
            }}
          >
            Data, sources and privacy
          </button>
          <span className="foot-sep" aria-hidden="true">·</span>
          <button
            className="foot-toggle"
            onClick={() => {
              history.pushState(null, '', '#trades');
              setRoute('trades');
              window.scrollTo({ top: 0 });
            }}
          >
            A page for every trade
          </button>
          <span className="foot-sep" aria-hidden="true">·</span>
          <button className="foot-toggle" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources}>
            {showSources ? 'Hide source dates' : 'Source dates'}
          </button>
        </div>
        {showSources && (
          <p className="foot-detail">
            DOB {data.sources?.facades} · ECB {data.sources?.ecb} · elevators {data.sources?.elevators} · awards{' '}
            {live?.sources?.awards || data.sources?.awards} · SLA {data.sources?.sla} · HPD {data.sources?.hpd} ·
            ACRIS deeds through {data.sources?.acrisThrough}. Every source passes a written license gate before
            collection; the ACRIS portal prohibits robots, so deeds come from the city's open-data batch. The same
            engine runs in production for government procurement and film/TV music licensing. Built by{' '}
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.name}</a>.
          </p>
        )}
      </footer>
    </div>
  );
}

function SimpleFeed({ items, total, shown, onMore, openId, toggle, reduce, renderHead, renderBody, idOf, nameOf, hashType, isWatched, onWatch, statusOf }) {
  return (
    <>
      <div className="feed">
        <AnimatePresence mode="popLayout" initial={false}>
        {items.map((c, i) => {
          const id = idOf(c);
          const open = openId === id;
          return (
            <motion.article
              layout={reduce ? false : true}
              key={id}
              id={'rw-' + id}
              className={'card' + (open ? ' open' : '')}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
                delay: Math.min(i * 0.04, 0.3),
                layout: { type: 'spring', stiffness: 350, damping: 34 },
              }}
            >
              <div className="card-row">
                <button
                  className="card-head"
                  aria-expanded={open}
                  // The screen-reader name says which record this is; the visual
                  // head is a dense span soup that reads as an anonymous button.
                  aria-label={nameOf ? `${open ? 'Collapse' : 'Expand'} ${nameOf(c)}` : undefined}
                  onClick={() => toggle(hashType, id, open)}
                >
                  <StatusDot status={statusOf ? statusOf(hashType + ':' + id) : 'open'} />
                  {renderHead(c)}
                  <motion.span
                    className="chev"
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.25 }}
                    aria-hidden="true"
                  >
                    <Chevron />
                  </motion.span>
                </button>
                <motion.button
                  className={'star' + (isWatched(c) ? ' on' : '')}
                  onClick={() => onWatch(c)}
                  whileTap={reduce ? undefined : { scale: 0.78 }}
                  aria-label={isWatched(c) ? 'Remove from watchlist' : 'Add to watchlist'}
                  aria-pressed={isWatched(c)}
                >
                  <motion.span
                    key={String(isWatched(c))}
                    initial={reduce ? false : { scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 17 }}
                    style={{ display: 'flex' }}
                  >
                    <Star on={isWatched(c)} />
                  </motion.span>
                </motion.button>
              </div>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="body"
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduce ? {} : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="card-body">{renderBody(c)}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.article>
          );
        })}
        </AnimatePresence>
      </div>
      {shown < total && (
        <div className="more-row">
          <button onClick={onMore}>Show more ({total - shown} left)</button>
        </div>
      )}
    </>
  );
}

function FeedbackRow({ k, card, fbOf, mark, reasonOf, markReason, noteOf, markNote, amountOf, markAmount, feedForReasons }) {
  const cur = fbOf(k);
  const opts = [
    ['contacted', 'Contacted'],
    ['won', 'Won'],
    ['lost', 'Lost'],
  ];
  const prefix = k.slice(0, 2);
  // Only worth asking about reasons the card can actually be judged on.
  // reasonsForFeed, not reasonsFor: a reason the whole visible register agrees
  // about teaches nothing — offering "wrong borough" on a list that is entirely
  // one borough just hides the register. The dismissal strip above the feed
  // already used the filtered helper; this path did not.
  const reasons =
    cur === 'dismissed' && !reasonOf(k) && card ? reasonsForFeed(prefix, card, feedForReasons || []) : [];
  return (
    <>
      <div className="fb-row">
        <span className="fb-cap">Track it:</span>
        {opts.map(([v, l]) => (
          <button key={v} className={'fb' + (cur === v ? ' on ' + v : '')} onClick={() => mark(k, v)}>
            {l}
          </button>
        ))}
        <button className={'fb dismiss' + (cur === 'dismissed' ? ' on' : '')} onClick={() => mark(k, 'dismissed', card)}>
          {cur === 'dismissed' ? 'Restore' : 'Dismiss'}
        </button>
      </div>
      {/* Once a card is picked up, what happened to it is the only thing worth
          writing down, and there was nowhere to write it. */}
      {/* The one number the product cannot read from any register: what the
          job actually closed for. Optional — skipping it never breaks the
          math — but three recorded wins replace every assumption in the
          funnel with this device's own history. */}
      {cur === 'won' && markAmount && (
        <div className="fb-row note">
          <span className="fb-cap">What was it worth?</span>
          <input
            className="fb-note amt"
            type="text"
            inputMode="numeric"
            defaultValue={amountOf?.(k) ? String(amountOf(k)) : ''}
            placeholder="$ — optional"
            aria-label="Deal value"
            onChange={(e) => markAmount(k, e.target.value)}
            onBlur={(e) => markAmount(k, e.target.value)}
          />
        </div>
      )}
      {['contacted', 'won', 'lost'].includes(cur) && (
        <div className="fb-row note">
          <span className="fb-cap">Note:</span>
          <input
            className="fb-note"
            type="text"
            defaultValue={noteOf?.(k) || ''}
            placeholder="Who you spoke to, what they said, when to call back"
            aria-label="Note on this card"
            onBlur={(e) => markNote?.(k, e.target.value.trim())}
            onChange={(e) => markNote?.(k, e.target.value.trim())}
          />
        </div>
      )}
      {reasons.length > 0 && (
        <div className="fb-row why">
          <span className="fb-cap">Why? Two of the same and we stop showing them:</span>
          {reasons.map((r) => (
            <button key={r.k} className="fb why" onClick={() => markReason(k, r.k, r.of(card) || NO_LESSON)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const defaultCOpener = (c) => {
  if (c.kind === 'INTENT')
    return `Re: ${c.title}${c.epin ? ` (PIN ${c.epin})` : ''} — we saw the intent-to-award notice. We can perform this scope and would like to be considered; what is the process for filing an objection before ${usDate(c.dueDate)}?`;
  if (c.kind === 'SOLICITATION')
    return `Re: ${c.title}${c.epin ? ` (PIN ${c.epin})` : ''} — we intend to bid before the ${usDate(c.dueDate)} deadline. Could you confirm where the bid documents are posted and whether a pre-bid conference is scheduled?`;
  return `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you need bonding or coverage lined up before mobilization, we can quote it this week.`;
};
const defaultOOpener = (c) =>
  c.src === 'dohmh'
    ? `Re: ${venueName(c)} at ${c.address} — saw the new Health Department permit. The weeks before you open are the busiest you'll ever have; if you're still picking a POS, coverage or suppliers, we can set you up before the doors open.`
    : `Re: ${venueName(c)} — saw the license application for ${c.address}. Openings are the busiest weeks you'll ever have; if you're still picking a POS or coverage, we can set you up before the doors open.`;

// US conveniences: dates the way Americans read them, an ET clock, map links a
// field crew can actually use, and calendar files for anything with a date.
const usDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const usShort = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const businessDaysUntil = (iso) => {
  if (!iso) return null;
  const end = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  let n = 0;
  const cur = new Date();
  if (isNaN(end) || end < cur) return null;
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
};
const mapsUrl = (addr, boro) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${addr}, ${boro}, NY`)}`;
const streetViewUrl = (addr, boro) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=&query=${encodeURIComponent(`${addr}, ${boro}, NY`)}`;

function downloadIcs(title, dateIso, description, location) {
  const d = String(dateIso).slice(0, 10).replace(/-/g, '');
  const uid = `${d}-${Math.random().toString(36).slice(2)}@rightwindow`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const esc = (t) => String(t || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Right Window//EN', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(description)}`, `LOCATION:${esc(location)}`,
    'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'right-window-event.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}

const findUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q.trim())}`;
const liUrl = (q) => `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(q.trim())}`;

function subOpens(sub) {
  return sub === '10A' ? '2025-02-21' : sub === '10B' ? '2026-02-21' : '2027-02-21';
}

