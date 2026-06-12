'use client';

import { IconCheck, IconSparkles } from '@tabler/icons-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CREW_FEATURES } from '@/lib/billing';

/** A controlled "Upgrade to Crew" prompt shown when a Solo cap is hit (extra
 *  project, export, etc.). Sends the user to the billing page, the single place
 *  that handles Checkout + admin/non-admin. */
export function UpgradeDialog({
  description,
  onOpenChange,
  open,
  title = 'Upgrade to Crew',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconSparkles className="text-primary size-5" /> {title}
          </DialogTitle>
          <DialogDescription>
            {description ?? 'This is a Crew feature. Upgrade to unlock it for your whole team.'}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2 text-sm">
          {CREW_FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <IconCheck className="text-primary size-4 shrink-0" /> {f}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Not now</Button>} />
          <Link href="/settings/billing" className={buttonVariants()}>
            See plans
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
