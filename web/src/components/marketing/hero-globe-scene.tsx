'use client';

import { Line } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// Geodetic palette — glowing indigo/blue arcs over the deep navy hero.
const ARC_COLORS = ['#4f7bff', '#6366f1', '#818cf8', '#60a5fa'];
const ARC_COUNT = 28;
const SEGMENTS = 180; // points per loop — high so the curves stay smooth
const RADIUS = 1.55;

/** A deterministic [0,1) pseudo-random sequence so the sphere looks identical on
 *  every render (no `Math.random`, which would also break SSR snapshots). */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Smooth, 2π-periodic pseudo-noise (sum of integer-frequency sines) → the loops
 *  close seamlessly while still wobbling organically. Range ≈ [-1, 1]. */
function wobble(t: number, seed: number) {
  return (
    Math.sin(t + seed) * 0.55 +
    Math.sin(t * 3 + seed * 2.3) * 0.3 +
    Math.sin(t * 5 + seed * 4.1) * 0.15
  );
}

interface Arc {
  color: string;
  opacity: number;
  points: [number, number, number][];
}

/** Builds `ARC_COUNT` great-circle-ish loops, each on a randomly-oriented plane
 *  through the origin, then perturbed with smooth noise (in-plane radius + an
 *  out-of-plane warble) so the sphere reads as organic rather than mechanical. */
function buildArcs(): Arc[] {
  const rng = makeRng(0x5e15);
  const arcs: Arc[] = [];
  for (let i = 0; i < ARC_COUNT; i++) {
    // A random unit normal → two orthonormal in-plane axes (u, v).
    const z = rng() * 2 - 1;
    const tt = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const normal = new THREE.Vector3(r * Math.cos(tt), r * Math.sin(tt), z);
    const seed = Math.abs(normal.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(normal, seed).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();

    // Per-loop noise character.
    const radialAmp = 0.05 + rng() * 0.06;
    const warpAmp = 0.06 + rng() * 0.07;
    const s1 = rng() * 6.28;
    const s2 = rng() * 6.28;

    const points: [number, number, number][] = [];
    for (let j = 0; j <= SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2;
      const rad = RADIUS * (1 + radialAmp * wobble(a, s1));
      const warp = RADIUS * warpAmp * wobble(a + 1.7, s2);
      const c = Math.cos(a) * rad;
      const d = Math.sin(a) * rad;
      points.push([
        u.x * c + v.x * d + normal.x * warp,
        u.y * c + v.y * d + normal.y * warp,
        u.z * c + v.z * d + normal.z * warp,
      ]);
    }
    arcs.push({
      color: ARC_COLORS[i % ARC_COLORS.length],
      opacity: 0.22 + rng() * 0.32,
      points,
    });
  }
  return arcs;
}

function Globe() {
  const group = useRef<THREE.Group>(null);
  const arcs = useMemo(() => buildArcs(), []);

  // Slow auto-rotation plus a very soft parallax that drifts toward the pointer.
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) {
      return;
    }
    g.rotation.y += delta * 0.08;
    // Frame-rate-independent damping with a long time constant (~0.8s) so the
    // tilt eases gently rather than tracking the cursor. Small amplitudes keep
    // the parallax subtle.
    const ease = 1 - Math.exp(-1.25 * delta);
    const targetX = 0.18 + state.pointer.y * 0.09;
    const targetZ = state.pointer.x * 0.05;
    g.rotation.x += (targetX - g.rotation.x) * ease;
    g.rotation.z += (targetZ - g.rotation.z) * ease;
  });

  return (
    <group ref={group} rotation={[0.18, 0, 0]}>
      {/* Faint inner shell for depth — barely visible, gives the arcs a body. */}
      <mesh>
        <sphereGeometry args={[RADIUS * 0.97, 48, 48]} />
        <meshBasicMaterial color="#0e1a40" transparent opacity={0.35} side={THREE.BackSide} />
      </mesh>
      {arcs.map((arc, i) => (
        <Line
          key={i}
          points={arc.points}
          color={arc.color}
          lineWidth={1.7}
          transparent
          opacity={arc.opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      ))}
    </group>
  );
}

export function HeroGlobeScene() {
  return (
    <Canvas
      camera={{ far: 100, fov: 42, near: 0.1, position: [0, 0, 4.4] }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
      style={{ height: '100%', width: '100%' }}
    >
      <Globe />
    </Canvas>
  );
}
