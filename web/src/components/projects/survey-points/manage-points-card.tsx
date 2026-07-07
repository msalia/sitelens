'use client';

import {
  IconDownload,
  IconMapPinPlus,
  IconTag,
  IconUpload,
  IconUsersGroup,
} from '@tabler/icons-react';

import { AddSurveyPointDialog } from '@/components/projects/add-survey-point-dialog';
import { CategoryManagerDialog } from '@/components/projects/category-manager-dialog';
import { ExportDialog } from '@/components/projects/export-dialog';
import { GroupManagerDialog } from '@/components/projects/group-manager-dialog';
import { ImportDialog } from '@/components/projects/import-dialog';
import { ListRowButton } from '@/components/projects/list-row';
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
            <ListRowButton
              leading={<IconMapPinPlus className="size-5" />}
              title="Add a point"
              subtitle="Enter a single survey point by hand."
            />
          }
        />
        <ImportDialog
          project={project}
          categories={categories}
          onImported={onImported}
          trigger={
            <ListRowButton
              leading={<IconUpload className="size-5" />}
              title="Import points"
              subtitle="From a survey-machine CSV or LandXML export."
            />
          }
        />
        <CategoryManagerDialog
          categories={categories}
          onChanged={onCategoriesChanged}
          trigger={
            <ListRowButton
              leading={<IconTag className="size-5" />}
              title="Categories"
              subtitle="Manage point categories for this organization."
            />
          }
        />
        <ExportDialog
          project={project}
          selectedIds={selectedIds}
          categoryFilter={categoryFilter}
          trigger={
            <ListRowButton
              leading={<IconDownload className="size-5" />}
              title="Export points"
              subtitle="Download CSV or LandXML in any space and unit."
            />
          }
        />
        <GroupManagerDialog
          project={project}
          selectedIds={selectedIds}
          onApply={onApplyGroup}
          onChanged={onGroupsChanged}
          trigger={
            <ListRowButton
              leading={<IconUsersGroup className="size-5" />}
              title="Groups"
              subtitle="Create, apply, and delete saved point groups."
            />
          }
        />
      </CardContent>
    </Card>
  );
}
