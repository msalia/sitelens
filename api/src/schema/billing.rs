use super::*;
use crate::billing::{self, StripeConfig};

/// Billing interval for a Crew subscription.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum BillingInterval {
    Monthly,
    Annual,
}

#[derive(Default)]
pub struct BillingMutation;

#[Object]
impl BillingMutation {
    /// Starts a hosted Stripe Checkout for the Crew plan; returns the redirect URL
    /// the client sends the browser to. Admin-only.
    async fn create_checkout_session(
        &self,
        ctx: &Context<'_>,
        interval: BillingInterval,
    ) -> Result<String> {
        let auth = require_admin(ctx)?;
        let pool = pool(ctx)?;
        let cfg = ctx.data::<StripeConfig>()?;
        if !cfg.enabled() {
            return Err(async_graphql::Error::new("billing is not configured"));
        }
        let (email,): (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1")
            .bind(auth.user_id)
            .fetch_one(pool)
            .await?;
        let customer = billing::ensure_customer(cfg, pool, auth.org_id, &email)
            .await
            .map_err(async_graphql::Error::new)?;
        let price = match interval {
            BillingInterval::Monthly => &cfg.price_monthly,
            BillingInterval::Annual => &cfg.price_annual,
        };
        if price.is_empty() {
            return Err(async_graphql::Error::new("billing price is not configured"));
        }
        billing::create_checkout_session(cfg, &customer, price, auth.org_id)
            .await
            .map_err(async_graphql::Error::new)
    }

    /// Opens the Stripe Customer Portal (manage card / cancel / invoices); returns
    /// the redirect URL. Admin-only.
    async fn create_billing_portal_session(&self, ctx: &Context<'_>) -> Result<String> {
        let auth = require_admin(ctx)?;
        let pool = pool(ctx)?;
        let cfg = ctx.data::<StripeConfig>()?;
        if !cfg.enabled() {
            return Err(async_graphql::Error::new("billing is not configured"));
        }
        let (customer,): (Option<String>,) =
            sqlx::query_as("SELECT stripe_customer_id FROM orgs WHERE id = $1")
                .bind(auth.org_id)
                .fetch_one(pool)
                .await?;
        let customer = customer
            .ok_or_else(|| async_graphql::Error::new("no Stripe customer for this organization"))?;
        billing::create_portal_session(cfg, &customer)
            .await
            .map_err(async_graphql::Error::new)
    }
}
