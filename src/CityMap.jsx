import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Stage, opaque, SOLID } from './Stage.jsx';
import outline from './data/nyc-outline.json';

// The register, on the city. Every card that carries a coordinate becomes a
// column on a blueprint slab of New York — height and colour by urgency — so a
// crew can see where their territory's work actually stands before they type a
// single ZIP. The slab is drawn from the city's own borough boundaries,
// simplified to twenty-nine kilobytes; the dots are the SAME filtered list the
// feed below is showing, so the search box, the borough chips and the cohort
// chips all move the map too.
//
// Deliberately not a tile map. A street map answers "how do I get there", which
// is not the question; this answers "where is the work", in the product's own
// drawing style, with no tile server, no library and nothing loaded from a
// third party.

// Equirectangular around the city's centroid — at city scale the error is
// centimetres. One kilometre is one world unit before fitting.
const LAT0 = 40.7128;
const LON0 = -73.986;
const KLAT = 110.574;
const KLON = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
const FIT = 0.42; // world units per km: the five boroughs span ~48km, the stage ~20.

const project = ([lat, lon]) => [
  (lon - LON0) * KLON * FIT,
  -((lat - LAT0) * KLAT * FIT),
];

// ---- the slab ---------------------------------------------------------------

function Boroughs({ colors }) {
  const lines = useMemo(() => {
    const ink = opaque(colors.line);
    return outline.map((b) => ({
      boro: b.boro,
      rings: b.rings.map((ring) => {
        const pts = ring.map(([lon, lat]) => {
          const [x, z] = project([lat, lon]);
          return new THREE.Vector3(x, 0.021, z);
        });
        pts.push(pts[0].clone());
        return { geo: new THREE.BufferGeometry().setFromPoints(pts), ink };
      }),
    }));
  }, [colors.line]);

  return (
    <group>
      {lines.map((b) =>
        b.rings.map((r, i) => (
          <line key={b.boro + i} geometry={r.geo}>
            <lineBasicMaterial color={r.ink} transparent opacity={0.9} />
          </line>
        )),
      )}
    </group>
  );
}

// ---- the columns ------------------------------------------------------------

const TMP = new THREE.Object3D();
const TMPC = new THREE.Color();

function Columns({ rows, colors, onPick, onHover }) {
  const ref = useRef(null);
  const placed = useMemo(() => {
    // Height by urgency, normalised within the visible list so the tallest
    // column is always the most urgent thing on screen rather than an absolute
    // scale nobody is told about.
    const scores = rows.map((r) => r.card.urgencyScore ?? 1);
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    const span = hi - lo || 1;
    return rows.map((r) => {
      const [x, z] = project(r.card.ll);
      const t = ((r.card.urgencyScore ?? 1) - lo) / span;
      return { ...r, x, z, h: 0.12 + t * 0.75, t };
    });
  }, [rows]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const brand = opaque(colors.brand);
    const warm = opaque(colors.warm);
    const ink = opaque(colors.ink);
    placed.forEach((p, i) => {
      TMP.position.set(p.x, p.h / 2 + 0.02, p.z);
      TMP.scale.set(1, p.h, 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
      // Amber for a dated forcing event that is actually close — a hearing
      // inside thirty days or a shed permit expiring inside sixty — matching
      // the caption exactly. Any shed at all painted 573 of 800 columns amber,
      // which made the colour mean nothing.
      const soon = (iso, days) => {
        if (!iso) return false;
        const d = (new Date(iso) - Date.now()) / 86400000;
        return d >= 0 && d <= days;
      };
      const hot = soon(p.card.nextHearing, 30) || soon(p.card.shed?.until, 60);
      TMPC.copy(hot ? warm : brand).lerp(ink, hot ? 0 : (1 - p.t) * 0.45);
      mesh.setColorAt(i, TMPC);
    });
    mesh.count = placed.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [placed, colors]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, Math.max(1, placed.length)]}
      onPointerMove={(e) => {
        e.stopPropagation();
        const p = placed[e.instanceId];
        if (p) onHover(p, e);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        const p = placed[e.instanceId];
        if (p) onPick(p);
      }}
    >
      <boxGeometry args={[0.075, 1, 0.075]} />
      <meshLambertMaterial {...SOLID} vertexColors={false} />
    </instancedMesh>
  );
}

// ---- camera: drag to turn, wheel to lean in ---------------------------------

function Rig({ target }) {
  const { camera } = useThree();
  const state = useRef({ yaw: 0.0, dist: 17, drag: null });

  useEffect(() => {
    const el = document.querySelector('.citymap');
    if (!el) return;
    const down = (e) => {
      state.current.drag = { x: e.clientX, yaw: state.current.yaw };
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      const d = state.current.drag;
      if (!d) return;
      state.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
    };
    const up = () => {
      state.current.drag = null;
    };
    const wheel = (e) => {
      e.preventDefault();
      state.current.dist = Math.min(26, Math.max(7, state.current.dist + e.deltaY * 0.02));
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  useFrame(() => {
    const { yaw, dist } = state.current;
    const cx = target[0] + Math.sin(yaw) * dist * 0.62;
    const cz = target[2] + Math.cos(yaw) * dist * 0.62;
    camera.position.lerp(new THREE.Vector3(cx, dist * 0.78, cz), 0.12);
    camera.lookAt(target[0], 0, target[2]);
  });
  return null;
}

// ---- the panel --------------------------------------------------------------

export default function CityMap({ rows, colors, reduced, onPick, describe, compact = false }) {
  const [tip, setTip] = useState(null);
  const host = useRef(null);

  const located = useMemo(
    () => rows.filter((r) => Array.isArray(r.card.ll) && r.card.ll.length === 2),
    [rows],
  );

  // Centre the camera on the visible work, not on the geographic middle of the
  // city: a Brooklyn territory should fill the frame with Brooklyn.
  const target = useMemo(() => {
    if (!located.length) return [0, 0, 0];
    let sx = 0;
    let sz = 0;
    for (const r of located) {
      const [x, z] = project(r.card.ll);
      sx += x;
      sz += z;
    }
    return [sx / located.length, 0, sz / located.length];
  }, [located]);

  const hover = useCallback(
    (p, e) => {
      if (!p) {
        setTip(null);
        return;
      }
      const box = host.current?.getBoundingClientRect();
      setTip({
        x: (e?.clientX ?? 0) - (box?.left ?? 0),
        y: (e?.clientY ?? 0) - (box?.top ?? 0),
        text: describe(p.card),
      });
    },
    [describe],
  );

  return (
    <div ref={host} className="citymap-wrap">
      <Stage reduced={reduced} className="citymap" camera={{ position: [0, 13, 11], fov: 34 }}>
        <Rig target={target} />
        <Boroughs colors={colors} />
        {/* the harbour: one quiet plate under everything */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[46, 46]} />
          <meshLambertMaterial color={opaque(colors.bg)} {...SOLID} />
        </mesh>
        {located.length > 0 && <Columns rows={located} colors={colors} onPick={onPick} onHover={hover} />}
      </Stage>
      {tip && (
        <div className="citymap-tip" style={{ left: tip.x + 14, top: tip.y - 10 }}>
          {tip.text}
        </div>
      )}
      <span className="citymap-cap">
        {compact
          ? `${located.length.toLocaleString('en-US')} cards on the map · your filters move it · drag to turn, click a column to open`
          : `${located.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} shown cards located · colour and height are urgency · amber has a dated hearing or an expiring shed · drag to turn, click a column to open its card`}
      </span>
    </div>
  );
}
