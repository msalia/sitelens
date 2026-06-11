# SiteLens — Email Auth & Live Scene — Specification

> Two enhancements to SiteLens: (1) email-backed account auth (verification,
> self-service password reset) plus org user management, and (2) a live,
> "delightful" 3D scene that updates over WebSocket subscriptions without
> remounting or resetting the camera.

---

## 1. Overview

SiteLens already has email/password auth (signup, verify, login, logout, invite,
role updates) but **no email delivery** — signup verification tokens are surfaced
in-app. This work adds real email (via Resend), self-service password reset, and a
full org user-management UI. Separately, the 3D viewer currently refetches and
**remounts the whole scene** on any change, which jerks the view and resets the
camera; this work makes scene updates push-driven, incremental, and animated.

Principles:
- **No new paid services.** Resend free tier for email; WebSockets are self-hosted.
- **Secrets in env only.** `RESEND_API_KEY` is never committed; loaded at runtime.
- **Smoothness is a rendering concern.** Live transport (subscriptions) and smooth
  rendering (reconcile-by-id + animation) are independent and both required.

---

## 2. Users & Access

Roles are unchanged: **Admin**, **Surveyor**, **Viewer** (one org per user).

- **Admin** — full org + project work, **and** user management (invite, change
  role, reset password, remove user).
- **Surveyor** — full project work; no user management.
- **Viewer** — read-only.

User management is **Admin-only**; non-admins never see `/settings/users`.

---

## 3. Data Model

### `users` (existing, extended)

Existing: `id, org_id, email, password_hash, role, email_verified,
verification_token, invite_token, created_at`.

Add token-expiry + reset support:

- `verification_token_expires timestamptz NULL` — verification links expire (e.g. 7 days).
- `invite_token_expires timestamptz NULL` — invite links expire (e.g. 7 days).
- `reset_token text NULL` + `reset_token_expires timestamptz NULL` — single-use
  password-reset token (1 hour).

All tokens are single-use: cleared (`NULL`) on consumption.

**Status** is derived (no column): `Unverified` (email_verified = false, no invite
pending), `Pending` (invite_token present, not yet accepted), `Active` (verified).

### Subscriptions

No schema. A per-process in-memory **broadcast bus** keyed by `project_id`.

---

## 4. Architecture

### Mail (`api/src/mail.rs`)

A thin mailer module wrapping the official **`resend-rs`** crate.

- Reads `RESEND_API_KEY` and `SITELENS_MAIL_FROM` from env at startup; held in a
  shared `Mailer` in the GraphQL context (like `Storage`/`AuthConfig`).
- Functions: `send_verification(to, link)`, `send_password_reset(to, link)`,
  `send_invite(to, org_name, link)`. Each builds a minimal HTML + text body.
- Send failures are logged and surfaced as a generic error; they never leak
  whether an address exists (see §7).
- If `RESEND_API_KEY` is unset (local dev without Resend), the mailer logs the
  email + link to stdout instead of sending, so dev flows still work.

### Live scene (subscriptions)

```
mutation (points/categories/grid/overlays/georef)
        │  publish(project_id)
        ▼
  ScenePubSub  ── tokio::sync::broadcast per project_id ──►  subscription stream
        ▲                                                          │  ping {projectId}
        │                                                          ▼
   AppState (shared)                                   client refetches sceneData
                                                       → reconcile by id → animate
```

- **`ScenePubSub`** lives in `AppState`/GraphQL context: a map `project_id →
  broadcast::Sender<()>` (created on demand). Relevant mutations call
  `pubsub.publish(project_id)`.
- **Subscription** `projectChanged(projectId)` yields a lightweight ping on each
  publish (debounced client-side). Implemented with async-graphql's
  `#[Subscription]` returning a `Stream`.
- **Transport:** async-graphql-axum's WebSocket handler mounted on the GraphQL
  route (GraphQL-over-WS / `graphql-transport-ws`). Auth on connection init reuses
  the session cookie (same `auth_context_from_token` path as the HTTP handler).
- **Traefik** must pass through the WS upgrade for `/graphql`.

### Client rendering

- `SceneView` opens one WS subscription per open project; on ping it refetches the
  existing `sceneData` query and **reconciles by id** into the existing state so
  React reuses marker/line nodes (no remount).
- The camera (`CameraRig`) is decoupled from data-driven bounds: it re-aims only on
  explicit intent.

---

## 5. API Design

### Mutations (new)

- `requestPasswordReset(email: String!): Boolean!` — always returns `true`
  (no account-existence leak). When the email matches a user, mints a 1h reset
  token and emails the link. Rate-limited per IP/email.
- `resetPassword(token: String!, newPassword: String!): Boolean!` — validates the
  unexpired single-use token, sets the new hash, clears the token.
- `resendVerification(email: String!): Boolean!` — always `true`; re-issues +
  re-sends a verification link if the user is unverified. Rate-limited.
- `adminResetPassword(userId: UUID!): Boolean!` — Admin-only; mints a reset token
  and emails the user (covers an admin-initiated reset).
- `removeUser(userId: UUID!): Boolean!` — Admin-only; deletes the user from the
  org. Guards: cannot remove the **last Admin**; an Admin may remove self only if
  another Admin exists.

### Mutations (existing, now also email)

- `signup` → sends a verification email (still returns the token for tests/dev).
- `inviteUser` → emails the invite link (still returns `inviteToken`).

### Subscription (new)

- `projectChanged(projectId: UUID!): SceneChangePing!` — emits on any scene-
  affecting mutation for that project. Payload is minimal (`projectId`, timestamp).

### Operator CLI

- `cargo run --bin reset_password -- <email>` (run via `docker exec`) — mints a
  reset token (or sets a temp password) for any user, printing the link. The
  escape hatch for a locked-out sole Admin. Bypasses GraphQL auth (operator-only).

---

## 6. UI/UX

### Auth pages

- **Forgot password** (`/forgot-password`) — email field → `requestPasswordReset`
  → always shows "If that account exists, a reset link is on its way." Replaces
  the current coming-soon placeholder.
- **Reset password** (`/reset-password?token=…`) — new-password + confirm →
  `resetPassword` → redirect to login.
- **Verify email** (existing `/verify…`) — now reached from the emailed link; keep
  a "resend verification" affordance on login when a user is unverified.

### `/settings/users` (Admin-only, new route)

- Member roster table: **email · role · status (Active / Pending / Unverified) ·
  joined**.
- Actions: **Invite** (email + role → emails invite link, shows it too),
  **Change role** (Select), **Reset password** (emails link; toast confirms),
  **Remove user** (confirm dialog; disabled for the last Admin / self-when-last).
- Uses shadcn components; matches the existing settings layout.

### 3D scene (delight)

- **Camera** holds position on all data changes; moves only on first load, a
  camera-preset pick, the reset button, or a table "locate".
- **Markers** (DOM `<Html>`): new points **fade + scale in**, removed points
  **fade + scale out** (unmount deferred through the exit), category/color change
  **tweens** the pin color. CSS transitions only.
- **Grid / DXF lines**: quick material-opacity fade on add/remove.
- Reconcile-by-id keeps each element a stable node so transitions fire.

---

## 7. Email

- **Provider:** Resend, via the `resend-rs` crate (HTTP API).
- **App key (runtime):** the app reads `RESEND_API_KEY` from its **env** (SiteLens
  convention — like `JWT_SECRET`/`DATABASE_URL`), using a **send-only scoped** key.
  Set in the Dokploy app env for prod and a local `.env`/compose override for dev.
  The app never reads from the devkit creds file.
- **Devkit key (operator):** the full-access key lives in
  `integrations/RESEND/.creds` (gitignored) + `infra.json → integrations.resend`,
  for tooling/validation/domain management only — not loaded by the app.
- **From:** `SITELENS_MAIL_FROM` = `noreply@msalia.org` (env).
- **Domain:** `msalia.org` is **already verified** in Resend (sending enabled), so
  `noreply@msalia.org` delivers to any recipient in **both dev and prod** — no
  per-environment from-address juggling and no extra DNS work.
- **Dev fallback:** leave `RESEND_API_KEY` unset to log emails (+ link) to stdout
  instead of sending; use the Resend test sinks (`delivered@resend.dev`,
  `bounced@resend.dev`) to exercise send paths without emailing real people.
- **Templates:** minimal, on-brand HTML + plaintext for verification, reset, and
  invite. Links point at the web app (`https://sitelens.msalia.org/...`).

---

## 8. Security

- **API key** in env only (`RESEND_API_KEY`); never committed. Rotate the key that
  was shared in chat once wired up.
- **Tokens** are single-use and expiry-bound (reset 1h, verification/invite 7d);
  cleared on use; generated with the existing CSPRNG `gen_token()`.
- **No account enumeration:** `requestPasswordReset` / `resendVerification` always
  return success regardless of whether the email exists.
- **Rate limiting:** reset/verification requests use the existing rate limiter
  (per IP, tightened window) to prevent abuse/email bombing.
- **WebSocket auth:** the subscription connection authenticates from the session
  cookie at connection init; `projectChanged` enforces org ownership of the
  project (same `ensure_project_in_org` check) before streaming.
- **Last-Admin guard** enforced server-side in `removeUser` / `updateUserRole`,
  not just the UI.

---

## 9. Testing

- **Unit (Rust):** token generation/expiry/single-use; last-Admin guard logic;
  status derivation; mailer "log mode" when key unset.
- **Mailer in tests:** no real sends — the mailer runs in log/capture mode; reset
  tests read the token from the DB (or capture) to drive `resetPassword`.
- **e2e (Playwright):** forgot-password → reset → login; resend verification;
  `/settings/users` invite (link shown) → accept → role change → remove; cannot
  remove the last Admin. (Token retrieved via the test capture hook.)
- **Subscriptions:** unit-test the broadcast bus (publish → receiver gets ping);
  a focused e2e that opens two contexts and asserts an edit in one appears in the
  other without reload (best-effort; gated on WS reachability).

---

## 10. Deployment

- **New env:** `RESEND_API_KEY`, `SITELENS_MAIL_FROM` — source values from
  `integrations/RESEND/.creds`; set in the Dokploy app env for prod.
- **DNS:** none — `msalia.org` is already verified in Resend (sending enabled).
- **Traefik:** ensure the `/graphql` route allows WebSocket upgrades (HTTP/1.1
  `Upgrade`/`Connection` headers passed through).
- **Migrations:** one migration adds the token-expiry + reset columns to `users`.

---

## 11. Scope Boundaries (deferred)

- **SSO / social login** — stays a placeholder.
- **Delta-streaming subscriptions** — using the invalidation-ping pattern instead.
- **Realtime collaboration** beyond live-stale (no presence, cursors, locks).
- **Mailpit dev harness** — covered by `onboarding@resend.dev` + stdout log mode.
- **Multi-org-per-user** — unchanged (one org per user).
- **Physics animation library** — CSS transitions only for now.
