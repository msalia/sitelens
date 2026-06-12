use crate::common::*;

#[test]
fn webhook_signature_is_verified() {
    let secret = "whsec_test_secret";
    let payload = br#"{"type":"ping"}"#;
    let now = chrono::Utc::now().timestamp();

    // A correctly signed, fresh payload verifies.
    let header = stripe_signature(secret, now, payload);
    assert!(verify_signature(secret, payload, &header).is_ok());

    // Tampering with the payload breaks verification.
    assert!(verify_signature(secret, br#"{"type":"evil"}"#, &header).is_err());

    // The wrong secret fails.
    assert!(verify_signature("whsec_other", payload, &header).is_err());

    // A stale timestamp (outside the replay tolerance) is rejected.
    let stale = stripe_signature(secret, now - 10_000, payload);
    assert!(verify_signature(secret, payload, &stale).is_err());

    // No configured secret means we never accept anything.
    assert!(verify_signature("", payload, &header).is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn webhook_drives_subscription_lifecycle(pool: PgPool) {
    let schema = schema(pool.clone());
    let (_admin, org, _) = signup(&schema, "a@example.com", "Co").await;
    let cust = "cus_lifecycle";
    let sub = "sub_lifecycle";
    let period_end = 1_900_000_000_i64; // a fixed future instant

    // 1) checkout.session.completed links the customer + subscription to the org.
    apply_event(
        &pool,
        &serde_json::json!({
            "type": "checkout.session.completed",
            "data": { "object": {
                "client_reference_id": org.to_string(),
                "customer": cust,
                "subscription": sub,
            }},
        }),
    )
    .await
    .unwrap();

    // 2) subscription.created -> active. The renewal date comes from the item
    // (newer Stripe shape), exercising the items[].current_period_end fallback.
    apply_event(
        &pool,
        &serde_json::json!({
            "type": "customer.subscription.created",
            "data": { "object": {
                "id": sub,
                "status": "active",
                "customer": cust,
                "cancel_at_period_end": false,
                "metadata": { "org_id": org.to_string() },
                "items": { "data": [ { "current_period_end": period_end } ] },
            }},
        }),
    )
    .await
    .unwrap();
    let b = org_billing(&pool, org).await.unwrap();
    assert!(b.paid(), "org should be paid after subscription.created");
    assert_eq!(b.status.as_deref(), Some("active"));
    assert_eq!(
        b.current_period_end.unwrap().timestamp(),
        period_end,
        "renewal date should come from items[].current_period_end"
    );
    assert!(!b.cancel_at_period_end);

    // 3) subscription.updated -> set to cancel at period end; still paid until then.
    apply_event(
        &pool,
        &serde_json::json!({
            "type": "customer.subscription.updated",
            "data": { "object": {
                "id": sub,
                "status": "active",
                "customer": cust,
                "cancel_at_period_end": true,
                "metadata": { "org_id": org.to_string() },
                "items": { "data": [ { "current_period_end": period_end } ] },
            }},
        }),
    )
    .await
    .unwrap();
    let b = org_billing(&pool, org).await.unwrap();
    assert!(
        b.paid(),
        "cancel-at-period-end keeps access until the period ends"
    );
    assert!(b.cancel_at_period_end);

    // 4) subscription.deleted -> canceled; access ends.
    apply_event(
        &pool,
        &serde_json::json!({
            "type": "customer.subscription.deleted",
            "data": { "object": {
                "id": sub,
                "customer": cust,
                "metadata": { "org_id": org.to_string() },
            }},
        }),
    )
    .await
    .unwrap();
    let b = org_billing(&pool, org).await.unwrap();
    assert!(
        !b.paid(),
        "org should lose access after subscription.deleted"
    );
    assert_eq!(b.status.as_deref(), Some("canceled"));
}

#[sqlx::test(migrations = "./migrations")]
async fn webhook_maps_subscription_by_customer_without_metadata(pool: PgPool) {
    // When a subscription event carries no metadata.org_id, we fall back to the
    // stripe_customer_id linked during checkout.
    let schema = schema(pool.clone());
    let (_admin, org, _) = signup(&schema, "a@example.com", "Co").await;
    let cust = "cus_fallback";

    apply_event(
        &pool,
        &serde_json::json!({
            "type": "checkout.session.completed",
            "data": { "object": {
                "client_reference_id": org.to_string(),
                "customer": cust,
                "subscription": "sub_fallback",
            }},
        }),
    )
    .await
    .unwrap();

    apply_event(
        &pool,
        &serde_json::json!({
            "type": "customer.subscription.updated",
            "data": { "object": {
                "id": "sub_fallback",
                "status": "active",
                "customer": cust,
                "cancel_at_period_end": false,
                "items": { "data": [ { "current_period_end": 1_900_000_000_i64 } ] },
            }},
        }),
    )
    .await
    .unwrap();

    assert!(
        org_billing(&pool, org).await.unwrap().paid(),
        "subscription should map to the org via its customer id"
    );
}

// past_due keeps access — Stripe is still dunning, so we don't cut the org off.
#[sqlx::test(migrations = "./migrations")]
async fn webhook_past_due_keeps_access(pool: PgPool) {
    let schema = schema(pool.clone());
    let (_a, org, _) = signup(&schema, "a@example.com", "Co").await;
    apply_event(
        &pool,
        &serde_json::json!({
            "type": "customer.subscription.updated",
            "data": { "object": {
                "id": "sub_pd", "status": "past_due", "customer": "cus_pd",
                "cancel_at_period_end": false,
                "metadata": { "org_id": org.to_string() },
                "items": { "data": [ { "current_period_end": 1_900_000_000_i64 } ] },
            }},
        }),
    )
    .await
    .unwrap();
    assert!(
        org_billing(&pool, org).await.unwrap().paid(),
        "past_due should keep access while Stripe retries payment"
    );
}

// trialing also counts as paid access.
#[sqlx::test(migrations = "./migrations")]
async fn webhook_trialing_keeps_access(pool: PgPool) {
    let schema = schema(pool.clone());
    let (_a, org, _) = signup(&schema, "a@example.com", "Co").await;
    apply_event(
        &pool,
        &serde_json::json!({
            "type": "customer.subscription.created",
            "data": { "object": {
                "id": "sub_tr", "status": "trialing", "customer": "cus_tr",
                "cancel_at_period_end": false,
                "metadata": { "org_id": org.to_string() },
                "items": { "data": [ { "current_period_end": 1_900_000_000_i64 } ] },
            }},
        }),
    )
    .await
    .unwrap();
    assert!(org_billing(&pool, org).await.unwrap().paid());
}

// A checkout event we can't map to an org (no client_reference_id) is a safe
// no-op — it must not error or change any org's billing.
#[sqlx::test(migrations = "./migrations")]
async fn webhook_checkout_without_org_reference_is_noop(pool: PgPool) {
    let schema = schema(pool.clone());
    let (_a, org, _) = signup(&schema, "a@example.com", "Co").await;
    apply_event(
        &pool,
        &serde_json::json!({
            "type": "checkout.session.completed",
            "data": { "object": { "customer": "cus_x", "subscription": "sub_x" } },
        }),
    )
    .await
    .unwrap();
    assert!(
        !org_billing(&pool, org).await.unwrap().paid(),
        "an unmappable checkout event must not grant access to anyone"
    );
}

// Webhooks are delivered at-least-once: applying the same event twice must leave
// the org in the same state (idempotent upsert).
#[sqlx::test(migrations = "./migrations")]
async fn webhook_is_idempotent(pool: PgPool) {
    let schema = schema(pool.clone());
    let (_a, org, _) = signup(&schema, "a@example.com", "Co").await;
    let event = serde_json::json!({
        "type": "customer.subscription.created",
        "data": { "object": {
            "id": "sub_idem", "status": "active", "customer": "cus_idem",
            "cancel_at_period_end": false,
            "metadata": { "org_id": org.to_string() },
            "items": { "data": [ { "current_period_end": 1_900_000_000_i64 } ] },
        }},
    });
    apply_event(&pool, &event).await.unwrap();
    apply_event(&pool, &event).await.unwrap();
    let b = org_billing(&pool, org).await.unwrap();
    assert!(b.paid());
    assert_eq!(b.status.as_deref(), Some("active"));
}

// Resubscribing (cancel_at_period_end back to false) clears the cancel flag.
#[sqlx::test(migrations = "./migrations")]
async fn webhook_resubscribe_clears_cancel_flag(pool: PgPool) {
    let schema = schema(pool.clone());
    let (_a, org, _) = signup(&schema, "a@example.com", "Co").await;
    let mk = |cancel: bool| {
        serde_json::json!({
            "type": "customer.subscription.updated",
            "data": { "object": {
                "id": "sub_re", "status": "active", "customer": "cus_re",
                "cancel_at_period_end": cancel,
                "metadata": { "org_id": org.to_string() },
                "items": { "data": [ { "current_period_end": 1_900_000_000_i64 } ] },
            }},
        })
    };
    apply_event(&pool, &mk(true)).await.unwrap();
    assert!(org_billing(&pool, org).await.unwrap().cancel_at_period_end);
    apply_event(&pool, &mk(false)).await.unwrap();
    assert!(!org_billing(&pool, org).await.unwrap().cancel_at_period_end);
}
