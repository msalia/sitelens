'use client';

import { IconMapPin, IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CategoryManagerDialog } from '@/components/projects/category-manager-dialog';
import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { ImportDialog } from '@/components/projects/import-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import {
  type InspectablePoint,
  type PointCategory,
  type Project,
  type SurveyPoint,
  UNIT_LABELS,
} from '@/lib/types';
import { fromMeters } from '@/lib/units';

const ALL = 'all';

const SURVEY_POINTS = graphql(`
  query SurveyPoints($id: UUID!, $search: String, $cat: UUID) {
    surveyPoints(projectId: $id, search: $search, categoryId: $cat) {
      id
      projectId
      label
      northing
      easting
      elevation
      description
      categoryId
      tags
      importBatchId
    }
  }
`);
const DELETE_SURVEY_POINT = graphql(`
  mutation DeleteSurveyPoint($id: UUID!) {
    deleteSurveyPoint(id: $id)
  }
`);
const CREATE_POINT_GROUP = graphql(`
  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {
    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {
      id
    }
  }
`);

export function SurveyPointsPanel({
  categories,
  onCategoriesChanged,
  project,
}: {
  project: Project;
  categories: PointCategory[];
  onCategoriesChanged: () => void;
}) {
  const unitLabel = UNIT_LABELS[project.displayUnit];
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<InspectablePoint | null>(null);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const load = useCallback(async () => {
    try {
      const data = await gql(SURVEY_POINTS, {
        cat: categoryFilter === ALL ? null : categoryFilter,
        id: project.id,
        search: search || null,
      });
      setPoints(data.surveyPoints);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load points');
    }
  }, [project.id, search, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function remove(id: string) {
    try {
      await gql(DELETE_SURVEY_POINT, { id });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function saveGroup() {
    const name = window.prompt(`Save ${selected.size} points as a group named:`);
    if (!name?.trim()) {
      return;
    }
    try {
      await gql(CREATE_POINT_GROUP, { id: project.id, ids: [...selected], name: name.trim() });
      toast.success('Group saved');
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save group failed');
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Survey points</CardTitle>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button size="sm" variant="outline" onClick={saveGroup}>
              Save group ({selected.size})
            </Button>
          )}
          <CategoryManagerDialog categories={categories} onChanged={onCategoriesChanged} />
          <ImportDialog project={project} categories={categories} onImported={load} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            placeholder="Search label, description, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <NativeSelect
            className="w-48"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <NativeSelectOption value={ALL}>All categories</NativeSelectOption>
            {categories.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Label</TableHead>
              <TableHead>N ({unitLabel})</TableHead>
              <TableHead>E ({unitLabel})</TableHead>
              <TableHead>Z ({unitLabel})</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => {
              const cat = p.categoryId ? catById.get(p.categoryId) : undefined;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      aria-label={`Select ${p.label}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{p.label}</TableCell>
                  <TableCell>{fromMeters(p.northing, project.displayUnit).toFixed(3)}</TableCell>
                  <TableCell>{fromMeters(p.easting, project.displayUnit).toFixed(3)}</TableCell>
                  <TableCell>
                    {p.elevation === null
                      ? '—'
                      : fromMeters(p.elevation, project.displayUnit).toFixed(3)}
                  </TableCell>
                  <TableCell>
                    {cat ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                        {cat.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-40 truncate text-xs">
                    {p.description || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Inspect"
                        onClick={() => setInspecting(p)}
                      >
                        <IconMapPin className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        onClick={() => remove(p.id)}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {points.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground text-center text-sm">
                  No points. Import a CSV or LandXML file to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <CoordinateInspectorDialog
        project={project}
        point={inspecting}
        onClose={() => setInspecting(null)}
      />
    </Card>
  );
}
