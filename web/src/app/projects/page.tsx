'use client';

import { IconPlus, IconTrash } from '@tabler/icons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { gql } from '@/lib/graphql';
import { type LengthUnit, type Project, UNIT_LABELS, UNIT_OPTIONS } from '@/lib/types';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await gql<{ projects: Project[] }>(
        `{ projects { id name description epsgCode displayUnit combinedScaleFactor createdAt } }`,
      );
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
      await gql('mutation ($id: UUID!) { deleteProject(id: $id) }', { id });
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button>
                <IconPlus className="mr-1 size-4" /> New project
              </Button>
            }
          />
          <CreateProjectDialog
            onCreated={() => {
              setOpen(false);
              void load();
            }}
          />
        </Dialog>
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
            <Card key={p.id} className="group relative">
              <CardHeader>
                <CardTitle>
                  <Link href={`/projects/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </CardTitle>
                <CardDescription>{p.description || 'No description'}</CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground flex items-center justify-between text-xs">
                <span>
                  EPSG {p.epsgCode} · {UNIT_LABELS[p.displayUnit as LengthUnit]}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete project"
                  onClick={() => remove(p.id, p.name)}
                >
                  <IconTrash className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [epsgCode, setEpsgCode] = useState('2229');
  const [displayUnit, setDisplayUnit] = useState<LengthUnit>('US_SURVEY_FOOT');
  const [scale, setScale] = useState('1.0');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gql(
        `mutation ($name: String!, $desc: String, $epsg: Int!, $unit: LengthUnit!, $scale: Float, $lat: Float, $lon: Float) {
          createProject(name: $name, description: $desc, epsgCode: $epsg, displayUnit: $unit,
            combinedScaleFactor: $scale, siteOriginLat: $lat, siteOriginLon: $lon) { id }
        }`,
        {
          desc: description || null,
          epsg: parseInt(epsgCode, 10),
          lat: lat ? parseFloat(lat) : null,
          lon: lon ? parseFloat(lon) : null,
          name,
          scale: scale ? parseFloat(scale) : null,
          unit: displayUnit,
        },
      );
      toast.success('Project created');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>Define the site and its coordinate reference.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="desc">Description</Label>
          <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="epsg">EPSG code</Label>
            <Input
              id="epsg"
              type="number"
              value={epsgCode}
              onChange={(e) => setEpsgCode(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="unit">Display unit</Label>
            <NativeSelect
              id="unit"
              className="w-full"
              value={displayUnit}
              onChange={(e) => setDisplayUnit(e.target.value as LengthUnit)}
            >
              {UNIT_OPTIONS.map((u) => (
                <NativeSelectOption key={u.value} value={u.value}>
                  {u.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="scale">Scale factor</Label>
            <Input id="scale" value={scale} onChange={(e) => setScale(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lat">Site lat</Label>
            <Input
              id="lat"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="opt."
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lon">Site lon</Label>
            <Input
              id="lon"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="opt."
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
