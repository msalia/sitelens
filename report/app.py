"""Stateless HTML -> PDF report service (WeasyPrint).

The shared report renderer for the SiteLens feature suite (foundation §8). Each
feature builds its own HTML/CSS (+ inlines any rasterized figures as data URIs)
and POSTs it here; this service just renders HTML -> PDF. Single-purpose,
stateless, no auth (only reachable on the internal compose network).

    POST /render   { "html": "<html>…</html>" }  -> application/pdf
    GET  /health                                  -> {"status":"ok"}
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from weasyprint import HTML

# Guard against hostile/oversized payloads (HTML with inlined PNG figures).
MAX_BYTES = 25 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, b'{"status":"ok"}')
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/render":
            self._send(404, b'{"error":"not found"}')
            return
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BYTES:
            self._send(413, b'{"error":"missing or oversized payload"}')
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            html = payload.get("html", "")
            if not html:
                self._send(400, b'{"error":"missing html"}')
                return
            pdf = HTML(string=html).write_pdf()
            self._send(200, pdf, "application/pdf")
        except Exception as exc:  # noqa: BLE001 — surface any render error as 500
            self._send(500, json.dumps({"error": str(exc)}).encode())

    def log_message(self, *args) -> None:  # keep the container logs quiet
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"SiteLens report service listening on 0.0.0.0:{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
