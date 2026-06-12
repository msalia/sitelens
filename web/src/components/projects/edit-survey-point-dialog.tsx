'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
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
import { Textarea } from '@/components/ui/textarea';
import { graphql } from '@/lib/gql';
import { gql, useMutation } from '@/lib/graphql';
import { type PointCategory, type SurveyPoint } from '@/lib/types';

import { OptionalBadge } from './field-extras';

const NONE = '__none__';

// Coordinates are fixed at import time — the API only lets these fields change.
const UPDATE_SURVEY_POINT = graphql(`
  mutation UpdateSurveyPoint($id: UUID!, $label: String, $description: String, $categoryId: UUID) {
    updateSurveyPoint(id: $id, label: $label, description: $description, categoryId: $categoryId) {
      id
    }
  }
`);

/** Edit a survey point's label, description, and category. Coordinates can't be
 *  changed after import, so they aren't shown here. Controlled like the other
 *  row dialogs: `point` seeds the form; `null` keeps it closed/idle. */
export function EditSurveyPointDialog({
  categories,
  onOpenChange,
  onSaved,
  open,
  point,
}: {
  /** The point being edited, or null when idle. */
  point: SurveyPoint | null;
  categories: PointCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const { busy, run } = useMutation();

  // Seed the form from the point when the dialog opens. Done during render (not
  // an effect) and keyed on open/point so reopening always reflects the row.
  const seedSig = `${open}|${point?.id ?? ''}`;
  const [seededSig, setSeededSig] = useState(seedSig);
  if (seededSig !== seedSig) {
    setSeededSig(seedSig);
    if (open && point) {
      setLabel(point.label);
      setDescription(point.description);
      setCategoryId(point.categoryId ?? NONE);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!point) {
      return;
    }
    await run(
      () =>
        gql(UPDATE_SURVEY_POINT, {
          categoryId: categoryId === NONE ? null : categoryId,
          description: description.trim() || null,
          id: point.id,
          label: label.trim(),
        }),
      {
        error: 'Update failed',
        onDone: onSaved,
        success: 'Point updated',
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit point</DialogTitle>
          <DialogDescription>
            Coordinates are set at import and can&apos;t be changed here.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="esp-label">Label</FieldLabel>
            <Input
              id="esp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="esp-description" className="w-full">
              Description
              <OptionalBadge />
            </FieldLabel>
            <Textarea
              id="esp-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="esp-category" className="w-full">
              Category
              <OptionalBadge />
            </FieldLabel>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger id="esp-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Category</SelectLabel>
                  <SelectItem value={NONE}>None</SelectItem>
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
          </Field>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
