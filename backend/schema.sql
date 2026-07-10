CREATE TABLE IF NOT EXISTS sales (
  auction_uuid TEXT PRIMARY KEY,
  item_id      TEXT,
  fingerprint  TEXT,
  price        INTEGER,
  sold_at      INTEGER,
  tier         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_fp ON sales (fingerprint, sold_at);

CREATE TABLE IF NOT EXISTS active (
  auction_uuid TEXT PRIMARY KEY,
  item_id      TEXT,
  fingerprint  TEXT,
  price        INTEGER,
  end_ts       INTEGER,
  last_seen    INTEGER
);

-- periodic bazaar price snapshots, for the "top movers" 24h change endpoint.
CREATE TABLE IF NOT EXISTS bazaar_snapshots (
  ts         INTEGER,
  product_id TEXT,
  buy_price  REAL,
  sell_price REAL
);
CREATE INDEX IF NOT EXISTS idx_snap_product_ts ON bazaar_snapshots (product_id, ts);

-- Mojang UUID -> username cache, so the browser never calls Mojang directly.
CREATE TABLE IF NOT EXISTS players (
  uuid      TEXT PRIMARY KEY,
  name      TEXT,
  cached_at INTEGER
);
