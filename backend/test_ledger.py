"""Smallest runnable check for the parser and the sale/expiry classification.
No framework: run with `python test_ledger.py`, exits non-zero on failure.
"""
import base64
import gzip
import sqlite3

from nbt import decode_item_bytes, fingerprint, parse_nbt
from collector import EXPIRY_SLACK_SECONDS, init_db, reconcile, record_bazaar_snapshot
import server
from server import low_supply, resolve_player, top_movers


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


def test_fingerprint_includes_low_level_enchants():
    # a Sharpness 5 sword and a bare one are different items, even though 5 is
    # below the old "meaningful" threshold of 6 -- both must fingerprint distinctly.
    plain = fingerprint("HYPERION", {})
    enchanted = fingerprint("HYPERION", {"enchantments": {"sharpness": 5}})
    assert plain != enchanted
    assert "sharpness5" in enchanted


def test_fingerprint_pet_level_band_matches_js():
    ea = {"petInfo": '{"type": "ENDERMAN", "tier": "LEGENDARY"}'}
    fp = fingerprint("PET", ea, display_name="[Lvl 47] Enderman")
    assert "PET:ENDERMAN:LEGENDARY:40:" in fp


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


def test_bazaar_snapshot_prunes_old_rows():
    conn = sqlite3.connect(":memory:")
    init_db(conn)
    products = {"COAL": {"quick_status": {"buyPrice": 10, "sellPrice": 8}}}
    record_bazaar_snapshot(conn, products, now_ts=0)
    record_bazaar_snapshot(conn, products, now_ts=1000)
    assert conn.execute("SELECT COUNT(*) FROM bazaar_snapshots").fetchone()[0] == 2
    # third snapshot is far enough past retention to prune the ts=0 row, not the ts=1000 one.
    from collector import SNAPSHOT_RETENTION_SECONDS
    record_bazaar_snapshot(conn, products, now_ts=SNAPSHOT_RETENTION_SECONDS + 500)
    remaining = {row[0] for row in conn.execute("SELECT ts FROM bazaar_snapshots")}
    assert 0 not in remaining
    assert 1000 in remaining


def test_top_movers_pct_change():
    conn = sqlite3.connect(":memory:")
    init_db(conn)
    day = 24 * 3600
    record_bazaar_snapshot(conn, {"COAL": {"quick_status": {"buyPrice": 10, "sellPrice": 100}}}, now_ts=0)
    record_bazaar_snapshot(conn, {"COAL": {"quick_status": {"buyPrice": 10, "sellPrice": 150}}}, now_ts=day)
    movers = top_movers(conn, now_ts=day, limit=10)
    assert len(movers) == 1
    assert movers[0]["item_id"] == "COAL"
    assert abs(movers[0]["pct_change"] - 50.0) < 0.01


def test_top_movers_empty_without_day_old_data():
    conn = sqlite3.connect(":memory:")
    init_db(conn)
    record_bazaar_snapshot(conn, {"COAL": {"quick_status": {"buyPrice": 10, "sellPrice": 100}}}, now_ts=0)
    assert top_movers(conn, now_ts=0) == []


def test_low_supply_filters_by_threshold():
    conn = sqlite3.connect(":memory:")
    init_db(conn)
    conn.executemany(
        "INSERT INTO active (auction_uuid, item_id, fingerprint, price, end_ts, last_seen) VALUES (?,?,?,?,?,?)",
        [
            ("a1", "RARE_ITEM", "RARE_ITEM", 100, 0, 0),
            ("a2", "RARE_ITEM", "RARE_ITEM", 120, 0, 0),
            *[(f"c{i}", "COMMON_ITEM", "COMMON_ITEM", 10, 0, 0) for i in range(10)],
        ],
    )
    conn.commit()
    results = {r["item_id"]: r["listings"] for r in low_supply(conn)}
    assert results.get("RARE_ITEM") == 2
    assert "COMMON_ITEM" not in results  # 10 listings is well above the low-supply threshold


def test_resolve_player_uses_cache_without_network():
    conn = sqlite3.connect(":memory:")
    init_db(conn)
    conn.execute(
        "INSERT INTO players (uuid, name, cached_at) VALUES (?,?,?)",
        ("uuid-1", "CachedName", 10**12),  # far future cached_at, never expires in this test
    )
    conn.commit()

    def fail_if_called(url):
        raise AssertionError("should not hit the network for a fresh cache entry")

    original = server.fetch_json
    server.fetch_json = fail_if_called
    try:
        assert resolve_player(conn, "uuid-1") == "CachedName"
    finally:
        server.fetch_json = original


def test_resolve_player_fetches_on_cache_miss():
    conn = sqlite3.connect(":memory:")
    init_db(conn)

    original = server.fetch_json
    server.fetch_json = lambda url: {"id": "uuid-2", "name": "FreshName"}
    try:
        assert resolve_player(conn, "uuid-2") == "FreshName"
    finally:
        server.fetch_json = original
    cached = conn.execute("SELECT name FROM players WHERE uuid=?", ("uuid-2",)).fetchone()
    assert cached[0] == "FreshName"


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} tests passed")
