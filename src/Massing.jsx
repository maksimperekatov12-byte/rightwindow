import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// A block, not a logo. One building on a facade deadline, wearing the shed and
// the scaffold the law puts there — the rest of the block is context.
// The layout is hand-authored rather than generated: composition matters more
// than variety, and a fixed array is the cheapest possible determinism.
const GROUND = { w: 13.4, d: 9.8, t: 0.18 };
const SUBJECT = { x: 0.4, z: 1.2, w: 2.0, d: 1.9, h: 7.2 };
const NEIGHBOURS = [
  { x: -4.6, z: 2.3, w: 2.5, d: 2.0, h: 3.1 },
  { x: -2.3, z: 2.6, w: 1.7, d: 1.5, h: 4.4 },
  { x: 3.3, z: 2.0, w: 2.0, d: 1.8, h: 2.3 },
  { x: 5.5, z: 2.6, w: 1.8, d: 1.7, h: 3.7 },
  { x: -4.6, z: -1.1, w: 2.2, d: 2.2, h: 5.2 },
  { x: -1.9, z: -1.4, w: 1.9, d: 1.8, h: 2.6 },
  { x: 2.7, z: -1.4, w: 2.1, d: 2.0, h: 4.3 },
  { x: -2.6, z: -3.6, w: 2.8, d: 1.9, h: 2.1 },
  { x: 2.0, z: -3.7, w: 3.0, d: 2.0, h: 5.8 },
];

const SHED = { over: 0.7, deckY: 1.25, deckT: 0.12, post: 0.09 };
const DECK_TOP = SHED.deckY + SHED.deckT / 2;
const OUTER_W = SUBJECT.w + SHED.over * 2;
const OUTER_D = SUBJECT.d + SHED.over * 2;

// The deck is a ring, not a slab: it covers the sidewalk and stops at the wall.
const SHED_DECK = [
  { x: SUBJECT.x, z: SUBJECT.z + SUBJECT.d / 2 + SHED.over / 2, sx: OUTER_W, sz: SHED.over },
  { x: SUBJECT.x, z: SUBJECT.z - SUBJECT.d / 2 - SHED.over / 2, sx: OUTER_W, sz: SHED.over },
  { x: SUBJECT.x + SUBJECT.w / 2 + SHED.over / 2, z: SUBJECT.z, sx: SHED.over, sz: SUBJECT.d },
  { x: SUBJECT.x - SUBJECT.w / 2 - SHED.over / 2, z: SUBJECT.z, sx: SHED.over, sz: SUBJECT.d },
];

const SHED_POSTS = (() => {
  const posts = [];
  const hx = OUTER_W / 2 - SHED.post;
  const hz = OUTER_D / 2 - SHED.post;
  for (let i = 0; i < 5; i++) {
    const x = SUBJECT.x - hx + (2 * hx * i) / 4;
    posts.push({ x, z: SUBJECT.z + hz }, { x, z: SUBJECT.z - hz });
  }
  for (let i = 1; i < 4; i++) {
    const z = SUBJECT.z - hz + (2 * hz * i) / 4;
    posts.push({ x: SUBJECT.x + hx, z }, { x: SUBJECT.x - hx, z });
  }
  return posts;
})();

const SCAF = { bays: 4, lifts: 6, top: 5.6, standoff: 0.16, t: 0.085 };
const SCAFFOLD = (() => {
  const members = [];
  const z = SUBJECT.z + SUBJECT.d / 2 + SCAF.standoff;
  const span = SUBJECT.w;
  for (let i = 0; i <= SCAF.bays; i++) {
    const x = SUBJECT.x - span / 2 + (span * i) / SCAF.bays;
    members.push({
      x, z,
      y: (DECK_TOP + SCAF.top) / 2,
      sx: SCAF.t, sy: SCAF.top - DECK_TOP, sz: SCAF.t,
      key: DECK_TOP + i * 0.06,
    });
  }
  for (let i = 0; i <= SCAF.lifts; i++) {
    const y = DECK_TOP + ((SCAF.top - DECK_TOP) * i) / SCAF.lifts;
    members.push({
      x: SUBJECT.x, z, y,
      sx: span + SCAF.t, sy: SCAF.t * 0.9, sz: SCAF.t,
      key: y,
    });
  }
  const lo = Math.min(...members.map((m) => m.key));
  const hi = Math.max(...members.map((m) => m.key));
  for (const m of members) m.delay = ((m.key - lo) / (hi - lo)) * 0.68;
  return members;
})();

const ORBIT_RATE = (Math.PI * 2) / 48;
const BASE_YAW = -0.62;
const MEMBER_IN = 0.52;
const MEMBER_RISE = 0.32;
const LOOK_AT = new THREE.Vector3(0, 2.1, 0);

// The theme's line colour carries the alpha meant for CSS borders, and three
// warns on every alpha it drops. The material owns how faint a hairline gets.
const opaque = (css) => String(css).replace(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+).*$/, 'rgb($1,$2,$3)');

function Mass({ box, edges, body, line, x, z, w, d, h }) {
  return (
    <group position={[x, h / 2, z]} scale={[w, h, d]}>
      <mesh geometry={box} material={body} />
      <lineSegments geometry={edges} material={line} />
    </group>
  );
}

function Model({ colors, reduced }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.viewport.aspect);

  const geo = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    return { box, edges: new THREE.EdgesGeometry(box) };
  }, []);
  useEffect(() => () => {
    geo.box.dispose();
    geo.edges.dispose();
  }, [geo]);

  // Built once and recoloured in place: rebuilding on every theme toggle would
  // also reset the scaffold's opacity, and the intro only plays once.
  const mat = useMemo(() => {
    // Faces are pushed back a hair so the drafted edges never fight the solid.
    const solid = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    return {
      mass: new THREE.MeshLambertMaterial(solid),
      subject: new THREE.MeshLambertMaterial(solid),
      ground: new THREE.MeshLambertMaterial(solid),
      shed: new THREE.MeshLambertMaterial(solid),
      scaffold: new THREE.MeshLambertMaterial({ transparent: true, opacity: reduced ? 1 : 0 }),
      line: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
    };
  }, []);
  useEffect(() => () => {
    for (const m of Object.values(mat)) m.dispose();
  }, [mat]);

  useEffect(() => {
    const bg = new THREE.Color(opaque(colors.bg));
    const ink = new THREE.Color(opaque(colors.ink));
    const line = new THREE.Color(opaque(colors.line));
    mat.mass.color.copy(ink).lerp(bg, 0.78);
    mat.subject.color.set(opaque(colors.brand));
    mat.ground.color.copy(bg).lerp(line, 0.07);
    mat.shed.color.set(opaque(colors.warm));
    mat.scaffold.color.set(opaque(colors.warm));
    mat.line.color.copy(line);
    invalidate();
  }, [colors.ink, colors.brand, colors.warm, colors.line, colors.bg, mat, invalidate]);

  useEffect(() => {
    camera.lookAt(LOOK_AT);
    invalidate();
  }, [camera, invalidate, aspect]);

  const orbit = useRef(null);
  const members = useRef([]);
  const clock = useRef(0);
  const settled = useRef(reduced);

  useEffect(() => {
    if (!reduced) return;
    settled.current = true;
    mat.scaffold.opacity = 1;
    for (let i = 0; i < members.current.length; i++) {
      const el = members.current[i];
      if (el) {
        el.visible = true;
        el.position.y = SCAFFOLD[i].y;
      }
    }
    invalidate();
  }, [reduced, mat, invalidate]);

  useFrame((_, delta) => {
    if (reduced) return;
    clock.current += delta > 0.05 ? 0.05 : delta;
    const t = clock.current;
    if (orbit.current) orbit.current.rotation.y = BASE_YAW + t * ORBIT_RATE;
    if (settled.current) return;
    let done = true;
    for (let i = 0; i < SCAFFOLD.length; i++) {
      const el = members.current[i];
      if (!el) continue;
      const m = SCAFFOLD[i];
      const p = (t - m.delay) / MEMBER_IN;
      if (p < 1) done = false;
      const e = p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p) * (1 - p);
      el.visible = p > 0;
      el.position.y = m.y - MEMBER_RISE * (1 - e);
    }
    mat.scaffold.opacity = t < MEMBER_IN ? t / MEMBER_IN : 1;
    if (done) settled.current = true;
  });

  const fit = Math.max(0.66, Math.min(0.98, aspect / 1.55));

  return (
    <group ref={orbit} rotation={[0, BASE_YAW, 0]} scale={fit}>
      <mesh geometry={geo.box} material={mat.ground} position={[0, -GROUND.t / 2, 0]} scale={[GROUND.w, GROUND.t, GROUND.d]} />
      <lineSegments geometry={geo.edges} material={mat.line} position={[0, -GROUND.t / 2, 0]} scale={[GROUND.w, GROUND.t, GROUND.d]} />

      {NEIGHBOURS.map((b, i) => (
        <Mass key={i} box={geo.box} edges={geo.edges} body={mat.mass} line={mat.line} {...b} />
      ))}
      <Mass box={geo.box} edges={geo.edges} body={mat.subject} line={mat.line} {...SUBJECT} />

      {SHED_DECK.map((p, i) => (
        <mesh key={i} geometry={geo.box} material={mat.shed} position={[p.x, SHED.deckY, p.z]} scale={[p.sx, SHED.deckT, p.sz]} />
      ))}
      {SHED_POSTS.map((p, i) => (
        <mesh
          key={i}
          geometry={geo.box}
          material={mat.shed}
          position={[p.x, (SHED.deckY - SHED.deckT / 2) / 2, p.z]}
          scale={[SHED.post, SHED.deckY - SHED.deckT / 2, SHED.post]}
        />
      ))}

      {SCAFFOLD.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => (members.current[i] = el)}
          geometry={geo.box}
          material={mat.scaffold}
          visible={reduced}
          position={[m.x, m.y, m.z]}
          scale={[m.sx, m.sy, m.sz]}
        />
      ))}
    </group>
  );
}

export default function Massing({ colors, reduced = false, className }) {
  const host = useRef(null);
  const [onScreen, setOnScreen] = useState(true);

  // A hero canvas that keeps drawing in a background tab or below the fold is a
  // battery bug, not an animation.
  useEffect(() => {
    if (reduced) return;
    const el = host.current;
    if (!el) return;
    let seen = true;
    const sync = () => setOnScreen(seen && !document.hidden);
    const io = new IntersectionObserver(
      ([entry]) => {
        seen = entry.isIntersecting;
        sync();
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [reduced]);

  return (
    <div ref={host} className={className} aria-hidden="true">
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
        frameloop={reduced ? 'demand' : onScreen ? 'always' : 'never'}
        camera={{ position: [14.6, 10.4, 18.2], fov: 30, near: 4, far: 70 }}
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[6, 9, 5]} intensity={2.1} />
        <Model colors={colors} reduced={reduced} />
      </Canvas>
    </div>
  );
}
