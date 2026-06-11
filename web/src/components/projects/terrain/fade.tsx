'use client';

import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/** Applies fade level `tv` (0..1) to a subtree: culls it (`visible = false`) once
 *  effectively invisible, otherwise lerps the opacity of every material under it,
 *  capturing each material's original opacity/transparency/depth-write on first
 *  touch. While fading it renders transparent with depth-write off (no self-
 *  overlap / double-side dark patches on solid geometry); fully visible it
 *  restores the original opaque rendering (so nothing looks washed-out at rest).
 *  Both the on-attach apply and the per-frame ramp call this, so visibility and
 *  opacity stay in lockstep from a single place. */
function applyFade(g: THREE.Object3D, tv: number) {
  g.visible = tv > 0.001;
  g.traverse((o) => {
    const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (!mat) {
      return;
    }
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const ud = m.userData;
      if (ud.baseOpacity === undefined) {
        ud.baseOpacity = m.opacity;
        ud.baseTransparent = m.transparent;
        ud.baseDepthWrite = m.depthWrite;
      }
      if (tv >= 0.999) {
        m.opacity = ud.baseOpacity as number;
        m.transparent = ud.baseTransparent as boolean;
        m.depthWrite = ud.baseDepthWrite as boolean;
      } else {
        m.transparent = true;
        m.depthWrite = false;
        m.opacity = (ud.baseOpacity as number) * tv;
      }
    }
  });
}

/** Smoothly fades a 3D subtree in/out by lerping the opacity of every material
 *  it contains. Once fully hidden it either **unmounts** the subtree (default —
 *  a toggled-off layer then costs nothing: no draw calls, raycasts, or geometry)
 *  or, with `cull`, keeps it mounted but `visible = false` (zero draw/raycast,
 *  geometry stays resident). Use `cull` for one heavy mesh you re-toggle often
 *  (e.g. terrain): it avoids the remount shader-recompile hitch on fade-in. The
 *  per-frame work early-returns once settled. */
export function Fade({
  children,
  cull = false,
  speed = 9,
  visible,
}: {
  visible: boolean;
  children: React.ReactNode;
  /** Keep mounted (cull via `visible=false`) instead of unmounting when hidden. */
  cull?: boolean;
  speed?: number;
}) {
  const [mounted, setMounted] = useState(visible);
  const group = useRef<THREE.Group | null>(null);
  const t = useRef(visible ? 1 : 0);

  // Mount immediately when becoming visible (render-phase adjust — no effect).
  if (visible && !mounted) {
    setMounted(true);
  }

  // Apply the current fade level the instant the group attaches (ref callbacks
  // run during commit, before paint) — so a re-shown layer's first painted frame
  // is already at the right (near-zero) opacity instead of flashing full, which
  // is what caused the fade-in "chop".
  const setGroup = useCallback((g: THREE.Group | null) => {
    group.current = g;
    if (g) {
      applyFade(g, t.current);
    }
  }, []);

  useFrame((_, dt) => {
    const target = visible ? 1 : 0;
    if (t.current === target || !group.current) {
      return;
    }
    t.current += (target - t.current) * (1 - Math.exp(-dt * speed));
    if (Math.abs(target - t.current) < 0.004) {
      t.current = target;
    }
    // applyFade re-shows the subtree (visible=true) as soon as tv climbs, and
    // culls it (visible=false) once tv hits ~0 — so cull mode needs no extra work.
    applyFade(group.current, t.current);
    if (target === 0 && t.current === 0 && !cull) {
      // Not culling → unmount so the hidden layer costs nothing at all.
      setMounted(false);
    }
  });

  if (!mounted) {
    return null;
  }
  return <group ref={setGroup}>{children}</group>;
}

/** DOM counterpart to {@link Fade}: fades an HTML overlay in/out with the same
 *  animate-in/out idiom the markers use, then **unmounts** it once hidden. The
 *  lone effect is a legitimate deferred-unmount timer (not derived state). Use
 *  inside a drei `<Html>` for labels/badges that should fade with their layer. */
export function FadeHtml({
  children,
  className,
  durationMs = 250,
  visible,
}: {
  visible: boolean;
  children: React.ReactNode;
  className?: string;
  durationMs?: number;
}) {
  const [mounted, setMounted] = useState(visible);
  // Mount immediately when shown (render-phase adjust — no effect needed).
  if (visible && !mounted) {
    setMounted(true);
  }
  // Keep the node for one fade-out, then drop it so hidden overlays cost nothing.
  useEffect(() => {
    if (visible) {
      return;
    }
    const t = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(t);
  }, [visible, durationMs]);

  if (!mounted) {
    return null;
  }
  return (
    <div
      className={`fill-mode-forwards ${visible ? 'animate-in fade-in' : 'animate-out fade-out'} ${className ?? ''}`}
      style={{ animationDuration: `${durationMs}ms` }}
    >
      {children}
    </div>
  );
}
