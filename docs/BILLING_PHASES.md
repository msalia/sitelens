# SiteLens Billing — Implementation Phases

> Sequenced build for the Stripe paywall. See [BILLING_SPEC.md](./BILLING_SPEC.md).
> Each phase ends working, lint/clippy/fmt clean, and (where it touches the API)
> verified against the docker Postgres with `MAIL_CAPTURE=1`.

| Phase | Focus | Status |
| ----- | ----- | ------ |
| 1 | Billing state + Stripe client + Checkout/Portal + webhook | ✅ Done |
| 2 | Entitlements + enforcement guards | ✅ Done |
| 3 | Frontend: billing page, upgrade gate + prompts | Not started |
| 4 | Subprocessors/legal + tests | Not started |

---

## Phase 1 — Billing state, Stripe client, Checkout/Portal, webhook ✅

- [x] Migration `0013_billing`: `stripe_customer_id`, `stripe_subscription_id`,
      `subscription_status`, `current_period_end`, `cancel_at_period_end` on `orgs`.
- [x] `billing` module: Stripe REST over `reqwest` (secret from env) — ensure/create
      Customer (with `metadata.org_id`), Checkout Session, Portal Session.
- [x] GraphQL mutations `createCheckoutSession(interval)` + `createBillingPortalSession`
      (Admin-only), returning redirect URLs.
- [x] `POST /stripe/webhook` axum route: HMAC-SHA256 signature verify (+ replay
      tolerance); handles checkout.session.completed +
      customer.subscription.{created,updated,deleted} → upsert org billing columns
      (idempotent).
- [x] `STRIPE_*` env wired (`StripeConfig::from_env`); `.env.example` documented.
- Stripe products created (live + test); `sitelens/.env` uses the test key + test
      price IDs, live key/IDs kept in `integrations/STRIPE/.creds`.
- [ ] **Deploy:** Traefik route `Path=/stripe/webhook` → API; set the Stripe webhook
      endpoint + `STRIPE_WEBHOOK_SECRET` in Dokploy.

**Validates:** an Admin can reach Stripe Checkout, complete it, and the org's billing
columns reflect the subscription via the webhook. *(Manual Checkout verification pending
the webhook secret; full suite of 50 integration tests passes with the migration.)*

## Phase 2 — Entitlements + enforcement ✅

- [x] `org_billing(pool, org_id)` → status, `paid`/`restricted`/`can_export`, usage counts
      (one round-trip with subselect counts); Solo caps as consts.
- [x] Guards in `schema/mod.rs`: `require_editor_active` (read-only lock),
      `require_paid`/`require_export`, `require_project_quota`, `require_member_quota`.
- [x] Applied: editor mutations across terrain/points/grid/projects/overlays use
      `require_editor_active`; project create/import → quota; invite + promote-to-admin →
      member/admin caps; `export_points` → export gate.
- [x] DXF made Crew-only: `require_paid` on `cadOverlays`, `cadOverlayContent`, `uploadDxf`,
      `setCadGeoreference`, `deleteCadOverlay` (upload **and** viewing).
- [x] `billing` query → plan, status, period end, cancel flag, `restricted`, `canExport`,
      usage + limits (`-1` = unlimited).
- [x] Integration tests: free-tier blocks (2nd project, export, DXF, overlay view), member
      caps (6th member, 2nd admin), paid unlocks, `billing` query per plan, lapsed → read-only.

**Validates:** free orgs are capped at Solo limits, lapsed orgs go read-only, exports + DXF are
paid-only — all enforced server-side. *(55 integration tests pass.)*

## Phase 3 — Frontend

- [ ] `billing` query client + a `useBilling` accessor.
- [ ] `/settings/billing` (Admin): plan/status/renewal; Upgrade (monthly/annual) →
      Checkout; Manage billing → Portal. Refetch on return.
- [ ] Full-screen upgrade gate when `restricted` (Admin CTAs vs "ask your admin").
- [ ] Shared upgrade dialog at Solo caps (2nd project / 6th member / export); disable +
      lock affordances mirroring server entitlements.

**Validates:** the paywall is visible and actionable; users can subscribe and self-manage.

## Phase 4 — Legal + tests

- [ ] Add Stripe to `docs/legal/SUBPROCESSORS.md`, `/subprocessors`, privacy policy.
- [ ] Integration tests: signed webhook events drive billing state (no real charge).
      *(Entitlement-guard tests landed in Phase 2.)*
- [ ] e2e: upgrade gate renders for a restricted org; billing page shows plan/CTAs.

**Validates:** compliance updated; enforcement + webhook logic covered without real charges.
