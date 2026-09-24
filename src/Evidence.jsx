import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

// "Does the window lead to a sale?" is the question an investor or a buyer asks
// of a product that sells timing, and the city's own permit records can answer
// it looking backward. scripts/backtest.mjs does the counting and writes
// data/evidence.json; this page only reads that file. No figure is typed here:
// each one is looked up by its path in the file and carries that path in a
// data-src attribute, so a test can check that nothing on the page was written
// by hand, and a rerun of the backtest changes the page without an edit.
//
// The file is mostly definitions and runs to about 140KB, so it is fetched when
// the page opens (a dynamic import, its own chunk) instead of riding in the
// bundle every visitor to the feed downloads.

const TITLE = 'Does the window lead to a sale? — Right Window';

const num = (x) => Number(x).toLocaleString('en-US');
// The script already rounds every share to one decimal; printing its value
// as-is keeps the page and the file character-for-character alike.
const pct = (x) => `${x}%`;
const days = (x) => `${num(x)} days`;
const usd = (x) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${Math.round(x / 1e6)}M` : `$${num(Math.round(x / 1000))}k`;
// A date the city published is a calendar day; read at noon so no time zone
// can move it to the day before.
const day = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return isNaN(d) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const stamp = (iso) => `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;
// The same in a narrow table cell: the day and the time each hold together.
const stampCell = (iso) => (
  <>
    <span className="nw">{String(iso).slice(0, 10)}</span> <span className="nw">{String(iso).slice(11, 16)} UTC</span>
  </>
);
const shareOf = (a, b) => `${Math.round((1000 * a) / b) / 10}%`;
// Windows are written into the file as prose ("filed 2022-02-01..2024-09-21");
// the dates are read out of that prose rather than kept twice.
const RANGE = /(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/;
const between = (text, joint = ' – ') => {
  const m = String(text).match(RANGE);
  return m ? `${day(m[1])}${joint}${day(m[2])}` : '';
};
const lowHigh = (xs, fmt = String) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
};

const Ev = createContext(null);
const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// One figure, read by its path and tagged with it.
function F({ src, fmt = num }) {
  return <span data-src={src}>{fmt(at(useContext(Ev), src))}</span>;
}

// A figure computed from others (a remainder, a range): it names what it was
// computed from, so it is checkable too.
function D({ from, children }) {
  return (
    <span data-src={from} data-derived="">
      {children}
    </span>
  );
}

// Text quoted from the file whole: a definition, a caveat, a claim.
function V({ src, as: Tag = 'span', className }) {
  return (
    <Tag className={className} data-src={src}>
      {at(useContext(Ev), src)}
    </Tag>
  );
}

// "876 / 2,523" in mono beside a share. A screen reader hears "876 of 2,523".
// In running text it sits in parentheses; in a table cell it stacks under the
// share and needs none.
function Den({ a, b, fmt = num, unit, paren }) {
  return (
    <span className="ev-den">
      {paren ? '(' : ''}
      {fmt(a)}
      <span aria-hidden="true"> / </span>
      <span className="sr-only"> of </span>
      {fmt(b)}
      {unit ? ` ${unit}` : ''}
      {paren ? ')' : ''}
    </span>
  );
}

// Every share on the page goes through here, so none can appear without the
// count it is out of.
function Share({ src, money, unit, stack }) {
  const s = at(useContext(Ev), src);
  return (
    <span className={'ev-share' + (stack ? ' stack' : '')} data-src={src}>
      <b>{pct(s.value)}</b> <Den a={s.num} b={s.den} fmt={money ? usd : num} unit={unit} paren={!stack} />
    </span>
  );
}

// A median with its interquartile range, the spread a single number hides.
function Median({ src, money, tail = '' }) {
  const s = at(useContext(Ev), src);
  const range = money ? `${usd(s.p25)}–${usd(s.p75)}` : `${num(s.p25)}–${num(s.p75)} days`;
  return (
    <span data-src={src}>
      a median <b>{money ? usd(s.median) : days(s.median)}</b>
      {tail} <span className="ev-den">(IQR {range})</span>
    </span>
  );
}

function Mo({ k, unit = 'months' }) {
  return <span data-src="definitions.months">{`${k} ${unit}`}</span>;
}

// The one chart: the three report statuses side by side at 12 and 24 months.
// Drawn at the width it is given (a ResizeObserver, not a scaled viewBox), so
// its labels stay the size of the text around them on a phone instead of
// shrinking to half of it.
function CohortChart({ m12, m24 }) {
  const e = useContext(Ev);
  const box = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setW(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const base = 'facades.cohorts.regex';
  const groups = ['UNSAFE', 'SWARMP', 'SAFE'].map((k) => ({ k, c: e.facades.cohorts.regex[k] }));
  const spans = [m12, m24];
  const max = Math.max(...groups.flatMap((g) => spans.map((m) => g.c[`within${m}`].value)));
  // Layout in CSS pixels. The label column fits "24 mo"; the right margin fits
  // the longest value label ("50.4%  1,272 / 2,523") after the longest bar.
  const LABEL = 52;
  const ROOM = 142;
  const HEAD = 22;
  const BAR = 14;
  const GAP = 5;
  const SEP = 18;
  const groupH = HEAD + spans.length * BAR + (spans.length - 1) * GAP;
  const H = groups.length * groupH + (groups.length - 1) * SEP + 2;
  const plot = Math.max(40, w - LABEL - ROOM);
  // Square at the baseline, a 4px round at the data end.
  const bar = (x, y, len, h) => {
    const r = Math.min(4, len / 2, h / 2);
    if (len <= 0) return '';
    return `M${x},${y}h${len - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(len - r)}z`;
  };
  const described = groups
    .map(
      ({ k, c }) =>
        `${k}, ${num(c.buildings)} buildings: ` +
        spans.map((m) => `${pct(c[`within${m}`].value)} within ${m} months (${num(c[`within${m}`].num)} of ${num(c[`within${m}`].den)})`).join(', '),
    )
    .join('; ');

  return (
    <div ref={box} className="ev-chart" style={{ height: H }}>
      {w > 0 && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-labelledby="ev-chart-t" aria-describedby="ev-chart-d">
          <title id="ev-chart-t">Share of buildings with a facade-related permit after their first cycle-9 report, by report status</title>
          <desc id="ev-chart-d" data-src={`${base}.*.within${m12}, ${base}.*.within${m24}`}>
            {described}.
          </desc>
          {groups.map(({ k, c }, gi) => {
            const y0 = gi * (groupH + SEP);
            return (
              <g key={k}>
                <text className="g" x={0} y={y0 + 14}>
                  {k}
                  <tspan className="gd" dx={8} data-src={`${base}.${k}.buildings`}>
                    {num(c.buildings)} buildings
                  </tspan>
                </text>
                <line className="axis" x1={LABEL - 0.5} x2={LABEL - 0.5} y1={y0 + HEAD - 3} y2={y0 + groupH + 3} />
                {spans.map((m, i) => {
                  const s = c[`within${m}`];
                  const y = y0 + HEAD + i * (BAR + GAP);
                  const len = (s.value / max) * plot;
                  return (
                    <g key={m}>
                      <text className="k" x={0} y={y + BAR - 3} data-src="definitions.months">
                        {m} mo
                      </text>
                      <path className={i === spans.length - 1 ? 'b-long' : 'b-short'} d={bar(LABEL, y, len, BAR)} />
                      <text x={LABEL + len + 7} y={y + BAR - 3} data-src={`${base}.${k}.within${m}`}>
                        <tspan className="v">{pct(s.value)}</tspan>
                        <tspan className="d" dx={7}>
                          {num(s.num)} / {num(s.den)}
                        </tspan>
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Body() {
  const e = useContext(Ev);
  // Month spans come from the file's own table of them, so "24 months" in a
  // sentence and the within24 figure beside it are the same key.
  const [m6, m12, m24] = Object.keys(e.definitions.months).sort((a, b) => a - b);
  const C = e.facades.cohorts.regex;
  const U = C.UNSAFE;
  const u24 = U[`within${m24}`];
  const W = 'facades.cohorts.workOnFloor';
  const R = 'facades.cohorts.regex';
  const lookback = (U.alreadyBefore.window.match(/(\d+) days before/) || [])[1];
  const O = e.openNow.UNSAFE;
  const young = (O.reportUnder180Days.definition.match(/less than (\d+) days/) || [])[1];
  const mk = 'facades.market.workOnFloor';
  const NF = e.engineers.nonFilers;
  const folds = Object.values(e.engineers.marketByFold);
  const shedGroups = [
    ['SHED_NO_REPAIR', <>Standing <Mo k={m12} /> or more, no facade permit in the <Mo k={m24} /> before (the register's SHED_NO_REPAIR)</>],
    ['NEW_NO_REPAIR', <>Standing under <Mo k={m12} />, no facade permit in the <Mo k={m24} /> before</>],
    ['NEW_ANY', <>Every shed standing under <Mo k={m12} />, permit before or not</>],
  ];
  const boroughs = Object.keys(O.openByBorough).sort(
    (a, b) => O.nothingFiledByBorough[b].num - O.nothingFiledByBorough[a].num || a.localeCompare(b),
  );
  const requests = e.sources.reduce((n, s) => n + s.queries.reduce((m, q) => m + q.requests, 0), 0);

  return (
    <>
      <p className="lead">
        Right Window tells a contractor when a New York building's legal deadline opens a window for the work. The fair
        thing to ask is whether the building then buys it. For facade work the city's permit records can answer that
        looking backward, and this page does. Every figure is counted from NYC Open Data, and every share has the count
        it is out of printed beside it.
      </p>

      <section aria-labelledby="ev-answer">
        <h2 id="ev-answer">The short answer</h2>
        <p className="ev-oneline">
          Yes, where the law requires the work. Of the buildings whose first cycle-9 facade report was filed UNSAFE,{' '}
          <Share src={`${R}.UNSAFE.within${m24}`} unit="buildings" /> had a facade-related permit within <Mo k={m24} />.
          Of the buildings reported SAFE, the comparison group, <Share src={`${R}.SAFE.within${m24}`} /> did.
        </p>
        <p>
          That gap is what the law requires, not a prediction by Right Window. An UNSAFE report obliges the owner to
          repair and a SAFE one does not, so UNSAFE buildings buying at{' '}
          <F src={`${R}.liftUnsafeOverSafe.within${m24}`} fmt={(x) => `${x} times`} /> the SAFE rate restates the law.
          What the records add is when the work is bought, what it is worth, and who wins it: the rest of this page.
        </p>
        <p>
          Every UNSAFE building has to repair, so the{' '}
          <D from={`${R}.UNSAFE.within${m24}: (den − num) / den`}>{shareOf(u24.den - u24.num, u24.den)}</D> with no such
          permit within <Mo k={m24} /> are repairs the permit record does not show (filed under a scaffold or shed job,
          in the city's older BIS system, or too small to need a general-construction permit), or repairs that slipped
          past <Mo k={m24} />.
        </p>
        <p>
          Two definitions of a facade-related permit are counted. The one above reads the permit's description for facade
          words. The narrower one takes only permits where DOB's own work-location field says Facade, and gives{' '}
          <Share src={`${W}.UNSAFE.within${m24}`} /> against <Share src={`${W}.SAFE.within${m24}`} />. The fair figure is
          the range between the two.
        </p>

        <figure className="ev-figure">
          <CohortChart m12={m12} m24={m24} />
          <figcaption>
            Share of buildings with a facade-related permit within <Mo k={m12} /> and <Mo k={m24} /> of their first
            cycle-9 report, by the report's status. Reports filed{' '}
            <D from={`${R}.UNSAFE.within${m24}.window`}>{between(u24.window)}</D>, citywide, on the description
            definition. SWARMP means safe for now, with repairs due before the next report.
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="ev-timing">
        <h2 id="ev-timing">How long the selling window really is</h2>
        <p>
          A permit is the public trace of a contractor already hired, so it shows up after the sale. The job's filing
          with DOB comes earlier and is the closer mark of when the owner chose someone. For the{' '}
          <F src="facades.jobTiming.reportToJobFiledSigned.n" /> UNSAFE buildings that got a permit within <Mo k={m24} />:
        </p>
        <dl className="ev-steps">
          <div>
            <dt>The job is filed with DOB</dt>
            <dd>
              <Median src="facades.jobTiming.reportToJobFiledSigned" tail=" after the report" />
            </dd>
          </div>
          <div>
            <dt>The job was filed before the report</dt>
            <dd>
              <Share src="facades.jobTiming.jobFiledBeforeReport" /> of them: the contractor was chosen before the report
              was filed
            </dd>
          </div>
          <div>
            <dt>The permit is issued</dt>
            <dd>
              <Median src={`${R}.UNSAFE.lagDays`} tail=" after the report" />
            </dd>
          </div>
          <div>
            <dt>From job filing to permit</dt>
            <dd>
              <Median src="facades.jobTiming.jobFiledToPermit" />
            </dd>
          </div>
          <div>
            <dt>
              A permit already in the <D from={`${R}.UNSAFE.alreadyBefore.window`}>{lookback} days</D> before the report
            </dt>
            <dd>
              <Share src={`${R}.UNSAFE.alreadyBefore`} /> of all UNSAFE buildings. They stay in the count, and only a
              later permit counts as a purchase
            </dd>
          </div>
        </dl>
        <p>
          So the window to sell into has closed by the time the job is filed, a median{' '}
          <F src="facades.jobTiming.reportToJobFiledSigned.median" fmt={days} /> after the report, not at the{' '}
          <F src={`${R}.UNSAFE.lagDays.median`} fmt={days} /> it takes the permit to appear. Waiting to see the permit
          is waiting until after the contractor was hired, and for{' '}
          <F src="facades.jobTiming.jobFiledBeforeReport.value" fmt={pct} /> of these buildings the contractor was hired
          before the report was even filed. Buildings reported SWARMP move more slowly: a median{' '}
          <F src={`${R}.SWARMP.lagDays.median`} fmt={days} /> from report to permit (
          <F src={`${R}.SWARMP.lagDays.n`} /> buildings).
        </p>
      </section>

      <section aria-labelledby="ev-money">
        <h2 id="ev-money">What the job is worth</h2>
        <p>
          On the first facade-related permit after an UNSAFE report, applicants declared{' '}
          <Median src={`${R}.UNSAFE.jobCost`} money />, across <F src={`${R}.UNSAFE.jobCost.n`} /> permits that declared
          a cost.
        </p>
        <p className="ev-note">
          That is the applicant's own estimate for the whole job, written on the permit application, and some of it is
          not facade work. It is not a contract value, and adding these figures up does not give the size of a market.
        </p>
        <p>
          After a SWARMP report the median was <F src={`${R}.SWARMP.jobCost.median`} fmt={usd} /> (
          <F src={`${R}.SWARMP.jobCost.n`} /> permits); after a SAFE one, <F src={`${R}.SAFE.jobCost.median`} fmt={usd} /> (
          <F src={`${R}.SAFE.jobCost.n`} />
          ).
        </p>
      </section>

      <section aria-labelledby="ev-newcomer">
        <h2 id="ev-newcomer">Can a newcomer win it?</h2>
        <h3>Restoration contractors</h3>
        <p>
          The work is spread across many firms. From{' '}
          <D from={`${mk}.contractors.window`}>{between(e.facades.market.workOnFloor.contractors.window, ' to ')}</D>,{' '}
          <F src={`${mk}.contractors.distinct`} /> general-contractor licences pulled facade-related permits (
          <F src="facades.market.regex.contractors.distinct" /> on the wider description definition). Counted by jobs,
          the ten busiest hold <Share src={`${mk}.contractors.top10`} unit="jobs" /> and the busiest one{' '}
          <Share src={`${mk}.contractors.top1`} />.
        </p>
        <p>
          Counted by declared dollars the market is less even: the ten largest hold{' '}
          <Share src={`${mk}.contractorsByDeclaredCost.top10`} money unit="declared" /> and the largest one{' '}
          <Share src={`${mk}.contractorsByDeclaredCost.top1`} money />. On the wider definition the same two shares are{' '}
          <F src="facades.market.regex.contractors.top10.value" fmt={pct} /> of jobs and{' '}
          <F src="facades.market.regex.contractorsByDeclaredCost.top10.value" fmt={pct} /> of dollars. Both views belong
          in any claim about how split the market is.
        </p>
        <p>
          The UNSAFE buildings above went to <F src={`${R}.UNSAFE.contractors.distinct`} /> different licences for their{' '}
          <F src={`${R}.UNSAFE.contractors.jobs`} /> first permits. <F src={`${R}.UNSAFE.contractors.withOneJob`} /> of
          those licences pulled just one, and the ten busiest held <Share src={`${R}.UNSAFE.contractors.top10`} />.
        </p>

        <h3>Engineers who file the reports</h3>
        <p>
          The report is a sale of its own, won by an engineering firm before any contractor is hired. In each of{' '}
          <D from="engineers.nonFilers.length">{NF.length}</D> sub-cycles we took the buildings that had a cycle-8
          record and had not filed a cycle-9 report <Mo k={m6} /> before their deadline, in the boroughs the register
          covers (all but Staten Island), and counted how many filed within the next <Mo k={m6} /> and{' '}
          <Mo k={m12} />. The count under each share is out of the buildings that had not filed.
        </p>
        <div className="scrollx ev-table-wrap">
          <table className="dtable ev-table">
            <thead>
              <tr>
                <th scope="col">Sub-cycle</th>
                <th scope="col">
                  Filed within <Mo k={m6} unit="mo" />
                </th>
                <th scope="col">
                  Within <Mo k={m12} unit="mo" />
                </th>
                <th scope="col">Firms</th>
              </tr>
            </thead>
            <tbody>
              {NF.map((r, i) => (
                <tr key={r.sub}>
                  <th scope="row">
                    <V src={`engineers.nonFilers.${i}.sub`} />
                    <span className="did">
                      counted <F src={`engineers.nonFilers.${i}.at`} fmt={day} />
                    </span>
                    <span className="did">
                      deadline <F src={`engineers.nonFilers.${i}.deadline`} fmt={day} />
                    </span>
                  </th>
                  <td className="n">
                    <Share src={`engineers.nonFilers.${i}.within${m6}`} stack />
                  </td>
                  <td className="n">
                    <Share src={`engineers.nonFilers.${i}.within${m12}`} stack />
                  </td>
                  <td className="n">
                    <F src={`engineers.nonFilers.${i}.engineers.distinct`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          In each sub-cycle{' '}
          <D from="engineers.nonFilers.*.engineers.distinct">{lowHigh(NF.map((r) => r.engineers.distinct), num)}</D>{' '}
          firms shared those reports, the ten busiest holding{' '}
          <D from="engineers.nonFilers.*.engineers.top10.value">{lowHigh(NF.map((r) => r.engineers.top10.value))}%</D>.
          Across every cycle-9 report citywide,{' '}
          <D from="engineers.marketByFold.*.distinct">{lowHigh(folds.map((f) => f.distinct), num)}</D> engineering firms
          filed (the count depends on how firm names are folded together), and the ten busiest held{' '}
          <D from="engineers.marketByFold.*.top10.value">{lowHigh(folds.map((f) => f.top10.value))}%</D>.
        </p>
        <p>
          Neither trade is held by a handful of firms, which is the room a newcomer has. These records cannot show that
          a newcomer wins: only that the work is not already spoken for by a few names.
        </p>
      </section>

      <section aria-labelledby="ev-sheds">
        <h2 id="ev-sheds">Sidewalk sheds: the long-standing shed converts lower</h2>
        <p>
          A shed that has stood for a long time over a building with no facade permit looks like an owner who has to
          repair and has not hired anyone yet. The register flags these as SHED_NO_REPAIR. Replayed on{' '}
          <D from="sheds.replay.length">{e.sheds.replay.length}</D> past dates and followed for <Mo k={m24} />, they
          bought less often than buildings whose shed was new:
        </p>
        <div className="scrollx ev-table-wrap">
          <table className="dtable ev-table">
            <caption className="sr-only">
              Share with a facade-related permit within <Mo k={m24} /> of each replay date
            </caption>
            <thead>
              <tr>
                <th scope="col">Shed on the replay date</th>
                {e.sheds.replay.map((r, i) => (
                  <th scope="col" key={r.at}>
                    <F src={`sheds.replay.${i}.at`} fmt={day} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shedGroups.map(([g, label]) => (
                <tr key={g}>
                  <th scope="row" className="ev-rowhead">
                    {label}
                  </th>
                  {e.sheds.replay.map((r, i) => (
                    <td className="n" key={r.at}>
                      <Share src={`sheds.replay.${i}.groups.${g}.within${m24}`} stack />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Like for like, the long-standing shed converts lower. It reads more like an owner who is stuck than one who is
          about to buy. Against every new shed, with a facade permit before it or not, it is close to level (the last
          row).
        </p>
        <p>
          For scale: of <F src="sheds.cohort.jobs" /> shed jobs at FISP buildings first permitted from{' '}
          <D from="sheds.cohort.withFacadePermit.window">{between(e.sheds.cohort.withFacadePermit.window, ' to ')}</D>,{' '}
          <Share src="sheds.cohort.withFacadePermit" /> had a facade-related permit at the same building from shortly
          before the shed went up to its removal, not necessarily for that shed. A shed stands a median{' '}
          <F src="sheds.cohort.shedLifeDays.median" fmt={days} />, counting the{' '}
          <F src="sheds.cohort.shedLifeDays.stillStanding" /> still up, and{' '}
          <F src="sheds.cohort.daysToSignoff.median" fmt={days} /> among those already taken down.
        </p>
      </section>

      <section aria-labelledby="ev-open">
        <h2 id="ev-open">Open now, and not on the register yet</h2>
        <p className="ev-note">This is what the product will read next, not a description of today's list.</p>
        <p>
          Between <D from="openNow.UNSAFE.open.window">{between(O.open.window, ' and ')}</D>,{' '}
          <F src="openNow.UNSAFE.reports" /> buildings in the boroughs the register covers filed their first cycle-10
          facade report UNSAFE. <Share src="openNow.UNSAFE.open" /> have no facade-related permit yet. That does not make
          them untouched:
        </p>
        <ul className="dlist ev-list">
          <li>
            <Share src="openNow.UNSAFE.facadeJobFiled" /> of those without a permit already have a facade-related job
            filed with DOB. The contractor is likely chosen and the permit not yet issued.
          </li>
          <li>
            <Share src="openNow.UNSAFE.nothingFiled" /> of all the reports have nothing facade-related filed at all. Of
            those, <Share src="openNow.UNSAFE.nothingFiledReportUnder180Days" /> were filed under{' '}
            <D from="openNow.UNSAFE.nothingFiledReportUnder180Days.definition">{young} days</D> ago, inside the usual
            time to a permit.
          </li>
          <li>
            Among the buildings with no permit, <Share src="openNow.UNSAFE.reportUnder180Days" /> of the reports are
            under <D from="openNow.UNSAFE.reportUnder180Days.definition">{young} days</D> old, and{' '}
            <Share src="openNow.UNSAFE.shedJobFiled" /> have a sidewalk-shed job filed.
          </li>
        </ul>
        <div className="scrollx ev-table-wrap">
          <table className="dtable ev-table">
            <thead>
              <tr>
                <th scope="col">Borough</th>
                <th scope="col">UNSAFE reports</th>
                <th scope="col">No permit yet</th>
                <th scope="col">Of those, job filed</th>
                <th scope="col">Nothing filed</th>
              </tr>
            </thead>
            <tbody>
              {boroughs.map((b) => {
                const open = O.openByBorough[b];
                const none = O.nothingFiledByBorough[b];
                return (
                  <tr key={b}>
                    <th scope="row">{b}</th>
                    <td className="n">
                      <F src={`openNow.UNSAFE.openByBorough.${b}.den`} />
                    </td>
                    <td className="n">
                      <Share src={`openNow.UNSAFE.openByBorough.${b}`} stack />
                    </td>
                    <td className="n">
                      <D from={`openNow.UNSAFE.openByBorough.${b}.num − openNow.UNSAFE.nothingFiledByBorough.${b}.num`}>
                        {num(open.num - none.num)}
                      </D>
                    </td>
                    <td className="n">
                      <Share src={`openNow.UNSAFE.nothingFiledByBorough.${b}`} stack />
                    </td>
                  </tr>
                );
              })}
              <tr className="ev-total">
                <th scope="row">All</th>
                <td className="n">
                  <F src="openNow.UNSAFE.reports" />
                </td>
                <td className="n">
                  <Share src="openNow.UNSAFE.open" stack />
                </td>
                <td className="n">
                  <F src="openNow.UNSAFE.facadeJobFiled.num" />
                </td>
                <td className="n">
                  <Share src="openNow.UNSAFE.nothingFiled" stack />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Worded from the file, not assumed: the day the register does carry a
            cycle-10 building, these two sentences say so instead. */}
        <p>
          {O.inRegister.num === 0 && e.openNow.register.noCycle10Filing.num === e.openNow.register.cards ? (
            <>
              None of these buildings is on the register today, and that is by how the register is built, not a finding:
              all <F src="openNow.register.cards" /> of its cards are buildings with no cycle-10 filing.
            </>
          ) : (
            <>
              <Share src="openNow.UNSAFE.inRegister" /> of the buildings with no permit are on the register today;{' '}
              <Share src="openNow.register.noCycle10Filing" /> of its cards are buildings with no cycle-10 filing.
            </>
          )}{' '}
          A fresh UNSAFE report with nothing filed behind it is the next signal the product will read.
        </p>
      </section>

      <section aria-labelledby="ev-not">
        <h2 id="ev-not">What we do not claim</h2>
        <p>
          Claims a reader could draw from a product like this one, and why each does not hold. Open one for the figures
          behind it and, where there is one, the test it had to pass.
        </p>
        <div className="ev-claims">
          {e.nonClaims.map((c, i) => (
            <details key={i} className="ev-claim">
              <summary>
                <span className={'verdict ' + (c.holds ? 'ok' : 'denied')}>{c.holds ? 'HOLDS' : 'DOES NOT HOLD'}</span>
                <V src={`nonClaims.${i}.claim`} />
              </summary>
              <V src={`nonClaims.${i}.evidence`} as="p" />
              {c.rule && (
                <p className="fine">
                  Test: <V src={`nonClaims.${i}.rule`} />
                </p>
              )}
            </details>
          ))}
        </div>

        <h3>Caveats</h3>
        <details className="ev-claim ev-caveats">
          <summary>
            <span>
              Read all <D from="caveats.length">{e.caveats.length}</D>
            </span>
          </summary>
          <ol>
            {e.caveats.map((c, i) => (
              <V key={i} src={`caveats.${i}`} as="li" />
            ))}
          </ol>
        </details>
      </section>

      <section aria-labelledby="ev-method">
        <h2 id="ev-method">Method</h2>
        <p>
          Counted by <code>{e.script}</code> from the <D from="sources.length">{e.sources.length}</D> DOB NOW datasets
          below, on NYC Open Data. Generated <F src="generatedAt" fmt={stamp} /> on data through{' '}
          <F src="asOf" fmt={day} />. The file holds aggregates only: no building, firm or person is named in it.
        </p>
        <div className="scrollx">
          <table className="dtable ev-sources">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Last updated by the city</th>
              </tr>
            </thead>
            <tbody>
              {e.sources.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <V src={`sources.${i}.name`} />
                    <span className="mono did">
                      <V src={`sources.${i}.id`} /> · <V src={`sources.${i}.host`} />
                    </span>
                    {s.queries.map((q, j) => (
                      <span className="did" key={j}>
                        <V src={`sources.${i}.queries.${j}.label`} />: <F src={`sources.${i}.queries.${j}.rows`} /> rows
                      </span>
                    ))}
                  </td>
                  <td className="mono">
                    <F src={`sources.${i}.rowsUpdatedAt`} fmt={stampCell} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine">
          Row counts are what each query returned, not the size of the dataset. The last-updated time is the dataset's
          own metadata as read on the run.
        </p>

        <h3>Definitions</h3>
        <dl className="ev-defs">
          <dt>Facade-related permit</dt>
          <V src="definitions.facadePermit.regex" as="dd" />
          <dt>The narrower definition</dt>
          <V src="definitions.facadePermit.workOnFloor" as="dd" />
          <dt>First report</dt>
          <V src="definitions.firstReport" as="dd" />
          <dt>Months</dt>
          <dd>
            {Object.entries(e.definitions.months).map(([k, v], i) => (
              <React.Fragment key={k}>
                {i ? ' · ' : ''}
                <span className="nw" data-src={`definitions.months.${k}`}>
                  {k} months = {v}
                </span>
              </React.Fragment>
            ))}
          </dd>
          <dt>Cycle-9 sub-cycles</dt>
          <dd>
            {e.definitions.subCycle9.map((s, i) => (
              <span key={s.sub} className="ev-sub" data-src={`definitions.subCycle9.${i}`}>
                {s.sub}: tax block ending in {s.blockLastDigit.join(', ')}; opens {day(s.opens)}, deadline {day(s.deadline)}
              </span>
            ))}
          </dd>
        </dl>

        <h3>Reproduce it</h3>
        <pre className="ev-cmd">
          <code>npm run backtest</code>
        </pre>
        <p>
          It makes <D from="sources.*.queries.*.requests">{requests}</D> requests to NYC Open Data, caches them for a
          day outside the repository, and rewrites <code>data/evidence.json</code>. This page reads that file, so a rerun
          changes the page. Open data is revised: rerun it before quoting a figure, and quote the figure with the dataset
          times above.
        </p>

        <details className="ev-claim">
          <summary>
            <span>The findings as the file states them</span>
          </summary>
          {e.headline.map((h, i) => (
            <div className="ev-stated" key={i}>
              <V src={`headline.${i}.claim`} as="p" />
              <p className="fine">
                <V src={`headline.${i}.denominator`} /> · <V src={`headline.${i}.window`} /> ·{' '}
                <V src={`headline.${i}.definition`} />
              </p>
            </div>
          ))}
        </details>
      </section>
    </>
  );
}

export default function EvidencePage({ onBack, isDark, onTheme }) {
  const [ev, setEv] = useState(null);
  const [failed, setFailed] = useState(false);

  // A single-page app has one <title>; this page borrows it while it is open
  // and hands it back on the way out.
  useEffect(() => {
    const was = document.title;
    document.title = TITLE;
    return () => {
      document.title = was;
    };
  }, []);

  // Arriving by a link further down another page (the data page links here)
  // would otherwise open this one scrolled to the same depth.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    let live = true;
    import('../data/evidence.json')
      .then((m) => live && setEv(m.default))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="wrap datapage evidence">
      <div className="page-bar">
        <button className="chip-btn back" onClick={onBack}>← Back to the feed</button>
        <button
          className="theme-btn"
          onClick={onTheme}
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
      </div>

      <Ev.Provider value={ev}>
        <main aria-busy={!ev && !failed}>
          <p className="ev-kicker">
            Evidence
            {ev && (
              <>
                {' · data through '}
                <F src="asOf" fmt={day} />
              </>
            )}
          </p>
          <h1>Does the window lead to a sale?</h1>
          {ev ? (
            <Body />
          ) : failed ? (
            <div className="ev-failed" role="alert">
              <p className="lead">The figures did not load. A reload usually brings them back.</p>
              <button className="btn solid" onClick={() => location.reload()}>
                Reload
              </button>
            </div>
          ) : (
            <p className="lead" role="status">
              Loading the figures…
            </p>
          )}
        </main>
      </Ev.Provider>
    </div>
  );
}
