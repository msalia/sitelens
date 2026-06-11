'use client';

import { IconTag, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';

import type { PointCategory } from '@/lib/types';

import { CategoryChip } from '@/components/projects/category-chip';
import { ConfirmDialog } from '@/components/projects/confirm-dialog';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { graphql } from '@/lib/gql';
import { gql, useMutation } from '@/lib/graphql';

const CREATE_CATEGORY = graphql(`
  mutation CreateCategory($name: String!, $color: String!, $icon: String!) {
    createCategory(name: $name, color: $color, icon: $icon) {
      id
    }
  }
`);
const DELETE_CATEGORY = graphql(`
  mutation DeleteCategory($id: UUID!) {
    deleteCategory(id: $id)
  }
`);

const PER_PAGE = 10;

export function CategoryManagerDialog({
  categories,
  onChanged,
  trigger,
}: {
  categories: PointCategory[];
  onChanged: () => void;
  /** Optional custom trigger element; falls back to a default button. */
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const { busy, run } = useMutation();

  const customs = useMemo(() => categories.filter((c) => !c.isDefault), [categories]);
  const defaults = useMemo(() => categories.filter((c) => c.isDefault), [categories]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await run(() => gql(CREATE_CATEGORY, { color, icon: 'point', name }), {
      error: 'Create failed',
      onDone: () => {
        setName('');
        onChanged();
      },
      success: 'Category created',
    });
  }

  async function remove(id: string) {
    await run(() => gql(DELETE_CATEGORY, { id }), {
      error: 'Delete failed',
      onDone: onChanged,
      success: 'Category deleted',
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline">
              <IconTag className="mr-1 size-4" /> Categories
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Default set plus your organization&rsquo;s custom ones.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="custom">
          <TabsList className="w-full">
            <TabsTrigger value="custom">Custom</TabsTrigger>
            <TabsTrigger value="default">Default</TabsTrigger>
          </TabsList>
          <TabsContent value="custom">
            <CategoryList items={customs} deletable onDelete={remove} />
          </TabsContent>
          <TabsContent value="default">
            <CategoryList items={defaults} />
          </TabsContent>
        </Tabs>

        <form onSubmit={create} className="contents">
          <div className="flex items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor="cat-name">New category</FieldLabel>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Category color"
              className="size-9 cursor-pointer rounded-full border p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              Add category
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A searchable, paginated, full-bleed list of categories. */
function CategoryList({
  deletable,
  items,
  onDelete,
}: {
  items: PointCategory[];
  deletable?: boolean;
  onDelete?: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((c) => c.name.toLowerCase().includes(q)) : items;
  }, [items, search]);

  // Reset to the first page when the filter changes (adjusted during render,
  // not via an effect).
  const [pagedSearch, setPagedSearch] = useState(search);
  if (pagedSearch !== search) {
    setPagedSearch(search);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageItems = filtered.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Filter by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="-mx-4 border-y [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted">
              <TableHead>Category</TableHead>
              {deletable && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <CategoryChip color={c.color} name={c.name} />
                </TableCell>
                {deletable && (
                  <TableCell className="text-right">
                    <ConfirmDialog
                      title={`Delete “${c.name}”?`}
                      description="Points in this category will become uncategorized. This can’t be undone."
                      onConfirm={() => onDelete?.(c.id)}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`}>
                          <IconTrash className="size-4" />
                        </Button>
                      }
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={deletable ? 2 : 1}
                  className="text-muted-foreground text-center text-sm"
                >
                  {search ? 'No categories match.' : 'None yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {page * PER_PAGE + 1}–{Math.min(filtered.length, (page + 1) * PER_PAGE)} of{' '}
            {filtered.length}
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
              {page + 1} / {pageCount}
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
    </div>
  );
}
