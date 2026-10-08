"""Serves the UI and forwards /api/* to the resume-screener backend (same origin, so no CORS needed).

Usage: python serve.py [--port 5173] [--backend http://127.0.0.1:8000]
Standard library only.
"""
import argparse
import http.server
import json
import urllib.error
import urllib.request
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent / "public"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
FORWARD_HEADERS = ("Content-Type", "Accept")


class Handler(http.server.SimpleHTTPRequestHandler):
    backend = "http://127.0.0.1:8000"
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self._json(404, {"detail": "Not found"})

    def _proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD_BYTES:
            self._json(413, {"detail": "Upload too large (50 MB limit)"})
            return
        body = self.rfile.read(length) if length else None
        url = self.backend.rstrip("/") + self.path[len("/api"):]
        headers = {h: self.headers[h] for h in FORWARD_HEADERS if self.headers.get(h)}
        request = urllib.request.Request(url, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=600) as resp:
                self._relay(resp.status, resp.headers.get("Content-Type"), resp.read())
        except urllib.error.HTTPError as err:
            self._relay(err.code, err.headers.get("Content-Type"), err.read())
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            self._json(502, {"detail": f"Backend not reachable at {self.backend} ({err})"})

    def _relay(self, status, content_type, data):
        self.send_response(status)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status, payload):
        self._relay(status, "application/json", json.dumps(payload).encode())

    def log_message(self, fmt, *args):
        if "/api/openapi.json" not in (args[0] if args else ""):  # skip the 15s health-check noise
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--backend", default="http://127.0.0.1:8000", help="Backend base URL")
    args = parser.parse_args()
    Handler.backend = args.backend
    # Bind to localhost only: the UI uploads resumes, so it shouldn't be reachable from the network.
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"UI:      http://127.0.0.1:{args.port}\nBackend: {args.backend}  (via /api)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
