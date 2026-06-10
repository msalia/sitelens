'use client';

import { IconTrash } from '@tabler/icons-react';
import Link from 'next/link';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
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
        <CardDescription className="flex-1">
          {project.description || 'No description'}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          EPSG {project.epsgCode} · {UNIT_LABELS[project.displayUnit]}
        </span>
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          description="The project and all its data will be permanently deleted. This can’t be undone."
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
