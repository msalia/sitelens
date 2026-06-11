'use client';

import { type ReactElement, type ReactNode, useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A destructive, irreversible confirmation dialog that requires the user to type
 * an exact phrase (e.g. the project or organization name) before the action is
 * enabled — so the deletion is always a conscious choice.
 */
export function TypeToConfirmDialog({
  confirmLabel = 'Delete',
  confirmPhrase,
  description,
  onConfirm,
  title,
  trigger,
}: {
  /** The destructive trigger (e.g. a Delete button). */
  trigger: ReactElement;
  title: string;
  description: ReactNode;
  /** The exact text the user must type to enable the action. */
  confirmPhrase: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = value.trim() === confirmPhrase;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setValue('');
    }
  }

  async function confirm() {
    if (!matches || busy) {
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="ttc-input" className="text-sm font-normal">
            Type <span className="text-foreground font-semibold break-all">{confirmPhrase}</span> to
            confirm
          </Label>
          <Input
            id="ttc-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={confirmPhrase}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!matches || busy} onClick={confirm}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
