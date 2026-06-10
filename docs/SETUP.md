# Local Setup

## Prerequisites

- Docker + Docker Compose
- Node.js 20+ and npm (for working on the web tier natively)
- Rust 1.93+ and cargo (for working on the api tier natively)
- git, gh CLI (authenticated)

## Getting Started (full stack via Docker)

```bash
git clone git@github.com:msalia/sitelens.git
cd sitelens
cp .env.example .env   # local config + secrets (gitignored)
docker compose up --build
```

This starts the services (ports from `docker-compose.override.yml`):

| Service     | URL                           | Check                                     |
| ----------- | ----------------------------- | ----------------------------------------- |
| Web         | http://localhost:3000         | Home shows "API: healthy · DB: connected" |
| Web docs    | http://localhost:3000/docs    | Documentation site                        |
| API health  | http://localhost:4000/health  | `{"status":"healthy","db":"connected"}`   |
| API GraphQL | http://localhost:4000/graphql | GraphiQL playground (GET)                 |
| DB          | localhost:5432                | PostgreSQL + PostGIS                      |

Reset the database: `docker compose down -v && docker compose up --build`.

## Hybrid development (faster iteration)

Run the database (and optionally the API) in Docker, and the tier you're editing
natively.

**Web (native):**

```bash
docker compose up db api          # backing services
cd web
npm install
API_INTERNAL_URL=http://localhost:4000 npm run dev
```

**API (native):**

```bash
docker compose up db
cd api
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sitelens cargo run
```

## Tests

```bash
# Web unit tests
cd web && npm test

# Web end-to-end (Playwright) — tests live in web/e2e
cd web && npm run test:e2e

# API unit tests (geo-core, units)
cd api && cargo test
```

## Project Structure

```
sitelens/
├── docker-compose.yml            # web + api + db + redis (production-shaped)
├── docker-compose.override.yml   # local host ports (auto-merged)
├── .env.example                  # safe defaults (committed); copy to .env
├── .env                          # local config + secrets (gitignored)
├── db/
│   └── init.sql                  # enables PostGIS + uuid-ossp
├── web/                          # Next.js frontend + docs site
│   ├── src/app/                  # routes (/, /api/health, /docs/*)
│   ├── src/components/           # docs-nav, docs-page, ui/
│   ├── src/content/docs/         # markdown documentation content
│   ├── src/lib/                  # api client, docs loader, utils
│   └── e2e/                      # Playwright tests (project-local)
├── api/                          # Rust GraphQL API
│   └── src/                      # main.rs (server), units.rs (conversions)
└── docs/                         # project docs (this directory)
```
