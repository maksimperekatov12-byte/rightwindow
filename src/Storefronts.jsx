import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Stage, opaque, SOLID, useRiseIn } from './Stage.jsx';

// The hero for New openings: the corner lease.
//
// A pending licence is not a building, it is a corner. Somebody signed the best
// lot on a low commercial street, and in two to four months the paper comes off
// the glass. So the picture is the street it is opening on — two runs of trading
// shopfronts meeting at an intersection, every one glazed, signed and open — and
// on the corner lot one tenancy that is none of those things. The licence
// attaches to the space, so the space is the coloured volume and the landlord's
// floor above it is plain mass.
//
// Same idiom as Massing.jsx, one zoom closer. Where the block hero cuts its
// streets into the slab, this one lifts the sidewalk above the roadway: the
// same honesty at a scale where a kerb is a thing you can see. The water tanks
// are Massing's constants verbatim — same city, cheapest possible continuity.
const GROUND = { w: 15.5, d: 11.0, t: 0.18 };
const AVENUE = { x: 3.15, w: 2.4 };
const CROSS = { z: 2.4, w: 2.0 };
const WALK = { h: 0.18 };
const WALKS = [
  { x: -3.4, z: 0.9, w: 8.7, d: 1.0 },
  { x: 1.45, z: -2.05, w: 1.0, d: 6.9 },
  { x: -1.6, z: 3.85, w: 12.3, d: 0.9 },
  { x: 4.85, z: -0.6, w: 1.0, d: 9.8 },
];

// The section every trading lot shares. One continuous glazing ribbon per run
// rather than nine separate windows: at this size the eye reads a dark band,
// never individual panes, and one box is cheaper than nine.
// A storey here is about 1.3 units, so the retail base is 1.7 and everything
// above it is somebody's apartment. Sized any taller the shopfront becomes the
// whole building and the run stops reading as a street wall at all.
const SHOP = {
  baseY: 0.18, baseH: 0.26,
  glazeY: 0.4, glazeH: 0.86, glazeInset: 0.14, glazeT: 0.12,
  lintelY: 1.26, lintelH: 0.1, lintelT: 0.2,
  bandY: 1.36, bandH: 0.34, bandOut: 0.1,
  panelH: 0.24, panelT: 0.06,
  pierY: 0.18, pierH: 1.5, pierW: 0.3, pierT: 0.22,
};

const SUBJECT = {
  x: -0.6, z: -0.95, w: 3.1, d: 2.7,
  tenancy: 1.7,
  upper: 2.3,
  cornice: { over: 0.16, h: 0.14 },
  tank: [0.75, -0.7],
  face: { ave: 0.95, cross: 0.4 },
};
// One dark slot in the green wall: there is a way in, and it gives the volume
// scale. Exactly one — a second starts modelling a shopfront.
const DOOR = { x: 0.3, y: 0.72, z: 0.34, w: 0.58, h: 1.3, t: 0.14 };

// The canopy is up before the sign is. A projecting box, not a sloped awning: a
// fabric slope lies almost along a sightline that descends at twenty degrees and
// would render as an invisible edge. A box presents a vertical fascia, and that
// fascia is the thing that is blank.
// Shallow on purpose. A projecting canopy hides the wall below it down to
// out/tan(elevation), and at this camera's twenty-four degrees a 0.7 projection
// wipes out the entire shopfront it is meant to shelter. A third of that reads
// as a fascia box and leaves the leased wall visible.
const CANOPY = { y: 1.5, h: 0.34, out: 0.34 };
const CANOPIES = [
  { axis: 'x', hinge: 0.95, c: -0.475, len: 3.65 },
  { axis: 'z', hinge: 0.4, c: -0.6, len: 3.1 },
];
// The absence rendered as an absence: this panel is the colour of nothing and
// carries only its hairline. Painting a nameless sign green would say the
// opposite of what it means.
const BLANK = { h: 0.34, t: 0.06, trim: 0.3 };

const CROSS_FACE = { z: 0.4, d: 2.7, cz: -0.95 };
const CROSS_RUN = [
  { x: -6.9, w: 1.7, h: 3.45, sign: 1.45 },
  { x: -5.15, w: 1.8, h: 2.95, sign: 1.55 },
  { x: -3.2, w: 2.1, h: 3.7, sign: 1.85 },
];
const CROSS_PIERS = [-2.15, -4.25, -6.05];
const CROSS_RIBBON = { c: -4.95, len: 5.6 };

const AVE_FACE = { x: 0.95, w: 3.1, cx: -0.6 };
const AVE_RUN = [
  { z: -3.35, d: 2.1, h: 3.2, sign: 1.85 },
  { z: -4.95, d: 1.1, h: 3.8, sign: 0.9 },
];
const AVE_PIERS = [-2.3, -4.4];
const AVE_RIBBON = { c: -3.9, len: 3.2 };

const REAR = [
  { x: -3.4, z: -3.6, w: 2.2, d: 2.2, h: 3.6, tank: [0.5, 0.4] },
  { x: -6.1, z: -3.45, w: 2.7, d: 2.4, h: 3.05 },
  { x: -4.3, z: -5.0, w: 2.6, d: 1.0, h: 3.4 },
  { x: -6.85, z: -5.0, w: 1.8, d: 1.0, h: 1.95 },
];
const ACROSS = [
  { x: -4.6, z: 4.95, w: 3.0, d: 1.6, h: 2.85 },
  { x: -1.2, z: 5.05, w: 2.6, d: 1.4, h: 2.2, tank: [0.45, -0.3] },
  { x: 6.55, z: -1.2, w: 1.8, d: 2.9, h: 2.6, tank: [-0.35, 0.6] },
  { x: 6.4, z: -4.1, w: 2.2, d: 2.3, h: 2.9 },
];

// A skip at the kerb is the most reliable street-level sign of a fit-out there
// is, and it sits under the new canopy where the eye already is.
const KERB = [
  { x: -0.85, z: 0.92, w: 1.55, h: 0.74, d: 0.72 },
  { x: 1.45, z: -0.3, w: 0.8, h: 0.56, d: 0.75 },
  { x: 1.42, z: -0.28, w: 0.62, h: 0.2, d: 0.6, on: 0.56 },
];

const TANK = { r: 0.21, h: 0.42, roofR: 0.25, roofH: 0.2 };

const ORBIT_RATE = (Math.PI * 2) / 54;
const BASE_YAW = -0.5;
const RISE = 0.6;
const STAGGER = 0.05;
const LOOK_AT = new THREE.Vector3(-0.2, 1.75, -0.4);
const FIT = { min: 0.68, max: 1.02, div: 1.48 };
const EXTRUDE = { at: 1.55, dur: 0.45 };
const DELIVER = { at: 1.95, dur: 0.3 };
const ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p) * (1 - p));

function Box({ geo, mat, p, s, line }) {
  return (
    <>
      <mesh geometry={geo.box} material={mat} position={p} scale={s} />
      {line && <lineSegments geometry={geo.edges} material={line} position={p} scale={s} />}
    </>
  );
}

function Tank({ geo, mat, at, y }) {
  return (
    <group position={[at[0], y, at[1]]}>
      <mesh geometry={geo.tank} material={mat} position={[0, TANK.h / 2 + 0.06, 0]} />
      <mesh geometry={geo.roof} material={mat} position={[0, TANK.h + 0.06 + TANK.roofH / 2, 0]} />
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

  const mat = useMemo(
    () => ({
      mass: new THREE.MeshLambertMaterial(SOLID),
      brand: new THREE.MeshLambertMaterial(SOLID),
      ground: new THREE.MeshLambertMaterial(SOLID),
      street: new THREE.MeshLambertMaterial(SOLID),
      walk: new THREE.MeshLambertMaterial(SOLID),
      glass: new THREE.MeshLambertMaterial(SOLID),
      tank: new THREE.MeshLambertMaterial(SOLID),
      blank: new THREE.MeshLambertMaterial(SOLID),
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
    mat.mass.color.copy(ink).lerp(bg, 0.78);
    mat.brand.color.set(colors.brand);
    mat.ground.color.copy(bg).lerp(line, 0.07);
    mat.street.color.copy(bg).lerp(ink, 0.3);
    // One step lighter than the roadway, so the kerb's lit face reads.
    mat.walk.color.copy(bg).lerp(ink, 0.07);
    // Derived from ink with a fixed step against mass, so the separation that
    // makes five dark shopfronts read against one sealed one survives the dark
    // theme instead of collapsing into it.
    mat.glass.color.copy(ink).lerp(bg, 0.3);
    mat.tank.color.copy(ink).lerp(bg, 0.5);
    mat.blank.color.copy(bg).lerp(line, 0.07);
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
  const canopies = useRef([]);
  const kerb = useRef(null);
  const count = CROSS_RUN.length + AVE_RUN.length + REAR.length + ACROSS.length + 1;
  const { groups, show, step } = useRiseIn({ count, rise: RISE, stagger: STAGGER, reduced });

  const settle = () => {
    for (const c of canopies.current) if (c) c.scale.setScalar(1);
    if (kerb.current) {
      kerb.current.scale.setScalar(1);
      kerb.current.visible = true;
    }
  };

  useEffect(() => {
    if (!reduced) return;
    show();
    settle();
    invalidate();
  }, [reduced, invalidate, show]);

  useFrame((state, delta) => {
    if (reduced) return;
    clock.current += delta > 0.05 ? 0.05 : delta;
    if (orbit.current) orbit.current.rotation.y = BASE_YAW + clock.current * ORBIT_RATE;
    step();
    if (!t0.current) t0.current = performance.now();
    const t = (performance.now() - t0.current) / 1000;
    // The canopies come out over the walk after the block has settled, then the
    // skip lands: the fit-out reaching the street.
    const e = ease((t - EXTRUDE.at) / EXTRUDE.dur);
    CANOPIES.forEach((c, i) => {
      const g = canopies.current[i];
      if (!g) return;
      const v = Math.max(e, 0.0001);
      if (c.axis === 'x') g.scale.x = v;
      else g.scale.z = v;
    });
    const d = ease((t - DELIVER.at) / DELIVER.dur);
    if (kerb.current) {
      kerb.current.visible = d > 0;
      kerb.current.scale.setScalar(Math.max(d, 0.0001));
    }
  });

  const fit = Math.max(FIT.min, Math.min(FIT.max, aspect / FIT.div));
  let slot = 0;
  const next = () => slot++;
  const subjTop = SUBJECT.tenancy + SUBJECT.upper;

  return (
    <group ref={orbit} rotation={[0, BASE_YAW, 0]} scale={fit}>
      <Box geo={geo} mat={mat.ground} line={mat.line} p={[0, -GROUND.t / 2, 0]} s={[GROUND.w, GROUND.t, GROUND.d]} />
      <mesh geometry={geo.box} material={mat.street} position={[AVENUE.x, 0.011, 0]} scale={[AVENUE.w, 0.02, GROUND.d]} />
      <mesh geometry={geo.box} material={mat.street} position={[0, 0.011, CROSS.z]} scale={[GROUND.w, 0.02, CROSS.w]} />
      {WALKS.map((w, i) => (
        <Box key={i} geo={geo} mat={mat.walk} line={mat.line} p={[w.x, WALK.h / 2, w.z]} s={[w.w, WALK.h, w.d]} />
      ))}

      {/* the cross-street frontage, laid out along its own length */}
      {CROSS_RUN.map((b, i) => (
        <group key={`c${i}`} ref={(el) => (groups.current[next()] = el)}>
          <Box geo={geo} mat={mat.mass} line={mat.line} p={[b.x, b.h / 2, CROSS_FACE.cz]} s={[b.w, b.h, CROSS_FACE.d]} />
          <mesh
            geometry={geo.box}
            material={mat.tank}
            position={[b.x, SHOP.bandY + SHOP.panelH / 2 + 0.05, CROSS_FACE.z + SHOP.bandOut]}
            scale={[b.sign, SHOP.panelH, SHOP.panelT]}
          />
        </group>
      ))}
      {/* one continuous recess, interrupted by piers at the lease lines */}
      <mesh
        geometry={geo.box}
        material={mat.glass}
        position={[CROSS_RIBBON.c, SHOP.glazeY + SHOP.glazeH / 2, CROSS_FACE.z - SHOP.glazeInset - SHOP.glazeT / 2]}
        scale={[CROSS_RIBBON.len, SHOP.glazeH, SHOP.glazeT]}
      />
      <mesh geometry={geo.box} material={mat.mass} position={[CROSS_RIBBON.c, SHOP.baseY / 2 + 0.02, CROSS_FACE.z - 0.06]} scale={[CROSS_RIBBON.len, SHOP.baseH, 0.16]} />
      <mesh geometry={geo.box} material={mat.mass} position={[CROSS_RIBBON.c, SHOP.lintelY + SHOP.lintelH / 2, CROSS_FACE.z - 0.06]} scale={[CROSS_RIBBON.len, SHOP.lintelH, SHOP.lintelT]} />
      <mesh geometry={geo.box} material={mat.mass} position={[CROSS_RIBBON.c, SHOP.bandY + SHOP.bandH / 2, CROSS_FACE.z + SHOP.bandOut / 2]} scale={[CROSS_RIBBON.len, SHOP.bandH, SHOP.bandOut]} />
      {CROSS_PIERS.map((x) => (
        <mesh key={`cp${x}`} geometry={geo.box} material={mat.mass} position={[x, SHOP.pierY + SHOP.pierH / 2, CROSS_FACE.z - SHOP.pierT / 2]} scale={[SHOP.pierW, SHOP.pierH, SHOP.pierT]} />
      ))}

      {/* the avenue frontage */}
      {AVE_RUN.map((b, i) => (
        <group key={`a${i}`} ref={(el) => (groups.current[next()] = el)}>
          <Box geo={geo} mat={mat.mass} line={mat.line} p={[AVE_FACE.cx, b.h / 2, b.z]} s={[AVE_FACE.w, b.h, b.d]} />
          <mesh
            geometry={geo.box}
            material={mat.tank}
            position={[AVE_FACE.x + SHOP.bandOut, SHOP.bandY + SHOP.panelH / 2 + 0.05, b.z]}
            scale={[SHOP.panelT, SHOP.panelH, b.sign]}
          />
        </group>
      ))}
      <mesh
        geometry={geo.box}
        material={mat.glass}
        position={[AVE_FACE.x - SHOP.glazeInset - SHOP.glazeT / 2, SHOP.glazeY + SHOP.glazeH / 2, AVE_RIBBON.c]}
        scale={[SHOP.glazeT, SHOP.glazeH, AVE_RIBBON.len]}
      />
      <mesh geometry={geo.box} material={mat.mass} position={[AVE_FACE.x - 0.06, SHOP.baseY / 2 + 0.02, AVE_RIBBON.c]} scale={[0.16, SHOP.baseH, AVE_RIBBON.len]} />
      <mesh geometry={geo.box} material={mat.mass} position={[AVE_FACE.x - 0.06, SHOP.lintelY + SHOP.lintelH / 2, AVE_RIBBON.c]} scale={[SHOP.lintelT, SHOP.lintelH, AVE_RIBBON.len]} />
      <mesh geometry={geo.box} material={mat.mass} position={[AVE_FACE.x + SHOP.bandOut / 2, SHOP.bandY + SHOP.bandH / 2, AVE_RIBBON.c]} scale={[SHOP.bandOut, SHOP.bandH, AVE_RIBBON.len]} />
      {AVE_PIERS.map((z) => (
        <mesh key={`ap${z}`} geometry={geo.box} material={mat.mass} position={[AVE_FACE.x - SHOP.pierT / 2, SHOP.pierY + SHOP.pierH / 2, z]} scale={[SHOP.pierT, SHOP.pierH, SHOP.pierW]} />
      ))}

      {REAR.concat(ACROSS).map((b, i) => (
        <group key={`m${i}`} ref={(el) => (groups.current[next()] = el)} position={[b.x, 0, b.z]}>
          <Box geo={geo} mat={mat.mass} line={mat.line} p={[0, b.h / 2, 0]} s={[b.w, b.h, b.d]} />
          {b.tank && <Tank geo={geo} mat={mat.tank} at={b.tank} y={b.h} />}
        </group>
      ))}

      {/* the corner lot: the tenancy is the coloured volume, the floor above it
          belongs to somebody else and is not the lead */}
      <group ref={(el) => (groups.current[next()] = el)}>
        <Box
          geo={geo}
          mat={mat.brand}
          line={mat.line}
          p={[SUBJECT.x, SUBJECT.tenancy / 2, SUBJECT.z]}
          s={[SUBJECT.w, SUBJECT.tenancy, SUBJECT.d]}
        />
        <Box
          geo={geo}
          mat={mat.mass}
          line={mat.line}
          p={[SUBJECT.x, SUBJECT.tenancy + SUBJECT.upper / 2, SUBJECT.z]}
          s={[SUBJECT.w, SUBJECT.upper, SUBJECT.d]}
        />
        <Box
          geo={geo}
          mat={mat.tank}
          line={mat.line}
          p={[SUBJECT.x, subjTop - SUBJECT.cornice.h / 2, SUBJECT.z]}
          s={[SUBJECT.w + SUBJECT.cornice.over * 2, SUBJECT.cornice.h, SUBJECT.d + SUBJECT.cornice.over * 2]}
        />
        <Tank geo={geo} mat={mat.tank} at={[SUBJECT.x + SUBJECT.tank[0], SUBJECT.z + SUBJECT.tank[1]]} y={subjTop} />
        <mesh geometry={geo.box} material={mat.glass} position={[DOOR.x, DOOR.y, DOOR.z]} scale={[DOOR.w, DOOR.h, DOOR.t]} />
      </group>

      {CANOPIES.map((c, i) => (
        <group
          key={i}
          ref={(el) => (canopies.current[i] = el)}
          position={c.axis === 'x' ? [c.hinge, CANOPY.y, c.c] : [c.c, CANOPY.y, c.hinge]}
          scale={c.axis === 'x' ? [0.0001, 1, 1] : [1, 1, 0.0001]}
        >
          {c.axis === 'x' ? (
            <>
              <Box geo={geo} mat={mat.mass} line={mat.line} p={[CANOPY.out / 2, 0, 0]} s={[CANOPY.out, CANOPY.h, c.len]} />
              <Box geo={geo} mat={mat.blank} line={mat.line} p={[CANOPY.out + BLANK.t / 2, 0, 0]} s={[BLANK.t, BLANK.h, c.len - BLANK.trim]} />
            </>
          ) : (
            <>
              <Box geo={geo} mat={mat.mass} line={mat.line} p={[0, 0, CANOPY.out / 2]} s={[c.len, CANOPY.h, CANOPY.out]} />
              <Box geo={geo} mat={mat.blank} line={mat.line} p={[0, 0, CANOPY.out + BLANK.t / 2]} s={[c.len - BLANK.trim, BLANK.h, BLANK.t]} />
            </>
          )}
        </group>
      ))}

      <group ref={kerb} visible={false}>
        {KERB.map((k, i) => (
          <Box key={i} geo={geo} mat={mat.tank} line={mat.line} p={[k.x, (k.on || 0) + k.h / 2, k.z]} s={[k.w, k.h, k.d]} />
        ))}
      </group>
    </group>
  );
}

export default function Storefronts({ colors, reduced = false, className }) {
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
