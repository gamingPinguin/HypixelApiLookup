"""Polls the Hypixel auction endpoint every POLL_INTERVAL seconds, diffs the
active listing set against the previous poll, and records sales.

A listing that disappears well before its stated end time was bought; one
that disappears at or after its end time expired back to the seller. See
the "Sale detection" section of README.md for the full reasoning.
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request

from nbt import decode_item_bytes, fingerprint

AUCTIONS_URL = "https://api.hypixel.net/v2/skyblock/auctions"
DB_PATH = os.environ.get("LEDGER_DB", "/data/ledger.db")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "60"))
# how much earlier than its stated end time a listing must vanish to count as sold,
# rather than expired -- covers poll jitter around the 60s cycle.
EXPIRY_SLACK_SECONDS = 90
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")


def init_db(conn):
    with open(SCHEMA_PATH, "r") as f:
        conn.executescript(f.read())
    conn.commit()


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read())


def fetch_all_bin_auctions():
    first = fetch_json(f"{AUCTIONS_URL}?page=0")
    total_pages = first["totalPages"]
    listings = [a for a in first["auctions"] if a["bin"]]
    for page in range(1, total_pages):
        data = fetch_json(f"{AUCTIONS_URL}?page={page}")
        listings.extend(a for a in data["auctions"] if a["bin"])
    return listings


def reconcile(conn, current_listings, now_ts):
    known = {
        row[0]: row
        for row in conn.execute(
            "SELECT auction_uuid, item_id, fingerprint, price, end_ts FROM active"
        ).fetchall()
    }
    current_ids = set()

    for listing in current_listings:
        uuid = listing["uuid"]
        current_ids.add(uuid)
        if uuid in known:
            conn.execute(
                "UPDATE active SET last_seen=? WHERE auction_uuid=?", (now_ts, uuid)
            )
            continue
        try:
            items = decode_item_bytes(listing["item_bytes"])
            ea = (items[0].get("tag") or {}).get("ExtraAttributes") if items else None
        except Exception:
            ea = None
        item_id = (ea or {}).get("id") or listing.get("item_name")
        fp = fingerprint(item_id, ea)
        conn.execute(
            "INSERT INTO active (auction_uuid, item_id, fingerprint, price, end_ts, last_seen) "
            "VALUES (?,?,?,?,?,?)",
            (uuid, item_id, fp, listing["starting_bid"], listing["end"] // 1000, now_ts),
        )

    vanished = [row for row_uuid, row in known.items() if row_uuid not in current_ids]
    for auction_uuid, item_id, fp, price, end_ts in vanished:
        if now_ts < end_ts - EXPIRY_SLACK_SECONDS:
            conn.execute(
                "INSERT OR IGNORE INTO sales (auction_uuid, item_id, fingerprint, price, sold_at, tier) "
                "VALUES (?,?,?,?,?,?)",
                (auction_uuid, item_id, fp, price, now_ts, None),
            )
        conn.execute("DELETE FROM active WHERE auction_uuid=?", (auction_uuid,))

    conn.commit()


def run():
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    while True:
        cycle_start = time.time()
        try:
            listings = fetch_all_bin_auctions()
            reconcile(conn, listings, int(cycle_start))
            print(f"[collector] reconciled {len(listings)} BIN listings", flush=True)
        except Exception as e:
            # a failed or partial fetch must not reconcile -- it would mark every
            # still-active auction as vanished and wrongly record it as sold.
            print(f"[collector] cycle failed, skipping: {e}", file=sys.stderr, flush=True)
        elapsed = time.time() - cycle_start
        time.sleep(max(0, POLL_INTERVAL - elapsed))


if __name__ == "__main__":
    run()
