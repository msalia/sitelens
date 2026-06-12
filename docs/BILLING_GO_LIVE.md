# Billing — Production Go-Live Runbook

The Stripe paywall is code-complete and verified in test mode (Stripe CLI + test
card). Going live is **configuration only** — no code changes. Do these steps in
order.

> Plans: **Solo** (free) → **Crew** ($10/mo or $99/yr). One subscription per org,
> Admin-managed. Webhook reaches the API through the web proxy route
> `/stripe/webhook`, so **no Traefik/Dokploy routing change is needed**.

## 1. Switch Stripe to live mode

In the Stripe Dashboard, toggle to **live mode** (not test).

- [ ] Confirm the **Crew product** + its **monthly ($10)** and **annual ($99)** prices
      exist in live mode (create them if not — they're separate from test mode).
      Record the live price IDs.
- [ ] Choose the **payment methods** offered at checkout (Settings → Payment methods,
      live mode). Card-only is simplest; Link/Klarna/etc. are fine too.

## 2. Create the live webhook endpoint

Stripe Dashboard (live) → **Developers → Webhooks → Add endpoint**:

- [ ] Endpoint URL: `https://sitelens.msalia.org/stripe/webhook`
- [ ] Events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Copy the endpoint's **Signing secret** (`whsec_…`) for the next step.

## 3. Set the live env in Dokploy

On the sitelens compose service env (the `api` + `web` read the same `.env`):

- [ ] `STRIPE_SECRET_KEY` = live `sk_live_…` (rotate the key first if it was ever
      shared; the previously-shared live key in `integrations/STRIPE/.creds` should be
      rotated and replaced).
- [ ] `STRIPE_WEBHOOK_SECRET` = the live endpoint's `whsec_…` (from step 2).
- [ ] `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` = the **live** price IDs (step 1).
- [ ] `APP_URL` = `https://sitelens.msalia.org` (Checkout success/cancel + Portal return).
- [ ] Leave `STRIPE_E2E` unset (it only gates the opt-in e2e spec).
- [ ] `MAIL_CAPTURE` unset in prod (so verification/invite emails actually send).

## 4. Deploy

- [ ] Deploy the latest `main` (api + web) via Dokploy. Recreate the services so the
      new env is picked up.

## 5. Verify

- [ ] Routing + signature rejection:
      `curl -i https://sitelens.msalia.org/stripe/webhook -X POST` → **400**
      (reached the API, rejected unsigned).
- [ ] Stripe Dashboard → the webhook endpoint → **Send test webhook** → expect 200.
- [ ] Real upgrade: as an org Admin, **Settings → Billing → Upgrade**, complete
      Checkout, confirm the org flips to **Crew** and the renewal date shows. (Use a
      real card or a live test as appropriate — this is live mode, so it charges.)
- [ ] Customer Portal opens (Manage billing) and cancel sets "cancels at period end".

## Rollback / notes

- Disabling billing is graceful: if `STRIPE_SECRET_KEY` is empty, `StripeConfig.enabled()`
  is false and the Checkout/Portal mutations return "billing is not configured" (the rest
  of the app is unaffected).
- Entitlements are enforced server-side regardless of the frontend, so there's no way to
  bypass caps/exports/DXF by calling the API directly.
- A missed webhook self-heals: the `billing` query backfills subscription state from
  Stripe (bounded by a short HTTP timeout) when a paid org has no renewal date yet.
