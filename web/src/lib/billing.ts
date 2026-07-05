'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { PLAN_CATALOG_QUERY, type PlanCatalog } from '@/lib/plan';
import { errMsg } from '@/lib/utils';

// The plan catalog (types, query, PRICING, and pure helpers) lives in the neutral
// `@/lib/plan` module so server components can use it too. Re-exported here so the
// existing `@/lib/billing` import sites keep working.
export {
  crewSellingPoints,
  featureMeta,
  fetchPlanCatalog,
  PLAN_CATALOG_QUERY,
  type PlanCatalog,
  type PlanFeature,
  type PlanLimits,
  PRICING,
} from '@/lib/plan';

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

/** Fetches the static plan/feature catalog (drives upgrade UI + selling points). */
export function usePlanCatalog() {
  const [catalog, setCatalog] = useState<PlanCatalog | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await gql(PLAN_CATALOG_QUERY);
        if (active) {setCatalog(data.planCatalog);}
      } catch {
        if (active) {setCatalog(null);}
      } finally {
        if (active) {setLoading(false);}
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { catalog, loading };
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
