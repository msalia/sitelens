'use client';

import {
  IconCheck,
  IconCreditCard,
  IconExternalLink,
  IconMail,
  IconSparkles,
} from '@tabler/icons-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { Me } from '@/lib/types';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  contactAdminHref,
  crewSellingPoints,
  isPaid,
  PRICING,
  useBilling,
  useCheckout,
  usePlanCatalog,
} from '@/lib/billing';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const ME = graphql(`
  query BillingMe {
    me {
      id
      orgId
      email
      role
      emailVerified
    }
  }
`);

function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function limitLabel(used: number, max: number): string {
  return max < 0 ? `${used} · Unlimited` : `${used} / ${max}`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function BillingContent() {
  const searchParams = useSearchParams();
  const { billing, loading, reload } = useBilling();
  const { catalog } = usePlanCatalog();
  const { busy, openPortal, startCheckout } = useCheckout();
  const [me, setMe] = useState<Me | null>(null);
  const handledReturn = useRef(false);

  useEffect(() => {
    gql(ME)
      .then(({ me }) => setMe(me))
      .catch(() => undefined);
  }, []);

  // Toast + refetch when returning from hosted Checkout.
  useEffect(() => {
    if (handledReturn.current) {
      return;
    }
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      handledReturn.current = true;
      toast.success('Subscription active — welcome to Crew!');
      void reload();
      window.history.replaceState(null, '', '/settings/billing');
    } else if (checkout === 'cancel') {
      handledReturn.current = true;
      toast.info('Checkout canceled.');
      window.history.replaceState(null, '', '/settings/billing');
    }
  }, [searchParams, reload]);

  if (loading || !billing) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }

  const isAdmin = me?.role === 'ADMIN';
  const paid = isPaid(billing);
  const contactHref = contactAdminHref(billing.adminEmails);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-sm">
          Your plan, usage, and subscription for this organization.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {paid ? <IconSparkles className="text-primary size-5" /> : null}
              {paid ? 'Crew' : 'Solo'}
              <span className="text-muted-foreground text-sm font-normal">
                {paid ? 'Paid plan' : 'Free plan'}
              </span>
            </CardTitle>
            <CardDescription>
              {paid
                ? 'Unlimited projects, members, exports, and DXF overlays.'
                : 'One project, one admin, up to five members. No exports or DXF overlays.'}
            </CardDescription>
          </CardHeader>
          {billing.status || paid || billing.cancelAtPeriodEnd ? (
            <CardContent className="divide-border divide-y">
              {billing.status ? (
                <Row
                  label="Status"
                  value={<span className="capitalize">{billing.status.replace(/_/g, ' ')}</span>}
                />
              ) : null}
              {paid ? (
                <Row
                  label={billing.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}
                  value={formatDate(billing.currentPeriodEnd)}
                />
              ) : null}
              {billing.cancelAtPeriodEnd ? (
                <Row
                  label="Auto-renew"
                  value={<span className="text-destructive">Off — cancels at period end</span>}
                />
              ) : null}
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>What this organization is using against its limits.</CardDescription>
          </CardHeader>
          <CardContent className="divide-border divide-y">
            <Row label="Projects" value={limitLabel(billing.projects, billing.maxProjects)} />
            <Row label="Admins" value={limitLabel(billing.admins, billing.maxAdmins)} />
            <Row label="Members" value={limitLabel(billing.nonAdmin, billing.maxNonAdmin)} />
          </CardContent>
        </Card>

        {!isAdmin ? (
          <Card>
            <CardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconCreditCard />
                  </EmptyMedia>
                  <EmptyTitle>
                    {paid ? 'Subscription managed by an admin' : 'Upgrade managed by an admin'}
                  </EmptyTitle>
                  <EmptyDescription>
                    {paid
                      ? 'Your organization is on the Crew plan. Only organization admins can change the subscription.'
                      : 'Your organization is on the free Solo plan. Ask an admin to upgrade to Crew to unlock exports, DXF overlays, and unlimited projects & members.'}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {contactHref ? (
                    <a href={contactHref} className={buttonVariants()}>
                      <IconMail className="mr-1 size-4" /> Contact your admin
                    </a>
                  ) : null}
                </EmptyContent>
              </Empty>
            </CardContent>
          </Card>
        ) : paid ? (
          <Card>
            <CardHeader>
              <CardTitle>Manage subscription</CardTitle>
              <CardDescription>
                Update your card, download invoices, or cancel in the Stripe Customer Portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" disabled={busy} onClick={openPortal}>
                <IconExternalLink className="mr-1 size-4" /> Manage billing
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IconSparkles className="text-primary size-5" /> Upgrade to Crew
              </CardTitle>
              <CardDescription>Unlock the full toolkit for your whole team.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="flex flex-col gap-2 text-sm">
                {crewSellingPoints(catalog).map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <IconCheck className="text-primary size-4 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="flex-1" disabled={busy} onClick={() => startCheckout('MONTHLY')}>
                  {busy
                    ? 'Redirecting…'
                    : `Upgrade — ${PRICING.monthly.label}${PRICING.monthly.cadence}`}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => startCheckout('ANNUAL')}
                >
                  Yearly — {PRICING.annual.label}
                  {PRICING.annual.cadence} · {PRICING.annual.note}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}
