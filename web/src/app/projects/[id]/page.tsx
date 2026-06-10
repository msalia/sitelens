'use client';

import {
  IconArrowLeft,
  IconCircleCheck,
  IconMapPin,
  IconPoint,
  IconRoute,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ControlPointsEditor } from '@/components/projects/control-points-editor';
import { ConverterPanel } from '@/components/projects/converter-panel';
import { EditProjectDialog } from '@/components/projects/edit-project-dialog';
import { GridEditor } from '@/components/projects/grid-editor';
import { SceneView } from '@/components/projects/scene-view';
import { SetupChecklist } from '@/components/projects/setup-checklist';
import { SurveyPointsPanel } from '@/components/projects/survey-points-panel';
import { TransformPanel } from '@/components/projects/transform-panel';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import {
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
    surveyPointCount(projectId: $id)
  }
`);

type Tab = 'setup' | 'control' | 'grid' | 'points' | 'convert';

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [axes, setAxes] = useState<GridAxis[]>([]);
  const [points, setPoints] = useState<ControlPoint[]>([]);
  const [transform, setTransform] = useState<Transform | null>(null);
  const [categories, setCategories] = useState<PointCategory[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('setup');

  // Fly the persistent 3D hero to a point picked from the table.
  const locate = useCallback((p: SurveyPoint) => {
    setFocus({ id: p.id, nonce: performance.now() });
  }, []);

  // Checklist navigation: some steps live in other tabs; the rest scroll.
  const navigateTo = useCallback((target: string) => {
    if (target === 'panel-grid' || target === 'panel-transform') {
      setTab('grid');
      return;
    }
    if (target === 'panel-control') {
      setTab('control');
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
      setPointCount(data.surveyPointCount);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
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
      <div className="p-6">
        <p className="text-sm">Project not found.</p>
        <Link href="/projects" className="text-sm underline">
          Back to projects
        </Link>
      </div>
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
            <EditProjectDialog project={project} onSaved={load} />
          </div>
        </header>

        <div className="flex gap-1 border-b px-3 py-2">
          {(
            [
              ['setup', 'Setup'],
              ['control', 'Control'],
              ['grid', 'Grid'],
              ['points', 'Points'],
              ['convert', 'Converter'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
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
            <section id="panel-control">
              <ControlPointsEditor project={project} points={points} onChanged={load} />
            </section>
          )}
          {tab === 'grid' && (
            <>
              <section id="panel-grid">
                <GridEditor project={project} axes={axes} onSaved={load} />
              </section>
              <section id="panel-transform">
                <TransformPanel project={project} initialTransform={transform} />
              </section>
            </>
          )}
          {tab === 'points' && (
            <section id="panel-points">
              <SurveyPointsPanel
                project={project}
                categories={categories}
                onCategoriesChanged={load}
                onLocate={locate}
              />
            </section>
          )}
          {tab === 'convert' && <ConverterPanel project={project} />}
        </div>
      </aside>

      {/* Hero — persistent 3D scene + live stat pills */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-end gap-2 px-4 pt-4">
          <StatPill
            icon={<IconMapPin className="size-3.5" />}
            label="Control"
            value={points.length}
          />
          <StatPill icon={<IconPoint className="size-3.5" />} label="Points" value={pointCount} />
          <StatPill
            icon={
              transform ? (
                <IconCircleCheck className="size-3.5 text-emerald-500" />
              ) : (
                <IconRoute className="size-3.5" />
              )
            }
            label={transform ? 'RMS' : 'Tie'}
            value={transform ? transform.rmsError.toFixed(3) : 'Not tied'}
          />
        </div>
        <section id="panel-scene" className="flex min-h-0 flex-1 flex-col p-4">
          <SceneView project={project} categories={categories} focus={focus} />
        </section>
      </div>
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="bg-card flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm shadow-sm">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
