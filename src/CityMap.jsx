import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Map as GLMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
// Vite bundles the main module but does not emit the worker file its
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)` points at, so
// production served a 404 and the map hung silently before its first tile
// request. `?url` makes Vite emit the worker as a real asset and hand back its
// hashed path, which MapLibre is told to use outright.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import outline from './data/nyc-outline.json';

setWorkerUrl(workerUrl);

// The register, on a real map of New York.
//
// The first version drew its own blueprint slab — borough outlines, no streets —
// and the request that replaced it was blunt: it should be unmistakably New
// York, and it should zoom to the building. So the base is OpenStreetMap,
// rendered by MapLibre GL (BSD) from OpenFreeMap's free vector tiles — open
// source end to end, no key, no quota, recorded in data/source-policy.json like
// every other host this product talks to.
//
// The cards stay three-dimensional: each is an extruded column, height and
// colour by urgency, amber where a dated forcing event is close. The columns are
// the SAME filtered list as the feed below — the search box, the borough chips
// and a typed ZIP territory move the map — and clicking one flies the camera to
// the building and opens its card. The panel expands to the full window for
// reading dense neighbourhoods.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

// The base style, recoloured into the product's own palette before the map is
// built. Positron ships neutral grey; this walks its layers and repaints them
// with the same tokens the rest of the interface uses — paper ground, green
// wash for parks, ink-toned labels — so the map reads as part of the page
// rather than an embedded third-party widget. Matching is by layer id and
// type, which is coarse on purpose: a layer the patterns miss simply keeps
// Positron's quiet grey.
let stylePromise = null;
function themedStyle(colors) {
  if (!stylePromise) stylePromise = fetch(STYLE_URL).then((r) => r.json());
  return stylePromise.then((base) => {
    const style = JSON.parse(JSON.stringify(base));
    const P = {
      land: colors.bg || '#F1EFE9',
      water: colors.waterTone || '#DCE3DE',
      green: colors.brandWash || 'rgba(20,89,74,0.12)',
      building: 'rgba(15,30,26,0.055)',
      roadMinor: 'rgba(255,255,255,0.9)',
      roadMajor: '#FFFFFF',
      roadCase: 'rgba(15,30,26,0.14)',
      label: colors.ink2 || '#3E4B46',
      labelFaint: colors.ink3 || '#5F6F69',
      halo: colors.paper || '#FBFAF6',
      boundary: 'rgba(15,30,26,0.25)',
    };
    for (const l of style.layers) {
      const id = l.id.toLowerCase();
      l.paint = l.paint || {};
      if (l.type === 'background') l.paint['background-color'] = P.land;
      else if (l.type === 'fill') {
        if (/water|ocean|river/.test(id)) l.paint['fill-color'] = P.water;
        else if (/park|green|wood|grass|cemetery|pitch|garden|landcover|vegetation/.test(id)) {
          l.paint['fill-color'] = P.green;
          delete l.paint['fill-pattern'];
        } else if (/building/.test(id)) l.paint['fill-color'] = P.building;
        else if (/landuse|residential|industrial|sand|aeroway/.test(id)) l.paint['fill-color'] = P.land;
      } else if (l.type === 'line') {
        if (/water|river/.test(id)) l.paint['line-color'] = P.water;
        else if (/boundary|admin/.test(id)) l.paint['line-color'] = P.boundary;
        else if (/casing|_case/.test(id)) l.paint['line-color'] = P.roadCase;
        else if (/motorway|trunk|primary|highway/.test(id)) l.paint['line-color'] = P.roadMajor;
        else if (/road|street|minor|service|path|rail|bridge|tunnel|link|secondary|tertiary/.test(id))
          l.paint['line-color'] = P.roadMinor;
      } else if (l.type === 'symbol') {
        // POI pins, house numbers and transit icons are what made the map read
        // as heavy — they compete with the cards, which are the point.
        if (/poi|housenumber|house_num|transit|airport|aeroway|ferry|station|oneway/.test(id)) {
          l.layout = l.layout || {};
          l.layout.visibility = 'none';
          continue;
        }
        l.paint['text-color'] = /place|city|town|suburb|neighbourhood|borough/.test(id) ? P.label : P.labelFaint;
        l.paint['text-halo-color'] = P.halo;
      }
    }
    return style;
  });
}

const NYC_BOUNDS = [
  [-74.28, 40.48],
  [-73.68, 40.93],
];

// Everything that is not the five boroughs is veiled: a world-sized polygon
// whose holes are the borough rings, filled with the page's own ground. New
// Jersey and Connecticut stop competing for attention, and the city the cards
// live in is the only thing drawn in full. The same rings give the city a
// crisp edge line.
const MASK = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [[-75.5, 39.8], [-72.5, 39.8], [-72.5, 41.6], [-75.5, 41.6], [-75.5, 39.8]],
      ...outline.flatMap((b) => b.rings),
    ],
  },
};
const EDGES = {
  type: 'FeatureCollection',
  features: outline.flatMap((b) =>
    b.rings.map((ring) => ({
      type: 'Feature',
      properties: { boro: b.boro },
      geometry: { type: 'LineString', coordinates: [...ring, ring[0]] },
    })),
  ),
};

// A column footprint in degrees: ~26m across, small enough that two adjacent
// buildings read separately at street zoom.
const HALF = 0.00012;

const soon = (iso, days) => {
  if (!iso) return false;
  const d = (new Date(iso) - Date.now()) / 86400000;
  return d >= 0 && d <= days;
};

// Two geometries per card, because the two layers want different ones: a
// circle layer renders POINTS only (a polygon in its source is silently
// skipped — the far-out view was empty for exactly that reason), while
// fill-extrusion wants the polygon footprint.
function toGeoJSON(rows) {
  const scores = rows.map((r) => r.card.urgencyScore ?? 1);
  const lo = Math.min(...scores);
  const span = Math.max(...scores) - lo || 1;
  const pts = [];
  const polys = [];
  rows.forEach((r, i) => {
    const [lat, lon] = r.card.ll;
    const t = ((r.card.urgencyScore ?? 1) - lo) / span;
    const hot = soon(r.card.nextHearing, 30) || soon(r.card.shed?.until, 60) ? 1 : 0;
    const props = { i, t, hot, height: 40 + t * 140 };
    pts.push({ type: 'Feature', id: i, properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } });
    polys.push({
      type: 'Feature',
      id: i,
      properties: props,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [lon - HALF, lat - HALF],
          [lon + HALF, lat - HALF],
          [lon + HALF, lat + HALF],
          [lon - HALF, lat + HALF],
          [lon - HALF, lat - HALF],
        ]],
      },
    });
  });
  return {
    pts: { type: 'FeatureCollection', features: pts },
    polys: { type: 'FeatureCollection', features: polys },
  };
}

function boundsOf(rows) {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  for (const r of rows) {
    const [lat, lon] = r.card.ll;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

// One map instance. The expanded overlay mounts a second one of these — tiles
// are cached by the browser, so the cost is a rebuild of the vector layers, and
// each instance owns its whole lifecycle, which is far simpler than moving a
// live WebGL canvas between containers.
function MapSurface({ rows, colors, onPick, describe, richTip = false }) {
  const host = useRef(null);
  const mapRef = useRef(null);
  const [tip, setTip] = useState(null);

  const located = rows;
  const data = useMemo(() => toGeoJSON(located), [located]);

  useEffect(() => {
    const el = host.current;
    if (!el || mapRef.current) return;
    let dead = false;
    let map = null;
    let ro = null;
    // The themed style is fetched BEFORE the map is built: swapping styles on a
    // live map wipes the card layers the load handler adds, and rebuilding them
    // across a swap is more machinery than waiting ~100ms for a 25KB JSON.
    themedStyle(colors)
      .catch(() => STYLE_URL)
      .then((style) => {
        if (dead || !host.current) return;
        map = buildMap(style);
      });

    const buildMap = (style) => {
    const map = new GLMap({
      container: el,
      style,
      bounds: located.length ? boundsOf(located) : NYC_BOUNDS,
      fitBoundsOptions: { padding: 40, maxZoom: 15 },
      // The camera cannot leave the city or zoom out past it: the register has
      // nothing to say about Norwalk.
      maxBounds: [
        [-74.4, 40.42],
        [-73.55, 41.0],
      ],
      minZoom: 8.8,
      // Flat by default. The tilted view is what made the panel feel heavy;
      // the fly-in still pitches when a card is opened.
      pitch: 0,
      attributionControl: { compact: true },
    });
    // Zoom buttons and a pitch-aware compass: the ask was zoom in and out, so
    // the controls are explicit rather than wheel-only.
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.touchZoomRotate.enableRotation();
    // The flag integration tests read: flipped on every idle, cleared on move.
    map.on('idle', () => {
      el.dataset.mapIdle = '1';
    });
    // Diagnostics reach the instance through the DOM; nothing ships state here.
    el._map = map;
    // The container is often mid-layout at construction, so the first fit can
    // be computed against a placeholder size and leave the camera a borough too
    // far out. One refit once everything has settled.
    map.once('idle', () => {
      map.resize();
      if (located.length) map.fitBounds(boundsOf(located), { padding: 48, maxZoom: 15, duration: 0 });
    });
    map.on('movestart', () => {
      delete el.dataset.mapIdle;
    });

    map.on('load', () => {
      map.addSource('nyc-mask', { type: 'geojson', data: MASK });
      map.addSource('nyc-edge', { type: 'geojson', data: EDGES });
      map.addLayer({
        id: 'nyc-mask',
        type: 'fill',
        source: 'nyc-mask',
        paint: { 'fill-color': colors.bg || '#F1EFE9', 'fill-opacity': 0.86 },
      });
      map.addLayer({
        id: 'nyc-edge',
        type: 'line',
        source: 'nyc-edge',
        paint: { 'line-color': colors.line || 'rgba(15,30,26,0.25)', 'line-width': 1 },
      });
      map.addSource('cards-pts', { type: 'geojson', data: data.pts });
      map.addSource('cards', { type: 'geojson', data: data.polys });
      // Far out, a dot; close in, the extruded column. The crossover leaves no
      // zoom where the register is invisible.
      map.addLayer({
        id: 'cards-dot',
        type: 'circle',
        source: 'cards-pts',
        maxzoom: 13.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.6, 13.5, 5.5],
          'circle-color': ['case', ['==', ['get', 'hot'], 1], colors.warm, colors.brand],
          'circle-opacity': 0.92,
          // The paper halo is what separates a dot from the street under it.
          'circle-stroke-color': colors.paper || '#FBFAF6',
          'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: 'cards-col',
        type: 'fill-extrusion',
        source: 'cards',
        minzoom: 12.5,
        paint: {
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-color': ['case', ['==', ['get', 'hot'], 1], colors.warm, colors.brand],
          'fill-extrusion-opacity': 0.92,
        },
      });

      const hoverable = ['cards-dot', 'cards-col'];
      map.on('mousemove', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: hoverable });
        if (!hits.length) {
          map.getCanvas().style.cursor = '';
          setTip(null);
          return;
        }
        map.getCanvas().style.cursor = 'pointer';
        const r = located[hits[0].properties.i];
        if (r) setTip({ x: e.point.x, y: e.point.y, card: r.card });
      });
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: hoverable });
        if (!hits.length) return;
        const r = located[hits[0].properties.i];
        if (!r) return;
        const [lat, lon] = r.card.ll;
        // Fly to the building first — the zoom IS the answer to "where is
        // this" — then open its card in the feed below.
        map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 16.6), pitch: 55, duration: 900 });
        onPick({ card: r.card });
      });
    });
    mapRef.current = map;
    // The container is laid out by CSS that can land a frame after
    // construction — the map read 463x300 once and stayed there. Track the
    // element, not the window.
    ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    return map;
    };

    return () => {
      dead = true;
      ro?.disconnect();
      mapRef.current = null;
      map?.remove();
    };
    // Initial mount only; data and camera follow in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filters changed: swap the data and re-frame the camera on what is left.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.getSource('cards-pts')?.setData(data.pts);
      map.getSource('cards')?.setData(data.polys);
      if (located.length) map.fitBounds(boundsOf(located), { padding: 48, maxZoom: 15, duration: 700 });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [data, located]);

  return (
    <div className="citymap-surface">
      <div ref={host} className="citymap-gl" />
      {tip && (
        <div className="citymap-tip" style={{ left: tip.x + 14, top: tip.y - 10 }}>
          {richTip ? (
            <>
              <b>{describe(tip.card)}</b>
              {tipExtras(tip.card).map((line) => (
                <span key={line}>{line}</span>
              ))}
            </>
          ) : (
            describe(tip.card)
          )}
        </div>
      )}
    </div>
  );
}

// The lines that separate one card from its neighbours, for the expanded view:
// whatever this register actually knows about the building.
function tipExtras(c) {
  const out = [];
  if (c.ghg?.usd > 0) out.push(`~$${c.ghg.usd.toLocaleString('en-US')}/yr estimated overage`);
  else if (c.ghg) out.push(`${c.ghg.t.toLocaleString('en-US')} tCO2e reported (CY${c.ghg.y})`);
  if (c.finesOwed > 0) out.push(`$${Math.round(c.finesOwed).toLocaleString('en-US')} assessed`);
  if (c.ecbBalance > 0) out.push(`$${Math.round(c.ecbBalance).toLocaleString('en-US')} unpaid at OATH`);
  if (c.nextHearing) out.push(`hearing ${c.nextHearing}`);
  if (c.laa) out.push(c.laa.filed ? `gas work filed ${c.laa.filed}` : 'gas work in pre-filing');
  if (c.devices) out.push(`${c.devices} device${c.devices > 1 ? 's' : ''} · CAT1 ${c.lastCat1 ?? 'never filed'}`);
  if (c.monthsLeft != null) out.push(`${c.monthsLeft} mo to deadline`);
  if (c.urgencyScore != null) out.push(`urgency ${c.urgencyScore}`);
  return out.slice(0, 5);
}

// The map's own filter. The toolbar's filters already move the map, but a
// reader lost in eight hundred dots needs a cut they can make WITHOUT leaving
// the map — the three questions that matter on it: who can I ring, whose window
// is dated, and who is most urgent.
const MAP_CUTS = [
  { k: 'all', label: 'All', of: () => true },
  {
    k: 'callable',
    label: 'Callable',
    of: (c) => Boolean(c.agent?.contactKnown || c.phone || c.email),
  },
  {
    k: 'soon',
    label: 'Dated soon',
    of: (c) => soon(c.nextHearing, 30) || soon(c.shed?.until, 60),
  },
  { k: 'top', label: 'Top 100', of: null }, // by rank, handled below
];

export default function CityMap({ rows, colors, reduced, onPick, describe, compact = false, startBig = false }) {
  const [big, setBig] = useState(startBig);
  const [cut, setCut] = useState('all');

  const located = useMemo(
    () => rows.filter((r) => Array.isArray(r.card.ll) && r.card.ll.length === 2),
    [rows],
  );

  const cutCounts = useMemo(() => {
    const m = { all: located.length, top: Math.min(100, located.length) };
    for (const c of MAP_CUTS) if (c.of && c.k !== 'all') m[c.k] = located.filter((r) => c.of(r.card)).length;
    return m;
  }, [located]);

  const shown = useMemo(() => {
    if (cut === 'top')
      return [...located].sort((a, b) => (b.card.urgencyScore ?? 0) - (a.card.urgencyScore ?? 0)).slice(0, 100);
    const def = MAP_CUTS.find((c) => c.k === cut);
    return def?.of && cut !== 'all' ? located.filter((r) => def.of(r.card)) : located;
  }, [located, cut]);

  // A cut that empties under the current toolbar filters resets rather than
  // showing a blank city.
  useEffect(() => {
    if (cut !== 'all' && !shown.length) setCut('all');
  }, [shown.length, cut]);

  const cutChips = (
    <div className="citymap-cuts" role="group" aria-label="Filter the cards on the map">
      {MAP_CUTS.map((c) => (
        <button
          key={c.k}
          className={cut === c.k ? 'on' : ''}
          aria-pressed={cut === c.k}
          onClick={() => setCut(c.k)}
        >
          {c.label} <i>{cutCounts[c.k] ?? 0}</i>
        </button>
      ))}
    </div>
  );

  useEffect(() => {
    if (!big) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setBig(false);
    };
    window.addEventListener('keydown', onKey);
    // The page behind a full-window map must not scroll under it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [big]);

  const pick = useCallback(
    (p) => {
      setBig(false);
      onPick(p);
    },
    [onPick],
  );

  return (
    <div className="citymap-wrap">
      <div className={'citymap' + (compact ? ' compact' : '')}>
        <MapSurface rows={shown} colors={colors} onPick={onPick} describe={describe} />
        <div className="citymap-topbar">
          <button className="citymap-big" onClick={() => setBig(true)} title="Expand the map to the whole window">
            ⤢ Expand
          </button>
          {cutChips}
        </div>
      </div>
      <span className="citymap-cap">
        {compact
          ? `${shown.length.toLocaleString('en-US')} cards · filters and the cut above move it · click to open`
          : `${shown.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} shown cards on the map · colour is urgency, amber has a dated hearing or an expiring shed · zoom to any card, click it to open`}
      </span>

      {big && (
        <div className="citymap-full" role="dialog" aria-label="Register map, full window">
          <div className="citymap-full-bar">
            <b>{shown.length.toLocaleString('en-US')} cards on the map</b>
            {cutChips}
            <span>hover for what makes it a call · click flies in and opens the card · Esc closes</span>
            <button className="btn ghost" onClick={() => setBig(false)}>
              ✕ Close
            </button>
          </div>
          <MapSurface rows={shown} colors={colors} onPick={pick} describe={describe} richTip />
        </div>
      )}
    </div>
  );
}
