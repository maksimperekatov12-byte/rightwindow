import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion, animate } from 'motion/react';
import data from './data/feed.json';

const YEAR = new Date().getFullYear();

// One place for how people reach Maxim. Add PHONE when there is a US number.
const CONTACT = {
  name: 'Maxim Perekatov',
  email: 'maxim122090@gmail.com',
  phone: '', // e.g. '+1 (917) 555-0134' — shown as a tap-to-call link when set
};
const byUrgency = (a, b) => b.urgencyScore - a.urgencyScore || a.monthsLeft - b.monthsLeft;
const has = (c, kind) => c.signals.some((s) => s.kind === kind);
const rank = (c, kind) => c.signals.find((x) => x.kind === kind)?.urgency ?? 0;
const money = (n) => '$' + n.toLocaleString('en-US');

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
  hero: 'Buildings in a forced-spend window',
  hint: 'Ranked by urgency — deadlines, fresh violations, ownership changes, penalty balances.',
  sort: byUrgency,
  why: (c) => signalStory(c),
  opener: (c) =>
    `Re: ${title(c.address)} — city records show mandated facade work ahead of the ${c.deadline} deadline. Worth a quick conversation before the penalty meter starts.`,
};

const PROFILES = {
  qewi: {
    label: 'Facade engineer',
    tile: 'Facade engineering / inspections (QEWI)',
    facade: {
      hero: 'Buildings that need a facade engineer — before they know it',
      hint: 'Buildings with no engineer engaged for Cycle 10 — ranked by how little time is left.',
      sort: byUrgency,
      why: () => 'No engineer on record — first call gets the walk-through.',
      opener: (c) =>
        `Re: ${title(c.address)} — DOB shows no Cycle 10 facade filing and the ${c.subCycle} deadline is ${c.deadline}. We can inspect this month, before the $1,000/mo penalty meter starts.`,
    },
    cNeed: (c) => `A ${money(c.amount)} construction award usually means inspections and special-inspection sign-offs down the line.`,
    cFilter: (c) => CONSTR.test(c.category || ''),
    oNeed: null,
  },
  restoration: {
    label: 'Restoration contractor',
    tile: 'Facade restoration / exterior repair',
    facade: {
      hero: 'Repair work the law has already sold for you',
      hint: 'Open SWARMP and UNSAFE conditions — mandatory scopes, before they go out to bid.',
      sort: (a, b) =>
        rank(b, 'SWARMP_CARRYOVER') + rank(b, 'UNSAFE_PRIOR') - rank(a, 'SWARMP_CARRYOVER') - rank(a, 'UNSAFE_PRIOR') || byUrgency(a, b),
      why: () => 'Mandatory scope, no contractor attached yet.',
      opener: (c) =>
        `Re: ${title(c.address)} — the open SWARMP from Cycle 9 becomes presumed-unsafe at the next filing. We can walk the scope and price it this week.`,
    },
    cNeed: (c) => `${c.vendor} just took on ${money(c.amount)} of city work — subcontract scopes get placed in the first weeks.`,
    cFilter: (c) => CONSTR.test(c.category || ''),
    oNeed: null,
  },
  lender: {
    label: 'C-PACE / lender',
    tile: 'Financing (C-PACE, bridge, equipment)',
    facade: {
      hero: 'Forced capital projects, found before the loan request',
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
    label: 'Elevator services',
    tile: 'Elevator service / modernization',
    facade: {
      hero: 'Elevators with a legal test due — and no one booked',
      hint: `Buildings whose devices have no ${YEAR} CAT1 test or an overdue 5-year CAT5 — the deadline is Dec 31.`,
      sort: (a, b) =>
        (b.elevator?.cat1Missing || 0) + (b.elevator?.cat5Due || 0) - (a.elevator?.cat1Missing || 0) - (a.elevator?.cat5Due || 0) ||
        byUrgency(a, b),
      why: (c) =>
        c.elevator
          ? `${c.elevator.cat1Missing ? `${c.elevator.cat1Missing}/${c.elevator.devices} without a ${YEAR} CAT1` : ''}${c.elevator.cat1Missing && c.elevator.cat5Due ? ', ' : ''}${c.elevator.cat5Due ? `${c.elevator.cat5Due} due for CAT5` : ''} — filing closes December 31.`
          : 'Forced-work windows usually bundle elevator capex.',
      opener: (c) =>
        `Re: ${title(c.address)} — DOB shows ${c.elevator?.cat1Missing || 'several'} elevator device(s) without a ${YEAR} CAT1 filing. We can test and file before the December 31 deadline.`,
      fFilter: (c) => Boolean(c.elevator),
    },
    cNeed: null,
    oNeed: null,
  },
  insurance: {
    label: 'Insurance / bonding',
    tile: 'Insurance / surety bonds',
    facade: {
      hero: 'Buildings whose risk profile just changed',
      hint: 'New owners re-shop coverage; active violations raise liability; mandated work needs builder’s risk.',
      sort: (a, b) =>
        (b.ownerChange ? 3 : 0) + (b.freshHaz ? 2 : 0) - (a.ownerChange ? 3 : 0) - (a.freshHaz ? 2 : 0) || byUrgency(a, b),
      why: (c) =>
        c.ownerChange || c.mgmtChange
          ? 'New ownership re-shops every policy in year one.'
          : 'Open violations change the liability picture before renewal.',
      opener: (c) =>
        `Re: ${title(c.address)} — city records show mandated facade work and open violations. Worth reviewing coverage before the repair scope starts?`,
    },
    cNeed: (c) => `${c.vendor} must post performance bonds and certificates of insurance before mobilizing ${money(c.amount)} of city work — usually within two weeks of the award.`,
    cOpener: (c) =>
      `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you need bonding or COIs lined up before mobilization, we can quote it this week.`,
    oNeed: () => `A new venue needs general liability and liquor liability before the doors open — and underwriting takes weeks.`,
    oOpener: (c) =>
      `Re: ${c.name} — saw the license application for ${c.address}. GL and liquor liability take a few weeks to bind; we can have you covered before opening day.`,
  },
  pos: {
    label: 'POS / payments',
    tile: 'POS, payments, restaurant tech',
    facade: null,
    cNeed: null,
    oNeed: () => `POS and payments get chosen during build-out — before opening day, not after. This venue is deciding right now.`,
    oOpener: (c) =>
      `Re: ${c.name} — saw the license application for ${c.address}. If you're still picking a POS, we can have you set up and trained before the doors open.`,
  },
  fnb: {
    label: 'F&B supplier',
    tile: 'Food and beverage supply',
    facade: null,
    cNeed: null,
    oNeed: () => `Opening menus are being costed right now — supplier lists lock in before the first delivery, not after.`,
    oOpener: (c) => `Re: ${c.name} — saw the license application for ${c.address}. We supply venues like yours; happy to quote your opening order before the rush.`,
  },
  staffing: {
    label: 'Staffing',
    tile: 'Staffing / recruiting',
    facade: null,
    cNeed: (c) => `${c.vendor} needs crews to deliver ${money(c.amount)} of new work — hiring happens in the first weeks after an award.`,
    cOpener: (c) => `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you're staffing up to deliver, we can have vetted crews ready this month.`,
    oNeed: () => `A venue opening in 2–4 months hires its whole team in the last six weeks — the search starts now.`,
    oOpener: (c) => `Re: ${c.name} — congrats on the upcoming opening at ${c.address}. We staff openings; want a bench of vetted candidates ready for your hiring window?`,
  },
  equipment: {
    label: 'Equipment / access',
    tile: 'Equipment rental / scaffolding',
    facade: {
      hero: 'Mandated repairs that need access equipment',
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
    label: 'Property management',
    tile: 'Property management',
    facade: {
      hero: 'Buildings that just changed hands — before the management RFP',
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
    label: 'Code attorney / expeditor',
    tile: 'Code attorneys / expeditors',
    facade: {
      hero: 'Hearings on the calendar, violations on the clock',
      hint: 'Buildings with OATH hearings ahead, fresh violations or unpaid ECB balances — clients with a date.',
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
    label: 'CRE broker / investor',
    tile: 'CRE brokerage / investment',
    facade: {
      hero: 'Owners under compliance pressure — before they list',
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
      `Re: ${c.name} — saw the filing for ${c.address}. Opening night only happens once; we build launch campaigns for new venues. Want the neighborhood talking before the doors open?`,
  },
  signage: {
    label: 'Signs / storefront',
    tile: 'Signage / storefronts',
    facade: null,
    cNeed: null,
    oNeed: () => `A storefront sign takes weeks: design, DOB sign permit, fabrication, install. It gets ordered during build-out — which is exactly where this venue is today.`,
    oOpener: (c) =>
      `Re: ${c.name} — saw the filing for ${c.address}. Signage takes weeks to design, permit and fabricate; we can have your storefront ready before opening day.`,
  },
  explore: {
    label: 'Just exploring',
    tile: 'Just exploring',
    facade: null,
    cNeed: null,
    oNeed: null,
  },
};

const fmtUsd = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

const PIPE = {
  qewi: (t) => ({ v: t.nonFilers10A * 5000, n: `${t.nonFilers10A.toLocaleString('en-US')} unfiled buildings × ~$5K per FISP inspection` }),
  restoration: (t) => ({ v: t.swarmpCarryover * 100000, n: `${t.swarmpCarryover.toLocaleString('en-US')} open SWARMP scopes × ~$100K per mandated repair` }),
  elevator: (t, f) => {
    const d = f.reduce((s, c) => s + (c.elevator ? c.elevator.cat1Missing + c.elevator.cat5Due : 0), 0);
    return { v: d * 650, n: `${d} overdue devices on this feed × ~$650 per test` };
  },
  insurance: (t, f) => ({ v: f.length * 12000, n: `${f.length} buildings × ~$12K annual premium` }),
  lender: (t, f) => ({ v: f.length * 200000, n: `${f.length} buildings × ~$200K financeable scope` }),
  equipment: (t, f) => ({ v: f.length * 45000, n: `${f.length} mandated scopes × ~$45K shed and scaffold` }),
  propmgmt: (t, f) => ({ v: f.length * 50000, n: `${f.length} buildings changing hands × ~$50K/yr management fee` }),
  legal: (t, f) => ({ v: f.length * 7500, n: `${f.length} buildings with hearings or penalties × ~$7.5K per matter` }),
  cre: (t, f) => ({ v: f.length * 160000, n: `${f.length} pressured owners × ~2% fee on a typical $8M sale` }),
  staffing: (t, f, c) => ({ v: c.length * 25000, n: `${c.length} fresh awards × ~$25K staffing package` }),
  pos: (t, f, c, o) => ({ v: o.length * 4000, n: `${o.length} openings × ~$4K/yr per venue` }),
  fnb: (t, f, c, o) => ({ v: o.length * 60000, n: `${o.length} openings × ~$60K/yr supply` }),
  marketing: (t, f, c, o) => ({ v: o.length * 15000, n: `${o.length} openings × ~$15K launch budget` }),
  signage: (t, f, c, o) => ({ v: o.length * 20000, n: `${o.length} openings × ~$20K storefront` }),
};

const PROFILE_ORDER = ['qewi', 'restoration', 'elevator', 'insurance', 'lender', 'equipment', 'propmgmt', 'legal', 'cre', 'staffing', 'pos', 'fnb', 'marketing', 'signage', 'explore'];

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

const VERTICALS = [
  { key: 'facades', label: 'Building facades' },
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
  const deepLinked = useRef(Boolean(location.hash.match(/^#(b|c|o)\//)));
  const [profileKey, setProfileKey] = useState(() => loadLS('rw.profile', null));
  const [showOnboard, setShowOnboard] = useState(() => !loadLS('rw.profile', null) && !deepLinked.current);
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
  const [email, setEmail] = useState(() => loadLS('rw.email', ''));
  const [theme, setTheme] = useState(() => loadLS('rw.theme', null));
  const [now, setNow] = useState(Date.now());
  const [checkedAt, setCheckedAt] = useState(null);
  const [claims, setClaims] = useState({});
  const [mine, setMine] = useState({});
  const [live, setLive] = useState(null);
  const [emailSaved, setEmailSaved] = useState(false);
  const [slackHook, setSlackHook] = useState(() => loadLS('rw.slack', ''));
  const [slackState, setSlackState] = useState('idle');
  const [portfolio, setPortfolio] = useState(() => loadLS('rw.portfolio', []));
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [portfolioText, setPortfolioText] = useState('');
  const [onlyPortfolio, setOnlyPortfolio] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);
  const [fb, setFb] = useState(() => loadLS('rw.fb', {}));
  const [showHidden, setShowHidden] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const reduce = useReducedMotion();
  const uid = useRef(null);
  if (uid.current === null) {
    let u = loadLS('rw.uid', null);
    if (!u) {
      u = crypto.randomUUID();
      saveLS('rw.uid', u);
    }
    uid.current = u;
  }

  const mark = (k, st) => {
    if ((st === 'contacted' || st === 'won') && !claims[k]) {
      setClaims((c) => ({ ...c, [k]: { at: Date.now() } }));
      fetch('/api/claims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: uid.current, key: k }),
      }).catch(() => {});
    }
    setFb((f) => {
      const n = { ...f };
      if (n[k]?.s === st) delete n[k];
      else n[k] = { s: st, t: Date.now() };
      saveLS('rw.fb', n);
      return n;
    });
  };
  const fbOf = (k) => fb[k]?.s || null;
  const isDismissed = (k) => fbOf(k) === 'dismissed';
  const statusOf = (k) => (claims[k] ? 'taken' : mine[k] && mine[k] > now ? 'personal' : 'open');
  const hoursLeft = (k) => Math.max(1, Math.round((mine[k] - now) / 3600000));

  useEffect(() => {
    const r = document.documentElement;
    if (theme) r.dataset.theme = theme;
    else delete r.dataset.theme;
  }, [theme]);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30000);
    const pull = () => {
      fetch('/api/heartbeat')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.checkedAt && setCheckedAt(j.checkedAt))
        .catch(() => {});
      fetch('/api/live')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.contracts && setLive(j))
        .catch(() => {});
      fetch('/api/claims')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setClaims(j))
        .catch(() => {});
      fetch('/api/mine?uid=' + uid.current)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j?.items) return;
          const m = {};
          for (const it of j.items) m[it.key] = it.until;
          setMine(m);
        })
        .catch(() => {});
    };
    pull();
    const h = setInterval(pull, 30000);
    return () => {
      clearInterval(i);
      clearInterval(h);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uid: uid.current,
          data: {
            profile: profileKey,
            boro,
            watch: Object.keys(watch),
            feedback: fb,
            lastFeedSeen: data.generatedAt,
            channels: { email: email || null, slack: slackHook || null, walletSerial: null },
            portfolio,
          },
        }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [profileKey, watch, fb, boro, email, slackHook, portfolio]);

  useEffect(() => {
    fetch('/api/pass/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setWalletReady(Boolean(j?.configured)))
      .catch(() => {});
  }, []);

  const profile = PROFILES[profileKey] || PROFILES.explore;
  const fv = profile.facade || GENERIC_FACADE;
  const [sortMode, setSortMode] = useState('profile');
  const [showTop, setShowTop] = useState(false);
  const searchRef = useRef(null);

  const forcedVert = useRef(null);
  if (forcedVert.current === null) {
    const m = location.hash.match(/^#(b|c|o)\//);
    forcedVert.current = m ? { b: 'facades', c: 'contracts', o: 'openings' }[m[1]] : '';
  }
  const isExplore = !profile.facade && !profile.cNeed && !profile.oNeed;
  const visibleVerts = VERTICALS.filter(
    (v) =>
      isExplore ||
      v.key === forcedVert.current ||
      (v.key === 'facades' && profile.facade) ||
      (v.key === 'contracts' && profile.cNeed) ||
      (v.key === 'openings' && profile.oNeed),
  );
  useEffect(() => {
    if (!visibleVerts.some((v) => v.key === vertical)) setVertical(visibleVerts[0].key);
  }, [profileKey]);

  const watchCount = Object.keys(watch).length;
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

  const pickProfile = (k) => {
    setProfileKey(k);
    saveLS('rw.profile', k);
    setShowOnboard(false);
    setShown(7);
    const p = PROFILES[k];
    setVertical(p?.facade ? 'facades' : p?.cNeed ? 'contracts' : p?.oNeed ? 'openings' : 'facades');
    setSortMode('profile');
  };

  const SORTS = {
    profile: fv.sort,
    deadline: (a, b) => a.monthsLeft - b.monthsLeft || byUrgency(a, b),
    money: (a, b) => (b.ecbBalance || 0) + (b.finesOwed || 0) - (a.ecbBalance || 0) - (a.finesOwed || 0),
  };
  const facadeFeed = useMemo(
    () => data.facades.feed.filter(fv.fFilter || (() => true)).sort(SORTS[sortMode] || fv.sort),
    [profileKey, sortMode],
  );
  const filteredFeed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = facadeFeed.filter((c) => {
      if (showHidden !== isDismissed('b:' + c.bin)) return false;
      if (hideBusy && c.occupied) return false;
      if (onlyPortfolio && !portfolio.includes(c.bin)) return false;
      if (onlyWatch && !isWatched('b:' + c.bin)) return false;
      if (boro !== 'all' && c.borough !== boro) return false;
      if (onlyNew && !(c.isNew || c.fresh?.length)) return false;
      if (!q) return true;
      return [c.address, c.owner, c.priorQewi, c.agent?.company, c.agent?.name]
        .filter(Boolean)
        .some((f) => f.toLowerCase().includes(q));
    });
    const isMine = (c) => (mine['b:' + c.bin] && mine['b:' + c.bin] > now ? 0 : 1);
    return base.sort((a, b) => isMine(a) - isMine(b));
  }, [facadeFeed, query, boro, onlyNew, onlyWatch, watch, fb, showHidden, mine, now, onlyPortfolio, portfolio, hideBusy]);
  const boroCounts = useMemo(() => {
    const m = {};
    for (const c of facadeFeed) m[c.borough] = (m[c.borough] || 0) + 1;
    return m;
  }, [facadeFeed]);
  const liveContracts = live?.contracts || data.contracts;
  const liveOpenings = live?.openings || data.openings;
  const contractsBase = useMemo(() => liveContracts.filter(profile.cFilter || (() => true)), [profileKey, liveContracts]);
  const contractsList = useMemo(
    () => contractsBase.filter((c) => showHidden === isDismissed('c:' + c.id) && (!onlyWatch || isWatched('c:' + c.id))),
    [contractsBase, onlyWatch, watch, fb, showHidden],
  );
  const openingsList = useMemo(
    () => liveOpenings.filter((o) => showHidden === isDismissed('o:' + o.id) && (!onlyWatch || isWatched('o:' + o.id))),
    [liveOpenings, onlyWatch, watch, fb, showHidden],
  );
  useEffect(() => setShown(7), [query, boro, onlyNew, onlyWatch, vertical, showHidden, onlyPortfolio, hideBusy]);

  const hiddenCount = Object.keys(fb).filter((k) => fb[k]?.s === 'dismissed').length;
  const wn = { ...(data.whatsNew || { buildings: 0, signals: 0, contracts: 0, openings: 0 }), ...(live?.whatsNew || {}) };
  const hasNew = wn.buildings + wn.signals + wn.contracts + wn.openings > 0;
  const pulled = new Date(data.generatedAt);
  const ago = (t) => {
    const m = Math.max(0, Math.round((now - t) / 60000));
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
  };
  const checksToday = live?.pulse?.length || 0;
  const lastChangeAt = live?.changedAt || pulled.getTime();
  const lastChangeLabel = ago(lastChangeAt);
  const recentDays = useMemo(() => {
    const days = [];
    const log = live?.changeLog || [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const n = log
        .filter((c) => new Date(c.at).toISOString().slice(0, 10) === key)
        .reduce((s2, c) => s2 + (c.contracts || 0) + (c.openings || 0), 0);
      days.push({ day: key.slice(5), n });
    }
    return days;
  }, [live, now]);
  const dataAt = live?.changedAt || pulled.getTime();
  const agoLabel = ago(dataAt);
  const toggleTheme = () => {
    const effDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = effDark ? 'light' : 'dark';
    setTheme(next);
    saveLS('rw.theme', next);
  };

  useEffect(() => {
    const m = location.hash.match(/^#(b|c|o)\/(.+)$/);
    if (!m) return;
    const [, t, id] = m;
    if (t === 'b') {
      const base = [...data.facades.feed].sort(byUrgency);
      const idx = base.findIndex((c) => c.bin === id);
      if (idx >= 0) {
        setVertical('facades');
        setOpenId(id);
        setShown(Math.max(7, idx + 1));
      }
    } else if (t === 'c') {
      const idx = (live?.contracts || data.contracts).findIndex((c) => c.id === id);
      if (idx >= 0) {
        setVertical('contracts');
        setOpenId(id);
        setShown(Math.max(7, idx + 1));
      }
    } else {
      const idx = (live?.openings || data.openings).findIndex((o) => o.id === id);
      if (idx >= 0) {
        setVertical('openings');
        setOpenId(id);
        setShown(Math.max(7, idx + 1));
      }
    }
    setTimeout(() => document.getElementById(`rw-${m[2]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 500);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && showOnboard && profileKey) setShowOnboard(false);
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
  }, [showOnboard, profileKey]);

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
        ['Address', 'Borough', 'BIN', 'Signals', 'Sub-cycle', 'Deadline', 'Months left', 'Why now', 'Penalties owed', 'ECB balance', 'Next hearing', 'Sold', 'Elevators due', 'Managing agent', 'Agent contact', 'Agent address', 'Suggested opener', 'DOB record', 'Link'],
        filteredFeed.map((c) => [
          title(c.address), c.borough, c.bin,
          c.signals.map((s) => BADGE[s.kind]).join('; '),
          c.subCycle, c.deadline, c.monthsLeft,
          fv.why(c),
          c.finesOwed || 0, c.ecbBalance || 0, c.nextHearing || '',
          c.ownerChange ? `${c.ownerChange.recorded}${c.ownerChange.amount ? ' ' + money(Math.round(c.ownerChange.amount)) : ''}` : '',
          c.elevator ? `${c.elevator.cat1Missing} no CAT1 / ${c.elevator.cat5Due} CAT5 due` : '',
          title(c.agent?.company || ''), title(c.agent?.name || ''), title(c.agent?.address || ''),
          fv.opener(c),
          `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${c.bin}`,
          `${location.origin}/#b/${c.bin}`,
        ]),
      );
    } else if (vertical === 'contracts') {
      downloadCsv(
        'right-window-contracts.csv',
        ['Vendor', 'Amount', 'Agency', 'Contract', 'Awarded', 'Days ago', 'Why you', 'Vendor address', 'Suggested opener', 'Link'],
        contractsList.map((c) => [
          c.vendor, c.amount, c.agency, c.title, c.date, c.daysAgo,
          profile.cNeed?.(c) || 'Winner is mobilizing: subs, bonding, insurance, staffing, equipment.',
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
          o.name, o.kind, o.county, o.address, o.legal, o.received || '',
          profile.oNeed?.(o) || 'Opening in 2–4 months: POS, insurance, suppliers, furniture, marketing get chosen now.',
          (profile.oOpener || defaultOOpener)(o),
          `${location.origin}/#o/${o.id}`,
        ]),
      );
    }
  };

  const pipe = useMemo(() => {
    const fn = PIPE[profileKey];
    if (!fn) return null;
    const r = fn(data.facades.totals, facadeFeed, contractsBase, data.openings);
    return r && r.v > 0 ? r : null;
  }, [profileKey, facadeFeed, contractsBase]);

  const heroText =
    vertical === 'facades'
      ? fv.hero
      : vertical === 'contracts'
        ? 'Companies that won city money yesterday'
        : 'Venues that will open their doors in a few months';

  const heroSub =
    vertical === 'facades'
      ? "Every building over six stories runs on a public compliance clock. We surface the ones that fell off it — with the deadline and the person to call."
      : vertical === 'contracts'
        ? 'A contract award is public the day it lands. The winner has two weeks to line up subs, bonding and crews.'
        : 'A liquor-license filing means a venue opens in two to four months — and is choosing its vendors right now.';

  const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 };
  const fade = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1], delay },
        };

  const miniToolbar = (list, total) => (
    <div className="toolbar">
      <button className={'chip-btn' + (onlyWatch ? ' on' : '')} onClick={() => setOnlyWatch((v) => !v)}>
        ★ Watchlist{watchCount ? ` (${watchCount})` : ''}
      </button>
      {hiddenCount > 0 && (
        <button className={'chip-btn' + (showHidden ? ' on' : '')} onClick={() => setShowHidden((v) => !v)}>
          Hidden ({hiddenCount})
        </button>
      )}
      <button className="chip-btn" onClick={exportCurrent}>Export CSV</button>
      <span className="count">
        {list.length}
        {list.length !== total ? ` of ${total}` : ''} shown
      </span>
    </div>
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
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? {} : { opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2>What do you do?</h2>
              <p>Pick what you sell. We'll show who needs it this week — with the timing and the person to call.</p>
              <div className="tiles">
                {PROFILE_ORDER.map((k) => (
                  <button key={k} className={'tile' + (profileKey === k ? ' on' : '')} onClick={() => pickProfile(k)}>
                    {PROFILES[k].tile}
                  </button>
                ))}
              </div>
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
                <p className="pf-miss">Not in the feed — likely no open window right now.</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="top">
        <div className="logo">
          <svg className="mark" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2.5" y="2.5" width="19" height="19" rx="4.5" stroke="currentColor" strokeWidth="2" />
            <rect x="12.6" y="6.4" width="5.4" height="5.4" rx="1.4" fill="var(--brand)" stroke="none" />
            <path d="M7 12.5v4.5M7 7v1.8M12.5 17h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.35" />
          </svg>
          <b>Right Window</b>
          <span>NYC public records</span>
        </div>
        <div className="top-right">
          <button className="theme-btn" onClick={toggleTheme} aria-label="Toggle dark mode">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
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
            {profileKey ? profile.label : 'Who are you?'} <span aria-hidden="true">›</span>
          </button>
          <div className="pulled">
            <motion.span
              className="dot"
              animate={reduce ? {} : { opacity: [1, 0.35, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span title={`Contract awards and license filings are re-checked every 5 minutes; the full building sweep runs hourly. Last build: ${pulled.toLocaleString('en-US')}`}>
              {checkedAt || live?.checkedAt
                ? `checked ${ago(live?.checkedAt || checkedAt)} · new data ${agoLabel}`
                : `new data ${agoLabel}`}
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
              className={vertical === v.key ? 'on' : ''}
              onClick={() => {
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
        </div>
      </LayoutGroup>

      <div className="lede">
        <section className="hero">
          <div className="eyebrow">New York City · public records, read hourly</div>
          <AnimatePresence mode="popLayout">
            <motion.h1
              key={vertical + profileKey}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? {} : { opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              {heroText}
            </motion.h1>
          </AnimatePresence>
          <motion.p {...fade(0.05)}>{heroSub}</motion.p>
          {pipe && (
            <motion.div className="pipe" {...fade(0.1)}>
              <b>≈ {fmtUsd(pipe.v)}</b> of potential work
              <span title={`Back-of-napkin: ${pipe.n}`}>matched to your trade and boroughs · hover for the math</span>
            </motion.div>
          )}
        </section>
        {vertical === 'facades' && (
          <div className="stats">
            {[
              [data.facades.totals.candidates, 'buildings off the compliance calendar, four boroughs'],
              [data.facades.totals.nonFilers10A, 'unfiled for sub-cycle 10A — six months to deadline'],
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
                <b>New in the last 48 hours:</b>{' '}
                {[
                  wn.buildings && `${wn.buildings} building${wn.buildings > 1 ? 's' : ''}`,
                  wn.signals && `${wn.signals} fresh signal${wn.signals > 1 ? 's' : ''}`,
                  wn.contracts && `${wn.contracts} contract${wn.contracts > 1 ? 's' : ''}`,
                  wn.openings && `${wn.openings} venue filing${wn.openings > 1 ? 's' : ''}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </>
            ) : (
              <>
                <b>No new windows in the last 48 hours.</b> The registers have been quiet — we keep checking.
              </>
            )}
          </span>
          {vertical === 'facades' && hasNew && <span className="news-cta">{onlyNew ? 'show all' : 'show only new'}</span>}
        </button>
        <div className="pulseline">
          <span title="Every check writes a timestamp, whether the city published anything or not">
            {checksToday ? `${checksToday} checks in the last 24h` : 'checking every 5 minutes'}
          </span>
          <span aria-hidden="true">·</span>
          <span>last new signal {lastChangeLabel}</span>
          {recentDays.some((d) => d.n > 0) && (
            <span className="spark" aria-label="new signals per day, last 7 days">
              {recentDays.map((d) => (
                <i key={d.day} className={d.n ? 'on' : ''} style={{ height: 4 + Math.min(14, d.n * 3) }} title={`${d.day}: ${d.n} new`} />
              ))}
            </span>
          )}
        </div>
      </motion.div>

      {vertical === 'facades' && (
        <>
          <p className="personas-hint">{fv.hint}</p>

          {Object.keys(mine).filter((k) => mine[k] > now).length > 0 && (
            <div className="p-banner">
              <span className="found personal" aria-hidden="true">★</span>
              <span>
                <b>{Object.keys(mine).filter((k) => mine[k] > now).length} personal signal{Object.keys(mine).filter((k) => mine[k] > now).length > 1 ? 's' : ''}</b>{' '}
                — yours for 48 hours, then they rotate to someone else.
              </span>
            </div>
          )}
          <div className="legend" aria-hidden="true">
            <span><i className="ldot open" /> open — no one has claimed it</span>
            <span><i className="ldot taken" /> taken — someone is already on it</span>
            <span><i className="ldot personal" /> personal — yours for 48h</span>
          </div>

          <div className="toolbar">
            <input
              ref={searchRef}
              type="search"
              className="search"
              placeholder="Search address, owner, agent…  ( / )"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search buildings"
            />
            <select className="sel" value={sortMode} onChange={(e) => setSortMode(e.target.value)} aria-label="Sort">
              <option value="profile">Sort: for you</option>
              <option value="deadline">Sort: deadline</option>
              <option value="money">Sort: penalties owed</option>
            </select>
            <div className="chips" role="group" aria-label="Borough">
              {[
                ['all', 'All', '', ''],
                ['Manhattan', 'Manhattan', 'mn', '4'],
                ['Brooklyn', 'Brooklyn', 'bk', 'B'],
                ['Queens', 'Queens', 'qn', 'N'],
                ['Bronx', 'Bronx', 'bx', '2'],
              ].map(([b, label, line, glyph]) => (
                <button key={b} className={'chip-btn' + (boro === b ? ' on' : '')} onClick={() => setBoro(b)}>
                  {line && <span className={'bullet ' + line} aria-hidden="true">{glyph}</span>}
                  {label}
                  <small>{b === 'all' ? facadeFeed.length : boroCounts[b] || 0}</small>
                </button>
              ))}
            </div>
            <button className={'chip-btn' + (onlyWatch ? ' on' : '')} onClick={() => setOnlyWatch((v) => !v)}>
              ★ Watchlist{watchCount ? ` (${watchCount})` : ''}
            </button>
            <button className={'chip-btn' + (hideBusy ? ' on' : '')} onClick={() => setHideBusy((v) => !v)} title="Hide buildings where a contractor already pulled a permit">
              Hide worked
            </button>
            <button className={'chip-btn' + (onlyPortfolio ? ' on' : '')} onClick={() => (portfolio.length ? setOnlyPortfolio((v) => !v) : setPortfolioOpen(true))}>
              My buildings{portfolio.length ? ` (${portfolio.length})` : ' +'}
            </button>
            {hiddenCount > 0 && (
              <button className={'chip-btn' + (showHidden ? ' on' : '')} onClick={() => setShowHidden((v) => !v)}>
                Hidden ({hiddenCount})
              </button>
            )}
            <button className="chip-btn" onClick={exportCurrent}>Export CSV</button>
            <span className="count">{filteredFeed.length} buildings</span>
          </div>

          {filteredFeed.length === 0 && (
            <div className="empty">
              <b>Nothing matches</b>
              No buildings fit the current search and filters.
              <div>
                <button onClick={() => { setQuery(''); setBoro('all'); setOnlyNew(false); setOnlyWatch(false); }}>Clear all filters</button>
              </div>
            </div>
          )}
          <div className="feed">
            <AnimatePresence mode="popLayout" initial={false}>
            {filteredFeed.slice(0, shown).map((c, i) => {
              const open = openId === c.bin;
              const wkey = 'b:' + c.bin;
              const topSignal = [...c.signals].sort((a, b) => b.urgency - a.urgency)[0];
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
                    <button className="card-head" aria-expanded={open} onClick={() => toggleCard('b', c.bin, open)}>
                      <span
                        className={'found ' + statusOf('b:' + c.bin)}
                        title={
                          statusOf('b:' + c.bin) === 'taken'
                            ? 'Taken — someone is already on it'
                            : statusOf('b:' + c.bin) === 'personal'
                              ? `Personal — yours for ${hoursLeft('b:' + c.bin)}h`
                              : 'Open — no one has claimed it yet'
                        }
                      >
                        {statusOf('b:' + c.bin) === 'personal' ? (
                          '★'
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <span className="head-main">
                        <span className="addr">{title(c.address)}</span>
                        <span className="boro">{c.borough}</span>
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
                          <WindowBar opens={subOpens(c.subCycle)} deadline={c.deadline} />
                          <div className="winbar-legend">
                            <span>window opened {usShort(subOpens(c.subCycle))}</span>
                            <span>deadline {usDate(c.deadline)}</span>
                          </div>

                          <div className="sig">
                            <div className="sig-k">
                              Why now
                              <span className="score" title="Urgency score">{c.urgencyScore}</span>
                            </div>
                            <div className="sig-v">{signalStory(c)}</div>
                          </div>
                          {c.occupied && (
                            <div className="sig busy">
                              <div className="sig-k">Already worked</div>
                              <div className="sig-v">
                                {c.filing?.who ? `${title(c.filing.who)} pulled a permit` : 'A permit is already pulled'}
                                {c.filing?.filed ? ` after filing ${usShort(c.filing.filed)}` : ''}. Ranked low on purpose — call only if you
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
                            <div className="fact">
                              <div className="k">Last report</div>
                              <div className="v">
                                Cycle {c.lastCycle}
                                {c.lastFiling ? ` · ${usDate(c.lastFiling)}` : ''} · {c.lastStatus || 'n/a'}
                              </div>
                            </div>
                            {c.priorQewi && (
                              <div className="fact">
                                <div className="k">Prior engineer</div>
                                <div className="v">{title(c.priorQewi)} — no Cycle 10 engagement on record</div>
                              </div>
                            )}
                            {c.owner && (
                              <div className="fact">
                                <div className="k">Owner of record</div>
                                <div className="v">{title(c.owner)}</div>
                              </div>
                            )}
                            {c.mgmtChange && (
                              <div className="fact">
                                <div className="k">Registration changed</div>
                                <div className="v">
                                  detected {c.mgmtChange.detected}
                                  {c.mgmtChange.prevCompany ? ` · was ${title(c.mgmtChange.prevCompany)}` : ''} · HPD daily
                                </div>
                              </div>
                            )}
                            {c.ownerChange && (
                              <div className="fact">
                                <div className="k">Sold</div>
                                <div className="v">
                                  {usDate(c.ownerChange.recorded)}
                                  {c.ownerChange.amount ? ` · ${money(Math.round(c.ownerChange.amount))}` : ''} · ACRIS deed
                                </div>
                              </div>
                            )}
                            {c.elevator && (
                              <div className="fact">
                                <div className="k">Elevators</div>
                                <div className="v">
                                  {c.elevator.cat1Missing > 0 ? `${c.elevator.cat1Missing} of ${c.elevator.devices} without a ${YEAR} CAT1 test` : ''}
                                  {c.elevator.cat1Missing > 0 && c.elevator.cat5Due > 0 ? ' · ' : ''}
                                  {c.elevator.cat5Due > 0 ? `${c.elevator.cat5Due} due for 5-year CAT5` : ''}
                                </div>
                              </div>
                            )}
                            {c.ecbBalance > 0 && (
                              <div className="fact">
                                <div className="k">Open ECB balance</div>
                                <div className="v fine">{money(c.ecbBalance)} unpaid</div>
                              </div>
                            )}
                            {c.nextHearing && (
                              <div className="fact">
                                <div className="k">Next OATH hearing</div>
                                <div className="v">
                                  {usDate(c.nextHearing)}
                                  {businessDaysUntil(c.nextHearing) != null && (
                                    <span className="bdays"> · {businessDaysUntil(c.nextHearing)} business days</span>
                                  )}
                                </div>
                              </div>
                            )}
                            {c.shed && (
                              <div className="fact">
                                <div className="k">Sidewalk shed</div>
                                <div className={'v' + (c.shed.longStanding ? ' fine' : '')}>
                                  {c.shed.state === 'active' ? 'Up' : 'Permit lapsed'} {Math.round(c.shed.ageDays / 30)} months
                                  {c.shed.who ? ` · ${title(c.shed.who)}` : ''}
                                  {c.shed.longStanding ? ' · past the 1-year mark' : ''}
                                </div>
                              </div>
                            )}
                            {c.filing && (
                              <div className="fact">
                                <div className="k">Facade filing</div>
                                <div className="v">
                                  {usShort(c.filing.filed)}
                                  {c.filing.who ? ` · ${title(c.filing.who)}` : ''} ·{' '}
                                  {c.filing.permitted ? 'permit pulled' : c.filing.stalled ? 'approved, no permit' : c.filing.status || 'in review'}
                                  {c.filing.cost ? ` · ${money(c.filing.cost)} declared` : ''}
                                </div>
                              </div>
                            )}
                            <div className="fact">
                              <div className="k">Source</div>
                              <div className="v">
                                DOB NOW {data.sources?.facades || ''} · ECB {data.sources?.ecb || ''} · HPD {data.sources?.hpd || ''} — official city records
                              </div>
                            </div>
                            <div className="fact">
                              <div className="k">Penalty meter</div>
                              <div className={'v' + (c.finesOwed > 0 ? ' fine' : '')}>
                                {c.finesOwed > 0 ? `${money(c.finesOwed)} already owed` : '$1,000/mo after a missed deadline'}
                              </div>
                            </div>
                          </div>

                          <div className="na-cap">Next action</div>
                          <div className="call-block">
                            <div className="call-who">
                              {c.agent ? (
                                <>
                                  <b>{title(c.agent.company || c.agent.name)}</b>
                                  {c.agent.company && c.agent.name ? ` — ${title(c.agent.name)}` : ''}
                                  <span>{c.agent.role}</span>
                                  {c.agent.address && <span>{title(c.agent.address)}</span>}
                                </>
                              ) : (
                                <span>Contact via HPD registration</span>
                              )}
                            </div>
                            <div className="call-actions">
                              <button className="btn solid" onClick={() => copy(c.bin, fv.opener(c))}>
                                {copiedId === c.bin ? 'Copied' : 'Copy opener'}
                              </button>
                              <button className="btn ghost" onClick={() => copyLink('b', c.bin)}>
                                {copiedLink === c.bin ? 'Copied' : 'Copy link'}
                              </button>
                              {c.agent && (
                                <a className="btn ghost" href={findUrl(`${c.agent.company || ''} ${c.agent.name || ''} phone New York`)} target="_blank" rel="noreferrer">
                                  Find phone ↗
                                </a>
                              )}
                              {c.agent && (
                                <a className="btn ghost" href={liUrl(`${c.agent.name || c.agent.company || ''} ${c.agent.company || ''}`)} target="_blank" rel="noreferrer">
                                  LinkedIn ↗
                                </a>
                              )}
                              <a className="btn ghost" href={mapsUrl(c.address, c.borough)} target="_blank" rel="noreferrer">
                                Map ↗
                              </a>
                              <a className="btn ghost" href={streetViewUrl(c.address, c.borough)} target="_blank" rel="noreferrer">
                                Street View ↗
                              </a>
                              <button
                                className="btn ghost"
                                onClick={() =>
                                  downloadIcs(
                                    c.nextHearing
                                      ? `OATH hearing — ${title(c.address)}`
                                      : `FISP deadline (${c.subCycle}) — ${title(c.address)}`,
                                    c.nextHearing || c.deadline,
                                    `${fv.why(c)}\n\n${location.origin}/#b/${c.bin}`,
                                    `${title(c.address)}, ${c.borough}, NY`,
                                  )
                                }
                              >
                                {c.nextHearing ? 'Add hearing' : 'Add deadline'}
                              </button>
                              <a
                                className="btn ghost"
                                href={`https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${c.bin}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                DOB record ↗
                              </a>
                            </div>
                          </div>
                          <FeedbackRow k={'b:' + c.bin} fbOf={fbOf} mark={mark} />
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
                  <span className="addr">{c.vendor}</span>
                  {c.isNew && <span className="badge new">New</span>}
                  {fbOf('c:' + c.id) && fbOf('c:' + c.id) !== 'dismissed' && (
                    <span className={'badge st ' + fbOf('c:' + c.id)}>{fbOf('c:' + c.id)}</span>
                  )}
                  <span className="badge">Won {money(c.amount)}</span>
                </span>
                <span className="head-side">
                  <span className={'clock' + (c.daysAgo != null && c.daysAgo <= 3 ? ' tight' : '')}>
                    {c.daysAgo != null ? `${c.daysAgo}d ago` : c.date}
                  </span>
                </span>
              </>
            )}
            renderBody={(c) => (
              <>
                <div className="sig">
                  <div className="sig-k">Why now</div>
                  <div className="sig-v">
                    Won {money(c.amount)} from {c.agency}
                    {c.daysAgo != null ? ` ${c.daysAgo === 0 ? 'today' : `${c.daysAgo}d ago`}` : ''} — purchasing starts now.
                  </div>
                </div>
                <div className="sig match">
                  <div className="sig-k">{profile.cNeed ? 'Why it matches you' : 'Who wins this window'}</div>
                  <div className="sig-v">
                    {profile.cNeed?.(c) || 'Bonding · insurance · subs · staffing · equipment.'}
                  </div>
                </div>
                <div className="facts">
                  <div className="fact">
                    <div className="k">Contract</div>
                    <div className="v">{c.title}</div>
                  </div>
                  <div className="fact">
                    <div className="k">Awarded by</div>
                    <div className="v">{c.agency}</div>
                  </div>
                  <div className="fact">
                    <div className="k">Method</div>
                    <div className="v">{c.method}</div>
                  </div>
                  {c.vendorAddress && (
                    <div className="fact">
                      <div className="k">Vendor address</div>
                      <div className="v">{c.vendorAddress}</div>
                    </div>
                  )}
                  <div className="fact">
                    <div className="k">Source</div>
                    <div className="v">City Record — Recent Contract Awards, as of {live?.sources?.awards || data.sources?.awards || 'today'}</div>
                  </div>
                </div>
                <div className="na-cap">Next action</div>
                <div className="call-block">
                  <div className="call-who">
                    <b>{c.vendor}</b>
                    <span>Opener written for {profile.cNeed ? profile.label : 'this window'}</span>
                  </div>
                  <div className="call-actions">
                    <button className="btn solid" onClick={() => copy(c.id, (profile.cOpener || defaultCOpener)(c))}>
                      {copiedId === c.id ? 'Copied' : 'Copy opener'}
                    </button>
                    <button className="btn ghost" onClick={() => copyLink('c', c.id)}>
                      {copiedLink === c.id ? 'Copied' : 'Copy link'}
                    </button>
                    <a className="btn ghost" href={findUrl(`${c.vendor} phone contact`)} target="_blank" rel="noreferrer">
                      Find contact ↗
                    </a>
                    <a className="btn ghost" href={liUrl(c.vendor)} target="_blank" rel="noreferrer">
                      LinkedIn ↗
                    </a>
                    <a
                      className="btn ghost"
                      href="https://data.cityofnewyork.us/City-Government/Recent-Contract-Awards/qyyg-4tf5"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source data ↗
                    </a>
                  </div>
                </div>
                <FeedbackRow k={'c:' + c.id} fbOf={fbOf} mark={mark} />
              </>
            )}
            idOf={(c) => c.id}
          />
        </>
      )}

      {vertical === 'openings' && (
        <>
          {miniToolbar(openingsList, data.openings.length)}
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
                  <span className="addr">{c.name}</span>
                  {c.isNew && <span className="badge new">New</span>}
                  {fbOf('o:' + c.id) && fbOf('o:' + c.id) !== 'dismissed' && (
                    <span className={'badge st ' + fbOf('o:' + c.id)}>{fbOf('o:' + c.id)}</span>
                  )}
                  <span className="boro">{c.county}</span>
                  <span className="badge">{c.kind} · opening soon</span>
                </span>
                <span className="head-side">
                  <span className="clock">{c.daysAgo != null ? `filed ${c.daysAgo}d ago` : '~2–4 mo'}</span>
                </span>
              </>
            )}
            renderBody={(c) => (
              <>
                <div className="sig">
                  <div className="sig-k">Why now</div>
                  <div className="sig-v">
                    {c.kind} license filed{c.daysAgo != null ? ` ${c.daysAgo}d ago` : ''} — opens in 2–4 months, choosing vendors now.
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
                  <div className="fact">
                    <div className="k">Legal name</div>
                    <div className="v">{c.legal}</div>
                  </div>
                  {c.received && (
                    <div className="fact">
                      <div className="k">Application received</div>
                      <div className="v">{usDate(c.received)} · under review</div>
                    </div>
                  )}
                  <div className="fact">
                    <div className="k">Source</div>
                    <div className="v">NY State Liquor Authority — pending licenses, as of {data.sources?.sla || 'today'}</div>
                  </div>
                </div>
                <div className="na-cap">Next action</div>
                <div className="call-block">
                  <div className="call-who">
                    <b>{c.name}</b>
                    <span>Opener written for {profile.oNeed ? profile.label : 'this window'}</span>
                  </div>
                  <div className="call-actions">
                    <button className="btn solid" onClick={() => copy(c.id, (profile.oOpener || defaultOOpener)(c))}>
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
                    <a className="btn ghost" href="https://data.ny.gov/d/f8i8-k2gm" target="_blank" rel="noreferrer">
                      Source data ↗
                    </a>
                  </div>
                </div>
              </>
            )}
            idOf={(c) => c.id}
          />
        </>
      )}

      </motion.div>

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
          <b>Want this watching your territory?</b>
          <span>Pilots are free while we learn.</span>
        </div>
        <form
          className="digest-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = e.target.elements.em.value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return;
            setEmail(v);
            saveLS('rw.email', v);
            setEmailSaved(true);
            setTimeout(() => setEmailSaved(false), 2600);
          }}
        >
          <input name="em" type="email" required placeholder="you@company.com" defaultValue={email} aria-label="Email for the daily digest" />
          <button className="btn solid" type="submit">{emailSaved ? 'Saved' : email ? 'Update digest email' : 'Get the daily digest'}</button>
          {email && !emailSaved && <span className="digest-note">Only when something new matches you</span>}
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
                body: JSON.stringify({ uid: uid.current, webhook: v }),
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
              {slackState === 'error' ? 'That URL was rejected — check it in Slack.' : 'Cards with Claim buttons'}
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
        <button className="foot-toggle" onClick={() => setShowSources((v) => !v)}>
          {showSources ? 'Hide sources' : 'Sources and freshness'}
        </button>
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

function SimpleFeed({ items, total, shown, onMore, openId, toggle, reduce, renderHead, renderBody, idOf, hashType, isWatched, onWatch, statusOf }) {
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
                <button className="card-head" aria-expanded={open} onClick={() => toggle(hashType, id, open)}>
                  <span
                    className={'found ' + (statusOf ? statusOf(hashType + ':' + id) : 'open')}
                    title={statusOf && statusOf(hashType + ':' + id) === 'taken' ? 'Taken — someone is already on it' : 'Open — no one has claimed it yet'}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
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

function FeedbackRow({ k, fbOf, mark }) {
  const cur = fbOf(k);
  const opts = [
    ['contacted', 'Contacted'],
    ['won', 'Won'],
    ['lost', 'Lost'],
  ];
  return (
    <div className="fb-row">
      <span className="fb-cap">Track it:</span>
      {opts.map(([v, l]) => (
        <button key={v} className={'fb' + (cur === v ? ' on ' + v : '')} onClick={() => mark(k, v)}>
          {l}
        </button>
      ))}
      <button className={'fb dismiss' + (cur === 'dismissed' ? ' on' : '')} onClick={() => mark(k, 'dismissed')}>
        {cur === 'dismissed' ? 'Restore' : 'Dismiss'}
      </button>
    </div>
  );
}

const defaultCOpener = (c) =>
  `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you need bonding or coverage lined up before mobilization, we can quote it this week.`;
const defaultOOpener = (c) =>
  `Re: ${c.name} — saw the license application for ${c.address}. Openings are the busiest weeks you'll ever have; if you're still picking a POS or coverage, we can set you up before the doors open.`;

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

function title(s) {
  if (!s) return s;
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .replace(/\bLlc\b/g, 'LLC')
    .replace(/\bHdfc\b/g, 'HDFC')
    .replace(/\bIi\b/g, 'II')
    .replace(/\bIii\b/g, 'III');
}
