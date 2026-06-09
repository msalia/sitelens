# Deployment

## How It Works

SiteLens deploys to Dokploy at https://dok.msalia.org as a **compose** resource.
Dokploy pulls from GitHub, builds the `docker-compose.yml` stack (web + api + db),
and Traefik routes HTTPS traffic to the `web` service on port 3000 at
https://sitelens.msalia.org.

The `db` service uses `postgis/postgis:16-3.4`; the `pgdata` volume persists data
across redeploys. The API reaches the DB at host `db`, and the web tier reaches
the API at `http://api:4000` — both on the compose-internal network.

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
```

The committed root `.env` holds only safe local-dev defaults.

## Monitoring a Deploy

Poll the compose status until `done` or `error`:

```bash
TOKEN=$(grep '^TOKEN' ../../integrations/DOKPLOY-server-1/.creds | awk '{print $2}')
curl -s -H "x-api-key: $TOKEN" \
  "https://dok.msalia.org/api/trpc/compose.one?input=$(python3 -c 'import json,urllib.parse; print(urllib.parse.quote(json.dumps({"json":{"composeId":"50mAX-t557Z8pJL0ry_SW"}})))')"
```
