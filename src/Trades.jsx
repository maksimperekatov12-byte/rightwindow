import React from 'react';

// One page per trade. Sending a facade contractor a link that opens already set
// up for his work beats asking him to pick himself out of a list of fifteen.
// Ordered by how much is actually in each feed today — a trade with four rows
// in it is not the one to put in front of someone.
export default function TradesPage({ profiles, primary, other, volume, onPick, onBack, isDark, onTheme }) {
  const MIN = 4;
  const Card = ({ k }) => {
    const p = profiles[k];
    const v = volume?.[k] || {};
    const parts = [
      [v.facades, 'building', 'buildings'],
      [v.contracts, 'award', 'awards'],
      [v.openings, 'opening', 'openings'],
    ]
      .filter(([n]) => n >= MIN)
      .map(([n, one, many]) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`);
    return (
      <button className="trade-card" onClick={() => onPick(k)}>
        <b>{p.label}</b>
        <span className="tc-what">{p.tile}</span>
        <span className="tc-feed">{parts.length ? parts.join(' · ') : 'nothing open today'}</span>
        <span className="tc-link">rightwindow.vercel.app/#t/{k}</span>
      </button>
    );
  };

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
      <h1>A page for every trade</h1>
      <p className="lead">
        Each trade has its own link. Open one and the feed, the ranking and the copy are already set for that work —
        nothing to configure. Send the link, not the tour. The counts are what is open right now; a register with
        fewer than four rows in it is not shown at all.
      </p>

      <h2>Most to work with today</h2>
      <div className="trade-grid">{primary.map((k) => <Card key={k} k={k} />)}</div>

      <h2>The rest</h2>
      <div className="trade-grid">{other.filter((k) => k !== 'explore').map((k) => <Card key={k} k={k} />)}</div>
    </div>
  );
}
