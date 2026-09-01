import React, { useMemo } from 'react';
import outline from './data/nyc-outline.json';

// The map's footprint, drawn instantly and without MapLibre: the five borough
// outlines in the page palette with the cards baked in as dots.
//
// It exists for two moments. On desktop it holds the map's space from first
// paint until the real map arrives, so the best position on the screen is never
// an empty white rectangle and nothing shifts when tiles land. Under 980px the
// real map never loads at all — phones are how reviewers open links — so this
// same drawing IS the map there: a static register-on-the-city, no worker, no
// tiles, thirty kilobytes of borough rings that were already in the bundle.
const LON = [-74.27, -73.68];
const LAT = [40.49, 40.925];
const W = 600;
const H = 520;
const px = (lon) => ((lon - LON[0]) / (LON[1] - LON[0])) * W;
const py = (lat) => ((LAT[1] - lat) / (LAT[1] - LAT[0])) * H;

const BOROS = outline.map((b) =>
  b.rings
    .map((ring) => 'M' + ring.map(([lon, lat]) => `${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`).join('L') + 'Z')
    .join(''),
);

export default function MapSkeleton({ cards = [], loading = false }) {
  const dots = useMemo(
    () =>
      cards
        .filter((c) => Array.isArray(c.ll) && c.ll.length === 2)
        // ll is [lat, lon] everywhere in the feed — same order CityMap reads.
        .map((c) => [px(c.ll[1]), py(c.ll[0]), (c.urgencyScore ?? 0) >= 18]),
    [cards],
  );
  return (
    <div className="mapskel" aria-hidden={loading ? 'true' : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role={loading ? undefined : 'img'} aria-label={loading ? undefined : `${dots.length} cards across the five boroughs`}>
        {BOROS.map((d, i) => (
          <path key={i} d={d} className="mapskel-boro" />
        ))}
        {dots.map(([x, y, hot], i) => (
          <circle key={i} cx={x} cy={y} r={hot ? 2.6 : 1.7} className={'mapskel-dot' + (hot ? ' hot' : '')} />
        ))}
      </svg>
      <span className="mapskel-cap">
        {dots.length.toLocaleString('en-US')} cards on the city{loading ? ' · map loading' : ''}
      </span>
    </div>
  );
}
