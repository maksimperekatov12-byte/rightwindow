import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Stage, opaque, SOLID, useRiseIn } from './Stage.jsx';

// The hero for City contracts: the yard, the morning after the award.
//
// One zoom step in from the facades block. A municipal bar put the work out;
// the parcel in front of it is fenced, paved and almost entirely empty. A
// gantry has set one load down and nothing else has arrived. The only object
// here that does not belong to the city is the winner's site trailer, towed in
// through the gate this week — so it is the only object carrying colour. The
// agency is the biggest thing in the frame and it is grey: what the colour
// marks is reachability, not size, which is the whole product.
//
// About sixty per cent of these awards are human services and renewals rather
// than construction, so nothing here may claim the work is a building. The
// gantry lifts material onto a yard; it does not raise a structure.
//
// Same idiom as Massing.jsx: Lambert fills, EdgesGeometry hairlines,
// hand-authored constants, one staged rise out of the ground.
const GROUND = { w: 15.5, d: 11.0, t: 0.18 };
const STREET = { z: -2.1, w: 1.5 };
const AVENUE = { x: 7.05, w: 1.3 };

// The yard is a raised slab, not paint. At a seventeen-degree eye the lip is
// what stops the whole composition flattening into a plan.
const APRON = { x: 0.6, z: 1.35, w: 11.4, d: 5.6, h: 0.09 };

// No portico, no columns, no flagpole: the city's actual real estate is a heavy
// bar with a cornice oversail and rooftop units.
const AGENCY = {
  x: -2.4,
  z: -4.15,
  plinth: { w: 8.2, d: 2.5, h: 0.32 },
  body: { w: 7.6, d: 2.2, h: 2.26, cy: 1.45 },
  cornice: { w: 8.0, d: 2.45, h: 0.24, cy: 2.7 },
  bulk: { w: 2.4, d: 1.7, h: 0.56, cy: 3.1, dx: -1.8 },
  band: { w: 7.0, h: 0.34, t: 0.1, ys: [0.95, 1.95], dz: 1.11 },
  units: [
    { dx: -3.65, dz: -0.45, w: 0.85, h: 0.28, d: 0.62 },
    { dx: 1.85, dz: 0.4, w: 0.66, h: 0.28, d: 0.52 },
    { dx: 3.25, dz: -0.3, w: 0.72, h: 0.42, d: 0.66 },
  ],
};

// Solid box posts, not a chain-link mesh: line width is not honoured, so forty
// strands would be a grey haze exactly where the drawing needs clean emptiness.
// Far and right runs only — a near run would stand between the eye and the
// trailer.
const FENCE = {
  post: { w: 0.09, h: 0.9, d: 0.09, cy: 0.54 },
  far: { z: -1.45, xs: [-5.1, -3.2, -1.3, 0.6, 2.5, 4.4, 6.3] },
  right: { x: 6.3, zs: [0.3, 2.6] },
  rails: [0.42, 0.86],
};

// The box gantry, the silhouette nothing else in this product owns. Three
// portals rather than two: through a full revolution two go edge-on and a pair
// would collapse, and the third bay reads as room the yard has not used.
const GANTRY = {
  x: 0.2,
  z: 1.5,
  bays: [-3.2, 0.0, 3.2],
  span: 2.7,
  leg: { w: 0.2, d: 0.26, h: 2.1, cy: 1.14 },
  head: { w: 0.3, h: 0.26, d: 2.96, cy: 2.32 },
  rail: { w: 6.9, h: 0.2, d: 0.26, cy: 2.32 },
  trolley: { dx: -1.6, w: 0.42, h: 0.26, d: 0.86, cy: 2.06 },
  hook: { s: 0.24, h: 0.2, cy: 1.02 },
  wireTop: 1.93,
};

// Four objects in an eleven-by-six yard. The count is the message.
const COURSE = 0.22;
const JITTER = [0.05, -0.06, 0.04];
const LOAD = { x: -1.4, z: 1.5, w: 1.55, d: 1.05, n: 3, dropFrom: 1.45 };
const STACKS = [
  { x: 3.8, z: 0.75, w: 1.4, d: 1.0, n: 2 },
  { x: -3.9, z: 3.3, w: 1.5, d: 0.95, n: 3 },
];

const PIPE = { r: 0.2, len: 2.2, seg: 8 };
const RACK = {
  x: 4.9,
  lower: { y: 0.4, zs: [1.18, 1.6, 2.02] },
  upper: { y: 0.75, zs: [1.39, 1.81] },
  bearer: { w: 0.16, h: 0.11, d: 0.9, cy: 0.145, xs: [4.15, 5.65] },
};

// The winner. Two-high, because that much colour holds the frame against a
// taller agency and half of it does not. On blocks, because a flat-roofed box
// on blocks is not a vehicle. Hitch still pointing back at the gate.
const TRAILER = {
  x: 4.55,
  z: 3.55,
  gateX: 8.6,
  skirt: { w: 2.15, h: 0.22, d: 1.0, dx: 0.0, cy: 0.2 },
  lower: { w: 2.45, h: 0.96, d: 1.12, dx: 0.0, dz: 0.0, cy: 0.79 },
  upper: { w: 2.1, h: 0.96, d: 1.04, dx: -0.15, dz: -0.05, cy: 1.75 },
  stair: { w: 0.5, h: 1.26, d: 0.62, dx: -1.45, cy: 0.94 },
  hitch: { w: 0.9, h: 0.1, d: 0.13, dx: 1.35, cy: 0.52 },
};

const ORBIT_RATE = (Math.PI * 2) / 58;
const BASE_YAW = -0.3;
const RISE = 0.55;
const STAGGER = 0.07;
const LOOK_AT = new THREE.Vector3(0.4, 1.3, 0.3);
// Two beats after the parcel is built: the load comes off the hook, then the
// winner drives in through the gate.
const HOIST = { t0: 0.85, dur: 0.5, from: 1.45, to: 0.0 };
const ARRIVE = { t0: 1.25, dur: 0.7, from: TRAILER.gateX, to: TRAILER.x };
const ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p) * (1 - p));

function Box({ geo, mat, p, s, line }) {
  return (
    <>
      <mesh geometry={geo.box} material={mat} position={p} scale={s} />
      {line && <lineSegments geometry={geo.edges} material={line} position={p} scale={s} />}
    </>
  );
}

function Model({ colors, reduced }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.viewport.aspect);

  const geo = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const rails = [];
    for (const y of FENCE.rails) {
      const yy = APRON.h + y;
      const x0 = FENCE.far.xs[0];
      const x1 = FENCE.far.xs[FENCE.far.xs.length - 1];
      rails.push(x0, yy, FENCE.far.z, x1, yy, FENCE.far.z);
      rails.push(FENCE.right.x, yy, FENCE.right.zs[0], FENCE.right.x, yy, FENCE.right.zs[1]);
    }
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(rails, 3));
    return {
      box,
      edges: new THREE.EdgesGeometry(box),
      pipe: new THREE.CylinderGeometry(PIPE.r, PIPE.r, PIPE.len, PIPE.seg),
      rails: railGeo,
    };
  }, []);
  useEffect(() => () => {
    for (const g of Object.values(geo)) g.dispose();
  }, [geo]);

  const mat = useMemo(
    () => ({
      mass: new THREE.MeshLambertMaterial(SOLID),
      brand: new THREE.MeshLambertMaterial(SOLID),
      ground: new THREE.MeshLambertMaterial(SOLID),
      street: new THREE.MeshLambertMaterial(SOLID),
      apron: new THREE.MeshLambertMaterial(SOLID),
      plant: new THREE.MeshLambertMaterial(SOLID),
      glass: new THREE.MeshLambertMaterial(SOLID),
      line: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
    }),
    [],
  );
  useEffect(() => () => {
    for (const m of Object.values(mat)) m.dispose();
  }, [mat]);

  useEffect(() => {
    const bg = opaque(colors.bg);
    const ink = opaque(colors.ink);
    const line = opaque(colors.line);
    // Four values, and each means something: pale is everything built, mid-grey
    // is everything that is plant, dark is void, and the one colour is the one
    // company.
    mat.mass.color.copy(ink).lerp(bg, 0.78);
    mat.brand.color.set(colors.brand);
    mat.ground.color.copy(bg).lerp(line, 0.07);
    mat.street.color.copy(bg).lerp(ink, 0.16);
    mat.apron.color.copy(bg).lerp(ink, 0.07);
    mat.plant.color.copy(ink).lerp(bg, 0.5);
    mat.glass.color.copy(ink).lerp(bg, 0.36);
    mat.line.color.copy(line);
    invalidate();
  }, [colors.ink, colors.brand, colors.warm, colors.line, colors.bg, mat, invalidate]);

  useEffect(() => {
    camera.lookAt(LOOK_AT);
    invalidate();
  }, [camera, invalidate, aspect]);

  const orbit = useRef(null);
  const clock = useRef(0);
  const t0 = useRef(0);
  const load = useRef(null);
  const trailer = useRef(null);
  const { groups, show, step } = useRiseIn({ count: 6, rise: RISE, stagger: STAGGER, reduced });

  useEffect(() => {
    if (!reduced) return;
    show();
    if (load.current) load.current.position.y = HOIST.to;
    if (trailer.current) trailer.current.position.x = ARRIVE.to;
    invalidate();
  }, [reduced, invalidate, show]);

  useFrame((state, delta) => {
    if (reduced) return;
    clock.current += delta > 0.05 ? 0.05 : delta;
    if (orbit.current) orbit.current.rotation.y = BASE_YAW + clock.current * ORBIT_RATE;
    step();
    if (!t0.current) t0.current = performance.now();
    const t = (performance.now() - t0.current) / 1000;
    if (load.current) {
      const p = ease((t - HOIST.t0) / HOIST.dur);
      load.current.position.y = HOIST.from + (HOIST.to - HOIST.from) * p;
    }
    if (trailer.current) {
      const p = ease((t - ARRIVE.t0) / ARRIVE.dur);
      trailer.current.position.x = ARRIVE.from + (ARRIVE.to - ARRIVE.from) * p;
    }
  });

  const fit = Math.max(0.7, Math.min(0.96, aspect / 1.52));
  const hookY = GANTRY.hook.cy;

  return (
    <group ref={orbit} rotation={[0, BASE_YAW, 0]} scale={fit}>
      <Box geo={geo} mat={mat.ground} line={mat.line} p={[0, -GROUND.t / 2, 0]} s={[GROUND.w, GROUND.t, GROUND.d]} />
      <mesh geometry={geo.box} material={mat.street} position={[0, 0.012, STREET.z]} scale={[GROUND.w, 0.02, STREET.w]} />
      <mesh geometry={geo.box} material={mat.street} position={[AVENUE.x, 0.012, 0]} scale={[AVENUE.w, 0.02, GROUND.d]} />
      <Box geo={geo} mat={mat.apron} line={mat.line} p={[APRON.x, APRON.h / 2, APRON.z]} s={[APRON.w, APRON.h, APRON.d]} />

      {/* the agency */}
      <group ref={(el) => (groups.current[0] = el)} position={[AGENCY.x, 0, AGENCY.z]}>
        <Box geo={geo} mat={mat.mass} line={mat.line} p={[0, AGENCY.plinth.h / 2, 0]} s={[AGENCY.plinth.w, AGENCY.plinth.h, AGENCY.plinth.d]} />
        <Box geo={geo} mat={mat.mass} line={mat.line} p={[0, AGENCY.body.cy, 0]} s={[AGENCY.body.w, AGENCY.body.h, AGENCY.body.d]} />
        {AGENCY.band.ys.map((y) =>
          [AGENCY.band.dz, -AGENCY.band.dz].map((dz) => (
            <mesh
              key={`${y}:${dz}`}
              geometry={geo.box}
              material={mat.glass}
              position={[0, y, dz]}
              scale={[AGENCY.band.w, AGENCY.band.h, AGENCY.band.t]}
            />
          )),
        )}
        <Box geo={geo} mat={mat.mass} line={mat.line} p={[0, AGENCY.cornice.cy, 0]} s={[AGENCY.cornice.w, AGENCY.cornice.h, AGENCY.cornice.d]} />
        <Box geo={geo} mat={mat.mass} line={mat.line} p={[AGENCY.bulk.dx, AGENCY.bulk.cy, 0]} s={[AGENCY.bulk.w, AGENCY.bulk.h, AGENCY.bulk.d]} />
        {AGENCY.units.map((u, i) => (
          <mesh key={i} geometry={geo.box} material={mat.plant} position={[u.dx, 2.82 + u.h / 2, u.dz]} scale={[u.w, u.h, u.d]} />
        ))}
      </group>

      {/* the hoarding: what turns empty ground into deliberately empty ground */}
      <group ref={(el) => (groups.current[1] = el)}>
        {FENCE.far.xs.map((x) => (
          <mesh key={`f${x}`} geometry={geo.box} material={mat.mass} position={[x, APRON.h + FENCE.post.cy, FENCE.far.z]} scale={[FENCE.post.w, FENCE.post.h, FENCE.post.d]} />
        ))}
        {FENCE.right.zs.map((z) => (
          <mesh key={`r${z}`} geometry={geo.box} material={mat.mass} position={[FENCE.right.x, APRON.h + FENCE.post.cy, z]} scale={[FENCE.post.w, FENCE.post.h, FENCE.post.d]} />
        ))}
        <lineSegments geometry={geo.rails} material={mat.line} />
      </group>

      {/* the gantry */}
      <group ref={(el) => (groups.current[2] = el)}>
        {GANTRY.bays.map((dx) => (
          <group key={dx} position={[GANTRY.x + dx, 0, GANTRY.z]}>
            {[-GANTRY.span / 2, GANTRY.span / 2].map((dz) => (
              <mesh key={dz} geometry={geo.box} material={mat.plant} position={[0, GANTRY.leg.cy, dz]} scale={[GANTRY.leg.w, GANTRY.leg.h, GANTRY.leg.d]} />
            ))}
            <mesh geometry={geo.box} material={mat.plant} position={[0, GANTRY.head.cy, 0]} scale={[GANTRY.head.w, GANTRY.head.h, GANTRY.head.d]} />
          </group>
        ))}
        {[-GANTRY.span / 2, GANTRY.span / 2].map((dz) => (
          <mesh key={dz} geometry={geo.box} material={mat.plant} position={[GANTRY.x, GANTRY.rail.cy, GANTRY.z + dz]} scale={[GANTRY.rail.w, GANTRY.rail.h, GANTRY.rail.d]} />
        ))}
        <mesh
          geometry={geo.box}
          material={mat.plant}
          position={[GANTRY.x + GANTRY.trolley.dx, GANTRY.trolley.cy, GANTRY.z]}
          scale={[GANTRY.trolley.w, GANTRY.trolley.h, GANTRY.trolley.d]}
        />
        <mesh
          geometry={geo.box}
          material={mat.plant}
          position={[GANTRY.x + GANTRY.trolley.dx, (GANTRY.wireTop + hookY) / 2, GANTRY.z]}
          scale={[0.03, GANTRY.wireTop - hookY, 0.03]}
        />
        <mesh
          geometry={geo.box}
          material={mat.plant}
          position={[GANTRY.x + GANTRY.trolley.dx, hookY, GANTRY.z]}
          scale={[GANTRY.hook.s, GANTRY.hook.h, GANTRY.hook.s]}
        />
      </group>

      {/* the pipe rack */}
      <group ref={(el) => (groups.current[3] = el)}>
        {RACK.bearer.xs.map((x) => (
          <mesh key={x} geometry={geo.box} material={mat.mass} position={[x, APRON.h + RACK.bearer.cy, 1.6]} scale={[RACK.bearer.w, RACK.bearer.h, RACK.bearer.d]} />
        ))}
        {RACK.lower.zs.map((z) => (
          <mesh key={`l${z}`} geometry={geo.pipe} material={mat.plant} position={[RACK.x, RACK.lower.y, z]} rotation={[0, 0, Math.PI / 2]} />
        ))}
        {RACK.upper.zs.map((z) => (
          <mesh key={`u${z}`} geometry={geo.pipe} material={mat.plant} position={[RACK.x, RACK.upper.y, z]} rotation={[0, 0, Math.PI / 2]} />
        ))}
      </group>

      {STACKS.map((s, si) => (
        <group key={si} ref={(el) => (groups.current[4 + si] = el)}>
          {Array.from({ length: s.n }, (_, i) => (
            <Box
              key={i}
              geo={geo}
              mat={mat.mass}
              line={mat.line}
              p={[s.x + JITTER[i % JITTER.length], APRON.h + COURSE / 2 + i * COURSE, s.z]}
              s={[s.w, COURSE, s.d]}
            />
          ))}
        </group>
      ))}

      {/* the load that just came off the hook */}
      <group ref={load} position={[0, HOIST.from, 0]}>
        {Array.from({ length: LOAD.n }, (_, i) => (
          <Box
            key={i}
            geo={geo}
            mat={mat.mass}
            line={mat.line}
            p={[LOAD.x + JITTER[i % JITTER.length], APRON.h + COURSE / 2 + i * COURSE, LOAD.z]}
            s={[LOAD.w, COURSE, LOAD.d]}
          />
        ))}
      </group>

      {/* the winner, towed in through the gate this week */}
      <group ref={trailer} position={[ARRIVE.from, 0, 0]}>
        <mesh geometry={geo.box} material={mat.mass} position={[TRAILER.skirt.dx, APRON.h + TRAILER.skirt.cy, TRAILER.z]} scale={[TRAILER.skirt.w, TRAILER.skirt.h, TRAILER.skirt.d]} />
        <Box
          geo={geo}
          mat={mat.brand}
          line={mat.line}
          p={[TRAILER.lower.dx, APRON.h + TRAILER.lower.cy, TRAILER.z + TRAILER.lower.dz]}
          s={[TRAILER.lower.w, TRAILER.lower.h, TRAILER.lower.d]}
        />
        <Box
          geo={geo}
          mat={mat.brand}
          line={mat.line}
          p={[TRAILER.upper.dx, APRON.h + TRAILER.upper.cy, TRAILER.z + TRAILER.upper.dz]}
          s={[TRAILER.upper.w, TRAILER.upper.h, TRAILER.upper.d]}
        />
        <mesh geometry={geo.box} material={mat.mass} position={[TRAILER.stair.dx, APRON.h + TRAILER.stair.cy, TRAILER.z]} scale={[TRAILER.stair.w, TRAILER.stair.h, TRAILER.stair.d]} />
        <mesh geometry={geo.box} material={mat.mass} position={[TRAILER.hitch.dx, APRON.h + TRAILER.hitch.cy, TRAILER.z]} scale={[TRAILER.hitch.w, TRAILER.hitch.h, TRAILER.hitch.d]} />
      </group>
    </group>
  );
}

export default function CivicWorks({ colors, reduced = false, className }) {
  return (
    <Stage
      reduced={reduced}
      className={className}
      camera={{ position: [15.0, 8.6, 18.0], fov: 30, near: 4, far: 70 }}
    >
      <Model colors={colors} reduced={reduced} />
    </Stage>
  );
}
