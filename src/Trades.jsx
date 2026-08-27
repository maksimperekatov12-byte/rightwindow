import React from 'react';

// One page per trade. Sending a facade contractor a link that opens already set
// up for his work beats asking him to pick himself out of a list of fifteen.
export default function TradesPage({ profiles, primary, other, onPick, onBack, isDark, onTheme }) {
  const Card = ({ k }) => {
    const p = profiles[k];
    const feed = p.facade ? 'Building facades' : p.cNeed ? 'City contracts' : p.oNeed ? 'New openings' : 'Everything';
    return (
      <button className="trade-card" onClick={() => onPick(k)}>
        <b>{p.label}</b>
        <span className="tc-what">{p.tile}</span>
        <span className="tc-feed">{feed}</span>
        <span className="tc-link">rightwindow.vercel.app/#t/{k}</span>
      </button>
    );
  };

  return (
    <div className="wrap datapage">
      <div className="page-bar">
        <button className="chip-btn back" onClick={onBack}>← Back to the feed</button>
        <button className="theme-btn" onClick={onTheme} title={isDark ? 'Switch to light' : 'Switch to dark'}>
          {isDark ? 'Light' : 'Dark'}
        </button>
      </div>
      <h1>A page for every trade</h1>
      <p className="lead">
        Each trade has its own link. Open one and the feed, the ranking and the copy are already set for that work —
        nothing to configure. Send the link, not the tour.
      </p>

      <h2>Facade compliance</h2>
      <div className="trade-grid">{primary.map((k) => <Card key={k} k={k} />)}</div>

      <h2>Other trades</h2>
      <div className="trade-grid">{other.filter((k) => k !== 'explore').map((k) => <Card key={k} k={k} />)}</div>
    </div>
  );
}
