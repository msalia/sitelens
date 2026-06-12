'use client';

import { IconCheck, IconLock } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { type Billing, CREW_FEATURES, PRICING, useCheckout } from '@/lib/billing';

/** Full-screen read-only gate shown when an org's subscription has lapsed while it
 *  is over the Solo caps. Admins can re-subscribe (Checkout) or open the Portal;
 *  others are told to ask an admin. */
export function UpgradeGate({ billing, isAdmin }: { billing: Billing; isAdmin: boolean }) {
  const { busy, openPortal, startCheckout } = useCheckout();

  const over: string[] = [];
  if (billing.projects > billing.maxProjects && billing.maxProjects >= 0) {
    over.push(`${billing.projects} projects`);
  }
  if (billing.admins > billing.maxAdmins && billing.maxAdmins >= 0) {
    over.push(`${billing.admins} admins`);
  }
  if (billing.nonAdmin > billing.maxNonAdmin && billing.maxNonAdmin >= 0) {
    over.push(`${billing.nonAdmin} members`);
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="max-w-lg">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLock />
          </EmptyMedia>
          <EmptyTitle>Your workspace is read-only</EmptyTitle>
          <EmptyDescription>
            Your Crew subscription has lapsed, and this organization is over the free Solo plan
            {over.length > 0 ? ` (${over.join(', ')})` : ''}. Your data is safe — resubscribe to
            Crew to make changes again.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent>
          <ul className="text-muted-foreground mb-2 flex flex-col gap-1.5 text-left text-sm">
            {CREW_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <IconCheck className="text-primary size-4 shrink-0" /> {f}
              </li>
            ))}
          </ul>

          {isAdmin ? (
            <div className="flex w-full flex-col gap-2">
              <Button disabled={busy} onClick={() => startCheckout('MONTHLY')}>
                {busy
                  ? 'Redirecting…'
                  : `Resubscribe — ${PRICING.monthly.label}${PRICING.monthly.cadence}`}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => startCheckout('ANNUAL')}>
                Pay yearly — {PRICING.annual.label}
                {PRICING.annual.cadence} · {PRICING.annual.note}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={openPortal}>
                Manage billing
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Ask an organization admin to resubscribe to Crew.
            </p>
          )}
        </EmptyContent>
      </Empty>
    </div>
  );
}
