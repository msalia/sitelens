'use client';

import { IconChevronDown, IconTrash } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
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
import { type PointCategory, type PointGroup } from '@/lib/types';

export function BulkActionsBar({
  busy,
  categories,
  groups,
  onAddToGroup,
  onAssignCategory,
  onClearCategory,
  onClearSelection,
  onNewGroup,
  onRequestBulkDelete,
  selectedCount,
}: {
  selectedCount: number;
  busy: boolean;
  categories: PointCategory[];
  groups: PointGroup[];
  onAssignCategory: (catId: string) => void;
  onClearCategory: () => void;
  onNewGroup: () => void;
  onAddToGroup: (groupId: string) => void;
  onClearSelection: () => void;
  onRequestBulkDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="font-medium">{selectedCount} selected</span>
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
            <DropdownMenuItem onClick={onClearCategory}>— Clear category —</DropdownMenuItem>
            {categories.map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => onAssignCategory(c.id)}>
                <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Add to group</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={onNewGroup}>New group…</DropdownMenuItem>
              {groups.length > 0 && <DropdownMenuSeparator />}
              {groups.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => onAddToGroup(g.id)}>
                  {g.name}
                  <span className="text-muted-foreground ml-auto text-xs">
                    {g.memberIds.length}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={onClearSelection}>Clear selection</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onRequestBulkDelete}>
            <IconTrash className="size-4" /> Delete {selectedCount} point
            {selectedCount > 1 ? 's' : ''}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
