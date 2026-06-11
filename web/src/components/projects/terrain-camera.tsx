'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { type Frame, toLocal } from './terrain-frame';
import { type CameraView, type FocusTarget } from './terrain-shared';

// Idle "attract" orbit: after IDLE_DELAY seconds without interaction the camera
// continuously rotates around the target, very slowly (radians/second).
const IDLE_DELAY = 10;
const ORBIT_SPEED = 0.04; // ~2.6 min per full revolution
/** Exposes a PNG snapshot via captureRef, reading the WebGL canvas back. */
export function SnapshotBridge({
  captureRef,
}: {
  captureRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!captureRef) {
      return;
    }
    captureRef.current = () => {
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sitelens-scene.png';
      a.click();
    };
    return () => {
      captureRef.current = null;
    };
  }, [captureRef, gl, scene, camera]);
  return null;
}

/** Pauses the render loop — and with it the idle orbit and every per-frame lerp —
 *  while the tab is hidden or the window is unfocused, so an idle-but-open scene
 *  doesn't render at full rate in the background. Switches R3F to `demand` when
 *  inactive (nothing renders until something invalidates) and back to `always`
 *  when the view is being looked at again. */
export function RenderGate() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const sync = () => {
      const active = document.visibilityState === 'visible' && document.hasFocus();
      setFrameloop(active ? 'always' : 'demand');
      if (active) {
        invalidate(); // repaint immediately on return
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      setFrameloop('always');
    };
  }, [setFrameloop, invalidate]);
  return null;
}

/** Camera position + target for a given preset, relative to the scene bounds. */
export function presetFor(
  view: CameraView,
  center: [number, number, number],
  ext: number,
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const [cx, cy, cz] = center;
  const target = new THREE.Vector3(cx, cy, cz);
  const d = ext * 1.7;
  const pos = {
    back: new THREE.Vector3(cx, cy + d * 0.45, cz - d),
    front: new THREE.Vector3(cx, cy + d * 0.45, cz + d),
    iso: new THREE.Vector3(cx + d * 0.7, cy + d * 0.75, cz + d * 0.7),
    left: new THREE.Vector3(cx - d, cy + d * 0.45, cz),
    right: new THREE.Vector3(cx + d, cy + d * 0.45, cz),
    top: new THREE.Vector3(cx, cy + d * 1.15, cz + 0.001),
  }[view];
  return { pos, target };
}

/** Drives the camera to presets / focused points, with a smooth glide. */
export function CameraRig({
  cx,
  cy,
  cz,
  ext,
  focus,
  frame,
  view,
  viewNonce,
}: {
  cx: number;
  cy: number;
  cz: number;
  ext: number;
  view: CameraView;
  viewNonce: number;
  focus?: FocusTarget;
  frame: Frame;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3;
    update: () => void;
    addEventListener: (type: string, cb: () => void) => void;
    removeEventListener: (type: string, cb: () => void) => void;
  } | null;
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const ready = useRef(false);
  // Idle "attract" orbit state.
  const interacting = useRef(false);
  const idleFor = useRef(0); // seconds since the last interaction / re-aim
  const reduceMotion = useRef(false);

  // Latest bounds, kept current without letting them re-aim the camera.
  const bounds = useRef({ cx, cy, cz, ext });
  useEffect(() => {
    bounds.current = { cx, cy, cz, ext };
  }, [cx, cy, cz, ext]);

  // Frame once, when the scene bounds first become valid. Later changes to the
  // bounds (points added/removed via live updates, terrain load, projection
  // toggle) do NOT re-aim — the view holds steady while data streams in.
  const framedOnce = useRef(false);
  useEffect(() => {
    if (framedOnce.current || ext <= 0) {
      return;
    }
    framedOnce.current = true;
    goal.current = presetFor(view, [cx, cy, cz], ext);
    idleFor.current = 0;
  }, [cx, cy, cz, ext, view]);

  // Re-aim only on explicit intent — a preset selection or a reset (viewNonce
  // bump) — using the bounds as they stand now.
  const firstIntent = useRef(true);
  useEffect(() => {
    if (firstIntent.current) {
      firstIntent.current = false;
      return;
    }
    const b = bounds.current;
    goal.current = presetFor(view, [b.cx, b.cy, b.cz], b.ext);
    idleFor.current = 0;
  }, [view, viewNonce]);

  useEffect(() => {
    if (!focus) {
      return;
    }
    const [x, y, z] = toLocal(frame, focus.lat, focus.lon, focus.height);
    const d = Math.max(ext * 0.35, 30);
    goal.current = {
      pos: new THREE.Vector3(x + d, y + d, z + d),
      target: new THREE.Vector3(x, y, z),
    };
    idleFor.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // Pause the idle orbit while the user is driving the camera; resume after a beat.
  useEffect(() => {
    reduceMotion.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!controls) {
      return;
    }
    const onStart = () => {
      interacting.current = true;
      idleFor.current = 0;
      // Abandon any in-progress glide so the user's input takes over immediately.
      goal.current = null;
    };
    const onEnd = () => {
      interacting.current = false;
      idleFor.current = 0;
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
    };
  }, [controls]);

  useFrame((_, delta) => {
    if (!controls) {
      return;
    }
    const g = goal.current;
    if (g) {
      // First framing snaps into place; every later change glides smoothly.
      if (!ready.current) {
        camera.position.copy(g.pos);
        controls.target.copy(g.target);
        ready.current = true;
        goal.current = null;
      } else {
        // Frame-rate-independent exponential ease — a low rate makes a slow,
        // smooth glide (~1.5s) regardless of display refresh.
        const k = 1 - Math.exp(-delta * 1.8);
        camera.position.lerp(g.pos, k);
        controls.target.lerp(g.target, k);
        if (camera.position.distanceTo(g.pos) < Math.max(ext * 0.004, 0.25)) {
          goal.current = null;
        }
      }
      controls.update();
    } else if (!interacting.current && !reduceMotion.current) {
      // Inactive state: after a short idle delay, slowly orbit around the target.
      idleFor.current += delta;
      if (idleFor.current >= IDLE_DELAY) {
        const dAngle = ORBIT_SPEED * delta;
        const { target } = controls;
        const px = camera.position.x - target.x;
        const pz = camera.position.z - target.z;
        const cos = Math.cos(dAngle);
        const sin = Math.sin(dAngle);
        camera.position.set(
          target.x + px * cos - pz * sin,
          camera.position.y,
          target.z + px * sin + pz * cos,
        );
        controls.update();
      }
    }
  });
  return null;
}
