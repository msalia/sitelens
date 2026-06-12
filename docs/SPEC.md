# SiteLens — Product & Architecture Specification

> Multi-tenant SaaS for construction surveyors: tie an architect's building grid to city control points, import surveyed points, and visualize everything in a 3D scene over real terrain — with full coordinate conversion across grid, projected, and geographic systems.

---

## 1. Overview

SiteLens is an office-first web application for land/construction surveyors. The core workflow it supports:

1. A surveyor receives an architect's plan and defines the building's **gridlines**.
2. The city provides **2+ geodetic control points** (published northing/easting).
3. SiteLens solves the **coordinate transformation** that maps the building grid onto real-world projected coordinates (ready for survey-machine ingestion).
4. The surveyor shoots new points in the field; their machine exports are **imported** into SiteLens (CSV / LandXML).
5. SiteLens **visualizes** the grid, control points, and surveyed points — with elevation — in a **3D scene** over open-source terrain, with the architect's **DXF** drawing overlaid.
6. Coordinates can be **converted** between systems and units at any time, per-point or ad hoc, and **exported** back out.

**Core principles**

- **Imported Z (elevation) is the source of truth.** Terrain is visual backdrop only, never survey-grade.
- **One canonical internal unit (meters).** Convert only at I/O boundaries; label units everywhere.
- **Precision math lives in Rust.** Rendering and CAD parsing live in the browser.
- **Tenancy isolation is a first-class security control**, not an afterthought.

**Office-first.** No live GPS / field capture in v1; field data arrives via machine export files.

## 2. Users & Access

**Tenancy:** Multi-tenant SaaS. Every record is scoped by `org_id`. A user belongs to exactly one org in v1. Strict cross-org isolation.

**Auth:** Email + password (with email verification). Sessions via secure, HTTP-only cookies (JWT). Passwords hashed with Argon2. Auth endpoints rate-limited. No SSO/OAuth in v1.

**Roles (within an org):**

| Role     | Capabilities                                                                     |
| -------- | -------------------------------------------------------------------------------- |
| Admin    | Manage org, invite/manage users, all project capabilities                        |
| Surveyor | Full project CRUD: grid/control entry, transforms, imports, conversions, exports |
| Viewer   | Read-only access to shared projects (for GCs / architects)                       |

## 3. Data Model

Stored in PostgreSQL + PostGIS. All coordinates persisted in **meters** (canonical). Spatial columns use PostGIS geometry for indexing/queries.

### 3.1 Org

- `id`, `name`, `created_at`
- Stripe billing columns: `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (null ⇒ free), `current_period_end`, `cancel_at_period_end` (see §11 Billing & Subscriptions)

### 3.2 User

- `id`, `org_id` (FK), `email` (unique), `password_hash` (Argon2), `role` (Admin | Surveyor | Viewer), `email_verified`, `created_at`

### 3.3 Project (a building site)

- `id`, `org_id` (FK), `name`, `description`
- `epsg_code` — projected CRS selected from the EPSG library (US defaults; user-selectable)
- `display_unit` — `us_survey_foot` | `international_foot` | `meter`
- `combined_scale_factor` — grid↔ground factor (or method to derive it)
- `site_origin_lat`, `site_origin_lon` — for terrain fetch + scene centering
- `created_at`, `updated_at`

### 3.4 ControlPoint

- `id`, `project_id` (FK), `label`
- `northing`, `easting`, `elevation` (meters, canonical)
- `source` — e.g. "city published"
- Used as the fixed points for the transform solve.

### 3.5 GridSystem

- `id`, `project_id` (FK)
- Axis definitions: named axes in two families (e.g. lettered A,B,C… and numbered 1,2,3…), each with an offset/coordinate in grid space.
- The grid defines the local "building grid" coordinate space.

### 3.6 Transform

- `id`, `project_id` (FK)
- Type: 4-parameter Helmert (similarity): `translation_e`, `translation_n`, `rotation`, `scale`
- Solve method: exact (2 points) or least-squares best-fit (3+ points)
- `residuals` — per-control-point residual (ΔE, ΔN) + magnitude
- `rms_error`
- Computed by the Rust geo-core; persisted with the inputs that produced it.

### 3.7 SurveyPoint

- `id`, `project_id` (FK), `label`, `description`
- `northing`, `easting`, `elevation` (meters, canonical) + PostGIS geometry
- `category_id` (FK, exactly one) + `tags` (free-text array)
- `import_batch_id` (FK, nullable)

### 3.8 PointCategory

- `id`, `org_id` (FK, nullable for built-in defaults), `name`, `color`, `icon`
- Default set (Control/Reference, Station/Setup, Column, Corner, Spot/Elevation, Utility, Other) + per-tenant custom categories.

### 3.9 PointGroup

- `id`, `project_id` (FK), `name`, member point IDs — a saved named selection.

### 3.10 ImportBatch / ImportProfile

- ImportBatch: `id`, `project_id`, `source_filename`, `format` (csv | landxml), `imported_at`, `row_count`
- ImportProfile: saved column-mapping + unit per project for reusable CSV imports.

### 3.11 CadOverlay (DXF)

- `id`, `project_id` (FK), `file_ref` (storage key), `original_filename`
- Georeference: `offset_e`, `offset_n`, `rotation`, `scale`, `assume_real_world` (bool)
- Parsed geometry cached (lines, polylines, arcs, text, layers).

### 3.12 Upload (generic file record)

- `id`, `org_id`, `project_id`, `storage_key`, `kind` (dxf | csv | landxml | snapshot), `size`, `created_at`
- Backed by a storage abstraction (local volume in v1, S3 later).

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (Next.js / React)                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ CesiumJS 3D  │  │ DXF parser   │  │ Forms / converter  │  │
│  │ scene        │  │ (client-side)│  │ point sidebar      │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘  │
└─────────┼─────────────────┼────────────────────┼─────────────┘
          │ GraphQL (cookie-auth JWT)             │
          ▼                                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Rust GraphQL API                                             │
│  • Helmert least-squares solve + residuals (nalgebra)       │
│  • EPSG projections, grid↔ground, unit conversion (PROJ)    │
│  • Tenancy enforcement (org_id scoping)                      │
│  • Import parsing (CSV / LandXML) in sandboxed jobs         │
│  • Storage abstraction (local volume → S3 later)            │
└───────────────┬─────────────────────────┬───────────────────┘
                │                          │
                ▼                          ▼
      ┌───────────────────┐      ┌───────────────────┐
      │ PostgreSQL+PostGIS│      │ Local file volume │
      │ (org-scoped, RLS) │      │ (uploads/snapshot)│
      └───────────────────┘      └───────────────────┘

External: AWS open Terrain Tiles (backdrop), optional Cesium Ion token (per tenant).
```

**Placement of geo math:** all precision/coordinate math (Helmert solve, EPSG projection via PROJ, grid↔ground scale, unit conversion) is in the **Rust** geo-core and exposed via GraphQL. DXF vector parsing and 3D rendering are **client-side**.

**Terrain:** AWS open Terrain Tiles by default (free, no token, global). A tenant may supply a Cesium Ion token for higher quality. Terrain is backdrop only.

## 5. API Design

GraphQL over HTTPS. Auth via HTTP-only cookie (JWT). Every resolver enforces `org_id` scoping at the API layer (see §8); Postgres RLS is scaffolded but not forced.

**Representative operations**

- Auth: `signup`, `login`, `logout`, `verifyEmail`, `me`
- Org/users: `inviteUser`, `updateUserRole`, `listUsers`
- Projects: `createProject`, `updateProject`, `listProjects`, `project(id)`
- Control & grid: `setGridSystem`, `addControlPoint`, `updateControlPoint`
- Transform: `solveTransform(projectId)` → returns Helmert params + per-point residuals + RMS
- Points: `importPoints(file, profile)`, `listPoints(filter)`, `updatePoint`, `createCategory`, `createGroup`
- Conversion: `convertCoordinate(input, fromSystem, toSystem, units)` → all representations
- CAD: `uploadDxf`, `setDxfGeoreference`, `parsedDxfGeometry`
- Export: `exportPoints(selection, system, unit, columnOrder, format)` → CSV / LandXML; `snapshot` for image

**Error handling:** typed GraphQL errors (validation, auth, not-found, tenancy-denied). Transform solve returns structured residual data even when RMS is high (surveyor decides acceptability).

## 6. UI/UX

**Roundedness:** TBD per project (default to template). Use shadcn/ui components first.

**Key screens**

- **Auth** — login / signup / verify.
- **Project list** — org's projects, create new.
- **Project workspace** — the core screen:
  - **3D Cesium viewport** (center): terrain, grid lines, control points, surveyed points (markers colored/iconed by category, floating at their Z), DXF overlay. Orbit/pan/zoom. Category visibility toggles.
  - **Point sidebar**: searchable/filterable list (by category, label, description, tags), multi-select, saved groups.
  - **Point inspector**: click a point → all coordinate representations live (building-grid, projected N/E grid + ground, lat/long, elevation) in project units, with copy buttons.
  - **Grid & control panel**: enter/edit gridlines and control points; trigger transform solve; view residuals + RMS.
  - **DXF panel**: upload, toggle visibility, adjust georeference (offset/rotation/scale) with live preview.
- **Standalone converter** — paste a coordinate in any system+unit, get all others.
- **Export dialog** — choose selection, target system, unit, column order, format (CSV/LandXML/image).

## 7. Coordinate Systems & Conversion

**Spaces supported**

1. **Building grid** — architect gridlines (axis + offset).
2. **Projected** — northing/easting in an EPSG-selected CRS (US State Plane / UTM etc.), with **grid vs ground** distinction via the combined scale factor.
3. **Geographic** — lat/long (WGS84).

**Units:** `us_survey_foot`, `international_foot`, `meter`. Internal canonical = meters. US-survey vs international foot tracked distinctly (~2 ppm difference matters).

**Transform:** building grid ↔ projected solved by 4-parameter Helmert (least-squares for 3+ control points), with residuals + RMS surfaced. Projected ↔ geographic via PROJ/EPSG. Grid ↔ ground via the combined scale factor.

## 8. Security

- **Tenancy isolation (top control):** `org_id` on every row, enforced **at the API layer** — every project-scoped resolver validates ownership (`ensure_project_in_org`, or a JOIN to `projects` on `org_id`) before reading or writing. A comprehensive cross-org isolation suite proves Org B is denied on every project-scoped read/mutation and can't even see Org A's projects. Postgres RLS policies are **scaffolded but deliberately not forced**: `async-graphql` resolves sibling fields concurrently over a shared pool, so the per-request connection pinning that `SET LOCAL app.current_org` requires would be a costly architecture change for a backstop behind a control already enforced and tested. The isolation suite is therefore the guardrail and must grow with every new project-scoped resolver. (Revisit forced RLS only if a dedicated-connection-per-request model or direct DB paths outside the API are introduced.)
- **Auth & rate limiting:** Email/password with Argon2 hashing; JWT in an HTTP-only `SameSite=Lax` cookie carrying `user_id`, `org_id`, `role`. `login`/`signup` are rate-limited per client IP (10/min, IP from `X-Forwarded-For` behind Traefik) via an in-process sliding window or a Redis fixed window (`INCR`+`EXPIRE`, selected by `REDIS_URL`) so the limit holds across API instances; the Redis path fails open on cache errors so an outage never locks users out.
- **File upload safety:** DXF/CSV/LandXML parsed in sandboxed jobs with size limits + timeouts (defend against huge/malicious files, XML-bomb-style LandXML). Files in object storage (local volume in v1), not the DB.
- **Secrets:** in `infra.json`/env, never committed.
- **Transport:** HTTPS via Dokploy/Traefik.
- Coordinate data is not treated as PII; no field-level encryption in v1.

## 9. Testing

- **Rust geo-core unit tests** (non-negotiable): Helmert solve, least-squares residuals, EPSG projections, grid↔ground, unit conversions — validated against **known-good reference values** (hand-computed / PROJ / published examples).
- **GraphQL API integration tests**: transform endpoints + **tenancy isolation** (org A cannot read org B).
- **Frontend**: component tests for forms/converter; **Playwright E2E** for the core flow (create project → enter grid+control → solve → import points → view in 3D → convert → export).
- **Shared utilities extracted and tested** (per standing preference) — notably the storage abstraction and unit/coordinate helpers.

## 10. Deployment

- **Dokploy compose stack** (fullstack template): Next.js frontend + Rust GraphQL API + PostgreSQL+PostGIS, behind Traefik at `sitelens.msalia.org`.
- **File storage:** local volume mount in v1, behind a storage interface so **AWS S3** slots in later without rework.
- **Single production environment** for v1; local Docker Compose for dev.
- Migrations run on deploy; PostGIS extension enabled via init.

## 11. Billing & Subscriptions

Subscription paywall over the multi-tenant model: one paid plan (**Crew**) above a
limited free tier (**Solo**), billed **per organization** via Stripe Checkout +
Customer Portal, with access driven by Stripe webhooks. The server is authoritative;
the client only mirrors entitlements for UX.

**Plans**

- **Solo** — free, default. `1 project · 1 admin · ≤5 non-admin members · no exports`.
- **Crew** — paid (`$10/mo` or `$99/yr` USD). Unlimited projects / admins / members + exports + DXF overlays.

**Model**

- Billing unit is the **organization**: one Stripe Customer + one Subscription per org; Admin-only.
- Plan is **derived** from Stripe status — no stored plan column. The Customer carries `metadata.org_id` so webhooks map back to the org.
- **Paid** iff `status ∈ {active, trialing, past_due}` (dunning keeps `past_due` usable until it cancels); `canceled`/none ⇒ free.
- **Cancel** uses `cancel_at_period_end`: the sub stays `active` until `current_period_end`, then `subscription.deleted` ⇒ lock.

**Enforcement** (two situations):

1. **At a Solo cap** — a free org within limits trying to exceed: block just that action with an upgrade error (create 2nd project · invite 6th non-admin · add/promote 2nd admin · any export · DXF overlays).
2. **Restricted / read-only** — a non-paid org whose usage **exceeds** Solo limits (e.g. a lapsed Crew org with >1 project or >5 members): all mutations blocked, reads allowed; Admin sees a full-screen upgrade page. A fresh free org within Solo limits is **not** restricted — just capped.

**Backend** (axum + GraphQL): a `billing` module wrapping Stripe (`STRIPE_SECRET_KEY`), hand-rolled over `reqwest` form POSTs to keep deps light; webhook signatures verified manually (HMAC-SHA256 over `t.payload`).

- Mutations (Admin): `createCheckoutSession(interval)` → Checkout URL; `createBillingPortalSession` → Customer Portal URL.
- Query `billing`: `{ plan, status, currentPeriodEnd, cancelAtPeriodEnd, restricted, canExport, limits, usage }` — powers UI gating.
- Webhook `POST /stripe/webhook` (alongside `/graphql`, reached via the web proxy route — no Traefik change): verify signature; handle `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_failed` → upsert the org's billing columns. Idempotent.
- Guards (`schema/mod.rs`): `require_editor_active` (blocks restricted orgs) on editor mutations; per-cap checks (`require_project_quota`, `require_member_quota`, `require_admin_quota`); `require_export` on exports; `require_paid` on DXF overlays.
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`.

**Frontend**

- `/settings/billing` (Admin): current plan + status + renewal/cancel date; **Upgrade** (monthly/annual → Checkout) when free; **Manage billing** (→ Portal) when paid.
- Full-screen upgrade gate when `restricted`.
- Inline upgrade prompts at Solo caps and gated features (export, DXF overlays) via a shared `UpgradeDialog`. Gated triggers stay **disabled until the `billing` query resolves** and default to gated, so a free org never momentarily sees the real flow.

**Testing:** enforcement + webhook handling are covered with crafted signed events + seeded DB state; the full Checkout flow is covered by Playwright with Stripe test cards (`sk_test_`, opt-in via `STRIPE_E2E=1` with the Stripe CLI listening).

**Legal:** Stripe is listed in `docs/legal/SUBPROCESSORS.md` and the public `/subprocessors` page (payment processor; billing contact + card data on Stripe's side).

## 12. Scope Boundaries (Deferred — NOT in v1)

- **DWG import** (DXF only; no open-source DWG parser — would require cloud conversion or paid ODA SDK).
- **Live field capture / GPS / mobile** (office-first; field data via machine export files).
- **SSO / OAuth** (email-password only).
- **Multi-org-per-user** (one org per user).
- **USGS 3DEP survey-grade terrain** (AWS open tiles backdrop only).
- **S3 storage** (local volume for now, behind an interface).
- **Staging environment.**
- **Property-based / fuzz testing** of transforms.
- **Real-time collaboration / multi-user live editing.**
- **Surface/TIN generation, contours, volumes** (points + grid + DXF only; no surface modeling).
