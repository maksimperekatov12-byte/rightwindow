import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

// The shell every register hero sits in.
//
// Three of these now exist — a block of buildings, a civic works site, a retail
// strip — and they share everything except their geometry: the same framing, the
// same lights, and the same rule that a canvas which keeps drawing in a
// background tab or below the fold is a battery bug rather than an animation.
export function Stage({ reduced = false, className, camera, children }) {
  const host = useRef(null);
  const [onScreen, setOnScreen] = useState(true);

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
        camera={camera}
      >
        <ambientLight intensity={2.0} />
        <directionalLight position={[6, 9, 5]} intensity={1.0} />
        {children}
      </Canvas>
    </div>
  );
}

// The theme's line colour carries the alpha meant for CSS borders; opaqued it is
// the right hue, and the material owns how faint the hairline gets.
export const opaque = (c) => new THREE.Color(String(c).replace(/rgba?\(([^)]+?)(?:,[^,)]+)?\)/, 'rgb($1)'));

// Every hero fills with Lambert and draws its own hairlines, so the polygon
// offset that keeps those hairlines off the fill is the same everywhere.
export const SOLID = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };

// A scene should look built, not spun up: each part rises out of the ground in
// turn, on wall clock rather than frame count, so a tab that renders rarely
// finishes the build instead of stretching it.
export function useRiseIn({ count, rise = 0.55, stagger = 0.055, reduced }) {
  const groups = useRef([]);
  const start = useRef(0);
  const settled = useRef(reduced);

  const show = useCallback(() => {
    settled.current = true;
    for (const g of groups.current) {
      if (g) {
        g.visible = true;
        g.scale.y = 1;
      }
    }
  }, []);

  const step = useCallback(() => {
    if (settled.current) return true;
    if (!start.current) start.current = performance.now();
    const t = (performance.now() - start.current) / 1000;
    let done = true;
    for (let i = 0; i < count; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const p = (t - i * stagger) / rise;
      if (p < 1) done = false;
      const e = p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p) * (1 - p);
      g.visible = p > 0;
      g.scale.y = Math.max(e, 0.0001);
    }
    if (done) settled.current = true;
    return done;
  }, [count, rise, stagger]);

  return { groups, show, step, settled };
}
