'use client';

import { IconArrowLeft } from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ControlPointsEditor } from '@/components/projects/control-points-editor';
import { EditProjectDialog } from '@/components/projects/edit-project-dialog';
import { GridEditor } from '@/components/projects/grid-editor';
import { SceneView } from '@/components/projects/scene-view';
import { SurveyPointsPanel } from '@/components/projects/survey-points-panel';
import { TransformPanel } from '@/components/projects/transform-panel';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import {
  type ControlPoint,
  type GridAxis,
  type PointCategory,
  type Project,
  type Transform,
  UNIT_LABELS,
} from '@/lib/types';

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
  }
`);

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [axes, setAxes] = useState<GridAxis[]>([]);
  const [points, setPoints] = useState<ControlPoint[]>([]);
  const [transform, setTransform] = useState<Transform | null>(null);
  const [categories, setCategories] = useState<PointCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await gql(WORKSPACE_QUERY, { id });
      setProject(data.project);
      setAxes(data.gridAxes);
      setPoints(data.controlPoints);
      setTransform(data.transform);
      setCategories(data.categories);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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
    <div className="mx-auto max-w-5xl p-6">
      <Link
        href="/projects"
        className="text-muted-foreground mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <IconArrowLeft className="size-4" /> Projects
      </Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <p className="text-muted-foreground text-sm">
            EPSG {project.epsgCode} · units {UNIT_LABELS[project.displayUnit]} · scale{' '}
            {project.combinedScaleFactor}
          </p>
          {project.description && (
            <p className="text-muted-foreground mt-1 text-sm">{project.description}</p>
          )}
        </div>
        <EditProjectDialog project={project} onSaved={load} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GridEditor project={project} axes={axes} onSaved={load} />
        <ControlPointsEditor project={project} points={points} onChanged={load} />
        <TransformPanel project={project} initialTransform={transform} />
        <SurveyPointsPanel project={project} categories={categories} onCategoriesChanged={load} />
        <SceneView project={project} categories={categories} />
      </div>
    </div>
  );
}
