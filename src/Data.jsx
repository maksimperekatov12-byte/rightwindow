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
        <button className="theme-btn" onClick={onTheme} title={isDark ? 'Switch to light' : 'Switch to dark'}>
          {isDark ? 'Light' : 'Dark'}
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
      <p className="lead sm">Every contact carries one of three labels, and the label is never upgraded by guesswork.</p>
      <ul className="dlist tiers">
        <li>
          <span className="conf ok">verified direct</span> A licensed enrichment provider returned a direct business
          number for that role. The number is shown.
        </li>
        <li>
          <span className="conf mid">office line · HPD registration</span> A business line on file with the city. The
          number is shown, labelled for what it is.
        </li>
        <li>
          <span className="conf low">no direct line on file</span> We have the company and the role, not a number. No
          number is shown. Searching the web for one stays a link, under the menu, named as a web search.
        </li>
      </ul>
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
