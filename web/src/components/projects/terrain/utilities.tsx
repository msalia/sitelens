'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

import type { SceneUtilityRun, SceneUtilityStructure } from '@/lib/types';

import { type Frame, toLocal } from '../terrain-frame';

/** What a 3D pick reports back to the panel. */
export interface UtilityPick {
  id: string;
  kind: 'run' | 'structure';
  label: string;
  typeKey: string;
}

const MIN_RADIUS = 0.15; // runs with no/tiny diameter still need to be visible (m)
const STRUCT_RADIUS = 0.5; // node solids (m)
const STRUCT_HEIGHT = 2.0;

/** A single run as a diameter-sized tube in its APWA colour. Coordinates use the
 *  vertices' absolute Z (invert elevation) — so buried runs sit below grade and
 *  the underground mode reveals them. */
function RunTube({
  frame,
  onSelect,
  run,
}: {
  run: SceneUtilityRun;
  frame: Frame;
  onSelect?: (p: UtilityPick) => void;
}) {
  const curve = useMemo(() => {
    const pts = run.vertices.map(
      (v) => new THREE.Vector3(...toLocal(frame, v.latitude, v.longitude, v.height)),
    );
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  }, [run.vertices, frame]);
  const radius = Math.max((run.diameter ?? 0) / 2, MIN_RADIUS);
  const segments = Math.max(run.vertices.length * 8, 16);
  return (
    <mesh
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.({ id: run.id, kind: 'run', label: run.label, typeKey: run.typeKey });
      }}
    >
      <tubeGeometry args={[curve, segments, radius, 8, false]} />
      <meshStandardMaterial color={run.apwaColor} roughness={0.7} />
    </mesh>
  );
}

/** A node structure as a vertical cylinder centred on its position. */
function StructureSolid({
  frame,
  onSelect,
  structure,
}: {
  structure: SceneUtilityStructure;
  frame: Frame;
  onSelect?: (p: UtilityPick) => void;
}) {
  const pos = toLocal(frame, structure.latitude, structure.longitude, structure.rimElev ?? 0);
  return (
    <mesh
      position={pos}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.({
          id: structure.id,
          kind: 'structure',
          label: structure.label,
          typeKey: structure.typeKey,
        });
      }}
    >
      <cylinderGeometry args={[STRUCT_RADIUS, STRUCT_RADIUS, STRUCT_HEIGHT, 16]} />
      <meshStandardMaterial color={structure.apwaColor} roughness={0.6} />
    </mesh>
  );
}

/** The buried utility network: diameter-sized tubes for runs, solids for
 *  structures, APWA-coloured. `visibleTypes` filters by type key (null = all). */
export function Utilities({
  frame,
  onSelect,
  runs,
  structures,
  visibleTypes,
}: {
  runs: SceneUtilityRun[];
  structures: SceneUtilityStructure[];
  frame: Frame;
  visibleTypes: Set<string> | null;
  onSelect?: (p: UtilityPick) => void;
}) {
  const showType = (t: string) => !visibleTypes || visibleTypes.has(t);
  return (
    <group>
      {runs.filter((r) => showType(r.typeKey)).map((r) => (
        <RunTube key={r.id} run={r} frame={frame} onSelect={onSelect} />
      ))}
      {structures.filter((s) => showType(s.typeKey)).map((s) => (
        <StructureSolid key={s.id} structure={s} frame={frame} onSelect={onSelect} />
      ))}
    </group>
  );
}
