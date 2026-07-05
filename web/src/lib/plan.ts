import { apiBaseUrl } from '@/lib/api';
import { graphql } from '@/lib/gql';

/**
 * The plan → capability catalog, shared by server and client (this module has no
 * `'use client'`, so it's safe to import from both). The client hooks live in
 * `@/lib/billing`; server components use {@link fetchPlanCatalog}.
 *
 * The catalog is the single source of truth for what each plan unlocks — upgrade
 * UI and pricing are derived from it, never hand-maintained. `minPlan`/`plan` are
 * `'SOLO' | 'CREW'`.
 */
export interface PlanFeature {
  blurb: string;
  key: string;
  label: string;
  minPlan: string;
}
export interface PlanLimits {
  maxAdmins: number;
  maxNonAdmin: number;
  maxProjects: number;
  plan: string;
}
export interface PlanCatalog {
  features: PlanFeature[];
  plans: PlanLimits[];
}

export const PLAN_CATALOG_QUERY = graphql(`
  query PlanCatalog {
    planCatalog {
      features {
        key
        label
        blurb
        minPlan
      }
      plans {
        plan
        maxProjects
        maxAdmins
        maxNonAdmin
      }
    }
  }
`);

/** Display-only pricing (the source of truth lives in Stripe). */
export const PRICING = {
  annual: { cadence: '/yr', label: '$99', note: 'Save ~17%' },
  monthly: { cadence: '/mo', label: '$10' },
} as const;

/** The Crew plan's selling points, derived from the catalog (no hand-maintained
 *  list): the unlimited-quota wins + each Crew feature's blurb. Empty until the
 *  catalog loads. */
export function crewSellingPoints(catalog: PlanCatalog | null): string[] {
  if (!catalog) {
    return [];
  }
  const crew = catalog.plans.find((p) => p.plan === 'CREW');
  const points: string[] = [];
  if (crew?.maxProjects === -1) {
    points.push('Unlimited projects');
  }
  if (crew?.maxAdmins === -1 && crew?.maxNonAdmin === -1) {
    points.push('Unlimited admins & members');
  }
  for (const f of catalog.features) {
    if (f.minPlan === 'CREW') {
      points.push(f.blurb);
    }
  }
  return points;
}

/** Look up a feature's catalog metadata by its stable key (e.g. `dxf_overlays`). */
export function featureMeta(catalog: PlanCatalog | null, key: string): PlanFeature | undefined {
  return catalog?.features.find((f) => f.key === key);
}

/**
 * Server-side catalog fetch for public pages (e.g. marketing pricing). Hits the
 * private API directly (the catalog is unauthenticated). Uses `no-store` so the
 * page renders on the server per request with correct data — the API isn't
 * reachable during the web image build, so build-time caching would bake in an
 * empty catalog. The catalog is tiny and only changes on deploy, so the cost is
 * negligible. Returns `null` on failure (upgrade lists degrade to empty).
 */
export async function fetchPlanCatalog(): Promise<PlanCatalog | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/graphql`, {
      body: JSON.stringify({ query: PLAN_CATALOG_QUERY.toString() }),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
      return null;
    }
    const payload = (await res.json()) as { data?: { planCatalog: PlanCatalog } };
    return payload.data?.planCatalog ?? null;
  } catch {
    return null;
  }
}
