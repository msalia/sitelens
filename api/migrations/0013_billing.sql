-- Stripe billing: per-organization subscription state. The plan (Solo/Crew) is
-- DERIVED from subscription_status (no stored plan column): paid access iff status
-- is active/trialing/past_due; null/canceled is free.
ALTER TABLE orgs
    ADD COLUMN stripe_customer_id     text,
    ADD COLUMN stripe_subscription_id text,
    ADD COLUMN subscription_status    text,
    ADD COLUMN current_period_end     timestamptz,
    ADD COLUMN cancel_at_period_end   boolean NOT NULL DEFAULT false;

-- Webhooks look orgs up by their Stripe customer id.
CREATE INDEX orgs_stripe_customer_idx ON orgs (stripe_customer_id);
