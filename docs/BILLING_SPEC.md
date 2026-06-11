# SiteLens Billing — Spec (Stripe)

> Subscription paywall. One paid plan (**Crew**) over a limited free tier (**Solo**),
> billed per-organization via Stripe Checkout + Customer Portal, with access driven
> by webhooks. See [BILLING_PHASES.md](./BILLING_PHASES.md) for the build order.

## Model

- **Billing unit: the organization.** One Stripe Customer + one Subscription per org.
  Billing is **Admin-only**.
- **Plans**
  - **Solo** — free, default. `1 project · 1 admin · ≤5 non-admin members · no exports`.
  - **Crew** — paid. Unlimited projects / admins / members + exports.
    `$10/mo` or `$99/yr` (USD). Stripe Product `SiteLens Crew` (`prod_UgfMHhyZMS5fnt`),
    prices `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`.

## Entitlements & enforcement (server is authoritative)

`entitlements(org)` derives from the subscription status:

- **Paid** iff `status ∈ {active, trialing, past_due}` (Stripe dunning keeps `past_due`
  usable until it cancels). `canceled`/none ⇒ free.
- **Cancel** uses `cancel_at_period_end`: the sub stays `active` until
  `current_period_end`, then Stripe emits `subscription.deleted` ⇒ we lock.

Two enforcement situations:

1. **At a Solo cap** (free, within limits, trying to exceed) — block just that action
   with an upgrade error: create 2nd project · invite 6th non-admin · add/promote 2nd
   admin · any export.
2. **Restricted / read-only** — a non-paid org whose usage **exceeds** Solo limits
   (e.g. a lapsed Crew org with >1 project or >5 members). All mutations blocked
   (projects, points, grid, overlays, terrain, groups, categories) + no exports;
   reads allowed. Admin sees a **full-screen upgrade page**.

A fresh free org within Solo limits is **not** restricted — it's just capped.

## Data model

Migration adds to the organizations table:

| column | type | note |
|---|---|---|
| `stripe_customer_id` | text null | set on first Checkout |
| `stripe_subscription_id` | text null | |
| `subscription_status` | text null | Stripe status; null ⇒ free |
| `current_period_end` | timestamptz null | renewal / lock date |
| `cancel_at_period_end` | bool, default false | |

Plan is **derived** from status (no stored plan column). The Stripe Customer carries
`metadata.org_id` so webhooks map back to the org.

## Backend (axum + GraphQL)

A `billing` module wrapping Stripe (secret from `STRIPE_SECRET_KEY`). Hand-rolled over
`reqwest` (form POSTs) to keep deps light, matching the existing OpenTopography/Overpass
style; webhook signatures verified manually (HMAC-SHA256 over `t.payload`, `hmac`+`sha2`).

- **Mutations** (Admin):
  - `createCheckoutSession(interval: MONTHLY | ANNUAL): String` — ensure the org's
    Customer, create a `mode=subscription` Checkout Session for the chosen price,
    `client_reference_id = org_id`, success/cancel → `APP_URL/settings/billing`. Returns URL.
  - `createBillingPortalSession: String` — Customer Portal session URL (manage card,
    invoices, cancel). Requires an existing customer.
- **Query** `billing`: `{ plan, status, currentPeriodEnd, cancelAtPeriodEnd, restricted,
  canExport, limits, usage{projects,admins,members} }` — powers the UI gating.
- **Webhook** `POST /stripe/webhook` (axum, alongside `/graphql`): verify signature, handle
  `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`,
  `invoice.payment_failed` → upsert the org's billing columns. Idempotent.
- **Guards** in `schema/mod.rs`: `require_not_restricted(ctx)` on editor mutations;
  per-cap checks (`require_project_quota`, `require_member_quota`, `require_admin_quota`);
  `require_export(ctx)` on `export_points`.
- **Env:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
  `STRIPE_PRICE_ANNUAL` (in `.env` / Dokploy). **Deploy:** Traefik must route
  `Path=/stripe/webhook` to the API.

## Frontend

- **`/settings/billing`** (Admin): current plan + status + renewal/cancel date; **Upgrade**
  (monthly/annual → Checkout redirect) when free; **Manage billing** (→ Portal) when paid.
- **Full-screen upgrade gate**: shown when `restricted` — value prop + Checkout CTAs for
  Admins, "ask your admin to upgrade" for others.
- **Inline upgrade prompts** at Solo caps (2nd project / 6th member / export) via a shared
  dialog. UI mirrors server entitlements from the `billing` query (disable + lock affordances).

## Legal

Add **Stripe** to `docs/legal/SUBPROCESSORS.md`, the public `/subprocessors` page, and the
privacy policy (payment processor; processes billing contact + card data on Stripe's side).

## Testing note

Account is in **live mode**, so automated end-to-end Checkout would create real charges.
Enforcement + webhook handling are tested with crafted **signed** events + seeded DB state
(no real charge); the Checkout/Portal redirects are verified manually. (If a `sk_test_` key
is provided later, the full flow can be covered with Stripe test cards.)
