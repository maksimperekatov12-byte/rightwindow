import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion, animate } from 'motion/react';
import data from './data/feed.json';

const YEAR = new Date().getFullYear();
const byUrgency = (a, b) => b.urgencyScore - a.urgencyScore || a.monthsLeft - b.monthsLeft;
const has = (c, kind) => c.signals.some((s) => s.kind === kind);
const rank = (c, kind) => c.signals.find((x) => x.kind === kind)?.urgency ?? 0;
const money = (n) => '$' + n.toLocaleString('en-US');

function signalStory(c) {
  if (c.mgmtChange) return `HPD registration changed within days — new management or a quiet sale, and every vendor relationship resets.`;
  if (c.ownerChange)
    return `Sold ${c.ownerChange.recorded}${c.ownerChange.amount ? ` for ${money(Math.round(c.ownerChange.amount))}` : ''} — the new owner is rebuilding the vendor list right now.`;
  if (c.freshHaz)
    return `A ${c.freshHaz.hazardous ? 'hazardous ' : ''}DOB violation landed ${c.freshHaz.daysAgo} days ago${c.nextHearing ? `, hearing set for ${c.nextHearing}` : ''} — mandatory correction with certification.`;
  if (has(c, 'NON_FILER') && c.monthsLeft <= 7)
    return `No Cycle 10 facade report filed and the ${c.subCycle} deadline is ${c.monthsLeft} months out — the penalty meter starts at $1,000/month after that.`;
  if (has(c, 'SWARMP_CARRYOVER'))
    return `SWARMP conditions from Cycle 9 are still open — unrepaired, they are presumed UNSAFE at the next filing.`;
  if (has(c, 'UNSAFE_PRIOR')) return `UNSAFE status on file — sidewalk shed and repairs are mandatory, not optional.`;
  return `Off the compliance calendar for sub-cycle ${c.subCycle} — a forced-spend window with a legal deadline.`;
}

const CONSTR = /construction|architect|engineer/i;

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
      why: (c) => `${signalStory(c)} No Cycle 10 engineer is on record — the first one to call gets the walk-through.`,
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
      why: (c) => `${signalStory(c)} This scope exists whether or not anyone has bid it yet — early contact beats the bid list.`,
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
        return `${signalStory(c)}${owed ? ` It already owes ${money(owed)} across DOB and ECB penalties.` : ''} That is financeable, non-deferrable capex — owners in this position need capital with a legal reason to use it.`;
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
          ? `${c.elevator.cat1Missing ? `${c.elevator.cat1Missing} of ${c.elevator.devices} devices have no ${YEAR} CAT1 test on file` : ''}${c.elevator.cat1Missing && c.elevator.cat5Due ? ' and ' : ''}${c.elevator.cat5Due ? `${c.elevator.cat5Due} are due for the 5-year CAT5` : ''} — tests must be filed by December 31, and late devices accrue penalties. ${signalStory(c)}`
          : `${signalStory(c)} Buildings in a forced-work window often bundle elevator work into the same capex.`,
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
        `${signalStory(c)} ${c.ownerChange || c.mgmtChange ? 'New ownership re-shops every policy in year one.' : 'Open violations and mandated work change the liability picture — renewal conversations start now, not at expiry.'}`,
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
      why: (c) => `${signalStory(c)} Mandated exterior work means sidewalk sheds, scaffolding and hoists — access gets booked before the first brick moves.`,
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
      why: (c) =>
        `${signalStory(c)} New ownership reviews the management contract in year one — and this building carries open compliance work a stronger manager would fix. That is your pitch.`,
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
        `${signalStory(c)}${c.nextHearing ? ` An OATH hearing is scheduled for ${c.nextHearing} — representation and cure certification decide what it costs.` : c.ecbBalance ? ` ${money(c.ecbBalance)} in ECB penalties sits unpaid — dismissals and settlements are on the table.` : ''}`,
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
        return `${signalStory(c)}${owed ? ` With ${money(owed)} in open penalties and mandated work ahead, ` : ' With mandated capex ahead, '}the owner is doing disposition math right now — a quiet valuation conversation lands differently this month.`;
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

const PROFILE_ORDER = ['qewi', 'restoration', 'elevator', 'insurance', 'lender', 'equipment', 'propmgmt', 'legal', 'cre', 'staffing', 'pos', 'fnb', 'marketing', 'signage', 'explore'];

const BADGE = {
  NON_FILER: 'No Cycle 10 filing',
  SWARMP_CARRYOVER: 'Open SWARMP',
  UNSAFE_PRIOR: 'UNSAFE on file',
  CHRONIC_NON_FILER: 'No Cycle 9 report',
  OWNER_CHANGE: 'Just sold',
  NEW_MGMT: 'Management changed',
  ELEV_DUE: 'Elevator tests due',
  SHED_EXPIRED: 'Shed permit expired',
  SHED_RENEWAL: 'Shed renewal due',
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
  const [boro, setBoro] = useState('all');
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [watch, setWatch] = useState(() => loadLS('rw.watch', {}));
  const reduce = useReducedMotion();

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
    return facadeFeed.filter((c) => {
      if (onlyWatch && !isWatched('b:' + c.bin)) return false;
      if (boro !== 'all' && c.borough !== boro) return false;
      if (onlyNew && !(c.isNew || c.fresh?.length)) return false;
      if (!q) return true;
      return [c.address, c.owner, c.priorQewi, c.agent?.company, c.agent?.name]
        .filter(Boolean)
        .some((f) => f.toLowerCase().includes(q));
    });
  }, [facadeFeed, query, boro, onlyNew, onlyWatch, watch]);
  const boroCounts = useMemo(() => {
    const m = {};
    for (const c of facadeFeed) m[c.borough] = (m[c.borough] || 0) + 1;
    return m;
  }, [facadeFeed]);
  const contractsBase = useMemo(() => data.contracts.filter(profile.cFilter || (() => true)), [profileKey]);
  const contractsList = useMemo(() => (onlyWatch ? contractsBase.filter((c) => isWatched('c:' + c.id)) : contractsBase), [contractsBase, onlyWatch, watch]);
  const openingsList = useMemo(() => (onlyWatch ? data.openings.filter((o) => isWatched('o:' + o.id)) : data.openings), [onlyWatch, watch]);
  useEffect(() => setShown(7), [query, boro, onlyNew, onlyWatch, vertical]);

  const wn = data.whatsNew || { buildings: 0, signals: 0, contracts: 0, openings: 0 };
  const hasNew = wn.buildings + wn.signals + wn.contracts + wn.openings > 0;
  const pulled = new Date(data.generatedAt);

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
      const idx = data.contracts.findIndex((c) => c.id === id);
      if (idx >= 0) {
        setVertical('contracts');
        setOpenId(id);
        setShown(Math.max(7, idx + 1));
      }
    } else {
      const idx = data.openings.findIndex((o) => o.id === id);
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

  const heroText =
    vertical === 'facades'
      ? fv.hero
      : vertical === 'contracts'
        ? 'Companies that won city money yesterday'
        : 'Venues that will open their doors in a few months';

  const heroSub =
    vertical === 'facades'
      ? "Every building over six stories runs on a public compliance clock. We read the city's records daily and surface the ones that fell off the calendar — with the deadline, the fine meter, and the person to call."
      : vertical === 'contracts'
        ? 'A contract award is public the day it happens. The winner now has guaranteed revenue — and two weeks to line up subcontractors, bonding, insurance and staff. That is your window.'
        : 'A liquor-license application means a venue opens in two to four months — and it is choosing its POS, insurance, suppliers and furniture right now. Same engine, different register.';

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
              <p>Right Window reads New York's public records and shows who may need your services — this week, with a reason to call. Pick your line of work:</p>
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
          <button className="profile-chip" onClick={() => setShowOnboard(true)}>
            {profileKey ? profile.label : 'Who are you?'} <span aria-hidden="true">›</span>
          </button>
          <div className="pulled">
            <motion.span
              className="dot"
              animate={reduce ? {} : { opacity: [1, 0.35, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            data pulled {pulled.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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

      {vertical === 'facades' && (
        <>
          {hasNew && (
            <motion.button className={'news' + (onlyNew ? ' on' : '')} onClick={() => setOnlyNew((v) => !v)} {...fade(0.1)}>
              <span className="news-dot" aria-hidden="true" />
              <span>
                <b>New in the last 48 hours:</b> {wn.buildings} buildings · {wn.signals} fresh signals
                {wn.contracts ? ` · ${wn.contracts} contracts` : ''}
                {wn.openings ? ` · ${wn.openings} venue filings` : ''}
              </span>
              <span className="news-cta">{onlyNew ? 'show all' : 'show only new'}</span>
            </motion.button>
          )}

          <p className="personas-hint">{fv.hint}</p>

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
              {['all', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx'].map((b) => (
                <button key={b} className={'chip-btn' + (boro === b ? ' on' : '')} onClick={() => setBoro(b)}>
                  {b === 'all' ? 'All' : b}
                  <small>{b === 'all' ? facadeFeed.length : boroCounts[b] || 0}</small>
                </button>
              ))}
            </div>
            <button className={'chip-btn' + (onlyWatch ? ' on' : '')} onClick={() => setOnlyWatch((v) => !v)}>
              ★ Watchlist{watchCount ? ` (${watchCount})` : ''}
            </button>
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
            {filteredFeed.slice(0, shown).map((c, i) => {
              const open = openId === c.bin;
              const wkey = 'b:' + c.bin;
              const topSignal = [...c.signals].sort((a, b) => b.urgency - a.urgency)[0];
              return (
                <motion.article
                  layout={reduce ? false : 'position'}
                  key={c.bin}
                  id={'rw-' + c.bin}
                  className={'card' + (open ? ' open' : '')}
                  initial={reduce ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.04, 0.3) }}
                >
                  <div className="card-row">
                    <button className="card-head" aria-expanded={open} onClick={() => toggleCard('b', c.bin, open)}>
                      <span className="found" aria-hidden="true">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                      <span className="head-main">
                        <span className="addr">{title(c.address)}</span>
                        <span className="boro">{c.borough}</span>
                        {c.isNew && <span className="badge new">New</span>}
                        {!c.isNew && c.fresh?.length > 0 && <span className="badge new">New signal</span>}
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
                    <button
                      className={'star' + (isWatched(wkey) ? ' on' : '')}
                      onClick={() => toggleWatch(wkey)}
                      aria-label={isWatched(wkey) ? 'Remove from watchlist' : 'Add to watchlist'}
                      aria-pressed={isWatched(wkey)}
                    >
                      <Star on={isWatched(wkey)} />
                    </button>
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
                            <span>window opened {subOpens(c.subCycle)}</span>
                            <span>deadline {c.deadline}</span>
                          </div>

                          <p className="why">{fv.why(c)}</p>

                          <div className="facts">
                            <div className="fact">
                              <div className="k">Last report</div>
                              <div className="v">
                                Cycle {c.lastCycle}
                                {c.lastFiling ? ` · ${c.lastFiling}` : ''} · {c.lastStatus || 'n/a'}
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
                                  {c.ownerChange.recorded}
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
                            {c.shed && (
                              <div className="fact">
                                <div className="k">Sidewalk shed</div>
                                <div className="v">{c.shed.state === 'expired' ? `permit expired ${c.shed.exp}` : `renewal due by ${c.shed.exp}`}</div>
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
                                <div className="v">{c.nextHearing}</div>
                              </div>
                            )}
                            <div className="fact">
                              <div className="k">Penalty meter</div>
                              <div className={'v' + (c.finesOwed > 0 ? ' fine' : '')}>
                                {c.finesOwed > 0 ? `${money(c.finesOwed)} already owed` : '$1,000/mo after a missed deadline'}
                              </div>
                            </div>
                          </div>

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
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              );
            })}
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
            renderHead={(c) => (
              <>
                <span className="head-main">
                  <span className="addr">{c.vendor}</span>
                  {c.isNew && <span className="badge new">New</span>}
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
                <p className="why">
                  {profile.cNeed?.(c) ||
                    `${c.vendor} just won ${money(c.amount)} from ${c.agency} (${c.category?.toLowerCase()}). Delivery starts now — subcontractors, bonding, insurance, equipment and staffing get bought in the next few weeks. Congratulate first, sell second.`}
                </p>
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
                </div>
                <div className="call-block">
                  <div className="call-who">
                    <b>{profile.cNeed ? 'Why this lands on your desk' : 'Who wins this window'}</b>
                    <span>
                      {profile.cNeed
                        ? `You: ${profile.label}`
                        : 'sureties and bonding · commercial insurance · subcontractors · staffing · equipment rental'}
                    </span>
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
            renderHead={(c) => (
              <>
                <span className="head-main">
                  <span className="addr">{c.name}</span>
                  {c.isNew && <span className="badge new">New</span>}
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
                <p className="why">
                  {profile.oNeed?.(c) ||
                    `${c.name} filed for a liquor license (${c.kind.toLowerCase()}) — a venue at ${c.address} opens in roughly two to four months. POS, insurance, furniture, suppliers and marketing are being chosen right now, before any storefront exists to walk into.`}
                </p>
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
                      <div className="v">{c.received} · under review</div>
                    </div>
                  )}
                </div>
                <div className="call-block">
                  <div className="call-who">
                    <b>{profile.oNeed ? 'Why this lands on your desk' : 'Who wins this window'}</b>
                    <span>
                      {profile.oNeed
                        ? `You: ${profile.label}`
                        : 'POS and payments · restaurant insurance · food and beverage suppliers · furniture · local marketing'}
                    </span>
                  </div>
                  <div className="call-actions">
                    <button className="btn solid" onClick={() => copy(c.id, (profile.oOpener || defaultOOpener)(c))}>
                      {copiedId === c.id ? 'Copied' : 'Copy opener'}
                    </button>
                    <button className="btn ghost" onClick={() => copyLink('o', c.id)}>
                      {copiedLink === c.id ? 'Copied' : 'Copy link'}
                    </button>
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

      <div className="pilot">
        <div>
          <b>Want this watching your territory?</b>
          <span>Pilots are open — your vertical, your borough, a ranked feed refreshed hourly.</span>
        </div>
        <a href="mailto:maxim122090@gmail.com?subject=Right%20Window%20pilot">Request a pilot</a>
      </div>

      <footer>
        Right Window reads New York's public registers hourly: the register publishes the event, the event opens a
        window, you get the window — with a contact and a reason to call. Every card links to the city's own record,
        and every source passes a written license gate before collection (the ACRIS web portal prohibits robots, so
        deeds come from the monthly open-data batch while HPD registrations are watched daily). The same engine runs
        in production for government procurement and film/TV music licensing. Built by{' '}
        <a href="mailto:maxim122090@gmail.com">Maxim Perekatov</a>.
      </footer>
    </div>
  );
}

function SimpleFeed({ items, total, shown, onMore, openId, toggle, reduce, renderHead, renderBody, idOf, hashType, isWatched, onWatch }) {
  return (
    <>
      <div className="feed">
        {items.map((c, i) => {
          const id = idOf(c);
          const open = openId === id;
          return (
            <motion.article
              layout={reduce ? false : 'position'}
              key={id}
              id={'rw-' + id}
              className={'card' + (open ? ' open' : '')}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.04, 0.3) }}
            >
              <div className="card-row">
                <button className="card-head" aria-expanded={open} onClick={() => toggle(hashType, id, open)}>
                  <span className="found" aria-hidden="true">
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
                <button
                  className={'star' + (isWatched(c) ? ' on' : '')}
                  onClick={() => onWatch(c)}
                  aria-label={isWatched(c) ? 'Remove from watchlist' : 'Add to watchlist'}
                  aria-pressed={isWatched(c)}
                >
                  <Star on={isWatched(c)} />
                </button>
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
      </div>
      {shown < total && (
        <div className="more-row">
          <button onClick={onMore}>Show more ({total - shown} left)</button>
        </div>
      )}
    </>
  );
}

const defaultCOpener = (c) =>
  `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you need bonding or coverage lined up before mobilization, we can quote it this week.`;
const defaultOOpener = (c) =>
  `Re: ${c.name} — saw the license application for ${c.address}. Openings are the busiest weeks you'll ever have; if you're still picking a POS or coverage, we can set you up before the doors open.`;

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
