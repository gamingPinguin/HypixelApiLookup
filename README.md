# Ledger

A market data terminal for Hypixel Skyblock. Ledger tracks bazaar prices, surfaces profitable order flips and craft flips, and scans the auction house for underpriced listings using true item attributes rather than display names.

The current release runs entirely in the browser as a single HTML file. A planned second phase adds a small backend service that records sale history, a capability the public Hypixel API does not provide on its own.

---

## Contents

1. [Status](#status)
2. [Features](#features)
3. [How it works](#how-it-works)
4. [Running the browser version](#running-the-browser-version)
5. [Data sources](#data-sources)
6. [Accuracy and known limits](#accuracy-and-known-limits)
7. [Planned backend service](#planned-backend-service)
8. [Roadmap](#roadmap)
9. [Project layout](#project-layout)

---

## Status

| Component | State | Notes |
|:----------|:------|:------|
| Bazaar viewer | Shipped | Live order book, sortable |
| Order flip finder | Shipped | Margin net of fees, volume weighted |
| Craft flip finder | Shipped | 213 recipes embedded, priced live |
| Auction snipe scanner | Shipped | Attribute aware, decodes item NBT |
| Sale history graph | Planned | Requires the backend service |
| Seller name resolution | Planned | Requires server side lookup |

---

## Features

### Bazaar

A live view of every bazaar product. Each row shows instant buy price, instant sell price, the spread between them, spread as a percentage, and seven day traded volume. Every column sorts.

### Order flips

Classic bazaar order flipping. Place a buy order at the current instant sell price, then relist with a sell order at the current instant buy price. The margin shown is net of the 1.25 percent bazaar transaction fee.

Each flip also carries a Flip Score, defined as margin multiplied by weekly volume. A large spread on an item that trades twice a week is a trap, and the score pushes those items down the list so genuinely liquid opportunities rise to the top.

### Craft flips

For each craftable item whose recipe consists entirely of bazaar tradeable ingredients, Ledger prices the full bill of materials at the current instant buy cost, compares it against sell offer revenue net of fees, and ranks by profit per craft. Selecting a row expands the full ingredient list with per item prices.

### Auction snipes

The scanner pulls every active Buy It Now listing, decodes each item's binary attribute data, and groups listings by a fingerprint built from the properties that actually move price:

- Internal item identifier
- Recombobulation
- Stars and master stars
- Fuming potato books beyond the standard ten hot potato books
- Enchantments at level six or above, plus all ultimate enchantments
- Pet type, tier, and level band, plus whether the pet holds an item
- New Year Cake year and party hat variants

Reforges are deliberately excluded, since they are cheap to reapply and do not meaningfully change an item's resale value.

A listing is flagged as a snipe only when its variant has at least four comparable listings, the price sits at least twenty percent below the median of the other listings, and there is a real coin gap above the next cheapest listing. Selecting a snipe opens a detail panel showing the item's in game tooltip, a price breakdown of every listing for that variant, and a link to each seller's profile.

---

## How it works

The browser version is a single self contained HTML file. There is no build step and no server. Open it and it runs.

```
Browser (Ledger single file)
  |
  |-- fetch bazaar          --> Hypixel API  (refreshed every 60s)
  |-- fetch auction pages   --> Hypixel API  (on demand scan)
  |
  |-- decode item_bytes     --> gzip + base64 + NBT parse, in browser
  |-- fingerprint items     --> attribute based grouping
  |-- compute flips, crafts, snipes
  |
  '-- render tables and detail panels
```

Recipe data and item display names are embedded directly in the file at build time, so the app has no runtime dependency on any recipe service. The only live calls are to the public Hypixel endpoints.

### Item attribute decoding

Every auction carries an `item_bytes` field containing the item's full attribute set as gzip compressed, base64 encoded named binary tag data. Ledger decompresses this in the browser, walks the tag tree, and reads the `ExtraAttributes` block. This is what allows a clean item to be told apart from a maxed one that happens to share a display name.

---

## Running the browser version

1. Download `ledger.html`.
2. Open it in any modern browser.

That is the whole process. For live reload during development, the VS Code Live Server extension works well, though it is not required.

No API key is needed. The bazaar and auction endpoints used here are public and cached upstream, so they do not require authentication.

---

## Data sources

| Source | Use | Authentication |
|:-------|:----|:---------------|
| Hypixel bazaar endpoint | Live product prices and volume | None |
| Hypixel auctions endpoint | Active Buy It Now listings | None |
| NotEnoughUpdates repository | Crafting recipes and item names | Embedded at build time |
| SkyCrypt | Seller profile links | None, opened in a new tab |

The Hypixel endpoints are cached on Hypixel's side and refresh roughly once per minute. Requesting them more often than that returns identical data, so the refresh interval is set to sixty seconds to match.

---

## Accuracy and known limits

Ledger is a research tool. Every figure it shows is an estimate based on current listings and assumes your orders fill at the prices displayed. Treat its output as a shortlist to verify in game, not as a guarantee.

Specific limits worth understanding:

**Craft flips** only cover recipes where every ingredient trades on the bazaar. Recipes that require auction only items, non tradeable items, or NPC purchases are excluded. Profit assumes ingredients are bought at instant buy, so patient buy orders will do better than the figures shown.

**Snipe fingerprints** do not yet account for gemstone slots, attribute shards, or dungeon drill components. Each of these carries its own value and would need its own pricing table. Pet levels are grouped into bands twenty levels wide, so two pets in the same band are treated as equivalent even when their exact levels differ.

**Sale detection is not available in the browser version.** The Hypixel API exposes only active auctions. Once an auction sells or expires it leaves the API, so the browser cannot know whether a given item is actually selling or merely being listed. This is the primary motivation for the planned backend service.

---

## Planned backend service

The public API has no sale history endpoint. To provide history, Ledger needs a process that runs continuously and records what it observes over time. That process cannot live in a browser tab, so this phase introduces a small containerized service.

### Architecture

```
+---------------------------------------------------+
|  Container                                         |
|                                                    |
|  +-------------+        +----------------------+   |
|  |  Collector   |  --->  |  Database (SQLite)   |   |
|  |  every 60s:  |        |  active listings     |   |
|  |  poll API,   |        |  detected sales      |   |
|  |  diff state, |        +----------------------+   |
|  |  record sales|                 |                 |
|  +-------------+                  v                 |
|                        +----------------------+     |
|  browser  ---------->  |  Web server (API)    |     |
|                        |  serves the page     |     |
|                        |  serves history data |     |
|                        +----------------------+     |
+---------------------------------------------------+
```

### Sale detection

The collector infers sales by comparing consecutive snapshots of the active auction set.

When an auction listing is present in one snapshot and absent in the next, one of two things happened. Either the item sold, or the listing timer expired and the item returned to its seller. The two cases are separated by comparing the listing's stated end time against the moment it disappeared. A listing that vanishes well before its end time was bought. A listing that vanishes at or after its end time expired.

This heuristic is not perfect, since an item can be purchased in the final moments before expiry, but it matches the approach used by established community trackers and is accurate in the large majority of cases.

### Proposed schema

```sql
CREATE TABLE sales (
  auction_uuid TEXT PRIMARY KEY,
  item_id      TEXT,
  fingerprint  TEXT,
  price        INTEGER,
  sold_at      INTEGER,
  tier         TEXT
);
CREATE INDEX idx_sales_fp ON sales (fingerprint, sold_at);

CREATE TABLE active (
  auction_uuid TEXT PRIMARY KEY,
  item_id      TEXT,
  fingerprint  TEXT,
  price        INTEGER,
  end_ts       INTEGER,
  last_seen    INTEGER
);
```

On each poll the collector loads the known active set from the database, fetches the current set from the API, and reconciles the two. New identifiers are inserted. Identifiers still present have their last seen time updated. Identifiers that are now missing are classified as sold or expired and handled accordingly.

### What the backend unlocks

- Real sale history per item variant, and therefore a price chart that shows whether an item is actually selling
- Server side seller name resolution, caching Mojang lookups that a browser cannot make directly
- Persistence across restarts, since the database lives on a mounted volume
- The option to run continuously without a browser tab open

---

## Roadmap

| Phase | Goal |
|:------|:-----|
| 1 | Browser terminal with bazaar, flips, crafts, and snipes. Complete. |
| 2 | Containerized collector and database for sale detection. |
| 3 | Sale history charts per item variant in the detail panel. |
| 4 | Full listing search, so any item can be looked up directly rather than only flagged deals. |
| 5 | Server side seller name resolution and caching. |
| 6 | Extended snipe fingerprint covering gemstones and other value bearing attributes. |

---

## Project layout

The browser release is a single file. The planned backend introduces a small set of additional files.

```
ledger/
  ledger.html            Browser terminal, self contained
  README.md              This document

  backend/               Planned, phase 2 onward
    collector.py         Polls the API and records sales
    server.py            Serves the page and history endpoints
    schema.sql           Database definition
    requirements.txt     Python dependencies
    Dockerfile
    docker-compose.yml
```

---

## A note on scope

The browser version is intentionally the whole product for its own purpose. It answers the question "what is worth trading right now" without any infrastructure at all. The backend exists only to answer a question the browser structurally cannot, which is "what has actually been selling over time." Keeping that boundary clear is deliberate, so that the simple thing stays simple and the complex thing is added only where it earns its place.

Ledger is an independent project and is not affiliated with Hypixel Inc.
