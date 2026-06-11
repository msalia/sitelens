'use client';

import { type ReactElement, useState } from 'react';
import { toast } from 'sonner';

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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { type PointCategory, type Project } from '@/lib/types';
import { unitName } from '@/lib/units';

import { OptionalBadge } from './field-extras';

const NONE = '__none__';

type InputSpace = 'GEOGRAPHIC' | 'GRID' | 'PROJECTED';

const ADD_SURVEY_POINT = graphql(`
  mutation AddSurveyPoint(
    $projectId: UUID!
    $label: String!
    $space: CoordinateSpace!
    $x: Float!
    $y: Float!
    $elevation: Float
    $description: String
    $categoryId: UUID
    $unit: LengthUnit!
  ) {
    addSurveyPoint(
      projectId: $projectId
      label: $label
      space: $space
      x: $x
      y: $y
      elevation: $elevation
      description: $description
      categoryId: $categoryId
      unit: $unit
    ) {
      id
    }
  }
`);

/** Adds a single survey point manually. The coordinate can be entered as
 *  projected easting/northing, geographic longitude/latitude, or building-grid
 *  X/Y — the server converts to the stored projected value. */
export function AddSurveyPointDialog({
  categories,
  onAdded,
  project,
  trigger,
}: {
  project: Project;
  categories: PointCategory[];
  onAdded: () => void;
  trigger: ReactElement;
}) {
  const unitLabel = unitName(project.displayUnit);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [space, setSpace] = useState<InputSpace>('PROJECTED');
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [elevation, setElevation] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);

  const isGeo = space === 'GEOGRAPHIC';
  const xLabel = isGeo ? 'Longitude' : space === 'GRID' ? 'Grid X' : 'Easting';
  const yLabel = isGeo ? 'Latitude' : space === 'GRID' ? 'Grid Y' : 'Northing';
  const linearUnit = isGeo ? 'Degrees' : unitLabel;

  function reset() {
    setLabel('');
    setSpace('PROJECTED');
    setX('');
    setY('');
    setElevation('');
    setDescription('');
    setCategoryId(NONE);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || x.trim() === '' || y.trim() === '') {
      toast.error(`Label, ${xLabel.toLowerCase()}, and ${yLabel.toLowerCase()} are required.`);
      return;
    }
    setBusy(true);
    try {
      await gql(ADD_SURVEY_POINT, {
        categoryId: categoryId === NONE ? null : categoryId,
        description: description.trim() || null,
        elevation: elevation.trim() === '' ? null : parseFloat(elevation),
        label: label.trim(),
        projectId: project.id,
        space,
        unit: project.displayUnit,
        x: parseFloat(x),
        y: parseFloat(y),
      });
      toast.success(`Added “${label.trim()}”.`);
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add point');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-3xl">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add a point</DialogTitle>
            <DialogDescription>
              Enter the coordinate in any space — it&apos;s converted and stored automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 sm:grid-cols-3">
            {/* Column 1 — identity */}
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="asp-label">Label</FieldLabel>
                <Input id="asp-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="asp-description" className="w-full">
                  Description
                  <OptionalBadge />
                </FieldLabel>
                <Textarea
                  id="asp-description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="asp-category" className="w-full">
                  Category
                  <OptionalBadge />
                </FieldLabel>
                <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
                  <SelectTrigger id="asp-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Category</SelectLabel>
                      <SelectItem value={NONE}>None</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: c.color }}
                            />
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* Columns 2–3 — coordinate */}
            <div className="grid grid-cols-2 gap-4 self-start sm:col-span-2">
              <Field className="col-span-2">
                <FieldLabel htmlFor="asp-space">Coordinate type</FieldLabel>
                <Select value={space} onValueChange={(v) => v && setSpace(v as InputSpace)}>
                  <SelectTrigger id="asp-space" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Coordinate type</SelectLabel>
                      <SelectItem value="PROJECTED">Projected (grid)</SelectItem>
                      <SelectItem value="GRID">Building grid</SelectItem>
                      <SelectItem value="GEOGRAPHIC">Geographic (lat/long)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {space === 'GRID' ? (
                  <FieldDescription>Requires a solved transform.</FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="asp-x">{xLabel}</FieldLabel>
                <Input
                  id="asp-x"
                  type="number"
                  step="any"
                  value={x}
                  onChange={(e) => setX(e.target.value)}
                />
                <FieldDescription>{linearUnit}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="asp-y">{yLabel}</FieldLabel>
                <Input
                  id="asp-y"
                  type="number"
                  step="any"
                  value={y}
                  onChange={(e) => setY(e.target.value)}
                />
                <FieldDescription>{linearUnit}</FieldDescription>
              </Field>
              <Field className="col-span-2">
                <FieldLabel htmlFor="asp-elevation" className="w-full">
                  Elevation
                  <OptionalBadge />
                </FieldLabel>
                <Input
                  id="asp-elevation"
                  type="number"
                  step="any"
                  value={elevation}
                  onChange={(e) => setElevation(e.target.value)}
                />
                <FieldDescription>{unitLabel}</FieldDescription>
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Adding…' : 'Add point'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
