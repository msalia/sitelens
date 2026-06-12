//! Stripe billing: per-org subscriptions via hosted Checkout + the Customer
//! Portal, with access state driven by webhooks. Hand-rolled over `reqwest` (form
//! POSTs + manual webhook-signature verification) to keep dependencies light and
//! consistent with the rest of the HTTP code. All amounts/prices live in Stripe;
//! we only store the linkage + status on the org.

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;
use uuid::Uuid;

const STRIPE_API: &str = "https://api.stripe.com";
/// Reject webhook events whose timestamp is older than this (replay protection).
const WEBHOOK_TOLERANCE_SECS: i64 = 300;
/// Cap every Stripe HTTP call so a slow/hung request can't block a resolver
/// (notably the `billing` query's self-heal).
const STRIPE_HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Stripe configuration from the environment. `enabled()` is false when no secret
/// key is set, so non-billing deployments (and tests) degrade gracefully.
#[derive(Clone)]
pub struct StripeConfig {
    pub secret_key: String,
    pub webhook_secret: String,
    pub price_monthly: String,
    pub price_annual: String,
    pub app_url: String,
}

impl StripeConfig {
    pub fn from_env() -> Self {
        let env = |k: &str| std::env::var(k).unwrap_or_default();
        StripeConfig {
            secret_key: env("STRIPE_SECRET_KEY"),
            webhook_secret: env("STRIPE_WEBHOOK_SECRET"),
            price_monthly: env("STRIPE_PRICE_MONTHLY"),
            price_annual: env("STRIPE_PRICE_ANNUAL"),
            app_url: std::env::var("APP_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
        }
    }

    pub fn enabled(&self) -> bool {
        !self.secret_key.is_empty()
    }
}

/// POSTs a form to the Stripe API and returns the parsed JSON (or the Stripe error
/// message). Auth is the secret key as a Bearer token.
async fn stripe_post(
    cfg: &StripeConfig,
    path: &str,
    form: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let res = reqwest::Client::new()
        .post(format!("{STRIPE_API}{path}"))
        .bearer_auth(&cfg.secret_key)
        .timeout(STRIPE_HTTP_TIMEOUT)
        .form(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(v["error"]["message"]
            .as_str()
            .unwrap_or("Stripe request failed")
            .to_string());
    }
    Ok(v)
}

/// GETs a Stripe resource as JSON (or the Stripe error message).
async fn stripe_get(cfg: &StripeConfig, path: &str) -> Result<serde_json::Value, String> {
    let res = reqwest::Client::new()
        .get(format!("{STRIPE_API}{path}"))
        .bearer_auth(&cfg.secret_key)
        .timeout(STRIPE_HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(v["error"]["message"]
            .as_str()
            .unwrap_or("Stripe request failed")
            .to_string());
    }
    Ok(v)
}

/// Pulls a subscription's current state from Stripe and writes it to the org by
/// reusing [`apply_event`]. Used to backfill/repair billing columns when a webhook
/// was missed or a Stripe schema change left a field unset.
pub async fn resync_subscription(
    cfg: &StripeConfig,
    pool: &PgPool,
    sub_id: &str,
) -> Result<(), String> {
    let sub = stripe_get(cfg, &format!("/v1/subscriptions/{sub_id}")).await?;
    let event = serde_json::json!({
        "type": "customer.subscription.updated",
        "data": { "object": sub },
    });
    apply_event(pool, &event).await
}

/// Returns the org's Stripe customer id, creating (and persisting) one if needed.
/// The customer carries `metadata.org_id` so webhooks can map back to the org.
pub async fn ensure_customer(
    cfg: &StripeConfig,
    pool: &PgPool,
    org_id: Uuid,
    email: &str,
) -> Result<String, String> {
    let existing: Option<(Option<String>,)> =
        sqlx::query_as("SELECT stripe_customer_id FROM orgs WHERE id = $1")
            .bind(org_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    if let Some((Some(id),)) = existing {
        return Ok(id);
    }
    let org = org_id.to_string();
    let v = stripe_post(
        cfg,
        "/v1/customers",
        &[("email", email), ("metadata[org_id]", &org)],
    )
    .await?;
    let id = v["id"]
        .as_str()
        .ok_or("Stripe returned no customer id")?
        .to_string();
    sqlx::query("UPDATE orgs SET stripe_customer_id = $2 WHERE id = $1")
        .bind(org_id)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Creates a hosted Checkout Session for a subscription to `price_id` and returns
/// its URL. `client_reference_id` + the subscription metadata carry the org id.
pub async fn create_checkout_session(
    cfg: &StripeConfig,
    customer_id: &str,
    price_id: &str,
    org_id: Uuid,
) -> Result<String, String> {
    let org = org_id.to_string();
    let success = format!("{}/settings/billing?checkout=success", cfg.app_url);
    let cancel = format!("{}/settings/billing?checkout=cancel", cfg.app_url);
    let v = stripe_post(
        cfg,
        "/v1/checkout/sessions",
        &[
            ("mode", "subscription"),
            ("customer", customer_id),
            ("line_items[0][price]", price_id),
            ("line_items[0][quantity]", "1"),
            ("client_reference_id", &org),
            ("subscription_data[metadata][org_id]", &org),
            ("allow_promotion_codes", "true"),
            ("success_url", &success),
            ("cancel_url", &cancel),
        ],
    )
    .await?;
    v["url"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Stripe returned no checkout url".to_string())
}

/// Creates a Customer Portal session (manage card / cancel / invoices) and returns
/// its URL.
pub async fn create_portal_session(
    cfg: &StripeConfig,
    customer_id: &str,
) -> Result<String, String> {
    let return_url = format!("{}/settings/billing", cfg.app_url);
    let v = stripe_post(
        cfg,
        "/v1/billing_portal/sessions",
        &[("customer", customer_id), ("return_url", &return_url)],
    )
    .await?;
    v["url"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Stripe returned no portal url".to_string())
}

// Solo (free) tier caps. Crew (paid) is unlimited.
pub const FREE_MAX_PROJECTS: i64 = 1;
pub const FREE_MAX_ADMINS: i64 = 1;
pub const FREE_MAX_NON_ADMIN: i64 = 5;

/// An org's billing posture: subscription status + current usage, with the
/// derived plan/entitlement helpers the resolvers gate on.
pub struct OrgBilling {
    pub status: Option<String>,
    pub current_period_end: Option<DateTime<Utc>>,
    pub cancel_at_period_end: bool,
    pub projects: i64,
    pub admins: i64,
    pub non_admin: i64,
}

impl OrgBilling {
    /// Paid access — active/trialing, or past_due (Stripe is still dunning).
    pub fn paid(&self) -> bool {
        matches!(
            self.status.as_deref(),
            Some("active" | "trialing" | "past_due")
        )
    }

    /// Read-only lock: a non-paid org whose usage exceeds the Solo caps (e.g. a
    /// lapsed Crew org). Fresh free orgs within the caps are NOT restricted.
    pub fn restricted(&self) -> bool {
        !self.paid()
            && (self.projects > FREE_MAX_PROJECTS
                || self.admins > FREE_MAX_ADMINS
                || self.non_admin > FREE_MAX_NON_ADMIN)
    }

    pub fn can_export(&self) -> bool {
        self.paid()
    }
}

/// Loads an org's subscription status + usage counts in one round-trip.
pub async fn org_billing(pool: &PgPool, org_id: Uuid) -> Result<OrgBilling, sqlx::Error> {
    let row: (Option<String>, Option<DateTime<Utc>>, bool, i64, i64, i64) = sqlx::query_as(
        "SELECT o.subscription_status, o.current_period_end, o.cancel_at_period_end, \
         (SELECT count(*) FROM projects p WHERE p.org_id = o.id), \
         (SELECT count(*) FROM users u WHERE u.org_id = o.id AND u.role = 'admin'), \
         (SELECT count(*) FROM users u WHERE u.org_id = o.id AND u.role <> 'admin') \
         FROM orgs o WHERE o.id = $1",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await?;
    Ok(OrgBilling {
        status: row.0,
        current_period_end: row.1,
        cancel_at_period_end: row.2,
        projects: row.3,
        admins: row.4,
        non_admin: row.5,
    })
}

/// Verifies a Stripe webhook signature (`Stripe-Signature: t=…,v1=…`): HMAC-SHA256
/// over `"{t}.{payload}"`, constant-time compared, within the replay tolerance.
pub fn verify_signature(secret: &str, payload: &[u8], header: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("no webhook secret configured".to_string());
    }
    let mut timestamp: Option<i64> = None;
    let mut signature: Option<&str> = None;
    for part in header.split(',') {
        match part.split_once('=') {
            Some(("t", v)) => timestamp = v.parse().ok(),
            Some(("v1", v)) => signature = Some(v),
            _ => {}
        }
    }
    let t = timestamp.ok_or("missing timestamp")?;
    let sig = signature.ok_or("missing v1 signature")?;
    if (Utc::now().timestamp() - t).abs() > WEBHOOK_TOLERANCE_SECS {
        return Err("timestamp outside tolerance".to_string());
    }
    let expected = hex::decode(sig).map_err(|_| "bad signature encoding")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|e| e.to_string())?;
    mac.update(t.to_string().as_bytes());
    mac.update(b".");
    mac.update(payload);
    mac.verify_slice(&expected)
        .map_err(|_| "signature mismatch".to_string())
}

/// Applies a webhook event to the org's billing columns. Idempotent: each event
/// just upserts the current subscription state. Unknown events are ignored.
pub async fn apply_event(pool: &PgPool, event: &serde_json::Value) -> Result<(), String> {
    let kind = event["type"].as_str().unwrap_or_default();
    let obj = &event["data"]["object"];
    match kind {
        // Link the customer + subscription to the org as soon as Checkout finishes;
        // the subscription.* events that follow set the authoritative status.
        "checkout.session.completed" => {
            let Some(org_id) = obj["client_reference_id"]
                .as_str()
                .and_then(|s| s.parse::<Uuid>().ok())
            else {
                return Ok(());
            };
            sqlx::query(
                "UPDATE orgs SET stripe_customer_id = COALESCE($2, stripe_customer_id), \
                 stripe_subscription_id = COALESCE($3, stripe_subscription_id) WHERE id = $1",
            )
            .bind(org_id)
            .bind(obj["customer"].as_str())
            .bind(obj["subscription"].as_str())
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
        "customer.subscription.created"
        | "customer.subscription.updated"
        | "customer.subscription.deleted" => {
            let status = if kind == "customer.subscription.deleted" {
                "canceled"
            } else {
                obj["status"].as_str().unwrap_or("canceled")
            };
            // Newer Stripe API versions dropped the top-level `current_period_end`
            // on the Subscription; it now lives on each subscription item. Read the
            // top-level for older versions, then fall back to the first item.
            let period_end = obj["current_period_end"]
                .as_i64()
                .or_else(|| obj["items"]["data"][0]["current_period_end"].as_i64())
                .and_then(|t| DateTime::<Utc>::from_timestamp(t, 0));
            let cancel_at_period_end = obj["cancel_at_period_end"].as_bool().unwrap_or(false);
            let sub_id = obj["id"].as_str();
            // Map to the org by metadata.org_id, falling back to the customer id.
            let org_id = obj["metadata"]["org_id"]
                .as_str()
                .and_then(|s| s.parse::<Uuid>().ok());
            let customer = obj["customer"].as_str();
            sqlx::query(
                "UPDATE orgs SET stripe_subscription_id = $1, subscription_status = $2, \
                 current_period_end = $3, cancel_at_period_end = $4 \
                 WHERE ($5::uuid IS NOT NULL AND id = $5) \
                    OR ($5::uuid IS NULL AND $6 IS NOT NULL AND stripe_customer_id = $6)",
            )
            .bind(sub_id)
            .bind(status)
            .bind(period_end)
            .bind(cancel_at_period_end)
            .bind(org_id)
            .bind(customer)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    Ok(())
}
