'use client';

import { IconPlus } from '@tabler/icons-react';
import { useState } from 'react';

import { UpgradeDialog } from '@/components/billing/upgrade-dialog';
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
import { isPaid, useBilling } from '@/lib/billing';
import { graphql } from '@/lib/gql';
import { gql, useMutation } from '@/lib/graphql';

const CREATE_PROJECT = graphql(`
  mutation CreateProject(
    $name: String!
    $desc: String
    $epsg: Int!
    $unit: LengthUnit!
    $scale: Float
    $lat: Float
    $lon: Float
    $rot: Float
  ) {
    createProject(
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

export function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [form, setForm] = useState(emptyProjectForm());
  const { busy, run } = useMutation();
  const { billing } = useBilling();

  // Solo is capped at one project; offer an upgrade instead of the create form.
  const atCap =
    !!billing &&
    !isPaid(billing) &&
    billing.maxProjects >= 0 &&
    billing.projects >= billing.maxProjects;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => gql(CREATE_PROJECT, projectFormVariables(form)), {
      error: 'Create failed',
      onDone: () => {
        setForm(emptyProjectForm());
        setOpen(false);
        onCreated();
      },
      success: 'Project created',
    });
  }

  if (atCap) {
    return (
      <>
        <Button onClick={() => setUpgradeOpen(true)}>
          <IconPlus className="mr-1 size-4" /> New project
        </Button>
        <UpgradeDialog
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          title="You've reached the Solo limit"
          description="The free Solo plan includes one project. Upgrade to Crew for unlimited projects."
        />
      </>
    );
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
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
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
