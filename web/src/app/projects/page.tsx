'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { Project } from '@/lib/types';

import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ImportProjectCard } from '@/components/projects/import-project-card';
import { ProjectCard } from '@/components/projects/project-card';
import { Card, CardContent } from '@/components/ui/card';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const PROJECTS_QUERY = graphql(`
  query Projects {
    projects {
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
  }
`);
const DELETE_PROJECT = graphql(`
  mutation DeleteProject($id: UUID!) {
    deleteProject(id: $id)
  }
`);

function ProjectsContent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await gql(PROJECTS_QUERY);
      setProjects(data.projects);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetching server data on mount is a legitimate effect (synchronizing with an
  // external system), so the setState inside `load` is expected here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function remove(id: string) {
    try {
      await gql(DELETE_PROJECT, { id });
      toast.success('Project deleted');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const filtered = useMemo(() => {
    if (!query) {
      return projects;
    }
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) || (p.description ?? '').toLowerCase().includes(query),
    );
  }, [projects, query]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm">
            {query
              ? `Matching “${query}” · ${filtered.length} of ${projects.length}`
              : 'Your organization’s building sites.'}
          </p>
        </div>
        <CreateProjectDialog onCreated={load} />
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : query && filtered.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No projects match your search.
          </CardContent>
        </Card>
      ) : (
        // The import card lives in the grid alongside projects (and stands alone
        // as the empty state when there are none).
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} onDelete={() => remove(p.id)} />
          ))}
          <ImportProjectCard onImported={load} />
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsContent />
    </Suspense>
  );
}
