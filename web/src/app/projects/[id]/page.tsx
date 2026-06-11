'use client';

import { IconArrowLeft, IconFolderQuestion } from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { CadOverlayPanel } from '@/components/projects/cad-overlay-panel';
import { ControlPointsEditor } from '@/components/projects/control-points-editor';
import { ConverterPanel } from '@/components/projects/converter-panel';
import { EditProjectDialog } from '@/components/projects/edit-project-dialog';
import { ExportProjectButton } from '@/components/projects/export-project-button';
import { GridEditor } from '@/components/projects/grid-editor';
import { SceneView } from '@/components/projects/scene-view';
import { SetupChecklist } from '@/components/projects/setup-checklist';
import { SurveyPointsPanel } from '@/components/projects/survey-points-panel';
import { TransformPanel } from '@/components/projects/transform-panel';
import { buttonVariants } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import {
  type CadOverlay,
  type ControlPoint,
  type GridAxis,
  type PointCategory,
  type Project,
  type SurveyPoint,
  type Transform,
  UNIT_LABELS,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const WORKSPACE_QUERY = graphql(`
  query Workspace($id: UUID!) {
    project(id: $id) {
      id
      orgId
      name
      description
      epsgCode
      displayUnit
      combinedScaleFactor
      siteOriginLat
      siteOriginLon
      siteOriginRotationDeg
      createdAt
      updatedAt
    }
    gridAxes(projectId: $id) {
      id
      projectId
      family
      label
      position
    }
    controlPoints(projectId: $id) {
      id
      projectId
      label
      northing
      easting
      elevation
      gridX
      gridY
      source
    }
    transform(projectId: $id) {
      translationE
      translationN
      rotationDegrees
      scale
      rmsError
      pointCount
      residuals {
        label
        deltaEasting
        deltaNorthing
        magnitude
      }
    }
    categories {
      id
      orgId
      name
      color
      icon
      isDefault
    }
    cadOverlays(projectId: $id) {
      id
      projectId
      originalFilename
      offsetE
      offsetN
      rotationDeg
      scale
      elevation
      assumeRealWorld
      visible
    }
    surveyPointCount(projectId: $id)
  }
`);

type Tab = 'setup' | 'control' | 'points' | 'overlays';

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [axes, setAxes] = useState<GridAxis[]>([]);
  const [points, setPoints] = useState<ControlPoint[]>([]);
  const [transform, setTransform] = useState<Transform | null>(null);
  const [categories, setCategories] = useState<PointCategory[]>([]);
  const [overlays, setOverlays] = useState<CadOverlay[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [sceneReload, setSceneReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('setup');
  // On the very first load, land on Points when the site is already set up
  // (transform solved), otherwise Setup. Doesn't override later manual switches.
  const initialTabPicked = useRef(false);

  // Fly the persistent 3D hero to a point picked from the table.
  const locate = useCallback((p: SurveyPoint) => {
    setFocus({ id: p.id, nonce: performance.now() });
  }, []);

  // Checklist navigation: some steps live in other tabs; the rest scroll.
  const navigateTo = useCallback((target: string) => {
    // Control, grid, and transform now share one tab.
    if (target === 'panel-grid' || target === 'panel-transform' || target === 'panel-control') {
      setTab('control');
      // Let the tab mount, then scroll the requested card into view.
      setTimeout(() => {
        document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
      return;
    }
    if (target === 'panel-points') {
      setTab('points');
      return;
    }
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await gql(WORKSPACE_QUERY, { id });
      setProject(data.project);
      setAxes(data.gridAxes);
      setPoints(data.controlPoints);
      setTransform(data.transform);
      setCategories(data.categories);
      setOverlays(data.cadOverlays);
      setPointCount(data.surveyPointCount);
      if (!initialTabPicked.current) {
        initialTabPicked.current = true;
        setTab(data.transform ? 'points' : 'setup');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Fetching the project on mount/id-change is a legitimate data-loading effect;
  // the setState inside `load` runs after the await, which is expected.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const tiedControlPoints = useMemo(
    () => points.filter((p) => p.gridX !== null && p.gridY !== null).length,
    [points],
  );

  if (loading) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }
  if (!project) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFolderQuestion />
          </EmptyMedia>
          <EmptyTitle>Project not found</EmptyTitle>
          <EmptyDescription>
            This project doesn’t exist or you don’t have access to it — it may have been deleted.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/projects" className={buttonVariants({ variant: 'outline' })}>
            <IconArrowLeft className="mr-1 size-4" /> Back to projects
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Detail panel */}
      <aside className="flex w-[440px] shrink-0 flex-col border-r">
        <header className="border-b px-4 py-3">
          <Link
            href="/projects"
            className="text-muted-foreground mb-2 inline-flex items-center gap-1 text-xs hover:underline"
          >
            <IconArrowLeft className="size-3.5" /> Projects
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight">{project.name}</h1>
              <p className="text-muted-foreground text-xs">
                EPSG {project.epsgCode} · {UNIT_LABELS[project.displayUnit]} · scale{' '}
                {project.combinedScaleFactor}
              </p>
            </div>
            <ButtonGroup>
              <EditProjectDialog project={project} onSaved={load} />
              <ExportProjectButton project={project} />
            </ButtonGroup>
          </div>
        </header>

        <div className="flex gap-1 border-b px-3 py-2">
          {(
            [
              ['setup', 'Setup'],
              ['control', 'Grid'],
              ['points', 'Points'],
              ['overlays', 'Overlays'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 text-center text-sm font-medium transition-colors',
                tab === key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* `[&>*]:shrink-0` keeps cards at natural height (flex children would
            otherwise shrink and clip their overflow-hidden content). */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 [&>*]:shrink-0">
          {tab === 'setup' && (
            <SetupChecklist
              axesCount={axes.length}
              controlPointsWithGrid={tiedControlPoints}
              transformSolved={transform !== null}
              pointCount={pointCount}
              onNavigate={navigateTo}
            />
          )}
          {tab === 'control' && (
            <>
              <section id="panel-control">
                <ControlPointsEditor project={project} points={points} onChanged={load} />
              </section>
              <section id="panel-grid">
                <GridEditor project={project} axes={axes} onSaved={load} />
              </section>
              <section id="panel-transform">
                <TransformPanel project={project} initialTransform={transform} />
              </section>
            </>
          )}
          {tab === 'points' && (
            <>
              <section id="panel-points">
                <SurveyPointsPanel
                  project={project}
                  categories={categories}
                  onCategoriesChanged={load}
                  onLocate={locate}
                />
              </section>
              <section id="panel-convert">
                <ConverterPanel project={project} />
              </section>
            </>
          )}
          {tab === 'overlays' && (
            <section id="panel-overlays">
              <CadOverlayPanel
                project={project}
                overlays={overlays}
                onChanged={() => {
                  void load();
                  setSceneReload((n) => n + 1);
                }}
              />
            </section>
          )}
        </div>
      </aside>

      {/* Hero — persistent, full-bleed 3D scene. Stats render as an overlay
          inside the viewer (bottom-left), so the scene fills the whole pane. */}
      <section id="panel-scene" className="min-h-0 min-w-0 flex-1">
        <SceneView
          project={project}
          categories={categories}
          focus={focus}
          reloadNonce={sceneReload}
          stats={[
            { label: 'Control', value: points.length },
            { label: 'Points', value: pointCount },
            transform
              ? { label: 'RMS', value: transform.rmsError.toFixed(3) }
              : { label: 'Tie', value: 'Not tied' },
          ]}
        />
      </section>
    </div>
  );
}
