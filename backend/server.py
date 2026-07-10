"""Serves the Ledger page and the sale history the collector records.
Stdlib http.server -- traffic for a single-user market tool doesn't
warrant a framework.
"""
import json
import os
import sqlite3
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from collector import init_db

DB_PATH = os.environ.get("LEDGER_DB", "/data/ledger.db")
PORT = int(os.environ.get("PORT", "8080"))
STATIC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/history":
            return self._history(urllib.parse.parse_qs(parsed.query))
        if parsed.path in ("/", "/ledger.html"):
            return self._serve_file("ledger.html", "text/html; charset=utf-8")
        self.send_error(404)

    def _history(self, query):
        fp = (query.get("fingerprint") or [None])[0]
        if not fp:
            self.send_error(400, "fingerprint query param required")
            return
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute(
            "SELECT price, sold_at FROM sales WHERE fingerprint=? ORDER BY sold_at DESC LIMIT 500",
            (fp,),
        ).fetchall()
        conn.close()
        self._send_json([{"price": p, "sold_at": t} for p, t in rows])

    def _send_json(self, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, name, content_type):
        path = os.path.join(STATIC_DIR, name)
        try:
            with open(path, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[server] {self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    # idempotent: makes the server independent of whether the collector has
    # already run once in this container.
    init_db(sqlite3.connect(DB_PATH))
    with ThreadingHTTPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"[server] listening on :{PORT}", flush=True)
        httpd.serve_forever()
