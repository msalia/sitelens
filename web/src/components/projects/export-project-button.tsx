'use client';

import { IconDownload } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { Project } from '@/lib/types';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { Button } from '@/components/ui/button';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const EXPORT_PROJECT = graphql(`
  query ProjectExport($id: UUID!) {
    projectExport(projectId: $id)
  }
`);

/** Slugify a project name into a safe filename stem. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

export function ExportProjectButton({ project }: { project: Project }) {
  const [busy, setBusy] = useState(false);

  async function exportProject() {
    setBusy(true);
    try {
      const data = await gql(EXPORT_PROJECT, { id: project.id });
      const blob = new Blob([data.projectExport], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slugify(project.name)}.slx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Project exported');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={`Export ${project.name}?`}
      description="Downloads a .slx archive with all of this project's data — settings, grid, control, transform, survey points, categories, point groups, and DXF overlays. Cached terrain and buildings are not included (they re-fetch after import)."
      confirmLabel={busy ? 'Exporting…' : 'Download archive'}
      confirmVariant="default"
      onConfirm={exportProject}
      trigger={
        <Button variant="outline" size="sm" disabled={busy}>
          <IconDownload className="mr-1 size-4" /> Export
        </Button>
      }
    />
  );
}
