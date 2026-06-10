'use client';

import { IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  emptyProjectForm,
  ProjectFormFields,
  projectFormVariables,
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
import { gql } from '@/lib/graphql';

const CREATE_PROJECT = graphql(`
  mutation CreateProject(
    $name: String!
    $desc: String
    $epsg: Int!
    $unit: LengthUnit!
    $scale: Float
    $lat: Float
    $lon: Float
  ) {
    createProject(
      name: $name
      description: $desc
      epsgCode: $epsg
      displayUnit: $unit
      combinedScaleFactor: $scale
      siteOriginLat: $lat
      siteOriginLon: $lon
    ) {
      id
    }
  }
`);

export function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyProjectForm());
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gql(CREATE_PROJECT, projectFormVariables(form));
      toast.success('Project created');
      setForm(emptyProjectForm());
      setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <IconPlus className="mr-1 size-4" /> New project
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Define the site and its coordinate reference.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <ProjectFormFields
            idPrefix="cp"
            values={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
