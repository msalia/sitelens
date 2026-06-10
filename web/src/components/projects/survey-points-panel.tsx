'use client';

import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconCurrentLocation,
  IconDotsVertical,
  IconDownload,
  IconMapPin,
  IconTag,
  IconTrash,
  IconUpload,
  IconUsersGroup,
} from '@tabler/icons-react';
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { toast } from 'sonner';

import { CategoryManagerDialog } from '@/components/projects/category-manager-dialog';
import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { ExportDialog } from '@/components/projects/export-dialog';
import { GroupManagerDialog } from '@/components/projects/group-manager-dialog';
import { ImportDialog } from '@/components/projects/import-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  type PointGroup,
  type Project,
  type SurveyPoint,
  UNIT_OPTIONS,
} from '@/lib/types';
import { fromMeters } from '@/lib/units';
import { cn } from '@/lib/utils';

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
    $group: UUID
    $limit: Int
    $offset: Int
    $sort: String
    $descending: Boolean
  ) {
    surveyPoints(
      projectId: $id
      search: $search
      categoryId: $cat
      groupId: $group
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
    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)
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
const POINT_GROUPS = graphql(`
  query PointGroups($id: UUID!) {
    pointGroups(projectId: $id) {
      id
      projectId
      name
      memberIds
    }
  }
`);
const ADD_TO_GROUP = graphql(`
  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {
    addPointsToGroup(groupId: $groupId, memberIds: $ids) {
      id
      memberIds
    }
  }
`);

export function SurveyPointsPanel({
  categories,
  onCategoriesChanged,
  onLocate,
  project,
}: {
  project: Project;
  categories: PointCategory[];
  onCategoriesChanged: () => void;
  /** Ask the 3D view to fly to a point. */
  onLocate?: (point: SurveyPoint) => void;
}) {
  const unitLabel = UNIT_OPTIONS.find((u) => u.value === project.displayUnit)?.label ?? '';
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  // Debounced search so we hit the server after typing settles, not per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<InspectablePoint | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SurveyPoint | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<PointGroup[]>([]);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const load = useCallback(async () => {
    try {
      const data = await gql(SURVEY_POINTS, {
        cat: categoryFilter === ALL ? null : categoryFilter,
        descending: sortDesc,
        group: groupFilter === ALL ? null : groupFilter,
        id: project.id,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: debouncedSearch || null,
        sort: sortField,
      });
      setPoints(data.surveyPoints);
      setTotal(data.surveyPointCount);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load points');
    }
  }, [project.id, debouncedSearch, categoryFilter, groupFilter, page, sortField, sortDesc]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadGroups = useCallback(async () => {
    try {
      const { pointGroups } = await gql(POINT_GROUPS, { id: project.id });
      setGroups(pointGroups);
    } catch {
      /* groups are non-critical; ignore load failures */
    }
  }, [project.id]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  // Debounce the search input → server query fires ~300ms after typing settles.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to the first page whenever the filters or sort change.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, categoryFilter, groupFilter, sortField, sortDesc]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showPagination = pageCount > 1;
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

  function openSaveGroup() {
    setGroupName('');
    setGroupDialogOpen(true);
  }

  async function confirmSaveGroup() {
    const name = groupName.trim();
    if (!name) {
      return;
    }
    setBusy(true);
    try {
      await gql(CREATE_POINT_GROUP, { id: project.id, ids: [...selected], name });
      toast.success('Group saved');
      setGroupDialogOpen(false);
      setSelected(new Set());
      void loadGroups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save group failed');
    } finally {
      setBusy(false);
    }
  }

  async function addToGroup(groupId: string) {
    setBusy(true);
    try {
      const { addPointsToGroup } = await gql(ADD_TO_GROUP, { groupId, ids: [...selected] });
      toast.success(`Added to group (${addPointsToGroup.memberIds.length} points total)`);
      setSelected(new Set());
      void loadGroups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add to group failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 [&>*]:shrink-0">
      <Card>
        <CardHeader>
          <CardTitle>Survey points</CardTitle>
        </CardHeader>
        <CardContent
          className={cn('flex flex-col gap-3', !showPagination && '-mb-(--card-spacing)')}
        >
          <div className="flex gap-2">
            <Input
              placeholder="Search label, description, tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? ALL)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Filter by category</SelectLabel>
                  <SelectItem value={ALL}>All categories</SelectItem>
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
            {groups.length > 0 && (
              <Select value={groupFilter} onValueChange={(v) => setGroupFilter(v ?? ALL)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Filter by group</SelectLabel>
                    <SelectItem value={ALL}>All groups</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="outline" disabled={busy}>
                      Actions
                      <IconChevronDown className="ml-1 size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Assign category</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => bulkAssign(NONE)}>
                      — Clear category —
                    </DropdownMenuItem>
                    {categories.map((c) => (
                      <DropdownMenuItem key={c.id} onClick={() => bulkAssign(c.id)}>
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Add to group</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={openSaveGroup}>New group…</DropdownMenuItem>
                      {groups.length > 0 && <DropdownMenuSeparator />}
                      {groups.map((g) => (
                        <DropdownMenuItem key={g.id} onClick={() => addToGroup(g.id)}>
                          {g.name}
                          <span className="text-muted-foreground ml-auto text-xs">
                            {g.memberIds.length}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onClick={() => setSelected(new Set())}>
                    Clear selection
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
                    <IconTrash className="size-4" /> Delete {selected.size} point
                    {selected.size > 1 ? 's' : ''}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Full-bleed table with sticky selector, label, and action columns. */}
          <div
            className={cn(
              '-mx-(--card-spacing) border-t [&_[data-slot=table-container]]:overscroll-x-none',
              showPagination && 'border-b',
            )}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead className="w-12 pl-(--card-spacing)" />
                  <TableHead className="w-10">
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
                    label="N"
                    field="northing"
                    active={sortField}
                    desc={sortDesc}
                    onSort={setSort}
                  />
                  <SortHeader
                    label="E"
                    field="easting"
                    active={sortField}
                    desc={sortDesc}
                    onSort={setSort}
                  />
                  <SortHeader
                    label="Z"
                    field="elevation"
                    active={sortField}
                    desc={sortDesc}
                    onSort={setSort}
                  />
                  <TableHead className="pr-(--card-spacing)">Category</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((p) => {
                  const cat = p.categoryId ? catById.get(p.categoryId) : undefined;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="w-12 pl-(--card-spacing)">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label="Point actions">
                                <IconDotsVertical className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="start">
                            {onLocate && (
                              <DropdownMenuItem onClick={() => onLocate(p)}>
                                <IconCurrentLocation className="size-4" /> Locate in 3D
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setInspecting(p)}>
                              <IconMapPin className="size-4" /> Inspect
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setPendingDelete(p)}
                            >
                              <IconTrash className="size-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          aria-label={`Select ${p.label}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{p.label}</div>
                        {p.description && (
                          <div className="text-muted-foreground max-w-48 truncate text-xs">
                            {p.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {fromMeters(p.northing, project.displayUnit).toFixed(3)}
                      </TableCell>
                      <TableCell>{fromMeters(p.easting, project.displayUnit).toFixed(3)}</TableCell>
                      <TableCell>
                        {p.elevation === null
                          ? '—'
                          : fromMeters(p.elevation, project.displayUnit).toFixed(3)}
                      </TableCell>
                      <TableCell className="pr-(--card-spacing)">
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
                    </TableRow>
                  );
                })}
                {points.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground text-center text-sm">
                      No points. Import a CSV or LandXML file to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {showPagination && (
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
        <CardFooter>
          <p className="text-muted-foreground text-xs">
            N (northing), E (easting), and Z (elevation) are shown in {unitLabel}.
          </p>
        </CardFooter>

        <CoordinateInspectorDialog
          project={project}
          point={inspecting}
          onClose={() => setInspecting(null)}
        />

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={pendingDelete ? `Delete ${pendingDelete.label}?` : 'Delete point?'}
          description="This survey point will be removed. This can’t be undone."
          onConfirm={() => {
            if (pendingDelete) {
              void remove(pendingDelete.id);
            }
            setPendingDelete(null);
          }}
        />

        <ConfirmDialog
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          title={`Delete ${selected.size} point(s)?`}
          description="The selected survey points will be removed. This can’t be undone."
          onConfirm={() => {
            void bulkDelete();
            setBulkDeleteOpen(false);
          }}
        />

        <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save as group</DialogTitle>
              <DialogDescription>
                Name this selection of {selected.size} point(s) to reuse it later.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void confirmSaveGroup();
              }}
            >
              <Input
                autoFocus
                placeholder="Group name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <DialogFooter className="mt-4">
                <Button type="submit" disabled={busy || !groupName.trim()}>
                  Save group
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manage points</CardTitle>
          <CardDescription>Import, categorize, and export survey points.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <ImportDialog
            project={project}
            categories={categories}
            onImported={load}
            trigger={
              <ActionRow
                icon={<IconUpload className="size-5" />}
                title="Import points"
                description="From a survey-machine CSV or LandXML export."
              />
            }
          />
          <CategoryManagerDialog
            categories={categories}
            onChanged={onCategoriesChanged}
            trigger={
              <ActionRow
                icon={<IconTag className="size-5" />}
                title="Categories"
                description="Manage point categories for this organization."
              />
            }
          />
          <ExportDialog
            project={project}
            selectedIds={[...selected]}
            categoryFilter={categoryFilter === ALL ? null : categoryFilter}
            trigger={
              <ActionRow
                icon={<IconDownload className="size-5" />}
                title="Export points"
                description="Download CSV or LandXML in any space and unit."
              />
            }
          />
          <GroupManagerDialog
            project={project}
            selectedIds={[...selected]}
            onApply={(ids) => setSelected(new Set(ids))}
            onChanged={loadGroups}
            trigger={
              <ActionRow
                icon={<IconUsersGroup className="size-5" />}
                title="Groups"
                description="Create, apply, and delete saved point groups."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** A row-style action button: icon, title, description, chevron. Forwards props
 *  so it can be used as a dialog trigger (base-ui injects onClick/ref). */
const ActionRow = forwardRef<
  HTMLButtonElement,
  { icon: ReactNode; title: string; description: string } & ComponentPropsWithoutRef<'button'>
>(function ActionRow({ description, icon, title, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="bg-muted/50 hover:bg-muted flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors"
      {...props}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block text-sm">{description}</span>
      </span>
      <IconChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
});

/** A clickable, sort-indicating column header. */
function SortHeader({
  active,
  className,
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
  className?: string;
}) {
  const isActive = active === field;
  return (
    <TableHead className={className}>
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
