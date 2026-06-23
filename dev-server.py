#!/usr/bin/env python3
"""Local dev static server with caching disabled.

The stock `python -m http.server` sends no cache headers, so browsers serve
stale JS/CSS on reload (which kept hiding edits during development). This sends
`Cache-Control: no-store` on every response so a normal reload always shows the
latest files. Serves the repo root regardless of the current working directory.
"""
import http.server
import os
import socketserver

PORT = 3333
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    print(f"Serving {ROOT} at http://localhost:{PORT} (no-cache)")
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        httpd.serve_forever()
