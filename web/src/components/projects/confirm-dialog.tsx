'use client';

import type { ReactElement, ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * A reusable destructive-confirmation dialog. Use either:
 *  - trigger mode: pass `trigger` (e.g. a delete button), or
 *  - controlled mode: pass `open` / `onOpenChange` (e.g. opened from a menu item).
 */
export function ConfirmDialog({
  confirmLabel = 'Delete',
  confirmVariant = 'destructive',
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
  trigger,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  confirmVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  onConfirm: () => void;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            onClick={() => {
              onConfirm();
              // Close after confirming — in controlled mode the action doesn't
              // dismiss on its own, so every call site closes without having to
              // clear its own open-state in onConfirm.
              onOpenChange?.(false);
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
