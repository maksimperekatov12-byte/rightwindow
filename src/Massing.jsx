import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Stage, opaque, SOLID, useRiseIn } from './Stage.jsx';

// A Manhattan block, drawn the way a zoning study draws it: tiered setback
// masses, water tanks on the roofs, an avenue and a cross street cut into the
// base. One building — the one with the deadline — carries the brand colour.
// Hand-authored: composition matters more than variety, and a fixed array is
// the cheapest possible determinism.
const GROUND = { w: 15.5, d: 11.0, t: 0.18 };
const AVENUE = { x: -0.6, w: 0.85 };
const STREET = { z: 0.35, w: 0.7 };

// Each building is a stack of tiers (the wedding-cake setbacks the 1916 zoning
// law forced on the city) plus, on some, a rooftop water tank.
const SUBJECT = {
  x: 1.15, z: 2.0,
  tiers: [
    { w: 2.15, d: 1.9, h: 3.4 },
    { w: 1.7, d: 1.5, h: 2.2 },
    { w: 1.2, d: 1.05, h: 1.5 },
    { w: 0.5, d: 0.45, h: 0.34 },
  ],
};
const NEIGHBOURS = [
  { x: -4.5, z: -2.7, tiers: [{ w: 2.2, d: 1.9, h: 2.6 }, { w: 1.7, d: 1.45, h: 1.2 }], tank: [0.55, 0.5] },
  { x: -2.3, z: -3.3, tiers: [{ w: 1.6, d: 1.5, h: 4.6 }] },
  { x: -2.7, z: -1.3, tiers: [{ w: 1.7, d: 1.3, h: 1.6 }], tank: [-0.4, 0.25] },
  { x: 1.4, z: -3.0, tiers: [{ w: 2.0, d: 1.8, h: 3.0 }, { w: 1.5, d: 1.35, h: 1.4 }, { w: 1.0, d: 0.9, h: 0.95 }] },
  { x: 3.95, z: -2.6, tiers: [{ w: 1.9, d: 1.7, h: 2.2 }], tank: [0.5, -0.35] },
  { x: 5.75, z: -3.4, tiers: [{ w: 1.4, d: 1.3, h: 3.4 }] },
  { x: -5.0, z: 1.9, tiers: [{ w: 1.8, d: 1.6, h: 2.0 }, { w: 1.3, d: 1.15, h: 1.0 }] },
  { x: -3.1, z: 2.8, tiers: [{ w: 1.5, d: 1.4, h: 3.6 }], tank: [0.35, 0.35] },
  { x: -4.4, z: 4.1, tiers: [{ w: 2.0, d: 1.2, h: 1.3 }] },
  { x: 3.9, z: 2.1, tiers: [{ w: 1.8, d: 1.7, h: 2.6 }, { w: 1.35, d: 1.25, h: 1.1 }], tank: [-0.4, 0.4] },
  { x: 5.8, z: 1.4, tiers: [{ w: 1.3, d: 1.2, h: 1.9 }] },
  { x: 3.3, z: 3.9, tiers: [{ w: 2.4, d: 1.35, h: 1.5 }] },
  { x: 5.6, z: 3.6, tiers: [{ w: 1.5, d: 1.2, h: 2.5 }], tank: [0.4, -0.3] },
];
const BUILDINGS = [...NEIGHBOURS, SUBJECT];
const SUBJECT_INDEX = BUILDINGS.length - 1;

const ORBIT_RATE = (Math.PI * 2) / 48;
const BASE_YAW = -0.62;
const RISE = 0.55;      // one building's grow-in, seconds
const STAGGER = 0.055;  // per building
const LOOK_AT = new THREE.Vector3(0, 2.1, 0);

const TANK = { r: 0.21, h: 0.42, roofR: 0.25, roofH: 0.2 };

function Building({ b, geo, mat, body, groupRef }) {
  let y = 0;
  const tiers = b.tiers.map((t, i) => {
    const cy = y + t.h / 2;
    y += t.h;
    return { ...t, cy, key: i };
  });
  const top = tiers[tiers.length - 1];
  return (
    <group ref={groupRef} position={[b.x, 0, b.z]}>
      {tiers.map((t) => (
        <group key={t.key} position={[0, t.cy, 0]} scale={[t.w, t.h, t.d]}>
          <mesh geometry={geo.box} material={body} />
          <lineSegments geometry={geo.edges} material={mat.line} />
        </group>
      ))}
      {b.tank && (
        <group position={[b.tank[0], y, b.tank[1]]}>
          <mesh geometry={geo.tank} material={mat.tank} position={[0, TANK.h / 2 + 0.06, 0]} />
          <mesh geometry={geo.roof} material={mat.tank} position={[0, TANK.h + 0.06 + TANK.roofH / 2, 0]} />
        </group>
      )}
    </group>
  );
}

function Model({ colors, reduced }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.viewport.aspect);

  const geo = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    return {
      box,
      edges: new THREE.EdgesGeometry(box),
      tank: new THREE.CylinderGeometry(TANK.r, TANK.r, TANK.h, 14),
      roof: new THREE.CylinderGeometry(0.02, TANK.roofR, TANK.roofH, 14),
    };
  }, []);
  useEffect(() => () => {
    for (const g of Object.values(geo)) g.dispose();
  }, [geo]);

  // Built once and recoloured in place — rebuilding on a theme toggle would
  // replay the one-time intro.
  const mat = useMemo(() => {
    return {
      mass: new THREE.MeshLambertMaterial(SOLID),
      subject: new THREE.MeshLambertMaterial(SOLID),
      ground: new THREE.MeshLambertMaterial(SOLID),
      street: new THREE.MeshLambertMaterial(SOLID),
      tank: new THREE.MeshLambertMaterial(SOLID),
      line: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
    };
  }, []);
  useEffect(() => () => {
    for (const m of Object.values(mat)) m.dispose();
  }, [mat]);

  useEffect(() => {
    const bg = opaque(colors.bg);
    const ink = opaque(colors.ink);
    const line = opaque(colors.line);
    mat.mass.color.copy(ink).lerp(bg, 0.78);
    mat.subject.color.set(colors.brand);
    mat.ground.color.copy(bg).lerp(line, 0.07);
    mat.street.color.copy(bg).lerp(ink, 0.16);
    mat.tank.color.copy(ink).lerp(bg, 0.5);
    mat.line.color.copy(line);
    invalidate();
  }, [colors.ink, colors.brand, colors.warm, colors.line, colors.bg, mat, invalidate]);

  useEffect(() => {
    camera.lookAt(LOOK_AT);
    invalidate();
  }, [camera, invalidate, aspect]);

  const orbit = useRef(null);
  const clock = useRef(0);
  const { groups, show, step } = useRiseIn({ count: BUILDINGS.length, rise: RISE, stagger: STAGGER, reduced });

  useEffect(() => {
    if (!reduced) return;
    show();
    invalidate();
  }, [reduced, invalidate, show]);

  // The intro extrudes the block out of the ground once, nearest lot first —
  // the way a massing model gets built, not the way a logo spins up.
  useFrame((state, delta) => {
    if (reduced) return;
    clock.current += delta > 0.05 ? 0.05 : delta;
    if (orbit.current) orbit.current.rotation.y = BASE_YAW + clock.current * ORBIT_RATE;
    step();
  });

  const fit = Math.max(0.66, Math.min(0.98, aspect / 1.55));

  return (
    <group ref={orbit} rotation={[0, BASE_YAW, 0]} scale={fit}>
      <mesh geometry={geo.box} material={mat.ground} position={[0, -GROUND.t / 2, 0]} scale={[GROUND.w, GROUND.t, GROUND.d]} />
      <lineSegments geometry={geo.edges} material={mat.line} position={[0, -GROUND.t / 2, 0]} scale={[GROUND.w, GROUND.t, GROUND.d]} />
      {/* streets read as cuts, not paint: thin strips a hair above the slab */}
      <mesh geometry={geo.box} material={mat.street} position={[AVENUE.x, 0.012, 0]} scale={[AVENUE.w, 0.02, GROUND.d]} />
      <mesh geometry={geo.box} material={mat.street} position={[0, 0.012, STREET.z]} scale={[GROUND.w, 0.02, STREET.w]} />

      {BUILDINGS.map((b, i) => (
        <Building
          key={i}
          b={b}
          geo={geo}
          mat={mat}
          body={i === SUBJECT_INDEX ? mat.subject : mat.mass}
          groupRef={(el) => (groups.current[i] = el)}
        />
      ))}
    </group>
  );
}

export default function Massing({ colors, reduced = false, className }) {
  return (
    <Stage
      reduced={reduced}
      className={className}
      camera={{ position: [14.6, 10.4, 18.2], fov: 30, near: 4, far: 70 }}
    >
      <Model colors={colors} reduced={reduced} />
    </Stage>
  );
}
