# Phase — Public Marketing Landing Page

> Status: **Not started** · Owner: web · Created 2026-06-12

Replace the placeholder home page (`web/src/app/page.tsx`, currently an API
health-check stub) with a real public marketing landing page: an animated dark
hero, a three-card pricing section (Solo / Crew monthly / Crew yearly), and a
multi-column footer. Plus public chrome (header + footer) and a docs page
describing what each plan tier unlocks.

## Goals

- A polished, on-brand landing page that converts visitors to `/signup`.
- Pricing presented as **display-only** (real Stripe Checkout already lives in
  `settings/billing` for logged-in admins). Marketing CTAs route to `/signup`.
- Reuse what's already installed — **no new runtime dependencies** (three.js +
  @react-three/fiber are already present; only the shadcn `badge` primitive is
  added).

## Design decisions (locked)

- **Headline angle:** confidence-focused (accuracy / sub-mm RMS coordinate-tie).
- **Hero visual:** animated 3D wireframe sphere of glowing great-circle arcs,
  **cyan/teal geodetic** palette on deep navy, slow auto-rotation + subtle
  pointer parallax. Built with R3F (no new deps), lazy-loaded, with a static
  SVG fallback when WebGL is unavailable.
- **Pricing = 3 cards** (no billing toggle): Solo (Free), Crew · Monthly
  ($10/mo), Crew · Yearly ($99/yr, highlighted "Best value", ~17% off).
- **Header/footer:** public chrome. Contact = `mailto:`. Docs link left as-is
  (the docs site stays auth-gated inside `AppShell`).
- **Roundedness:** project default (`--radius: 0.625rem`); no sharp override
  for SiteLens.

## Source of truth (no Stripe call needed)

- Tier caps — `api/src/billing.rs:202-238`: Solo (free) = 1 project, 1 admin +
  up to 5 members, no exports. Crew (paid) = unlimited + exports + DXF overlays.
- Display pricing + Crew feature list — `web/src/lib/billing.ts:60-72`
  (`PRICING`, `CREW_FEATURES`). Crew = $10/mo or $99/yr (~17%).

## Plan tiers (card + docs copy)

**Solo — Free**
- 1 project
- Team up to 6 (1 admin + 5 members)
- Coordinate-tie (Helmert transform) + coordinate conversion / inspector
- CSV / LandXML point import
- 3D Cesium visualization

**Crew — $10/mo or $99/yr**
- Everything in Solo, plus:
- Unlimited projects
- Unlimited admins & members
- CSV / LandXML & full project exports
- DXF overlays in the 3D view

## Design update (2026-06-13) — hero retargeted

The hero was re-styled to match a user-supplied reference (Liquid Brokers): a
**centered** headline + subhead + single white-pill CTA, with a large wireframe
globe **rising from the bottom-center** behind the content and two floating glass
stat cards overlapping it. Palette shifted from cyan/teal to **indigo/blue arcs +
violet** accents for cohesion with the violet `Sign up` pill. The globe arcs are
now **organic** — perturbed with smooth periodic noise (in-plane radius +
out-of-plane warble) and drawn with drei `<Line>` for real thickness (plain
`lineBasicMaterial` can't thicken in WebGL). The secondary "See how it works"
hero button was dropped (single CTA) and footer **social icons removed** (no
social presence) — footer keeps the copyright line only.

> Note: drei `<Line>` (`@react-three/drei`, already installed) is now used — no
> new runtime dependency, but worth recording vs the original `lineBasicMaterial`
> plan.

## Tasks

- [x] `marketing/site-header.tsx` — compass wordmark · centered links (Features,
      Pricing, Docs, Contact) · `Log in` ghost + `Sign up` violet pill;
      mobile-collapsing menu. Contact = `mailto:`.
- [x] `marketing/site-footer.tsx` — logo + tagline; columns Product (Features,
      Pricing, Docs) · Company (Contact, Login, Signup) · Legal (Terms, Privacy,
      Subprocessors); divider + copyright. Copyright reads
      "© 2023–2026 KeshavTech. All rights reserved." (social icons removed.)
- [x] `marketing/hero-globe.tsx` — R3F indigo/blue great-circle sphere (organic
      noise, drei `<Line>` thickness, additive blending, auto-rotate + parallax);
      client, lazy, SVG fallback.
- [x] Hero section + rebuild `app/page.tsx` — centered headline + subhead, single
      white pill CTA → `/signup`, bottom-rising globe, two glass stat cards.
- [x] `marketing/pricing.tsx` — 3 cards (Solo / Crew Monthly / Crew Yearly),
      Crew Yearly highlighted with "Best value" `Badge`; CTAs → `/signup`.
- [x] Add shadcn `badge` primitive (`components/ui/badge.tsx`).
- [x] Docs: `content/docs/plans.md` + `docs/plans/page.tsx` + register in
      `lib/docs.ts` nav — tier comparison (Solo vs Crew).
- [~] Responsive pass (mobile → desktop) — hero centers, stat cards hidden on
      mobile, header collapses; needs a visual pass at 375/768/1280. (Page is a
      self-contained dark experience, so no light-mode handling needed.)
- [ ] Playwright screenshot check in `web/e2e` — blocked locally: Chromium can't
      launch from this session (macOS mach-port sandbox); run from a terminal.
- [~] Lint + format — `eslint` + `tsc` clean; run `npm run format` before commit.
      Commit + push only on explicit go-ahead.

## Acceptance criteria

- `/` renders the new landing (hero + pricing + footer); no API health stub.
- Sphere animates smoothly and degrades gracefully without WebGL.
- All three pricing cards show correct prices/features; CTAs reach `/signup`.
- Header/footer links resolve (Contact mailto, Legal pages, Docs).
- Docs `plans` page lists each tier's entitlements and is reachable from the
  docs nav.
- Responsive at 375px / 768px / 1280px. Lint + format clean.

## Out of scope

- Changes to the Stripe billing model or entitlements (Solo/Crew stay as-is).
- Making the docs site public, or building a real `/contact` page (mailto only).
- New runtime dependencies beyond the shadcn `badge` component.
