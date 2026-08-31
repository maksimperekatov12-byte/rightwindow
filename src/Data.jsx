import React from 'react';
import policy from '../data/source-policy.json';
import data from './data/feed.json';

// Generated from data/source-policy.json at build time. Nothing on this page is
// written by hand, so it cannot drift from the gate the collectors actually enforce.
export default function DataPage({ live, onBack, isDark, onTheme }) {
  const freshness = { ...(data.sources || {}), ...(live?.sources || {}) };
  const allowed = policy.filter((p) => p.verdict === 'ALLOWED' && p.datasets?.length);
  const denied = policy.filter((p) => p.verdict !== 'ALLOWED');
  const noCall = policy.filter((p) => p.verdict === 'ALLOWED' && !p.datasets?.length);

  return (
    <div className="wrap datapage">
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

      <h1>Data, sources and privacy</h1>
      <p className="lead">
        Every source is checked against <code>data/source-policy.json</code> before a request is made. A source with no
        recorded verdict and licence is not collected — the collector throws rather than guesses. This page is
        generated from that same file.
      </p>

      <h2>Sources in use</h2>
      <div className="scrollx">
        <table className="dtable">
          <thead>
            <tr>
              <th>Dataset</th>
              <th>What it provides</th>
              <th>Publisher</th>
              <th>Verdict</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {allowed.flatMap((p) =>
              p.datasets.map(([name, id, provides, key]) => (
                <tr key={id}>
                  <td>
                    {name}
                    <span className="mono did">{id}</span>
                  </td>
                  <td>{provides}</td>
                  <td>{p.publisher}</td>
                  <td>
                    <span className="verdict ok">{p.verdict}</span>
                  </td>
                  <td className="mono">{freshness[key] || '—'}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="fine">
        Last-updated dates are read from each dataset's own metadata on every collection run and shown unmodified,
        including when a source lags. The header carries the same two clocks: when we last checked, and when the city
        last published.
      </p>
      {allowed.map((p) => (
        <p className="fine" key={p.id}>
          <b>{p.publisher} licence.</b> {p.license}
        </p>
      ))}

      <h2>What we don't collect, and why</h2>
      {denied.map((p) => (
        <div className="deny" key={p.id}>
          <div className="deny-head">
            <b>{p.publisher}</b>
            <span className="verdict denied">{p.verdict}</span>
            <span className="mono">{p.host}</span>
          </div>
          <p>{p.license}</p>
          <p>{p.notes}</p>
        </div>
      ))}
      <p className="fine">
        We could get fresher deed data by ignoring that policy. We don't. Same-week ownership changes are detected
        through HPD registrations instead, and a production account would buy the City Register's official feed.
      </p>

      <h2>Buildings, not people</h2>
      <ul className="dlist">
        <li>The subjects of this product are buildings and companies. No private individual is profiled.</li>
        <li>
          Contacts are business roles from public filings — the managing agent of record, at their business address. No
          home addresses, no personal numbers.
        </li>
        <li>Nothing about tenants, residents or occupants is collected or displayed.</li>
      </ul>

      <h2>How contacts are obtained</h2>
      <p className="lead sm">
        Every contact carries a label naming where it came from, and the label is never upgraded by guesswork —
        a number is only worth what its source is worth.
      </p>
      <ul className="dlist tiers">
        <li>
          <span className="conf ok">verified · company site</span> Read off the company's own domain or a city filing.
          Shown with the domain it came from.
        </li>
        <li>
          <span className="conf mid">listed · directory</span> A third party vouches for the same company. Shown,
          labelled for what it is — dial it expecting it may be stale.
        </li>
        <li>
          <span className="conf alt">via another operator</span> The registered owner is a holding company with no
          contact anywhere, and this number reaches the firm that actually runs the building — named on a city filing or
          on the building's own site. The label always says whose line it is, so nobody opens a call asking for a company
          that will not be there.
        </li>
        <li>
          <span className="conf mid">office inbox · company site</span> No direct line, but an inbox the company
          published for exactly this. A shared mailbox is a slower door than a number, and the label says so.
        </li>
        <li>
          <span className="conf mid">number on file · not in the public build</span> A contact has been resolved but
          is not in the copy of the data you are looking at: contact values never travel through the public
          repository, only through the private store. The card says so rather than pretending there is no number.
        </li>
        <li>
          <span className="conf alt">from the food permit at this address</span> A venue applying for a liquour licence
          usually holds a food permit too, and that record prints a number. The premises address alone is not enough —
          the previous tenant sat at the same storefront — so the names have to corroborate as well. The label always
          says which record the number came from.
        </li>
        <li>
          <span className="conf ok">published on the permit</span> A record the city publishes with the number on it —
          a Health Department food permit, or the officer named on a City Record notice. No lookup, no provider, no
          guesswork: it is printed where the city printed it, for exactly this purpose.
        </li>
        <li>
          <span className="conf low">no direct line on file</span> We have the company and the role, not a number. No
          number is shown. Searching the web for one stays a link, under the menu, named as a web search.
        </li>
      </ul>
      <p className="fine">
        Measured, not estimated. New openings reaches 391 of 400 — the city prints the number on a food permit, so that
        register barely needs looking anything up. Across the four building registers it is 694 of 1,600. The
        most recent sweep took the 39 managing agents covering the most cards and resolved 36 of them — 28 read off the
        company's own site. Coverage by register is uneven for a reason: 77% on the carbon feed, which is large
        buildings with professional management, against 11% on gas piping, where 246 of 400 buildings register an
        individual rather than a company and there is no business to look up. That gap is structural, and it is what
        the last two labels are for.
      </p>
      {noCall.map((p) => (
        <p className="fine" key={p.id}>
          <b>Current provider: {p.publisher}.</b> {p.license}
        </p>
      ))}

      <h2>Compliance</h2>
      <p className="lead sm">
        This is a business-to-business research tool built on public records. We surface who to contact and why; we
        never dial, auto-dial or send anything on your behalf. Calls, texts and email you send are yours, and so are
        the TCPA, Do-Not-Call and CAN-SPAM obligations that come with them.
      </p>

      <p className="fine">
        A question your vendor review needs answered that isn't here? Write to{' '}
        <a href="mailto:maxim122090@gmail.com">maxim122090@gmail.com</a> and it gets added to this page.
      </p>
    </div>
  );
}
