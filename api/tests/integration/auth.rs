use crate::common::*;

#[sqlx::test(migrations = "./migrations")]
async fn signup_verify_login_me(pool: PgPool) {
    let schema = schema(pool);
    let (user_id, org_id, token) = signup(&schema, "a@example.com", "Acme Survey").await;

    // me is null before login.
    let data = exec_ok(&schema, "{ me { id } }", None).await;
    assert!(data["me"].is_null());

    // login fails before verification.
    let login_q = r#"mutation { login(email: "a@example.com", password: "password123") { id } }"#;
    let msg = exec_err(&schema, login_q, None).await;
    assert!(msg.contains("not verified"), "got: {msg}");

    // verify, then login succeeds and sets a session cookie.
    let verify_q = format!(r#"mutation {{ verifyEmail(token: "{token}") }}"#);
    let data = exec_ok(&schema, &verify_q, None).await;
    assert_eq!(data["verifyEmail"], Json::Bool(true));

    let resp = schema.execute(Request::new(login_q)).await;
    assert!(resp.errors.is_empty(), "login errors: {:?}", resp.errors);
    let set_cookie = resp
        .http_headers
        .get("set-cookie")
        .expect("login should set a cookie")
        .to_str()
        .unwrap()
        .to_string();
    let session = session_token_from_cookie_header(&set_cookie).expect("cookie has session token");
    let auth = sitelens_api::auth::auth_context_from_token(&session, "test-secret").unwrap();
    assert_eq!(auth.user_id, user_id);
    assert_eq!(auth.org_id, org_id);

    // me works with the derived auth context.
    let data = exec_ok(&schema, "{ me { id email } }", Some(auth)).await;
    assert_eq!(uuid_at(&data, &["me", "id"]), user_id);
    assert_eq!(data["me"]["email"], Json::String("a@example.com".into()));
    // login data is also sane.
    assert!(matches!(resp.data, Value::Object(_)));
}

#[sqlx::test(migrations = "./migrations")]
async fn verify_email_rejects_reused_and_invalid_tokens(pool: PgPool) {
    let schema = schema(pool);
    let (_id, _org, token) = signup(&schema, "v@example.com", "Org").await;

    // First verification works.
    let q = format!(r#"mutation {{ verifyEmail(token: "{token}") }}"#);
    assert_eq!(
        exec_ok(&schema, &q, None).await["verifyEmail"],
        Json::Bool(true)
    );

    // The same token can't be reused (cleared on use).
    let msg = exec_err(&schema, &q, None).await;
    assert!(msg.contains("invalid or expired"), "reuse: {msg}");

    // A bogus token is rejected too.
    let bad = r#"mutation { verifyEmail(token: "nope-not-real") }"#;
    let msg = exec_err(&schema, bad, None).await;
    assert!(msg.contains("invalid or expired"), "bogus: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn resend_verification_reissues_token_and_is_always_truthy(pool: PgPool) {
    let schema = schema(pool.clone());
    let (user_id, _org, token1) = signup(&schema, "r@example.com", "Org").await;

    // Always returns true — even for an address that doesn't exist (no enumeration).
    let resend = |email: &str| format!(r#"mutation {{ resendVerification(email: "{email}") }}"#);
    assert_eq!(
        exec_ok(&schema, &resend("r@example.com"), None).await["resendVerification"],
        Json::Bool(true)
    );
    assert_eq!(
        exec_ok(&schema, &resend("nobody@example.com"), None).await["resendVerification"],
        Json::Bool(true)
    );

    // The original token was replaced by the resend.
    let stale = format!(r#"mutation {{ verifyEmail(token: "{token1}") }}"#);
    assert!(exec_err(&schema, &stale, None)
        .await
        .contains("invalid or expired"));

    // The freshly-issued token (read from the DB) verifies and enables login.
    let token2: String = sqlx::query_scalar("SELECT verification_token FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let verify2 = format!(r#"mutation {{ verifyEmail(token: "{token2}") }}"#);
    assert_eq!(
        exec_ok(&schema, &verify2, None).await["verifyEmail"],
        Json::Bool(true)
    );
    let login = r#"mutation { login(email: "r@example.com", password: "password123") { id } }"#;
    assert!(schema.execute(Request::new(login)).await.errors.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn login_is_rate_limited(pool: PgPool) {
    let schema = schema(pool);
    // A real account so attempts reach the credential check, not a missing user.
    let (_id, _org, token) = signup(&schema, "a@example.com", "Org").await;
    let verify_q = format!(r#"mutation {{ verifyEmail(token: "{token}") }}"#);
    exec_ok(&schema, &verify_q, None).await;

    // The limiter is 10 attempts/min/IP. Tests carry no ClientIp, so all share
    // the "unknown" bucket. Ten wrong-password attempts are allowed (each an
    // "invalid credentials" error)...
    let wrong = r#"mutation { login(email: "a@example.com", password: "wrong-password") { id } }"#;
    for _ in 0..10 {
        let msg = exec_err(&schema, wrong, None).await;
        assert!(msg.contains("invalid credentials"), "got: {msg}");
    }
    // ...the 11th is refused by the rate limiter regardless of credentials.
    let msg = exec_err(&schema, wrong, None).await;
    assert!(msg.contains("too many attempts"), "got: {msg}");

    // Even a correct password is blocked once the limit is hit.
    let right = r#"mutation { login(email: "a@example.com", password: "password123") { id } }"#;
    let msg = exec_err(&schema, right, None).await;
    assert!(msg.contains("too many attempts"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn role_enforcement_blocks_non_admin(pool: PgPool) {
    let schema = schema(pool);
    let (admin_id, org_id, _) = signup(&schema, "admin@example.com", "Org").await;

    // Invite a viewer and accept the invite (sets password + verifies).
    let invite_q = r#"mutation { inviteUser(email: "viewer@example.com", role: VIEWER) { user { id } inviteToken } }"#;
    let data = exec_ok(&schema, invite_q, Some(admin_ctx(admin_id, org_id))).await;
    let viewer_id = uuid_at(&data, &["inviteUser", "user", "id"]);
    let invite_token = data["inviteUser"]["inviteToken"]
        .as_str()
        .unwrap()
        .to_string();

    let accept_q = format!(
        r#"mutation {{ acceptInvite(token: "{invite_token}", password: "password123") {{ id role }} }}"#
    );
    let data = exec_ok(&schema, &accept_q, None).await;
    assert_eq!(data["acceptInvite"]["role"], Json::String("VIEWER".into()));

    // A viewer cannot list users or change roles.
    let viewer_ctx = AuthContext {
        user_id: viewer_id,
        org_id,
        role: Role::Viewer,
    };
    let msg = exec_err(&schema, "{ users { id } }", Some(viewer_ctx.clone())).await;
    assert!(msg.contains("forbidden"), "got: {msg}");

    let update_q =
        format!(r#"mutation {{ updateUserRole(userId: "{admin_id}", role: VIEWER) {{ id }} }}"#);
    let msg = exec_err(&schema, &update_q, Some(viewer_ctx)).await;
    assert!(msg.contains("forbidden"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn surveyor_can_edit_but_not_administer(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;
    let surveyor_id = invite(&schema, admin_ctx(admin, org), "s@example.com", "SURVEYOR").await;
    let surveyor = role_ctx(surveyor_id, org, Role::Surveyor);

    // A surveyor is an editor: project + control point + category all succeed.
    let pid = create_project(&schema, surveyor.clone(), "S Site").await;
    add_cp(&schema, surveyor.clone(), pid, "CP1", 1.0, 1.0, 0.0, 0.0).await;
    let cat = exec_ok(
        &schema,
        r##"mutation { createCategory(name: "Utilities", color: "#fff", icon: "u") { id isDefault } }"##,
        Some(surveyor.clone()),
    )
    .await;
    assert_eq!(cat["createCategory"]["isDefault"], Json::Bool(false));

    // But not admin actions.
    let msg = exec_err(&schema, "{ users { id } }", Some(surveyor.clone())).await;
    assert!(msg.contains("forbidden"), "got: {msg}");
    let inv = r#"mutation { inviteUser(email: "x@example.com", role: VIEWER) { inviteToken } }"#;
    let msg = exec_err(&schema, inv, Some(surveyor)).await;
    assert!(msg.contains("forbidden"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn viewer_cannot_mutate_data(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let viewer_id = invite(&schema, admin_ctx(admin, org), "v@example.com", "VIEWER").await;
    let viewer = role_ctx(viewer_id, org, Role::Viewer);

    // A viewer can read...
    let read = exec_ok(
        &schema,
        &format!(r#"{{ controlPoints(projectId: "{pid}") {{ id }} }}"#),
        Some(viewer.clone()),
    )
    .await;
    assert_eq!(read["controlPoints"].as_array().unwrap().len(), 0);

    // ...but every write is rejected with an editor-role error.
    let writes = [
        format!(
            r#"mutation {{ addControlPoint(projectId: "{pid}", label: "X", northing: 1.0, easting: 1.0, unit: METER) {{ id }} }}"#
        ),
        format!(
            r#"mutation {{ importPoints(projectId: "{pid}", format: CSV, content: "N,E\n1,1\n", unit: METER, mapping: {{ hasHeader: true, northingCol: 0, eastingCol: 1 }}) {{ rowCount }} }}"#
        ),
        r##"mutation { createCategory(name: "C", color: "#fff", icon: "c") { id } }"##.to_string(),
        format!(
            r#"mutation {{ uploadDxf(projectId: "{pid}", filename: "a.dxf", content: "x") {{ id }} }}"#
        ),
    ];
    for q in &writes {
        let msg = exec_err(&schema, q, Some(viewer.clone())).await;
        assert!(
            msg.contains("editor role required"),
            "viewer wrote: {q}\n=> {msg}"
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn unauthenticated_requests_are_denied(pool: PgPool) {
    let schema = schema(pool);
    let msg = exec_err(&schema, "{ projects { id } }", None).await;
    assert!(msg.contains("not authenticated"), "got: {msg}");
    let m = r#"mutation { createProject(name: "X", epsgCode: 2229, displayUnit: METER) { id } }"#;
    let msg = exec_err(&schema, m, None).await;
    assert!(msg.contains("not authenticated"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn signup_validation_errors(pool: PgPool) {
    let schema = schema(pool);

    let short = r#"mutation { signup(email: "a@example.com", password: "short12", orgName: "O") { user { id } } }"#;
    assert!(exec_err(&schema, short, None).await.contains("at least 8"));

    let bad_email = r#"mutation { signup(email: "nope", password: "password123", orgName: "O") { user { id } } }"#;
    assert!(exec_err(&schema, bad_email, None)
        .await
        .contains("valid email"));

    let empty_org = r#"mutation { signup(email: "b@example.com", password: "password123", orgName: "  ") { user { id } } }"#;
    assert!(exec_err(&schema, empty_org, None)
        .await
        .contains("organization name"));

    // Duplicate email is rejected.
    signup(&schema, "dup@example.com", "Org").await;
    let dup = r#"mutation { signup(email: "dup@example.com", password: "password123", orgName: "Org2") { user { id } } }"#;
    assert!(exec_err(&schema, dup, None)
        .await
        .contains("already registered"));
}

#[sqlx::test(migrations = "./migrations")]
async fn token_and_invite_errors(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;

    let bad_verify = r#"mutation { verifyEmail(token: "nope") }"#;
    assert!(exec_err(&schema, bad_verify, None)
        .await
        .contains("invalid or expired"));

    let bad_accept = r#"mutation { acceptInvite(token: "nope", password: "password123") { id } }"#;
    assert!(exec_err(&schema, bad_accept, None)
        .await
        .contains("invalid or expired invite"));

    let short_pw = r#"mutation { acceptInvite(token: "whatever", password: "short12") { id } }"#;
    assert!(exec_err(&schema, short_pw, None)
        .await
        .contains("at least 8"));

    // Inviting an already-registered email fails.
    let dup =
        r#"mutation { inviteUser(email: "admin@example.com", role: VIEWER) { inviteToken } }"#;
    assert!(exec_err(&schema, dup, Some(admin_ctx(admin, org)))
        .await
        .contains("already registered"));
}

#[sqlx::test(migrations = "./migrations")]
async fn admin_updates_user_role(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;
    let viewer_id = invite(&schema, admin_ctx(admin, org), "v@example.com", "VIEWER").await;

    let promote = format!(
        r#"mutation {{ updateUserRole(userId: "{viewer_id}", role: SURVEYOR) {{ role }} }}"#
    );
    let d = exec_ok(&schema, &promote, Some(admin_ctx(admin, org))).await;
    assert_eq!(d["updateUserRole"]["role"], Json::String("SURVEYOR".into()));

    // Reflected in the org user list.
    let users = exec_ok(
        &schema,
        "{ users { id role } }",
        Some(admin_ctx(admin, org)),
    )
    .await;
    let found = users["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| uuid_at(u, &["id"]) == viewer_id)
        .unwrap();
    assert_eq!(found["role"], Json::String("SURVEYOR".into()));
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_clears_session_cookie(pool: PgPool) {
    let schema = schema(pool);
    let resp = schema.execute(Request::new("mutation { logout }")).await;
    assert!(resp.errors.is_empty());
    let cookie = resp
        .http_headers
        .get("set-cookie")
        .expect("logout sets a clearing cookie")
        .to_str()
        .unwrap();
    // Clears the session: empty value + immediate expiry.
    assert!(cookie.contains("session="), "got: {cookie}");
    assert!(cookie.contains("Max-Age=0"), "got: {cookie}");
}

#[sqlx::test(migrations = "./migrations")]
async fn password_reset_token_is_single_use_and_expires(pool: PgPool) {
    let schema = schema(pool.clone());
    let (user_id, _org, _) = signup(&schema, "a@example.com", "Org").await;

    // Request a reset; the token is stored on the user (not returned to clients).
    exec_ok(
        &schema,
        r#"mutation { requestPasswordReset(email: "a@example.com") }"#,
        None,
    )
    .await;
    let token: String = sqlx::query_scalar("SELECT reset_token FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    // First use succeeds and clears the token; reusing it fails (single-use).
    let q =
        format!(r#"mutation {{ resetPassword(token: "{token}", newPassword: "newpassword1") }}"#);
    let data = exec_ok(&schema, &q, None).await;
    assert_eq!(data["resetPassword"].as_bool(), Some(true));
    let reused = exec_err(&schema, &q, None).await;
    assert!(!reused.is_empty());

    // An expired token is rejected.
    exec_ok(
        &schema,
        r#"mutation { requestPasswordReset(email: "a@example.com") }"#,
        None,
    )
    .await;
    let token2: String = sqlx::query_scalar("SELECT reset_token FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET reset_token_expires = now() - interval '1 hour' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let q2 =
        format!(r#"mutation {{ resetPassword(token: "{token2}", newPassword: "newpassword2") }}"#);
    let expired = exec_err(&schema, &q2, None).await;
    assert!(!expired.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn cannot_remove_or_demote_the_last_admin(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let ctx = admin_ctx(admin, org);

    let remove = format!(r#"mutation {{ removeUser(userId: "{admin}") }}"#);
    let err = exec_err(&schema, &remove, Some(ctx.clone())).await;
    assert!(err.to_lowercase().contains("last admin"), "got: {err}");

    let demote =
        format!(r#"mutation {{ updateUserRole(userId: "{admin}", role: VIEWER) {{ id }} }}"#);
    let err2 = exec_err(&schema, &demote, Some(ctx)).await;
    assert!(err2.to_lowercase().contains("last admin"), "got: {err2}");
}
