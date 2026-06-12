'use client';

import { IconDownload } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { Project } from '@/lib/types';

import { UpgradeDialog } from '@/components/billing/upgrade-dialog';
import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBilling } from '@/lib/billing';
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
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { billing, loading } = useBilling();
  // Default to gated until billing confirms the org can export, so a free org
  // never momentarily sees the real export flow while billing is still loading.
  const gated = !billing?.canExport;

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
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Export project"
              // Block interaction until billing resolves so the click always
              // routes to the correct dialog (upgrade vs. export).
              disabled={busy || loading}
              onClick={() => (gated ? setUpgradeOpen(true) : setOpen(true))}
            >
              <IconDownload className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Export project</TooltipContent>
      </Tooltip>
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title="Exporting is a Crew feature"
        description="Upgrade to Crew to download a full project archive."
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Export ${project.name}?`}
        description="Downloads a .slx archive with all of this project's data — settings, grid, control, transform, survey points, categories, point groups, and DXF overlays. Cached terrain and buildings are not included (they re-fetch after import)."
        confirmLabel={busy ? 'Exporting…' : 'Download archive'}
        confirmVariant="default"
        onConfirm={exportProject}
      />
    </>
  );
}
