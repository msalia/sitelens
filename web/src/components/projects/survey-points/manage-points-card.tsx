'use client';

import {
  IconChevronRight,
  IconDownload,
  IconMapPinPlus,
  IconTag,
  IconUpload,
  IconUsersGroup,
} from '@tabler/icons-react';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';

import { AddSurveyPointDialog } from '@/components/projects/add-survey-point-dialog';
import { CategoryManagerDialog } from '@/components/projects/category-manager-dialog';
import { ExportDialog } from '@/components/projects/export-dialog';
import { GroupManagerDialog } from '@/components/projects/group-manager-dialog';
import { ImportDialog } from '@/components/projects/import-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type PointCategory, type Project } from '@/lib/types';

export function ManagePointsCard({
  categories,
  categoryFilter,
  onAdded,
  onApplyGroup,
  onCategoriesChanged,
  onGroupsChanged,
  onImported,
  project,
  selectedIds,
}: {
  project: Project;
  categories: PointCategory[];
  selectedIds: string[];
  /** Category filter for exports, or null for "all". */
  categoryFilter: string | null;
  onAdded: () => void;
  onImported: () => void;
  onCategoriesChanged: () => void;
  onGroupsChanged: () => void;
  onApplyGroup: (ids: string[]) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage points</CardTitle>
        <CardDescription>Import, categorize, and export survey points.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <AddSurveyPointDialog
          project={project}
          categories={categories}
          onAdded={onAdded}
          trigger={
            <ActionRow
              icon={<IconMapPinPlus className="size-5" />}
              title="Add a point"
              description="Enter a single survey point by hand."
            />
          }
        />
        <ImportDialog
          project={project}
          categories={categories}
          onImported={onImported}
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
          selectedIds={selectedIds}
          categoryFilter={categoryFilter}
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
          selectedIds={selectedIds}
          onApply={onApplyGroup}
          onChanged={onGroupsChanged}
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
