import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion, animate } from 'motion/react';
import data from './data/feed.json';

const PERSONAS = {
  qewi: {
    tab: 'Facade engineer',
    hint: 'Buildings with no engineer engaged for Cycle 10 — ranked by how little time is left.',
    hero: 'Buildings that need a facade engineer — before they know it',
    sort: (a, b) => b.urgencyScore - a.urgencyScore || a.monthsLeft - b.monthsLeft,
    why: (c) => {
      if (c.mgmtChange)
        return `The HPD registration changed within days — new management or a quiet sale. Vendor relationships reset at exactly this moment, and the Cycle 10 obligation transfers with the keys.`;
      if (c.ownerChange)
        return `Sold ${Math.round(c.ownerChange.daysAgo / 30)} months ago${c.ownerChange.amount ? ` for $${Math.round(c.ownerChange.amount).toLocaleString()}` : ''} — the previous engineer's relationship just reset to zero, and the Cycle 10 filing is still open. New owners pick their vendors in the first months. Be the first call.`;
      if (c.freshHaz)
        return `A ${c.freshHaz.hazardous ? 'hazardous ' : ''}DOB violation landed ${c.freshHaz.daysAgo} days ago${c.nextHearing ? ` and a hearing is set for ${c.nextHearing}` : ''} — and the building still has no Cycle 10 engineer on record. Call this week, not this quarter.`;
      if (has(c, 'NON_FILER') && c.monthsLeft <= 7)
        return `No Cycle 10 report filed and the ${c.subCycle} deadline is ${c.monthsLeft} months out. Inspections take months to schedule — this building needs a QEWI now, and DOB data shows nobody is engaged.`;
      if (has(c, 'SWARMP_CARRYOVER'))
        return `Filed SWARMP in Cycle 9 and never closed it — unrepaired conditions are presumed UNSAFE at the next filing. Whoever inspects next inherits a mandatory repair scope.`;
      return `Off the compliance calendar for sub-cycle ${c.subCycle}. The first engineer to call gets the walk-through.`;
    },
    opener: (c) =>
      `Re: ${title(c.address)} — DOB shows no Cycle 10 facade filing and the ${c.subCycle} deadline is ${c.deadline}. We can inspect this month, before the $1,000/mo penalty meter starts.`,
  },
  restoration: {
    tab: 'Restoration contractor',
    hint: 'Open SWARMP and UNSAFE conditions — mandatory repair scopes, before they go out to bid.',
    hero: 'Repair work the law has already sold for you',
    sort: (a, b) =>
      rank(b, 'SWARMP_CARRYOVER') + rank(b, 'UNSAFE_PRIOR') - rank(a, 'SWARMP_CARRYOVER') - rank(a, 'UNSAFE_PRIOR') ||
      b.urgencyScore - a.urgencyScore,
    why: (c) => {
      if (c.ownerChange)
        return `New owner as of ${c.ownerChange.recorded} — every service contract is up for review, and the open facade scope comes with the keys. Incumbents lost their edge; the bid list is being rewritten right now.`;
      if (c.freshHaz)
        return `A fresh violation (${c.freshHaz.daysAgo} days ago) means mandatory correction with certification — new, unassigned work on top of the facade scope. Nobody has been hired yet.`;
      if (has(c, 'UNSAFE_PRIOR'))
        return `UNSAFE status on file — sidewalk shed and repairs are mandatory, not optional. This scope exists whether or not anyone has bid it yet.`;
      if (has(c, 'SWARMP_CARRYOVER'))
        return `SWARMP conditions from Cycle 9 still open. They must be repaired before the next report or the building is presumed UNSAFE — a guaranteed scope with a legal deadline.`;
      return `Non-filer close to the deadline: when the inspection lands, repairs usually follow. Early contact beats the bid list.`;
    },
    opener: (c) =>
      `Re: ${title(c.address)} — the open SWARMP from Cycle 9 becomes presumed-unsafe at the next filing. We can walk the scope and price it this week.`,
  },
  lender: {
    tab: 'C-PACE lender',
    hint: 'Mandatory capex with a fine meter — financeable projects that cannot be postponed.',
    hero: 'Forced capital projects, found before the loan request',
    sort: (a, b) => b.urgencyScore - a.urgencyScore || (b.finesOwed || 0) + (b.ecbBalance || 0) - (a.finesOwed || 0) - (a.ecbBalance || 0),
    why: (c) => {
      const owed = (c.finesOwed || 0) + (c.ecbBalance || 0);
      const fine = owed ? ` It already owes $${owed.toLocaleString()} across DOB and ECB penalties.` : '';
      if (c.ownerChange)
        return `Acquired ${Math.round(c.ownerChange.daysAgo / 30)} months ago${c.ownerChange.amount ? ` for $${Math.round(c.ownerChange.amount).toLocaleString()}` : ''} with mandated facade work attached${owed ? ` and $${owed.toLocaleString()} in open penalties` : ''}. New owners budget capex in year one — that budget is being written now.`;
      if (c.freshHaz && owed)
        return `A new violation ${c.freshHaz.daysAgo} days ago on top of ${fine.trim().replace('It already owes ', '')} — forced spend is stacking up${c.nextHearing ? `, with a hearing on ${c.nextHearing}` : ''}. This owner needs capital with a legal reason to use it.`;
      if (has(c, 'SWARMP_CARRYOVER'))
        return `Mandatory repair scope (open SWARMP) plus a filing deadline with a $1,000/month meter.${fine} That is financeable, non-deferrable capex.`;
      return `Compliance deadline ${c.deadline} with penalties accruing after.${fine} Owners in this position need capital fast, with a legal reason to spend it.`;
    },
    opener: (c) =>
      `Re: ${title(c.address)} — this building has city-mandated facade work ahead of the ${c.deadline} deadline. C-PACE can fund it before the penalty meter starts.`,
  },
};

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
  { key: 'facades', label: 'Building facades', sub: 'deep' },
  { key: 'contracts', label: 'City contracts', sub: 'light' },
  { key: 'openings', label: 'New openings', sub: 'light' },
];

const has = (c, kind) => c.signals.some((s) => s.kind === kind);
const rank = (c, kind) => c.signals.find((x) => x.kind === kind)?.urgency ?? 0;
const money = (n) => '$' + n.toLocaleString('en-US');

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

export default function App() {
  const [vertical, setVertical] = useState('facades');
  const [persona, setPersona] = useState('qewi');
  const [shown, setShown] = useState(7);
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const reduce = useReducedMotion();
  const p = PERSONAS[persona];
  const facadeFeed = useMemo(() => [...data.facades.feed].sort(p.sort), [persona]);
  const pulled = new Date(data.generatedAt);

  const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 };
  const fade = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1], delay },
        };

  const copy = (id, text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    });
  };

  const heroText =
    vertical === 'facades'
      ? p.hero
      : vertical === 'contracts'
        ? 'Companies that won city money yesterday'
        : 'Venues that will open their doors in a few months';

  const heroSub =
    vertical === 'facades'
      ? "Every building over six stories runs on a public compliance clock. We read the city's records daily and surface the ones that fell off the calendar — with the deadline, the fine meter, and the person to call."
      : vertical === 'contracts'
        ? 'A contract award is public the day it happens. The winner now has guaranteed revenue — and two weeks to line up subcontractors, bonding, insurance and staff. That is your window.'
        : 'A liquor-license application means a venue opens in two to four months — and it is choosing its POS, insurance, suppliers and furniture right now. Same engine, different register.';

  return (
    <div className="wrap">
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
        <div className="pulled">
          <motion.span
            className="dot"
            animate={reduce ? {} : { opacity: [1, 0.35, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          data pulled {pulled.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </header>

      <LayoutGroup>
        <div className="verticals" role="tablist" aria-label="Pick a register">
          {VERTICALS.map((v) => (
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

      <section className="hero">
        <AnimatePresence mode="popLayout">
          <motion.h1
            key={vertical + (vertical === 'facades' ? persona : '')}
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
        <>
          <div className="stats">
            {[
              [data.facades.totals.candidates, 'buildings off the calendar (Manhattan + Brooklyn)'],
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

          <LayoutGroup>
            <div className="personas" role="tablist" aria-label="Who are you">
              {Object.entries(PERSONAS).map(([key, pp]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={key === persona}
                  className={key === persona ? 'on' : ''}
                  onClick={() => {
                    setPersona(key);
                    setShown(7);
                    setOpenId(null);
                  }}
                >
                  {key === persona && (
                    <motion.span className="pill" layoutId="persona-pill" transition={spring} aria-hidden="true" />
                  )}
                  <span className="tlabel">{pp.tab}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
          <AnimatePresence mode="popLayout">
            <motion.p
              className="personas-hint"
              key={persona}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? {} : { opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {p.hint}
            </motion.p>
          </AnimatePresence>

          <div>
            {facadeFeed.slice(0, shown).map((c, i) => {
              const open = openId === c.bin;
              const topSignal = [...c.signals].sort((a, b) => b.urgency - a.urgency)[0];
              return (
                <motion.article
                  layout={reduce ? false : 'position'}
                  key={c.bin}
                  className={'card' + (open ? ' open' : '')}
                  initial={reduce ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.04, 0.3) }}
                >
                  <button className="card-head" aria-expanded={open} onClick={() => setOpenId(open ? null : c.bin)}>
                    <span className="found" aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    <span className="head-main">
                      <span className="addr">{title(c.address)}</span>
                      <span className="boro">{c.borough}</span>
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

                          <p className="why">{p.why(c)}</p>

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
                                <div className="v">detected {c.mgmtChange.detected}{c.mgmtChange.prevCompany ? ` · was ${title(c.mgmtChange.prevCompany)}` : ''} · HPD daily</div>
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
                                  {c.elevator.cat1Missing > 0 ? `${c.elevator.cat1Missing} of ${c.elevator.devices} without a ${new Date().getFullYear()} CAT1 test` : ''}
                                  {c.elevator.cat1Missing > 0 && c.elevator.cat5Due > 0 ? ' · ' : ''}
                                  {c.elevator.cat5Due > 0 ? `${c.elevator.cat5Due} due for 5-year CAT5` : ''}
                                </div>
                              </div>
                            )}
                            {c.shed && (
                              <div className="fact">
                                <div className="k">Sidewalk shed</div>
                                <div className="v">
                                  {c.shed.state === 'expired' ? `permit expired ${c.shed.exp}` : `renewal due by ${c.shed.exp}`}
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
                              <button className="btn solid" onClick={() => copy(c.bin, p.opener(c))}>
                                {copiedId === c.bin ? 'Copied' : 'Copy opener'}
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

          {shown < facadeFeed.length && (
            <div className="more-row">
              <button onClick={() => setShown((n) => n + 7)}>Show more buildings ({facadeFeed.length - shown} left)</button>
            </div>
          )}
        </>
      )}

      {vertical === 'contracts' && (
        <SimpleFeed
          items={data.contracts.slice(0, shown)}
          total={data.contracts.length}
          shown={shown}
          onMore={() => setShown((n) => n + 7)}
          openId={openId}
          setOpenId={setOpenId}
          reduce={reduce}
          renderHead={(c) => (
            <>
              <span className="head-main">
                <span className="addr">{c.vendor}</span>
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
                {c.vendor} just won {money(c.amount)} from {c.agency} ({c.category?.toLowerCase()}). Delivery starts
                now — which means subcontractors, bonding, insurance, equipment and staffing get bought in the next
                few weeks. Congratulate first, sell second.
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
                  <b>Who wins this window</b>
                  <span>sureties and bonding · commercial insurance · subcontractors · staffing · equipment rental</span>
                </div>
                <div className="call-actions">
                  <button
                    className="btn solid"
                    onClick={() =>
                      copy(
                        c.id,
                        `Re: your ${money(c.amount)} award from ${c.agency} — congratulations. If you need bonding or coverage lined up before mobilization, we can quote it this week.`,
                      )
                    }
                  >
                    {copiedId === c.id ? 'Copied' : 'Copy opener'}
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
      )}

      {vertical === 'openings' && (
        <SimpleFeed
          items={data.openings.slice(0, shown)}
          total={data.openings.length}
          shown={shown}
          onMore={() => setShown((n) => n + 7)}
          openId={openId}
          setOpenId={setOpenId}
          reduce={reduce}
          renderHead={(c) => (
            <>
              <span className="head-main">
                <span className="addr">{c.name}</span>
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
                {c.name} filed for a liquor license ({c.kind.toLowerCase()}) — which means a venue at {c.address} opens
                in roughly two to four months. POS systems, insurance, furniture, suppliers and marketing are being
                chosen right now, before any storefront exists to walk into.
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
                  <b>Who wins this window</b>
                  <span>POS and payments · restaurant insurance · food and beverage suppliers · furniture · local marketing</span>
                </div>
                <div className="call-actions">
                  <button
                    className="btn solid"
                    onClick={() =>
                      copy(
                        c.id,
                        `Re: ${c.name} — saw the license application for ${c.address}. Openings are the busiest weeks you'll ever have; if you're still picking a POS or coverage, we can set you up before the doors open.`,
                      )
                    }
                  >
                    {copiedId === c.id ? 'Copied' : 'Copy opener'}
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
      )}

      <footer>
        Working demo of Right Window — timing systems on public registers: the register publishes the event, the
        event opens a window, we hand you the window with a contact and a reason to call. Sources: NYC Open Data and
        data.ny.gov, no restrictions on use; every card links to the primary record. Every source passes a written
        license gate before collection — the ACRIS web portal prohibits robots, so deed data comes from the city's
        open-data batch and management changes are watched daily through HPD; real-time deeds are available through
        the City Register's official subscription feed. The same engine runs in
        production for government procurement (Kyrgyzstan) and film/TV music licensing. Built by{' '}
        <a href="mailto:maxim122090@gmail.com">Maxim Perekatov</a>.
      </footer>
    </div>
  );
}

function SimpleFeed({ items, total, shown, onMore, openId, setOpenId, reduce, renderHead, renderBody, idOf }) {
  return (
    <>
      <div>
        {items.map((c, i) => {
          const id = idOf(c);
          const open = openId === id;
          return (
            <motion.article
              layout={reduce ? false : 'position'}
              key={id}
              className={'card' + (open ? ' open' : '')}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.04, 0.3) }}
            >
              <button className="card-head" aria-expanded={open} onClick={() => setOpenId(open ? null : id)}>
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

const findUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q.trim())}`;
const liUrl = (q) => `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(q.trim())}`;

const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

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
