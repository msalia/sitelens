'use client';

import { IconCube } from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { InspectablePoint, PointCategory, Project, SceneData } from '@/lib/types';

import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { gql } from '@/lib/graphql';

// Cesium is heavy and browser-only; load it lazily and never on the server.
const CesiumViewer = dynamic(
  () => import('@/components/projects/cesium-viewer').then((m) => m.CesiumViewer),
  {
    loading: () => <p className="text-muted-foreground p-6 text-sm">Loading 3D engine…</p>,
    ssr: false,
  },
);

const SCENE_QUERY = `
  query ($id: UUID!) {
    sceneData(projectId: $id) {
      origin { latitude longitude height }
      controlPoints { id label latitude longitude height easting northing categoryId }
      surveyPoints { id label latitude longitude height easting northing categoryId }
      gridLines { label coordinates { latitude longitude height } }
    }
  }`;

export function SceneView({
  categories,
  project,
}: {
  project: Project;
  categories: PointCategory[];
}) {
  const [scene, setScene] = useState<SceneData | null>(null);
  const [shown, setShown] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<InspectablePoint | null>(null);

  const visibleCategoryIds = useMemo(
    () => new Set(categories.filter((c) => !hidden.has(c.id)).map((c) => c.id)),
    [categories, hidden],
  );

  const load = useCallback(async () => {
    try {
      const data = await gql<{ sceneData: SceneData }>(SCENE_QUERY, { id: project.id });
      setScene(data.sceneData);
      setShown(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load scene');
    }
  }, [project.id]);

  const onSelectPoint = useCallback(
    (id: string) => {
      const p = scene?.surveyPoints.find((s) => s.id === id);
      if (p) {
        setInspecting({ easting: p.easting, label: p.label, northing: p.northing });
      }
    },
    [scene],
  );

  function toggleCategory(id: string) {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>3D view</CardTitle>
        <Button size="sm" variant="outline" onClick={load}>
          <IconCube className="mr-1 size-4" />
          {shown ? 'Reload scene' : 'Show 3D view'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!shown || !scene ? (
          <p className="text-muted-foreground text-sm">
            Load the 3D scene to view control points, surveyed points, and grid lines over terrain.
            Terrain is a backdrop — imported elevations are the source of truth.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => {
                const on = !hidden.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCategory(c.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-opacity ${
                      on ? '' : 'opacity-40'
                    }`}
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </button>
                );
              })}
            </div>
            <CesiumViewer
              scene={scene}
              categories={categories}
              visibleCategoryIds={visibleCategoryIds}
              onSelectPoint={onSelectPoint}
            />
          </>
        )}
      </CardContent>

      <CoordinateInspectorDialog
        project={project}
        point={inspecting}
        onClose={() => setInspecting(null)}
      />
    </Card>
  );
}
