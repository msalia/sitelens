'use client';

import { IconTag } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { PointCategory } from '@/lib/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { gql } from '@/lib/graphql';

export function CategoryManagerDialog({
  categories,
  onChanged,
}: {
  categories: PointCategory[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gql(
        `mutation ($name: String!, $color: String!, $icon: String!) {
          createCategory(name: $name, color: $color, icon: $icon) { id }
        }`,
        { color, icon: 'point', name },
      );
      toast.success('Category created');
      setName('');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <IconTag className="mr-1 size-4" /> Categories
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Default set plus your organization&rsquo;s custom ones.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="size-3 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
              {!c.isDefault && <span className="text-muted-foreground text-xs">(custom)</span>}
            </li>
          ))}
        </ul>
        <form onSubmit={create} className="mt-2 flex items-end gap-2 border-t pt-3">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="cat-name" className="text-xs">
              New category
            </Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Category color"
            className="h-9 w-12 rounded-md border"
          />
          <Button type="submit" disabled={busy}>
            Add
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
