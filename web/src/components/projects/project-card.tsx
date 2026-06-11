'use client';

import { IconTrash } from '@tabler/icons-react';
import Link from 'next/link';

import { TypeToConfirmDialog } from '@/components/type-to-confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Project, UNIT_LABELS } from '@/lib/types';

export function ProjectCard({ onDelete, project }: { project: Project; onDelete: () => void }) {
  return (
    <Card className="group relative flex h-full flex-col">
      <CardHeader className="flex flex-1 flex-col">
        <CardTitle>
          <Link href={`/projects/${project.id}`} className="hover:underline">
            {project.name}
          </Link>
        </CardTitle>
        <CardDescription className="line-clamp-3 flex-1">
          {project.description || 'No description'}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          EPSG {project.epsgCode} · {UNIT_LABELS[project.displayUnit]}
        </span>
        <TypeToConfirmDialog
          title={`Delete ${project.name}?`}
          description={
            <>
              This <strong>permanently</strong> deletes the project and{' '}
              <strong>everything in it</strong> — survey points, control points, the grid, imported
              data, and all uploaded files (drawings, terrain). This action is{' '}
              <strong>irreversible</strong> and leaves no trace.
            </>
          }
          confirmPhrase={project.name}
          confirmLabel="Delete project"
          onConfirm={onDelete}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Delete project">
              <IconTrash className="size-4" />
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
