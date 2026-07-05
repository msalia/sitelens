import { IconCheck } from '@tabler/icons-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { crewSellingPoints, fetchPlanCatalog, PRICING } from '@/lib/plan';
import { cn } from '@/lib/utils';

interface Plan {
  cadence?: string;
  cta: string;
  featured?: boolean;
  features: string[];
  featuresLead?: string;
  name: string;
  note?: string;
  price: string;
  tagline: string;
}

const SOLO_FEATURES = [
  '1 project',
  'Team up to 6 (1 admin + 5 members)',
  'Coordinate-tie + conversion & inspector',
  'CSV / LandXML point import',
  '3D visualization',
];

/** The Crew tier's cards, with the gated-feature list sourced from the plan
 *  catalog (single source of truth) rather than a hand-maintained copy. */
function buildPlans(crewFeatures: string[]): Plan[] {
  return [
    {
      cta: 'Get started',
      features: SOLO_FEATURES,
      name: 'Solo',
      price: 'Free',
      tagline: 'Everything to tie and visualize a single site.',
    },
    {
      cadence: PRICING.monthly.cadence,
      cta: 'Start with Crew',
      features: crewFeatures,
      featuresLead: 'Everything in Solo, plus:',
      name: 'Crew · Monthly',
      price: PRICING.monthly.label,
      tagline: 'For teams running multiple jobs at once.',
    },
    {
      cadence: PRICING.annual.cadence,
      cta: 'Start with Crew',
      featured: true,
      features: crewFeatures,
      featuresLead: 'Everything in Solo, plus:',
      name: 'Crew · Yearly',
      note: PRICING.annual.note,
      price: PRICING.annual.label,
      tagline: 'The full toolkit at the best price.',
    },
  ];
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-xl border p-6 backdrop-blur-sm transition-colors',
        plan.featured
          ? 'border-indigo-400/40 bg-indigo-400/[0.06] shadow-[0_0_40px_-12px_rgba(99,102,241,0.45)]'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20',
      )}
    >
      {plan.featured ? (
        <Badge className="absolute -top-2.5 right-6 border-transparent bg-gradient-to-r from-indigo-400 to-violet-400 text-[#070b16]">
          Best value
        </Badge>
      ) : null}

      <h3 className="text-sm font-semibold text-white">{plan.name}</h3>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold tracking-tight text-white">{plan.price}</span>
        {plan.cadence ? <span className="text-sm text-white/50">{plan.cadence}</span> : null}
        {plan.note ? (
          <span className="ml-2 text-xs font-medium text-indigo-300">{plan.note}</span>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/55">{plan.tagline}</p>

      <Link
        href="/signup"
        className={cn(
          'mt-6 flex h-10 items-center justify-center rounded-lg text-sm font-medium transition-colors',
          plan.featured
            ? 'bg-gradient-to-r from-indigo-400 to-violet-400 text-[#070b16] hover:opacity-90'
            : 'bg-white/10 text-white hover:bg-white/15',
        )}
      >
        {plan.cta}
      </Link>

      {plan.featuresLead ? (
        <p className="mt-6 text-xs font-medium text-white/40">{plan.featuresLead}</p>
      ) : null}
      <ul className="mt-3 space-y-3 text-sm text-white/70">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <IconCheck className="mt-0.5 size-4 shrink-0 text-indigo-300" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function Pricing() {
  const catalog = await fetchPlanCatalog();
  const plans = buildPlans(crewSellingPoints(catalog));
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold tracking-wide text-indigo-400 uppercase">Pricing</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Start free. Upgrade when your crew grows.
        </h2>
        <p className="mt-4 text-base text-white/55">
          Solo is free forever for a single site. Crew unlocks unlimited projects, exports, and DXF
          overlays.
        </p>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.name} plan={plan} />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-white/40">
        Prices in USD. Billing is managed securely by Stripe.
      </p>
    </section>
  );
}
