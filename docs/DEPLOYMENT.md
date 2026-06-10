# Deployment

## How It Works

SiteLens deploys to Dokploy at https://dok.msalia.org as a **compose** resource.
Dokploy pulls from GitHub, builds the `docker-compose.yml` stack
(web + api + db + redis), and Traefik routes HTTPS traffic to the `web` service on
port 3000 at https://sitelens.msalia.org.

The `db` service uses `postgis/postgis:16-3.4`; the `pgdata` volume persists data
across redeploys. PostGIS + `uuid-ossp` + `pg_trgm` extensions are created by the
first migration, so they're present in fresh and ephemeral databases alike. The
API reaches the DB at host `db`, Redis at `redis://redis:6379`, and the web tier
reaches the API at `http://api:4000` — all on the compose-internal network. The
`redis` service is an ephemeral cache (no persistence) backing the auth rate
limiter.

**Migrations run automatically** on API startup (`db::run_migrations`), so a
deploy applies any new migrations before serving. Never edit an
already-applied migration file — sqlx validates checksums and a changed file
fails startup with `VersionMismatch`; always add a new migration instead.

## Ship Code

Use `/project ship` or manually:

```bash
# from sitelens/
cd web && npm run format && npm test && cd ..
cd api && cargo fmt && cargo test && cd ..

# verify the full stack builds and runs
docker compose build
docker compose up -d
curl -s http://localhost:4000/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
docker compose down

git add -A
git commit -m "feat: <description>"
git push

# trigger deploy (token from integrations/DOKPLOY-server-1/.creds)
TOKEN=$(grep '^TOKEN' ../../integrations/DOKPLOY-server-1/.creds | awk '{print $2}')
curl -s -H "x-api-key: $TOKEN" "https://dok.msalia.org/api/trpc/compose.deploy" \
  -X POST -H "Content-Type: application/json" \
  --data-raw '{"json":{"composeId":"50mAX-t557Z8pJL0ry_SW"}}'

# reload Traefik after deploy
curl -s -H "x-api-key: $TOKEN" "https://dok.msalia.org/api/trpc/settings.reloadTraefik" \
  -X POST -H "Content-Type: application/json" --data-raw '{"json":{}}'
```

## Environment Variables

Production env is set on the Dokploy compose resource:

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong generated value>
POSTGRES_DB=sitelens
DATABASE_URL=postgresql://postgres:<password>@db:5432/sitelens
API_INTERNAL_URL=http://api:4000
REDIS_URL=redis://redis:6379
JWT_SECRET=<strong generated value>
COOKIE_SECURE=true
STORAGE_DIR=/data/uploads
CESIUM_ION_TOKEN=<cesium ion token>     # optional; enables Ion World Terrain
```

Secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`, `CESIUM_ION_TOKEN`) live **only** in
the Dokploy env, never in git. The local `.env` is **gitignored**; copy
`.env.example` (committed, safe defaults with empty secrets) to `.env` for local
runs. `COOKIE_SECURE=true` is required in production so the session cookie is
only sent over HTTPS.

## Monitoring a Deploy

Poll the compose status until `done` or `error`:

```bash
TOKEN=$(grep '^TOKEN' ../../integrations/DOKPLOY-server-1/.creds | awk '{print $2}')
curl -s -H "x-api-key: $TOKEN" \
  "https://dok.msalia.org/api/trpc/compose.one?input=$(python3 -c 'import json,urllib.parse; print(urllib.parse.quote(json.dumps({"json":{"composeId":"50mAX-t557Z8pJL0ry_SW"}})))')"
```
