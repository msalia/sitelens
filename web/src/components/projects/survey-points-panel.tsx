'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { EditSurveyPointDialog } from '@/components/projects/edit-survey-point-dialog';
import { BulkActionsBar } from '@/components/projects/survey-points/bulk-actions-bar';
import { ManagePointsCard } from '@/components/projects/survey-points/manage-points-card';
import { PointsTable, type SortField } from '@/components/projects/survey-points/points-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { gql } from '@/lib/graphql';
import { subscribeProjectChanged } from '@/lib/scene-subscription';
import {
  type InspectablePoint,
  type PointCategory,
  type PointGroup,
  type Project,
  type SurveyPoint,
} from '@/lib/types';
import { unitName } from '@/lib/units';
import { cn } from '@/lib/utils';

import {
  ADD_TO_GROUP,
  ASSIGN_CATEGORY,
  BULK_DELETE,
  CREATE_POINT_GROUP,
  DELETE_SURVEY_POINT,
  POINT_GROUPS,
  SURVEY_POINTS,
} from './survey-points-data';

const ALL = 'all';
const NONE = 'none';
const PAGE_SIZE = 50;

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
  const unitLabel = unitName(project.displayUnit);
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
  const [editing, setEditing] = useState<SurveyPoint | null>(null);
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

  // Legitimate data-fetching effect: query the server when filters/page change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Legitimate data-fetching effect: load point groups for the filter dropdown.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroups();
  }, [loadGroups]);

  // Live updates: keep the table in sync with edits (from this or another
  // session) by refetching the current page + groups on each projectChanged ping.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeProjectChanged(project.id, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
        void loadGroups();
      }, 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [project.id, load, loadGroups]);

  // Debounce the search input → server query fires ~300ms after typing settles.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to the first page whenever the filters or sort change. Adjusting state
  // during render (instead of an effect) also avoids a redundant fetch at the
  // stale page before the reset lands.
  const filterSig = `${debouncedSearch}|${categoryFilter}|${groupFilter}|${sortField}|${sortDesc}`;
  const [pagedFilterSig, setPagedFilterSig] = useState(filterSig);
  if (pagedFilterSig !== filterSig) {
    setPagedFilterSig(filterSig);
    setPage(0);
  }

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
            <BulkActionsBar
              selectedCount={selected.size}
              busy={busy}
              categories={categories}
              groups={groups}
              onAssignCategory={(id) => bulkAssign(id)}
              onClearCategory={() => bulkAssign(NONE)}
              onNewGroup={openSaveGroup}
              onAddToGroup={addToGroup}
              onClearSelection={() => setSelected(new Set())}
              onRequestBulkDelete={() => setBulkDeleteOpen(true)}
            />
          )}

          <PointsTable
            points={points}
            catById={catById}
            project={project}
            selected={selected}
            allOnPageSelected={allOnPageSelected}
            sortField={sortField}
            sortDesc={sortDesc}
            showPagination={showPagination}
            onToggle={toggle}
            onToggleAll={toggleAllOnPage}
            onSort={setSort}
            onLocate={onLocate}
            onInspect={setInspecting}
            onEdit={setEditing}
            onDelete={setPendingDelete}
          />

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

        <EditSurveyPointDialog
          categories={categories}
          point={editing}
          open={editing !== null}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
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

      <ManagePointsCard
        project={project}
        categories={categories}
        selectedIds={[...selected]}
        categoryFilter={categoryFilter === ALL ? null : categoryFilter}
        onAdded={load}
        onImported={load}
        onCategoriesChanged={onCategoriesChanged}
        onGroupsChanged={loadGroups}
        onApplyGroup={(ids) => setSelected(new Set(ids))}
      />
    </div>
  );
}
