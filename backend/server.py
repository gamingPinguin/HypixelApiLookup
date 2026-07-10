"""Serves the Ledger page and the sale history the collector records.
Stdlib http.server -- traffic for a single-user market tool doesn't
warrant a framework.
"""
import json
import os
import sqlite3
import time
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from collector import fetch_json, init_db

DB_PATH = os.environ.get("LEDGER_DB", "/data/ledger.db")
PORT = int(os.environ.get("PORT", "8080"))
STATIC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# explicit allowlist for top-level pages, plus anything under src/ with a safe
# extension -- not a general file server, avoids any path-traversal surface on
# a server that's meant to be reachable publicly.
TOP_LEVEL_PAGES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/bazaar-tracker.html": "bazaar-tracker.html",
    "/auction-tracker.html": "auction-tracker.html",
    "/flips.html": "flips.html",
    "/privacy.html": "privacy.html",
}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
}
SRC_ROOT = os.path.realpath(os.path.join(STATIC_DIR, "src"))


def resolve_static_path(url_path):
    """Returns (filesystem path, content type) for an allowed static request, or None."""
    if url_path in TOP_LEVEL_PAGES:
        name = TOP_LEVEL_PAGES[url_path]
        return os.path.join(STATIC_DIR, name), CONTENT_TYPES[os.path.splitext(name)[1]]
    ext = os.path.splitext(url_path)[1]
    if url_path.startswith("/src/") and ext in CONTENT_TYPES:
        candidate = os.path.realpath(os.path.join(STATIC_DIR, url_path.lstrip("/")))
        if candidate == SRC_ROOT or candidate.startswith(SRC_ROOT + os.sep):
            return candidate, CONTENT_TYPES[ext]
    return None

MOVERS_WINDOW_SECONDS = 24 * 3600
# snapshots land every ~10 minutes; +-15 min either side of the 24h mark
# guarantees a match without pulling in a point from a different day.
MOVERS_TOLERANCE_SECONDS = 900
LOW_SUPPLY_MAX_LISTINGS = 3
PLAYER_CACHE_TTL_SECONDS = 30 * 24 * 3600
MOJANG_PROFILE_URL = "https://sessionserver.mojang.com/session/minecraft/profile/{}"


def top_movers(conn, now_ts, limit=20):
    latest = dict(conn.execute(
        "SELECT product_id, sell_price FROM bazaar_snapshots "
        "WHERE ts = (SELECT MAX(ts) FROM bazaar_snapshots)"
    ).fetchall())
    target = now_ts - MOVERS_WINDOW_SECONDS
    day_ago_rows = conn.execute(
        "SELECT product_id, sell_price, ts FROM bazaar_snapshots "
        "WHERE ts BETWEEN ? AND ?",
        (target - MOVERS_TOLERANCE_SECONDS, target + MOVERS_TOLERANCE_SECONDS),
    ).fetchall()
    day_ago = {}
    for product_id, price, ts in day_ago_rows:
        # multiple snapshots can land in the tolerance window; keep the closest to target.
        if product_id not in day_ago or abs(ts - target) < abs(day_ago[product_id][1] - target):
            day_ago[product_id] = (price, ts)

    movers = []
    for product_id, old_price in ((k, v[0]) for k, v in day_ago.items()):
        new_price = latest.get(product_id)
        if new_price is None or not old_price:
            continue
        pct = (new_price - old_price) / old_price * 100
        movers.append({"item_id": product_id, "old_price": old_price, "new_price": new_price, "pct_change": pct})
    movers.sort(key=lambda m: abs(m["pct_change"]), reverse=True)
    return movers[:limit]


def bazaar_history(conn, product_id, limit=500):
    rows = conn.execute(
        "SELECT ts, buy_price, sell_price FROM bazaar_snapshots WHERE product_id=? "
        "ORDER BY ts DESC LIMIT ?",
        (product_id, limit),
    ).fetchall()
    return [{"ts": ts, "buy_price": b, "sell_price": s} for ts, b, s in rows]


def low_supply(conn, limit=30):
    rows = conn.execute(
        "SELECT item_id, COUNT(*) AS n, MIN(price) AS min_price FROM active "
        "GROUP BY item_id HAVING n <= ? ORDER BY n ASC, min_price DESC LIMIT ?",
        (LOW_SUPPLY_MAX_LISTINGS, limit),
    ).fetchall()
    return [{"item_id": r[0], "listings": r[1], "min_price": r[2]} for r in rows]


def resolve_player(conn, uuid):
    row = conn.execute("SELECT name, cached_at FROM players WHERE uuid=?", (uuid,)).fetchone()
    now_ts = int(time.time())
    if row and now_ts - row[1] < PLAYER_CACHE_TTL_SECONDS:
        return row[0]
    try:
        data = fetch_json(MOJANG_PROFILE_URL.format(uuid))
        name = data.get("name")
    except urllib.error.HTTPError:
        name = None
    except Exception:
        return row[0] if row else None  # network hiccup: serve stale cache over nothing
    conn.execute(
        "INSERT INTO players (uuid, name, cached_at) VALUES (?,?,?) "
        "ON CONFLICT(uuid) DO UPDATE SET name=excluded.name, cached_at=excluded.cached_at",
        (uuid, name, now_ts),
    )
    conn.commit()
    return name


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/history":
            return self._history(query)
        if parsed.path == "/api/bazaar-history":
            return self._bazaar_history(query)
        if parsed.path == "/api/movers":
            return self._send_json(top_movers(sqlite3.connect(DB_PATH), int(time.time())))
        if parsed.path == "/api/low-supply":
            return self._send_json(low_supply(sqlite3.connect(DB_PATH)))
        if parsed.path == "/api/player":
            return self._player(query)
        resolved = resolve_static_path(parsed.path)
        if resolved:
            return self._serve_file(*resolved)
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

    def _bazaar_history(self, query):
        product_id = (query.get("product") or [None])[0]
        if not product_id:
            self.send_error(400, "product query param required")
            return
        conn = sqlite3.connect(DB_PATH)
        rows = bazaar_history(conn, product_id)
        conn.close()
        self._send_json(rows)

    def _player(self, query):
        uuid = (query.get("uuid") or [None])[0]
        if not uuid:
            self.send_error(400, "uuid query param required")
            return
        conn = sqlite3.connect(DB_PATH)
        name = resolve_player(conn, uuid)
        conn.close()
        self._send_json({"uuid": uuid, "name": name})

    def _send_json(self, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path, content_type):
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
