use async_graphql::SimpleObject;

use super::*;
use crate::billing::{self, StripeConfig};

/// Billing interval for a Crew subscription.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum BillingInterval {
    Monthly,
    Annual,
}

/// The org's billing posture for the client: plan, status, usage, and limits
/// (`-1` = unlimited). Drives the upgrade gate, caps, and the Billing settings page.
#[derive(SimpleObject)]
pub struct BillingInfo {
    /// "solo" (free) or "crew" (paid).
    pub plan: String,
    pub status: Option<String>,
    pub current_period_end: Option<chrono::DateTime<chrono::Utc>>,
    pub cancel_at_period_end: bool,
    /// Read-only lock (lapsed sub over the Solo caps).
    pub restricted: bool,
    pub can_export: bool,
    pub projects: i64,
    pub admins: i64,
    pub non_admin: i64,
    pub max_projects: i64,
    pub max_admins: i64,
    pub max_non_admin: i64,
    /// Emails of this org's admins, so non-admin members can reach out about
    /// upgrading/managing the subscription.
    pub admin_emails: Vec<String>,
}

#[derive(Default)]
pub struct BillingQuery;

#[Object]
impl BillingQuery {
    /// The caller org's plan, subscription status, usage, and limits.
    async fn billing(&self, ctx: &Context<'_>) -> Result<BillingInfo> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let mut b = billing::org_billing(pool, auth.org_id).await?;

        // Self-heal: a paid org with no renewal date means a webhook was missed or
        // didn't carry the period (e.g. a Stripe schema change). Pull the live
        // subscription state from Stripe once; subsequent loads skip this.
        if b.paid() && b.current_period_end.is_none() {
            if let Ok(cfg) = ctx.data::<StripeConfig>() {
                if cfg.enabled() {
                    let sub: Option<(Option<String>,)> =
                        sqlx::query_as("SELECT stripe_subscription_id FROM orgs WHERE id = $1")
                            .bind(auth.org_id)
                            .fetch_optional(pool)
                            .await?;
                    if let Some((Some(sub_id),)) = sub {
                        let _ = billing::resync_subscription(cfg, pool, &sub_id).await;
                        b = billing::org_billing(pool, auth.org_id).await?;
                    }
                }
            }
        }

        let admin_emails: Vec<String> = sqlx::query_scalar(
            "SELECT email FROM users WHERE org_id = $1 AND role = 'admin' ORDER BY email",
        )
        .bind(auth.org_id)
        .fetch_all(pool)
        .await?;
        // Caps come from the plan catalog: Crew resolves to unlimited (-1).
        let plan = b.plan();
        let limits = plan.limits();
        Ok(BillingInfo {
            plan: plan.as_str().to_string(),
            status: b.status.clone(),
            current_period_end: b.current_period_end,
            cancel_at_period_end: b.cancel_at_period_end,
            restricted: b.restricted(),
            can_export: b.can_export(),
            projects: b.projects,
            admins: b.admins,
            non_admin: b.non_admin,
            max_projects: limits.projects,
            max_admins: limits.admins,
            max_non_admin: limits.non_admin,
            admin_emails,
        })
    }
}

/// A gated feature in the plan catalog (static metadata; drives the web's upgrade
/// dialogs + selling points). See `crate::plan`.
#[derive(SimpleObject)]
pub struct PlanFeature {
    /// Stable snake_case id (upgrade dialogs key off this).
    pub key: String,
    pub label: String,
    pub blurb: String,
    pub min_plan: crate::plan::Plan,
}

/// A plan's usage caps (`-1` = unlimited).
#[derive(SimpleObject)]
pub struct PlanLimits {
    pub plan: crate::plan::Plan,
    pub max_projects: i64,
    pub max_admins: i64,
    pub max_non_admin: i64,
}

/// The static plan → capability catalog: the single source of truth for what each
/// plan unlocks. The web renders upgrade UI + selling points from this instead of
/// hard-coding feature lists.
#[derive(SimpleObject)]
pub struct PlanCatalog {
    pub features: Vec<PlanFeature>,
    pub plans: Vec<PlanLimits>,
}

#[derive(Default)]
pub struct PlanCatalogQuery;

#[Object]
impl PlanCatalogQuery {
    /// The static plan/feature catalog. No auth required — it's marketing/gating
    /// metadata, safe to render on public pricing surfaces.
    async fn plan_catalog(&self, _ctx: &Context<'_>) -> Result<PlanCatalog> {
        use crate::plan::{Feature, Plan};
        let features = Feature::all()
            .iter()
            .map(|&f| {
                let m = f.meta();
                PlanFeature {
                    key: m.key.to_string(),
                    label: m.label.to_string(),
                    blurb: m.blurb.to_string(),
                    min_plan: m.min_plan,
                }
            })
            .collect();
        let plans = Plan::all()
            .iter()
            .map(|&p| {
                let l = p.limits();
                PlanLimits {
                    plan: p,
                    max_projects: l.projects,
                    max_admins: l.admins,
                    max_non_admin: l.non_admin,
                }
            })
            .collect();
        Ok(PlanCatalog { features, plans })
    }
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
