# Infrastructure

## Domain

- **URL:** https://sitelens.msalia.org
- **DNS Provider:** AWS Lightsail
- **Record Type:** A
- **Target IP:** 108.174.61.68
- **Created:** 2026-06-09

## GitHub Repository

- **URL:** https://github.com/msalia/sitelens
- **Visibility:** public
- **Default Branch:** main

## Dokploy Deployment

- **Dashboard:** https://dok.msalia.org
- **Server:** server-1
- **Project ID:** tWDQCpljWUU-bduk-q81t
- **Compose ID:** 50mAX-t557Z8pJL0ry_SW
- **Environment ID:** lIQdpMb6nXqyM6hOQ4VYw
- **Resource Type:** compose (docker-compose)
- **Compose Path:** ./docker-compose.yml
- **Source:** git (https://github.com/msalia/sitelens.git, branch main)
- **Auto Deploy:** on push to main
- **Routed Service:** web (port 3000)
- **SSL:** Let's Encrypt

## Services (docker-compose)

| Service | Image / Build               | Internal Port | Purpose                                |
| ------- | --------------------------- | ------------- | -------------------------------------- |
| web     | ./web (Next.js, standalone) | 3000          | Frontend + docs; routed by Traefik     |
| api     | ./api (Rust GraphQL)        | 4000          | GraphQL API + geo-core                 |
| db      | postgis/postgis:16-3.4      | 5432          | PostgreSQL + PostGIS (volume `pgdata`) |

## AWS

- **Account ID:** 486491621206
- **Region:** us-east-1

## Production secrets

Set in the Dokploy compose environment (not committed):

- `POSTGRES_PASSWORD` / `DATABASE_URL` — strong generated password (set at provision time).
- `API_INTERNAL_URL=http://api:4000` — compose-internal API host for the web tier.
