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
import { crewSellingPoints, featureMeta, usePlanCatalog } from '@/lib/billing';

/** A controlled "Upgrade to Crew" prompt shown when a Solo cap is hit (extra
 *  project, export, etc.). Sends the user to the billing page, the single place
 *  that handles Checkout + admin/non-admin.
 *
 *  Copy + selling points come from the plan catalog: pass `feature` (a catalog
 *  key like `"dxf_overlays"`) to auto-fill the title/description, or override
 *  `title`/`description` explicitly. */
export function UpgradeDialog({
  description,
  feature,
  onOpenChange,
  open,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: string;
  title?: string;
  description?: string;
}) {
  const { catalog } = usePlanCatalog();
  const meta = feature ? featureMeta(catalog, feature) : undefined;
  const resolvedTitle = title ?? (meta ? `${meta.label} is a Crew feature` : 'Upgrade to Crew');
  const resolvedDescription =
    description ??
    meta?.blurb ??
    'This is a Crew feature. Upgrade to unlock it for your whole team.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconSparkles className="text-primary size-5" /> {resolvedTitle}
          </DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2 text-sm">
          {crewSellingPoints(catalog).map((f) => (
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
