# SiteLens — Email Auth & Live Scene — Implementation Phases

> Sequenced roadmap. Each phase produces a working, demonstrable state.
> See [AUTH_AND_LIVE_SCENE_SPEC.md](./AUTH_AND_LIVE_SCENE_SPEC.md) for the full design.

---

## Phase Summary

| Phase | Focus                                                  | Depends On | Status      |
| ----- | ------------------------------------------------------ | ---------- | ----------- |
| 1     | Mail infrastructure (resend-rs)                        | —          | ✅ Done     |
| 2     | Email verification                                     | 1          | ✅ Done     |
| 3     | Self-service password reset                            | 1          | ✅ Done     |
| 4     | Org user management (`/settings/users`) + operator CLI | 1          | ✅ Done     |
| 5     | WebSocket subscription infra                           | —          | ✅ Done     |
| 6     | Live scene client (reconcile-by-id, camera decouple)   | 5          | Not started |
| 7     | Delightful animations                                  | 6          | Not started |

```
Auth track:   1 ──► 2
                └──► 3
                └──► 4
Live track:   5 ──► 6 ──► 7
```

The two tracks are independent; Phase 1 gates the auth track, Phase 5 gates the live track.

---

## Phase 1 — Mail infrastructure

Wire Resend so the API can send mail, with a safe dev fallback.

### Deliverables

- [x] Add `resend-rs` dependency.
- [x] `api/src/mail.rs`: `Mailer` built from `RESEND_API_KEY` + `SITELENS_MAIL_FROM`;
      `send_verification` / `send_password_reset` / `send_invite` with HTML+text bodies.
- [x] Log-mode fallback when `RESEND_API_KEY` is unset (print recipient + link).
- [x] Inject `Mailer` into the GraphQL context (`.data(...)` in `build_schema_with`).
- [x] App reads a **send-only-scoped** `RESEND_API_KEY` from **env** (SiteLens
      convention), set in Dokploy (prod) + local `.env`/compose (dev); the
      full-access devkit key (`integrations/RESEND/.creds`) is never used by the app.
- [x] Env documented in `.env.example` / compose / Dokploy notes.

### Tests

- [x] Unit: log-mode renders a body and never panics with no key.
- [x] Manual: a real test send confirms Resend delivery (`real_send_smoke` →
      `delivered@resend.dev`, verified domain `noreply@msalia.org`).

### Validates

The API can send (or log) an email through the configured provider.

---

## Phase 2 — Email verification

Turn signup verification into a real emailed link.

### Deliverables

- [x] Migration: `verification_token_expires` on `users`.
- [x] `signup` sends a verification email with `…/verify?token=`.
- [x] `resendVerification(email)` mutation (always returns true; rate-limited).
- [x] Verify page consumes the emailed token; login surfaces a "resend" affordance
      when the user is unverified.

### Tests

- [x] Integration: reused + invalid token rejected; resend reissues + lets login.
- [x] e2e: signup → (capture token) → verify → login; invalid token rejected;
      unverified login shows resend.

### Validates

A new user verifies via an emailed link; expired links are rejected.

---

## Phase 3 — Self-service password reset ✅

### Deliverables

- [x] Migration (`0012`): `reset_token` + `reset_token_expires` on `users`.
- [x] `requestPasswordReset(email)` — 1h single-use token, emails link, always true,
      rate-limited (no enumeration).
- [x] `resetPassword(token, newPassword)` — validates + rotates the hash, clears token.
- [x] `/forgot-password` page (replaces placeholder) and `/reset-password?token=` page.

### Tests

- [x] Integration: token single-use + expiry rejected
      (`password_reset_token_is_single_use_and_expires`).
- [x] e2e: forgot-password → (capture link via `sentEmails`) → reset → login with the
      new password; unknown email still succeeds and sends nothing (`password-reset.spec`).

### Validates

A user resets their own password via email without account-existence leaks.

---

## Phase 4 — Org user management ✅

Admin UI + the missing remove mutation + operator escape hatch.

### Deliverables

- [x] `removeUser(userId)` + `adminResetPassword(userId)` mutations with last-Admin /
      self guards (server-side).
- [x] Migration (`0012`): `invite_token_expires`; `inviteUser` emails the link.
- [x] `/settings/users` route (Admin-only): roster (email · role · status · joined)
      with Invite / Change role / Reset password / Remove actions (shadcn); destructive
      actions use `AlertDialogTrigger` confirmations.
- [x] Operator CLI bin `reset_password` (run via `docker exec`) for any user.

### Tests

- [x] Integration: cannot remove/demote the last Admin
      (`cannot_remove_or_demote_the_last_admin`); role change + invite covered by
      `admin_updates_user_role`, `invite`, `token_and_invite_errors`.
- [x] e2e: invite → accept → land in projects; admin reset emails a link
      (`users.spec`).

### Validates

An Admin can fully manage org membership; the operator can recover a locked-out
sole Admin.

---

## Additional work completed (auth track, beyond the original phases) ✅

Shipped alongside Phases 3–4 in response to follow-up requests:

- [x] **Removed Google SSO** from login/signup and deleted the placeholder route.
- [x] **Water-tight deletes.** `deleteProject` purges all uploaded files (DXF /
      terrain / buildings) and cascades every DB row; admin **`deleteOrganization`**
      (closes the account — removes all projects, files, and users) with cookie
      clear. Both behind **type-to-confirm** dialogs (exact project/org name).
      `Storage::delete_prefix` added. Integration tests verify DB cascade + physical
      file removal + cross-org isolation + admin guard.
- [x] **Email capture mode for tests.** `MAIL_CAPTURE=1` records mail in memory;
      `sentEmails` query lets e2e read links without spending Resend quota.
- [x] **Legal pages.** Public `/terms` and `/privacy`, GDPR-aligned (controller/
      processor roles, legal bases, full data-subject rights, transfers, breach
      notice, subprocessor disclosure). Linked from signup, the user dropdown, and
      the left rail; auth-aware "back" link.
- [x] **Docs/UI copy scrub** — removed system-architecture / data-provider details
      from user-facing text; fixed docs prev/next ordering.
- [x] **Auth-page redirects.** Signed-in users are redirected to `/projects` from
      every auth page (server-side in `page.tsx`); covered by `auth-redirect.spec`.
- [x] **Sidebar** — tooltips on rail icons + quick logout button.
- [x] **`useEffect` cleanup** — render-phase state / `useSyncExternalStore` where
      effects were avoidable.

> Remaining org/legal steps for full GDPR compliance (not code): customer DPA,
> documented subprocessor list + SCCs, breach-response process, records of
> processing, and (if non-EU) an EU representative.

---

## Phase 5 — WebSocket subscription infrastructure ✅

### Deliverables

- [x] `ScenePubSub` (per-`project_id` `tokio::sync::broadcast`) injected into the
      GraphQL context (`api/src/pubsub.rs`).
- [x] `projectChanged(projectId)` `#[Subscription]` returning a ping stream
      (`api/src/schema/subscription.rs`).
- [x] `publish(project_id)` calls in scene-affecting mutations: survey points
      (import/update/delete/bulk-delete/assign-category), control points
      (add/update/delete), grid axes, transform solve, overlays
      (upload/georef/delete), terrain/buildings refresh, and project georef update.
      (Org-wide category create/delete have no single project to target — noted.)
- [x] WebSocket transport mounted on `/graphql` (graphql-transport-ws), coexisting
      with the GraphiQL GET and the POST handler; connection auth from the session
      cookie at upgrade; org-ownership check before streaming.
- [ ] Traefik WS upgrade passthrough — verify on deploy (Traefik forwards the
      `Upgrade`/`Connection` headers by default; confirm in prod).

### Tests

- [x] Unit: publish → subscriber receives a ping; unrelated project gets nothing;
      no-subscriber publish is a no-op (`pubsub` tests).
- [x] Integration: subscription enforces org ownership, and a publish delivers a
      ping to the owner's stream (`project_changed_subscription_requires_org_ownership`).
- [ ] Manual: a `graphql-ws` client receives pings on edits (verify with the live
      client in Phase 6).

### Validates

Edits to a project emit a push over an authenticated WebSocket.

---

## Phase 6 — Live scene client

### Deliverables

- [ ] `SceneView` opens a `projectChanged` subscription for the open project.
- [ ] On ping (debounced), refetch `sceneData` and **reconcile by id** into existing
      state (no `setScene(newObject)` remount); remove the manual "Reload" reliance.
- [ ] `CameraRig` decoupled from data-driven bounds — re-aims only on first load,
      preset/reset, and table "locate".

### Tests

- [ ] e2e: edit in one browser context appears in another without reload (best-effort).
- [ ] Manual: rapid edits don't jerk the camera; view holds position.

### Validates

The scene updates itself live; the camera never resets on data change.

---

## Phase 7 — Delightful animations

### Deliverables

- [ ] Marker enter (fade + scale) / exit (deferred-unmount fade + scale) via CSS.
- [ ] Color tween on category/recategorize; quick opacity fade for grid/DXF lines.
- [ ] Verify reconcile-by-id keeps nodes stable so transitions actually fire.

### Tests

- [ ] Manual: add/remove/recategorize points and confirm smooth transitions.

### Validates

Scene changes appear and disappear smoothly — the "delightful" end state.
