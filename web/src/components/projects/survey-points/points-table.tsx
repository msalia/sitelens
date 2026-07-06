'use client';

import {
  IconArrowDown,
  IconArrowUp,
  IconCurrentLocation,
  IconDotsVertical,
  IconMapPin,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type PointCategory, type Project, type SurveyPoint } from '@/lib/types';
import { fromMeters } from '@/lib/units';
import { cn } from '@/lib/utils';

/** Sortable columns, mapped to the API's `sort` argument. */
export type SortField = 'label' | 'northing' | 'easting' | 'elevation';

export function PointsTable({
  allOnPageSelected,
  catById,
  onDelete,
  onEdit,
  onInspect,
  onLocate,
  onSort,
  onToggle,
  onToggleAll,
  points,
  project,
  selected,
  showPagination,
  sortDesc,
  sortField,
}: {
  points: SurveyPoint[];
  catById: Map<string, PointCategory>;
  project: Project;
  selected: Set<string>;
  allOnPageSelected: boolean;
  sortField: SortField | null;
  sortDesc: boolean;
  showPagination: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onSort: (field: SortField) => void;
  onLocate?: (point: SurveyPoint) => void;
  onInspect: (point: SurveyPoint) => void;
  onEdit: (point: SurveyPoint) => void;
  onDelete: (point: SurveyPoint) => void;
}) {
  return (
    // Full-bleed table with sticky selector, label, and action columns.
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
                onChange={onToggleAll}
                aria-label="Select all on page"
              />
            </TableHead>
            <SortHeader
              label="Label"
              field="label"
              active={sortField}
              desc={sortDesc}
              onSort={onSort}
            />
            <SortHeader
              label="N"
              field="northing"
              active={sortField}
              desc={sortDesc}
              onSort={onSort}
            />
            <SortHeader
              label="E"
              field="easting"
              active={sortField}
              desc={sortDesc}
              onSort={onSort}
            />
            <SortHeader
              label="Z"
              field="elevation"
              active={sortField}
              desc={sortDesc}
              onSort={onSort}
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
                      <DropdownMenuItem onClick={() => onInspect(p)}>
                        <IconMapPin className="size-4" /> Inspect
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(p)}>
                        <IconPencil className="size-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(p)}>
                        <IconTrash className="size-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => onToggle(p.id)}
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
                <TableCell>{fromMeters(p.northing, project.displayUnit).toFixed(3)}</TableCell>
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
  );
}

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
