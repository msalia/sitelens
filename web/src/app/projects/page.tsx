'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { Project } from '@/lib/types';

import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
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

export default function ProjectsPage() {
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

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string, name: string) {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await gql(DELETE_PROJECT, { id });
      toast.success('Project deleted');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm">Your organization&rsquo;s building sites.</p>
        </div>
        <CreateProjectDialog onCreated={load} />
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No projects yet. Create your first site to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onDelete={() => remove(p.id, p.name)} />
          ))}
        </div>
      )}
    </div>
  );
}
