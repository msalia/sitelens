'use client';

import { IconArrowDown, IconArrowUp, IconMapPin, IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CategoryManagerDialog } from '@/components/projects/category-manager-dialog';
import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { ExportDialog } from '@/components/projects/export-dialog';
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
const NONE = 'none';
const PAGE_SIZE = 50;

/** Sortable columns, mapped to the API's `sort` argument. */
type SortField = 'label' | 'northing' | 'easting' | 'elevation';

const SURVEY_POINTS = graphql(`
  query SurveyPoints(
    $id: UUID!
    $search: String
    $cat: UUID
    $limit: Int
    $offset: Int
    $sort: String
    $descending: Boolean
  ) {
    surveyPoints(
      projectId: $id
      search: $search
      categoryId: $cat
      limit: $limit
      offset: $offset
      sort: $sort
      descending: $descending
    ) {
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
    surveyPointCount(projectId: $id, search: $search, categoryId: $cat)
  }
`);
const DELETE_SURVEY_POINT = graphql(`
  mutation DeleteSurveyPoint($id: UUID!) {
    deleteSurveyPoint(id: $id)
  }
`);
const BULK_DELETE = graphql(`
  mutation DeleteSurveyPoints($ids: [UUID!]!) {
    deleteSurveyPoints(ids: $ids)
  }
`);
const ASSIGN_CATEGORY = graphql(`
  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {
    assignCategory(ids: $ids, categoryId: $cat)
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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<InspectablePoint | null>(null);
  const [busy, setBusy] = useState(false);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const load = useCallback(async () => {
    try {
      const data = await gql(SURVEY_POINTS, {
        cat: categoryFilter === ALL ? null : categoryFilter,
        descending: sortDesc,
        id: project.id,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: search || null,
        sort: sortField,
      });
      setPoints(data.surveyPoints);
      setTotal(data.surveyPointCount);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load points');
    }
  }, [project.id, search, categoryFilter, page, sortField, sortDesc]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to the first page whenever the filters or sort change.
  useEffect(() => {
    setPage(0);
  }, [search, categoryFilter, sortField, sortDesc]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  const pageIds = points.map((p) => p.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

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

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s);
      if (allOnPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function setSort(field: SortField) {
    if (sortField === field) {
      setSortDesc((d) => !d);
    } else {
      setSortField(field);
      setSortDesc(false);
    }
  }

  async function remove(id: string) {
    try {
      await gql(DELETE_SURVEY_POINT, { id });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} point(s)? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const { deleteSurveyPoints } = await gql(BULK_DELETE, { ids: [...selected] });
      toast.success(`Deleted ${deleteSurveyPoints} point(s)`);
      setSelected(new Set());
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function bulkAssign(value: string) {
    setBusy(true);
    try {
      const { assignCategory } = await gql(ASSIGN_CATEGORY, {
        cat: value === NONE ? null : value,
        ids: [...selected],
      });
      toast.success(`Updated ${assignCategory} point(s)`);
      setSelected(new Set());
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assign failed');
    } finally {
      setBusy(false);
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
          <CategoryManagerDialog categories={categories} onChanged={onCategoriesChanged} />
          <ExportDialog
            project={project}
            selectedIds={[...selected]}
            categoryFilter={categoryFilter === ALL ? null : categoryFilter}
          />
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

        {selected.size > 0 && (
          <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <NativeSelect
              className="h-8 w-44"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && bulkAssign(e.target.value)}
            >
              <NativeSelectOption value="">Assign category…</NativeSelectOption>
              <NativeSelectOption value={NONE}>— Clear category —</NativeSelectOption>
              {categories.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button size="sm" variant="outline" disabled={busy} onClick={saveGroup}>
              Save as group
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={bulkDelete}>
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  aria-label="Select all on page"
                />
              </TableHead>
              <SortHeader
                label="Label"
                field="label"
                active={sortField}
                desc={sortDesc}
                onSort={setSort}
              />
              <SortHeader
                label={`N (${unitLabel})`}
                field="northing"
                active={sortField}
                desc={sortDesc}
                onSort={setSort}
              />
              <SortHeader
                label={`E (${unitLabel})`}
                field="easting"
                active={sortField}
                desc={sortDesc}
                onSort={setSort}
              />
              <SortHeader
                label={`Z (${unitLabel})`}
                field="elevation"
                active={sortField}
                desc={sortDesc}
                onSort={setSort}
              />
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

        {total > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {rangeStart}–{rangeEnd} of {total}
              {selected.size > 0 ? ` · ${selected.size} selected` : ''}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <span className="text-muted-foreground">
                Page {page + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <CoordinateInspectorDialog
        project={project}
        point={inspecting}
        onClose={() => setInspecting(null)}
      />
    </Card>
  );
}

/** A clickable, sort-indicating column header. */
function SortHeader({
  active,
  desc,
  field,
  label,
  onSort,
}: {
  label: string;
  field: SortField;
  active: SortField | null;
  desc: boolean;
  onSort: (f: SortField) => void;
}) {
  const isActive = active === field;
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {label}
        {isActive &&
          (desc ? <IconArrowDown className="size-3.5" /> : <IconArrowUp className="size-3.5" />)}
      </button>
    </TableHead>
  );
}
