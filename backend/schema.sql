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
