import type { Metadata } from 'next';

import { IconArrowRight, IconArrowUpRight } from '@tabler/icons-react';
import Link from 'next/link';

import { JsonLd } from '@/components/json-ld';
import { Features } from '@/components/marketing/features';
import { HeroGlobe } from '@/components/marketing/hero-globe';
import { Pricing } from '@/components/marketing/pricing';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { ORG_NAME, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  // Title + description inherit the root defaults; we only pin the canonical.
  alternates: { canonical: '/' },
};

/** SoftwareApplication structured data — makes SiteLens eligible for rich
 *  product results and clarifies the entity to search engines. */
const SOFTWARE_APPLICATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  applicationCategory: 'BusinessApplication',
  description: SITE_DESCRIPTION,
  name: SITE_NAME,
  offers: [
    { '@type': 'Offer', name: 'Solo', price: '0', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Crew', priceCurrency: 'USD' },
  ],
  operatingSystem: 'Web',
  publisher: { '@type': 'Organization', name: ORG_NAME },
  url: SITE_URL,
};

/** A small floating glass stat card that overlaps the hero globe. */
function StatCard({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={`absolute hidden w-60 rounded-2xl border border-white/10 bg-[#0b1024]/60 p-4 backdrop-blur-md lg:block ${className ?? ''}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs text-white/55">{label}</span>
        <span className="flex size-6 items-center justify-center rounded-full bg-white text-[#070b16]">
          <IconArrowUpRight className="size-3.5" />
        </span>
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  return (
    // The marketing page is a self-contained dark experience, independent of the
    // app's light/dark setting — `dark` forces shadcn tokens to their dark values.
    <div className="dark flex min-h-screen flex-col bg-[#070b16] text-white">
      <JsonLd data={SOFTWARE_APPLICATION_JSONLD} />
      <SiteHeader />

      <main className="flex-1">
        {/* HERO — full-height, centered, with a globe rising from the bottom. */}
        <section className="relative flex min-h-[calc(100vh-4rem)] flex-col overflow-hidden">
          {/* Indigo glow from the top. */}
          <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,rgba(79,70,229,0.35),transparent_60%),radial-gradient(70%_60%_at_12%_0%,rgba(99,102,241,0.25),transparent_55%)]" />
          {/* Star field. */}
          <div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                'radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.5), transparent), radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.35), transparent), radial-gradient(1px 1px at 80px 160px, rgba(255,255,255,0.4), transparent), radial-gradient(1.5px 1.5px at 180px 50px, rgba(255,255,255,0.3), transparent), radial-gradient(1px 1px at 240px 130px, rgba(255,255,255,0.45), transparent)',
              backgroundSize: '260px 220px',
            }}
          />
          {/* Edge vignette. */}
          <div className="absolute inset-0 bg-[radial-gradient(100%_100%_at_50%_40%,transparent_55%,rgba(0,0,0,0.55))]" />

          {/* Globe rising from the bottom-center, behind the content. */}
          <div className="pointer-events-none absolute bottom-0 left-1/2 aspect-square w-[min(1500px,185vw)] -translate-x-1/2 translate-y-[58%]">
            <div className="absolute inset-[18%] rounded-full bg-indigo-500/10 blur-3xl" />
            <HeroGlobe />
          </div>

          {/* Centered headline + subhead + single CTA. */}
          <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-6 pt-20 text-center sm:pt-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              <span className="size-1.5 rounded-full bg-indigo-400" />
              Built for construction surveyors
            </span>
            <h1 className="mt-7 text-5xl leading-[1.05] font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
              Tie Every Survey
              <br />
              To Ground Truth
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
              Solve the grid-to-ground coordinate transform with a least-squares Helmert fit, then
              see your control, points, and CAD in a live 3D scene.
            </p>
            <Link
              href="/signup"
              className="group mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#070b16] transition-colors hover:bg-white/90"
            >
              Start for free
              <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Floating stat cards overlapping the globe. */}
          <StatCard label="Coordinate-tie" className="top-[58%] left-[6%] xl:left-[12%]">
            <p className="mt-8 text-sm leading-snug font-semibold text-white">
              Sub-millimetre residuals
              <span className="mt-1 block text-xs font-normal text-white/40">
                Helmert least-squares RMS
              </span>
            </p>
          </StatCard>
          <StatCard label="Transform fit" className="top-[72%] right-[6%] xl:right-[12%]">
            <p className="mt-4 text-3xl font-bold tracking-tight text-white">99.8%</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[98%] rounded-full bg-gradient-to-r from-indigo-400 to-violet-400" />
            </div>
          </StatCard>
        </section>

        <Features />
        <Pricing />

        {/* Closing CTA. */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-24">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/15 via-white/[0.03] to-violet-500/10 px-8 py-14 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to tie your next site?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/60">
              Create a free Solo project and have your first coordinate-tie solved in minutes.
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#070b16] transition-colors hover:bg-white/90"
            >
              Get started free
              <IconArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
