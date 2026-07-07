#!/usr/bin/env bash
# Fast PDF design loop — render an HTML file through the live WeasyPrint report
# container WITHOUT rebuilding the api. Edit the HTML, re-run, view the PDF.
#
#   scripts/report-preview.sh [input.html] [output.pdf]
#
# Defaults: scripts/report-preview.html -> /tmp/report-preview.pdf, then opens it.
# The report container must be up (docker compose ... up -d report); it listens on
# host :5055 -> container :8000 (see docker-compose.override.yml).
#
# Workflow: iterate on the HTML/CSS here (this is the exact CSS baked into
# api/src/report/mod.rs). Once it looks right, port the CSS/structure into the
# Rust `report::render` + the consumer's body builder and rebuild the api once.
set -euo pipefail

IN="${1:-$(dirname "$0")/report-preview.html}"
OUT="${2:-/tmp/report-preview.pdf}"
PORT="${REPORT_PORT:-5055}"

python3 - "$IN" > /tmp/report-preview-payload.json <<'PY'
import json, sys
print(json.dumps({"html": open(sys.argv[1]).read()}))
PY

code=$(curl -s -o "$OUT" -w '%{http_code}' \
  -X POST "http://localhost:${PORT}/render" \
  -H 'Content-Type: application/json' \
  --data @/tmp/report-preview-payload.json)

if [ "$code" != "200" ]; then
  echo "render failed (HTTP $code):"; cat "$OUT"; echo; exit 1
fi
echo "Rendered $IN -> $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
[ "${NO_OPEN:-}" = "1" ] || (command -v open >/dev/null && open "$OUT") || true
