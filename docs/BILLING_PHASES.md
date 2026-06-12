# SiteLens Billing — Implementation Phases

> Sequenced build for the Stripe paywall. See [BILLING_SPEC.md](./BILLING_SPEC.md).
> Each phase ends working, lint/clippy/fmt clean, and (where it touches the API)
> verified against the docker Postgres with `MAIL_CAPTURE=1`.

| Phase | Focus                                                     | Status           |
| ----- | --------------------------------------------------------- | ---------------- |
| 1     | Billing state + Stripe client + Checkout/Portal + webhook | ✅ Done          |
| 2     | Entitlements + enforcement guards                         | ✅ Done          |
| 3     | Frontend: billing page, upgrade gate + prompts            | ✅ Done          |
| 4     | Subprocessors/legal + tests                               | ✅ Done          |
| 5     | Production go-live (Dokploy + Stripe live mode)           | ✅ Done          |

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
      (idempotent). `current_period_end` reads the top-level field and falls back to
      `items[].current_period_end` (newer Stripe API versions moved it onto the item).
- [x] `STRIPE_*` env wired (`StripeConfig::from_env`); `.env.example` documented.
- [x] Stripe products created (live + test); `sitelens/.env` uses the test key + test
      price IDs, live key/IDs kept in `integrations/STRIPE/.creds`.
- [x] **Webhook delivery without infra changes:** a Next route (`/stripe/webhook`)
      proxies the raw body + `Stripe-Signature` to the internal API, exactly like
      `/api/graphql` — so prod needs no Traefik/Dokploy route. Verified end-to-end
      with the Stripe CLI (signed events flip the org; bad/unsigned → 400).

**Validates:** an Admin can reach Stripe Checkout, complete it, and the org's billing
columns reflect the subscription via the webhook.

## Phase 2 — Entitlements + enforcement ✅

- [x] `org_billing(pool, org_id)` → status, `paid`/`restricted`/`can_export`, usage counts
      (one round-trip with subselect counts); Solo caps as consts.
- [x] Guards in `schema/mod.rs`: `require_editor_active` (read-only lock),
      `require_paid`/`require_export`, `require_project_quota`, `require_member_quota`.
- [x] Applied: editor mutations across terrain/points/grid/projects/overlays use
      `require_editor_active`; project create/import → quota; invite + promote-to-admin →
      member/admin caps; `export_points` + `project_export` → export gate.
- [x] DXF made Crew-only: `require_paid` on `cadOverlayContent`, `uploadDxf`,
      `setCadGeoreference`, `deleteCadOverlay`; `cadOverlays` returns `[]` for non-paid
      orgs so the bundled scene query still loads.
- [x] `billing` query → plan, status, period end, cancel flag, `restricted`, `canExport`,
      usage + limits (`-1` = unlimited), and `adminEmails` (so non-admins can reach an admin).
- [x] Integration tests across `tests/integration/` modules (`billing`, `webhooks`, …).

**Validates:** free orgs are capped at Solo limits, lapsed orgs go read-only, exports + DXF are
paid-only — all enforced server-side.

## Phase 3 — Frontend ✅

- [x] `useBilling` / `useCheckout` clients + a `billing` query (`web/src/lib/billing.ts`).
- [x] `/settings/billing`: plan/status/renewal + usage vs limits; admins get Checkout
      (monthly/annual) + Customer Portal (opens in a new tab); handles
      `?checkout=success|cancel`. Non-admins get an Empty state with a **Contact your
      admin** mailto (to `adminEmails`).
- [x] Full-screen read-only `UpgradeGate` when `restricted` (lapsed over caps), shown
      everywhere except the billing page so admins can resubscribe.
- [x] Inline upgrade prompts at Solo caps (2nd project, point/project export); the DXF
      **Overlays tab is hidden** entirely on the free tier.
- [x] Settings shows the tier badge (`Solo · Free` / `Crew`) + an upgrade affordance on free;
      Billing added to the rail + user menu.

**Validates:** the paywall is visible and actionable; users can subscribe and self-manage.

## Phase 4 — Legal + tests ✅

- [x] Stripe added to `docs/legal/SUBPROCESSORS.md`, `/subprocessors`, and the privacy policy.
- [x] Integration tests: signed webhook signature verification + the full subscription
      lifecycle (created / past_due / trialing / cancel-at-period-end / deleted /
      idempotency / customer-id fallback / unmappable no-op) — no real charges.
- [x] e2e (`web/e2e/billing.spec.ts`): free-vs-Crew coverage for every gate (billing page,
      settings badge, 2nd project, point/project export, DXF tab, lapsed read-only gate,
      non-admin contact-admin). Crew minted via a DB backdoor for speed.
- [x] e2e (`web/e2e/billing-checkout.spec.ts`): opt-in (`STRIPE_E2E=1`) real hosted Checkout
      with a test card via the Stripe CLI, asserting the webhook flips the org to Crew.

**Validates:** compliance updated; enforcement + webhook logic covered without real charges.
_(67 API integration tests + the e2e billing suite pass.)_

## Phase 5 — Production go-live ✅

Code is complete and verified in test mode. Going live is configuration only — no code
changes. See the runbook: [BILLING_GO_LIVE.md](./BILLING_GO_LIVE.md).

- [x] Deploy the latest `api` + `web` to the server (Dokploy).
- [x] Stripe **live mode**: create the webhook endpoint
      `https://sitelens.msalia.org/stripe/webhook` for
      `checkout.session.completed` + `customer.subscription.{created,updated,deleted}`.
- [x] Set Dokploy env: live `STRIPE_SECRET_KEY`, live `STRIPE_WEBHOOK_SECRET`, live
      `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`, `APP_URL=https://sitelens.msalia.org`;
      leave `STRIPE_E2E` unset.
- [x] Verify routing: `curl -i -X POST https://sitelens.msalia.org/stripe/webhook` → **400**
      (proxied to the API, unsigned event rejected). A final real Admin upgrade in the live
      UI confirms the end-to-end charge → Crew flip.
- [x] Decide live-mode payment methods (Card-only vs Link/Klarna/etc.).
