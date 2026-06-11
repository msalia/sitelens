# SiteLens — Email Auth & Live Scene — Implementation Phases

> Sequenced roadmap. Each phase produces a working, demonstrable state.
> See [AUTH_AND_LIVE_SCENE_SPEC.md](./AUTH_AND_LIVE_SCENE_SPEC.md) for the full design.

---

## Phase Summary

| Phase | Focus                                                  | Depends On | Status      |
| ----- | ------------------------------------------------------ | ---------- | ----------- |
| 1     | Mail infrastructure (resend-rs)                        | —          | ✅ Done      |
| 2     | Email verification                                     | 1          | Not started |
| 3     | Self-service password reset                            | 1          | Not started |
| 4     | Org user management (`/settings/users`) + operator CLI | 1          | Not started |
| 5     | WebSocket subscription infra                           | —          | Not started |
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

- [ ] Migration: `verification_token_expires` on `users`.
- [ ] `signup` sends a verification email with `…/verify?token=`.
- [ ] `resendVerification(email)` mutation (always returns true; rate-limited).
- [ ] Verify page consumes the emailed token; login surfaces a "resend" affordance
      when the user is unverified.

### Tests

- [ ] Unit: expired/invalid/already-used verification token paths.
- [ ] e2e: signup → (capture token) → verify → login.

### Validates

A new user verifies via an emailed link; expired links are rejected.

---

## Phase 3 — Self-service password reset

### Deliverables

- [ ] Migration: `reset_token` + `reset_token_expires` on `users`.
- [ ] `requestPasswordReset(email)` — 1h single-use token, emails link, always true,
      rate-limited (no enumeration).
- [ ] `resetPassword(token, newPassword)` — validates + rotates the hash, clears token.
- [ ] `/forgot-password` page (replaces placeholder) and `/reset-password?token=` page.

### Tests

- [ ] Unit: token expiry/single-use; password-strength enforcement reused.
- [ ] e2e: forgot-password → (capture token) → reset → login with the new password.

### Validates

A user resets their own password via email without account-existence leaks.

---

## Phase 4 — Org user management

Admin UI + the missing remove mutation + operator escape hatch.

### Deliverables

- [ ] `removeUser(userId)` + `adminResetPassword(userId)` mutations with last-Admin /
      self guards (server-side).
- [ ] Migration: `invite_token_expires`; `inviteUser` emails the link.
- [ ] `/settings/users` route (Admin-only): roster (email · role · status · joined)
      with Invite / Change role / Reset password / Remove actions (shadcn).
- [ ] Operator CLI bin `reset_password` (run via `docker exec`) for any user.

### Tests

- [ ] Unit: cannot remove/demote the last Admin; self-remove only if another Admin.
- [ ] e2e: invite → accept → change role → remove; last-Admin removal blocked.

### Validates

An Admin can fully manage org membership; the operator can recover a locked-out
sole Admin.

---

## Phase 5 — WebSocket subscription infrastructure

### Deliverables

- [ ] `ScenePubSub` (per-`project_id` `tokio::sync::broadcast`) in `AppState`/context.
- [ ] `projectChanged(projectId)` `#[Subscription]` returning a ping stream.
- [ ] `publish(project_id)` calls in scene-affecting mutations (points, categories,
      groups, grid, control, overlays, georef/update_project).
- [ ] WebSocket transport mounted on `/graphql` (graphql-transport-ws); connection
      auth from the session cookie; org-ownership check before streaming.
- [ ] Traefik WS upgrade passthrough verified.

### Tests

- [ ] Unit: publish → subscriber receives a ping; unrelated project gets nothing.
- [ ] Manual: a `graphql-ws` client receives pings on edits.

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
