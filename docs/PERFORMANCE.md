# Performance

Phase 9 baselines, budgets, and how to reproduce them. Measure against real
numbers, not guesses — re-run the harnesses below and compare before changing
hot paths.

## Geo-core micro-benchmarks (baseline)

CPU-only Criterion benchmarks (`api/benches/core_bench.rs`), no database. Run:

```bash
cd api && cargo bench --bench core_bench
```

Baseline on the dev machine (Apple Silicon, `opt-level = 2`), 2026-06-09 — median time:

| Benchmark | Input | Time | Throughput |
|---|---|---|---|
| `solve_helmert` | 4 pts | ~1.09 µs | 3.7 Melem/s |
| `solve_helmert` | 50 pts | ~3.11 µs | 16 Melem/s |
| `solve_helmert` | 500 pts | ~23.2 µs | 21 Melem/s |
| `helmert_apply` | 1 pt | ~1.6 ns | — |
| `projected_to_geographic` | 1 pt | ~1.31 µs | — |
| `convert_full` | 1 pt | ~1.32 µs | — |
| `parse_csv` | 1,000 rows | ~450 µs | 2.2 Mrows/s |
| `parse_csv` | 10,000 rows | ~4.36 ms | 2.3 Mrows/s |

**Takeaways**
- The CRS projection (`proj4rs`) dominates `convert` — `convert_full` ≈
  `projected_to_geographic`. The Helmert math itself (`apply`) is ~1.6 ns and
  negligible. Optimizing conversion means optimizing/caching the projection, not
  the linear algebra.
- `solveTransform` is microseconds even at 500 control points; it is never a
  bottleneck at realistic survey sizes.
- CSV parsing runs at ~2.2M rows/s, so import latency is dominated by the
  database insert, not parsing. Scale imports by batching inserts, not by
  touching the parser.

## Database

Indexes covering the hot query paths (see `migrations/`):

- `users (lower(email))` unique — login / signup lookups (`0001`).
- FK indexes on every `org_id` / `project_id` column (`0001`–`0005`).
- `survey_points` trigram GIN on `label` and `description` (`0006`) — makes the
  leading-wildcard `ILIKE` substring search index-backed instead of a full scan.
- `survey_points (project_id, seq)` (`0006`) — serves the paginated list in
  stable insertion order without a sort. `seq` (a `bigserial`) gives a total
  order; `created_at` alone ties for bulk-imported rows.

Tag substring search is intentionally not indexed (`array_to_string` is not
`IMMUTABLE`, so it can't back an expression index); tags are a secondary filter.

## API

- **`surveyPoints` is paginated** (`limit` clamped to [1, 1000], default 200;
  `offset`) with a companion `surveyPointCount` for the UI. The list query is
  always bounded — no unbounded result sets.
- `sceneData` issues a fixed, small number of queries (project, transform,
  control points, survey points, grid axes) — no N+1.
- Pagination uses `limit`/`offset` rather than Relay cursor connections:
  the UI is page-numbered with a total, which offset/limit fits directly. The
  `(project_id, seq)` index keeps shallow pages cheap; revisit keyset/Relay
  connections only if a project reaches tens of thousands of points and deep
  pages become hot.

## Frontend

- **Cesium is not in the JS bundle.** It loads from `/cesium/Cesium.js` via a
  script tag, so the app bundle stays small and the 3D engine is fetched only
  when the 3D view is opened.
- The 3D view (`SceneView` → `CesiumViewer`) is a `dynamic(..., { ssr: false })`
  import — code-split and lazy-loaded on demand.
- **Survey points render on a clustered `CustomDataSource`** (pixelRange 40,
  minimumClusterSize 5): dense sites collapse into labelled clusters when zoomed
  out, keeping the scene legible and the frame rate up with many points.
- The survey-points table is **paginated at 50 rows/page**, so the DOM never
  holds thousands of rows regardless of dataset size.
- DXF parsing happens client-side (`dxf-parser`) only for visible overlays.

## Budgets

Targets to hold; a regression past these warrants investigation.

| Metric | Budget |
|---|---|
| `solveTransform` (≤500 pts) | < 1 ms server compute |
| `convertCoordinate` (single) | < 1 ms server compute |
| `surveyPoints` page (50 rows) | < 50 ms server p95 |
| CSV parse (10k rows) | < 10 ms |
| App First Load JS (excl. Cesium) | < 300 kB |
| 3D scene interaction | ≥ 30 fps with clustering at typical zoom |

## Load testing

`scripts/loadtest.sh` drives sustained load with [`oha`](https://github.com/hatoo/oha).
It hits the public health endpoint by default, and can POST an authenticated
GraphQL query when given a session cookie:

```bash
# Liveness endpoint, 30s:
scripts/loadtest.sh https://sitelens.msalia.org

# Authenticated GraphQL query (paste a session cookie from your browser):
SITELENS_COOKIE='sitelens_session=...' scripts/loadtest.sh https://sitelens.msalia.org
```

Record p95/p99 before and after a change and confirm no regression against the
budgets above.
