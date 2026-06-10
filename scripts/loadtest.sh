#!/usr/bin/env bash
# Sustained-load test for the SiteLens API using `oha`.
#
# Usage:
#   scripts/loadtest.sh [BASE_URL]
#
# Defaults to the health endpoint. To load-test an authenticated GraphQL query,
# pass a session cookie via SITELENS_COOKIE (copy `sitelens_session=...` from
# your browser's devtools after logging in):
#
#   SITELENS_COOKIE='sitelens_session=...' scripts/loadtest.sh https://sitelens.msalia.org
#
# Tunables: DURATION (default 30s), CONCURRENCY (default 50).

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
DURATION="${DURATION:-30s}"
CONCURRENCY="${CONCURRENCY:-50}"

if ! command -v oha >/dev/null 2>&1; then
  echo "error: 'oha' is not installed. Install it with:" >&2
  echo "  cargo install oha   # or: brew install oha" >&2
  exit 1
fi

if [[ -n "${SITELENS_COOKIE:-}" ]]; then
  echo "==> Load testing authenticated GraphQL on ${BASE_URL} for ${DURATION} @ ${CONCURRENCY} conns"
  # A cheap, representative authenticated read: the current user.
  oha -z "${DURATION}" -c "${CONCURRENCY}" \
    -m POST \
    -H "Content-Type: application/json" \
    -H "Cookie: ${SITELENS_COOKIE}" \
    -d '{"query":"{ me { id email role } }"}' \
    "${BASE_URL}/api/graphql"
else
  echo "==> Load testing health endpoint on ${BASE_URL} for ${DURATION} @ ${CONCURRENCY} conns"
  echo "    (set SITELENS_COOKIE to test an authenticated GraphQL query instead)"
  oha -z "${DURATION}" -c "${CONCURRENCY}" "${BASE_URL}/api/health"
fi
