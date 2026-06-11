# SiteLens Billing — Implementation Phases

> Sequenced build for the Stripe paywall. See [BILLING_SPEC.md](./BILLING_SPEC.md).
> Each phase ends working, lint/clippy/fmt clean, and (where it touches the API)
> verified against the docker Postgres with `MAIL_CAPTURE=1`.

| Phase | Focus | Status |
| ----- | ----- | ------ |
| 1 | Billing state + Stripe client + Checkout/Portal + webhook | ✅ Done |
| 2 | Entitlements + enforcement guards | Not started |
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

## Phase 2 — Entitlements + enforcement

- [ ] `org_billing(pool, org_id)` → status, derived plan, usage counts, `restricted`,
      `can_export`, limits.
- [ ] Guards in `schema/mod.rs`: `require_not_restricted`, `require_project_quota`,
      `require_member_quota`, `require_admin_quota`, `require_export`.
- [ ] Apply: project create; user invite + role change (admin/member caps); `export_points`;
      and `require_not_restricted` across editor mutations.
- [ ] `billing` query exposing the above for the client.

**Validates:** free orgs are capped at Solo limits, lapsed orgs go read-only, exports are
paid-only — all enforced server-side.

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
- [ ] Integration tests: signed webhook events drive billing state; entitlement guards
      block (over-cap create, restricted mutation, free export) and allow when paid
      (seeded subscription state — no real charge).
- [ ] e2e: upgrade gate renders for a restricted org; billing page shows plan/CTAs.

**Validates:** compliance updated; enforcement + webhook logic covered without real charges.
