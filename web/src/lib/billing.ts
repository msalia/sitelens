'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { errMsg } from '@/lib/utils';

/** The org's billing posture, mirroring the API's `BillingInfo`. Limits use
 *  `-1` for "unlimited" (Crew). `plan` is `'solo'` (free) or `'crew'` (paid). */
export interface Billing {
  adminEmails: string[];
  admins: number;
  cancelAtPeriodEnd: boolean;
  canExport: boolean;
  currentPeriodEnd: string | null;
  maxAdmins: number;
  maxNonAdmin: number;
  maxProjects: number;
  nonAdmin: number;
  plan: string;
  projects: number;
  restricted: boolean;
  status: string | null;
}

export const BILLING_QUERY = graphql(`
  query Billing {
    billing {
      plan
      status
      currentPeriodEnd
      cancelAtPeriodEnd
      restricted
      canExport
      projects
      admins
      nonAdmin
      maxProjects
      maxAdmins
      maxNonAdmin
      adminEmails
    }
  }
`);

const CREATE_CHECKOUT = graphql(`
  mutation CreateCheckoutSession($interval: BillingInterval!) {
    createCheckoutSession(interval: $interval)
  }
`);

const CREATE_PORTAL = graphql(`
  mutation CreateBillingPortalSession {
    createBillingPortalSession
  }
`);

/** Display-only pricing (the source of truth lives in Stripe). */
export const PRICING = {
  annual: { cadence: '/yr', label: '$99', note: 'Save ~17%' },
  monthly: { cadence: '/mo', label: '$10' },
} as const;

/** The Crew plan's selling points — shared across upgrade surfaces. */
export const CREW_FEATURES = [
  'Unlimited projects',
  'Unlimited admins & members',
  'CSV / LandXML & full project exports',
  'DXF overlays in the 3D view',
] as const;

export const isPaid = (b: Billing | null) => b?.plan === 'crew';

/** A `mailto:` to the org's admins for non-admins to ask about the subscription,
 *  or `null` if there are no admin emails to reach. */
export function contactAdminHref(
  emails: string[],
  subject = 'SiteLens — upgrade to Crew',
): string | null {
  return emails.length > 0
    ? `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}`
    : null;
}

/** Fetches the caller org's billing posture. */
export function useBilling() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await gql(BILLING_QUERY);
      setBilling(data.billing);
    } catch {
      setBilling(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { billing, loading, reload };
}

/** Redirects to hosted Stripe Checkout / the Customer Portal. Admin-only on the
 *  server; on failure we toast and clear `busy` (no redirect happens). */
export function useCheckout() {
  const [busy, setBusy] = useState(false);

  async function startCheckout(interval: 'MONTHLY' | 'ANNUAL') {
    setBusy(true);
    try {
      const { createCheckoutSession } = await gql(CREATE_CHECKOUT, { interval });
      window.location.href = createCheckoutSession;
    } catch (err) {
      toast.error(errMsg(err, 'Could not start checkout'));
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    // Open the tab synchronously (inside the click) so it isn't blocked as a
    // popup after the await; point it at the portal URL once we have it.
    const tab = window.open('', '_blank');
    try {
      const { createBillingPortalSession } = await gql(CREATE_PORTAL);
      if (tab) {
        tab.location.href = createBillingPortalSession;
      } else {
        window.location.href = createBillingPortalSession;
      }
    } catch (err) {
      tab?.close();
      toast.error(errMsg(err, 'Could not open the billing portal'));
    } finally {
      setBusy(false);
    }
  }

  return { busy, openPortal, startCheckout };
}
