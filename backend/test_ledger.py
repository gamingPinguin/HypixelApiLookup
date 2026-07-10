"""Smallest runnable check for the parser and the sale/expiry classification.
No framework: run with `python test_ledger.py`, exits non-zero on failure.
"""
import base64
import gzip
import sqlite3

from nbt import decode_item_bytes, fingerprint, parse_nbt
from collector import EXPIRY_SLACK_SECONDS, init_db, reconcile


def test_nbt_roundtrip():
    # {"a": 5} as a TAG_Compound, same bytes as the ledger.html self-test.
    buf = bytes([10, 0, 0, 3, 0, 1, 97, 0, 0, 0, 5, 0])
    assert parse_nbt(buf)["a"] == 5


def test_decode_item_bytes():
    raw = bytes([10, 0, 0, 9, 0, 1, 105, 3, 0, 0, 0, 0, 0])  # {"i": []}
    b64 = base64.b64encode(gzip.compress(raw)).decode()
    assert decode_item_bytes(b64) == []


def test_fingerprint_matches_js_cases():
    assert fingerprint("HYPERION", {}) == "HYPERION"
    assert "FPB5" in fingerprint("HYPERION", {"hot_potato_count": 15})
    assert fingerprint("HYPERION", None) == "HYPERION"


def _listing(uuid, item_id="COAL", price=1000, end_ts=10_000, bytes_ok=True):
    ea_bytes = bytes([10, 0, 0, 0])  # empty compound
    b64 = base64.b64encode(gzip.compress(ea_bytes)).decode() if bytes_ok else "not-base64"
    return {"uuid": uuid, "item_name": item_id, "starting_bid": price,
             "end": end_ts * 1000, "item_bytes": b64}


def test_reconcile_sold_vs_expired():
    conn = sqlite3.connect(":memory:")
    init_db(conn)

    # cycle 1: two fresh listings, one that will sell early and one that will expire.
    reconcile(conn, [
        _listing("sold-uuid", end_ts=10_000),
        _listing("expired-uuid", end_ts=100),
    ], now_ts=0)
    assert conn.execute("SELECT COUNT(*) FROM active").fetchone()[0] == 2

    # cycle 2: both vanish. sold-uuid disappears far before its end_ts -> sale.
    # expired-uuid disappears at/after its end_ts -> expiry, not a sale.
    reconcile(conn, [], now_ts=200)

    assert conn.execute("SELECT COUNT(*) FROM active").fetchone()[0] == 0
    sold = conn.execute("SELECT auction_uuid FROM sales").fetchall()
    assert sold == [("sold-uuid",)]


def test_reconcile_skips_when_within_expiry_slack():
    conn = sqlite3.connect(":memory:")
    init_db(conn)
    reconcile(conn, [_listing("edge-uuid", end_ts=200)], now_ts=0)
    # vanishes only just before end_ts, inside the slack window -> treated as expiry.
    reconcile(conn, [], now_ts=200 - EXPIRY_SLACK_SECONDS + 1)
    assert conn.execute("SELECT COUNT(*) FROM sales").fetchone()[0] == 0


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} tests passed")
