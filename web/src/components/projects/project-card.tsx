'use client';

import { IconTrash } from '@tabler/icons-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Project, UNIT_LABELS } from '@/lib/types';

export function ProjectCard({ onDelete, project }: { project: Project; onDelete: () => void }) {
  return (
    <Card className="group relative">
      <CardHeader>
        <CardTitle>
          <Link href={`/projects/${project.id}`} className="hover:underline">
            {project.name}
          </Link>
        </CardTitle>
        <CardDescription>{project.description || 'No description'}</CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          EPSG {project.epsgCode} · {UNIT_LABELS[project.displayUnit]}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Delete project" onClick={onDelete}>
          <IconTrash className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
