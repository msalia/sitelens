'use client';

import { IconPencil } from '@tabler/icons-react';
import { useState } from 'react';

import type { Project } from '@/lib/types';

import {
  ProjectFormFields,
  projectFormVariables,
  projectToForm,
} from '@/components/projects/project-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { graphql } from '@/lib/gql';
import { gql, useMutation } from '@/lib/graphql';

const UPDATE_PROJECT = graphql(`
  mutation UpdateProject(
    $id: UUID!
    $name: String
    $desc: String
    $epsg: Int
    $unit: LengthUnit
    $scale: Float
    $lat: Float
    $lon: Float
    $rot: Float
  ) {
    updateProject(
      id: $id
      name: $name
      description: $desc
      epsgCode: $epsg
      displayUnit: $unit
      combinedScaleFactor: $scale
      siteOriginLat: $lat
      siteOriginLon: $lon
      siteOriginRotationDeg: $rot
    ) {
      id
    }
  }
`);

export function EditProjectDialog({ onSaved, project }: { project: Project; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => projectToForm(project));
  const { busy, run } = useMutation();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => gql(UPDATE_PROJECT, { id: project.id, ...projectFormVariables(form) }), {
      error: 'Update failed',
      onDone: () => {
        setOpen(false);
        onSaved();
      },
      success: 'Project updated',
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setForm(projectToForm(project));
        }
        setOpen(o);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <IconPencil className="mr-1 size-4" /> Edit project
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Update the site and its coordinate reference.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <ProjectFormFields
            idPrefix="ep"
            values={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
