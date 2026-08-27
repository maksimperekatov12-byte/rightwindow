import React from 'react';
import data from './data/feed.json';

// A vendor-review page, on purpose. Enterprise buyers have a procedure, and it kills
// deals after the handshake. Answering it before the first call is cheaper than
// answering it after.
export default function DataPage({ live, onBack }) {
  const s = data.sources || {};
  const sources = [
    ['DOB NOW — Facade Compliance Filings', 'xubg-57si', 'NYC Open Data', s.facades, 'FISP cycle status, sub-cycle deadlines, prior engineer'],
    ['DOB NOW — Approved Permits', 'rbx6-tga4', 'NYC Open Data', s.facades, 'Active sheds and scaffolds: who is already on site'],
    ['DOB NOW — Job Application Filings', 'w9ak-ipjd', 'NYC Open Data', s.facades, 'Facade work already filed, stage and declared cost'],
    ['ECB / OATH Violations', '6bgk-3dad', 'NYC Open Data', s.ecb, 'Open violations, unpaid balances, hearing dates'],
    ['Elevator Safety Compliance', 'e5aq-a4j2', 'NYC Open Data', s.elevators, 'CAT1 and CAT5 test status by device'],
    ['HPD Registrations and Contacts', 'tesw-yqqr · feu5-w2e2', 'NYC Open Data', s.hpd, 'Managing agent of record, business address'],
    ['ACRIS Deeds (open-data batch)', 'bnx9-e6tj · 8h5j-fqxa', 'NYC Open Data', s.acrisThrough, 'Ownership changes'],
    ['Recent Contract Awards', 'qyyg-4tf5', 'NYC Open Data', live?.sources?.awards || s.awards, 'City contract winners'],
    ['Liquor License Applications', 'f8i8-k2gm', 'NY State Open Data', s.sla, 'Venues opening in 2–4 months'],
  ];

  return (
    <div className="wrap datapage">
      <button className="chip-btn back" onClick={onBack}>← Back to the feed</button>
      <h1>Where the data comes from</h1>
      <p className="lead">
        Every source passes a written license gate before a single request is made. A source without a recorded
        verdict and licence is not collected — the collector throws rather than guesses.
      </p>

      <h2>Sources in use</h2>
      <div className="scrollx">
        <table className="dtable">
          <thead>
            <tr><th>Source</th><th>Dataset</th><th>Publisher</th><th>Last updated</th><th>What we take</th></tr>
          </thead>
          <tbody>
            {sources.map((r) => (
              <tr key={r[1]}>
                <td>{r[0]}</td>
                <td className="mono">{r[1]}</td>
                <td>{r[2]}</td>
                <td className="mono">{r[3] || '—'}</td>
                <td>{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">
        Freshness is the city's, not ours. These dates are read from each dataset's own metadata on every collection
        run and shown unmodified — including when a source lags.
      </p>

      <h2>What we refuse to collect</h2>
      <div className="deny">
        <div className="deny-head">
          <b>ACRIS web portal</b> <span className="denied">DENIED</span>
        </div>
        <p>
          The City Register's Bandwidth Policy prohibits automated access: “Further access to ACRIS is denied… detection
          of automated scripts/robots… contact the City Register to learn about our subscription data services.”
        </p>
        <p>
          So we do not scrape it. Deed data comes from the city's own open-data batch, which lags about a month, and
          same-week ownership changes are detected through HPD registrations instead. Real-time deeds are available
          through the City Register's official paid feed, which is the route we would take for a production account.
        </p>
      </div>

      <h2>Buildings, not people</h2>
      <ul className="dlist">
        <li>The subjects of this product are buildings and companies. We do not profile private individuals.</li>
        <li>
          Contacts are business roles from public filings — the managing agent of record and the officer registered
          with HPD, at their business address. No home addresses, no personal phone numbers scraped from anywhere.
        </li>
        <li>Every contact carries a confidence label. “Unverified” is shown as unverified rather than dressed up.</li>
        <li>Nothing about tenants, residents or occupants is collected.</li>
      </ul>

      <h2>Calling and messaging</h2>
      <ul className="dlist">
        <li>
          We surface business contacts for business-to-business outreach. Compliance with TCPA, state calling rules and
          the National and state Do-Not-Call registries remains the caller's responsibility, and we say so plainly.
        </li>
        <li>We do not dial, auto-dial or send messages on anyone's behalf. Drafted openers are copied by a human.</li>
        <li>Any enrichment provider we add will be a licensed, contracted B2B source — never a scraped one.</li>
      </ul>

      <h2>Retention and access</h2>
      <ul className="dlist">
        <li>Feed data is rebuilt from public sources; there is no private customer data in it.</li>
        <li>Account state — trade, boroughs, watchlist, feedback — is stored per anonymous id and deleted on request.</li>
        <li>Email and Slack destinations are used only to deliver the signals you asked for.</li>
      </ul>

      <p className="fine">
        Questions a vendor review needs answered that are not here? Write to{' '}
        <a href="mailto:maxim122090@gmail.com">maxim122090@gmail.com</a> and it gets added to this page.
      </p>
    </div>
  );
}
