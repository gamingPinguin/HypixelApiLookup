# Ledger

A market data terminal for Hypixel Skyblock. Ledger tracks bazaar prices, surfaces profitable order flips and craft flips, and scans the auction house for underpriced listings using true item attributes rather than display names.

The browser release runs as a single HTML file with no build step. A small containerized backend records sale history, a capability the public Hypixel API does not provide on its own.

---

## Contents

1. [Status](#status)
2. [Features](#features)
3. [How it works](#how-it-works)
4. [Running the browser version](#running-the-browser-version)
5. [Running the backend](#running-the-backend)
6. [Data sources](#data-sources)
7. [Accuracy and known limits](#accuracy-and-known-limits)
8. [Backend service](#backend-service)
9. [Roadmap](#roadmap)
10. [Design direction](#design-direction)
11. [References](#references)
12. [Project layout](#project-layout)

---

## Status

| Component | State | Notes |
|:----------|:------|:------|
| Bazaar viewer | Shipped | Live order book, sortable |
| Order flip finder | Shipped | Margin net of fees, volume weighted |
| Craft flip finder | Shipped | Recipes fetched live from the NEU repo, cached in the browser |
| Auction snipe scanner | Shipped | Attribute aware, decodes item NBT |
| Backend collector and API | Shipped | Records BIN sales, containerized, `/api/history` endpoint |
| Sale history graph | Planned | Backend records the data; no chart in the browser yet |
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
- Pet type, tier, and whether the pet holds an item
- New Year Cake year and party hat variants

Reforges are deliberately excluded, since they are cheap to reapply and do not meaningfully change an item's resale value.

A listing is flagged as a snipe only when its variant has at least four comparable listings, the price sits at least twenty percent below the median of the other listings, and there is a real coin gap above the next cheapest listing. Selecting a snipe opens a detail panel showing a price breakdown of every listing for that variant and a link to each seller's profile.

---

## How it works

The browser version is a single self contained HTML file. There is no build step and no server required to use it standalone.

```
Browser (Ledger single file)
  |
  |-- fetch bazaar          --> Hypixel API  (refreshed every 60s)
  |-- fetch auction pages   --> Hypixel API  (on demand scan)
  |-- fetch recipes         --> NEU repo     (on demand, cached in localStorage)
  |
  |-- decode item_bytes     --> gzip + base64 + NBT parse, in browser
  |-- fingerprint items     --> attribute based grouping
  |-- compute flips, crafts, snipes
  |
  '-- render tables and detail panels
```

### Item attribute decoding

Every auction carries an `item_bytes` field containing the item's full attribute set as gzip compressed, base64 encoded named binary tag data. Ledger decompresses this in the browser, walks the tag tree, and reads the `ExtraAttributes` block. This is what allows a clean item to be told apart from a maxed one that happens to share a display name. The backend collector decodes the same format in Python so both sides group auctions into identical variants.

---

## Running the browser version

1. Download `ledger.html`.
2. Open it in any modern browser.

That is the whole process. No API key is needed. The bazaar and auction endpoints used here are public and cached upstream, so they do not require authentication.

---

## Running the backend

```
cd backend
docker compose build
docker compose up
```

The page and the history API are both served on port 8080. Data lives in a named Docker volume, so it survives container restarts. Run the self-tests with `python backend/test_ledger.py` before building if you've changed the collector or parser.

---

## Data sources

| Source | Use | Authentication |
|:-------|:----|:---------------|
| Hypixel bazaar endpoint | Live product prices and volume | None |
| Hypixel auctions endpoint | Active Buy It Now listings | None |
| NotEnoughUpdates repository | Crafting recipes | None, fetched live and cached |
| SkyCrypt | Seller profile links | None, opened in a new tab |

The Hypixel endpoints are cached on Hypixel's side and refresh roughly once per minute. Requesting them more often than that returns identical data, so the refresh interval is set to sixty seconds to match.

---

## Accuracy and known limits

Ledger is a research tool. Every figure it shows is an estimate based on current listings and assumes your orders fill at the prices displayed. Treat its output as a shortlist to verify in game, not as a guarantee.

Specific limits worth understanding:

**Craft flips** only cover recipes where every ingredient trades on the bazaar. Recipes that require auction only items, non tradeable items, or NPC purchases are excluded. Profit assumes ingredients are bought at instant buy, so patient buy orders will do better than the figures shown.

**Snipe fingerprints** do not yet account for gemstone slots, attribute shards, or dungeon drill components. Each of these carries its own value and would need its own pricing table. Pets are grouped by type and tier only, not by exact level, so two pets of the same tier are treated as equivalent even when their levels differ.

**Sale detection is a heuristic, not a certainty.** The Hypixel API exposes only active auctions. The backend infers a sale by comparing consecutive snapshots: a listing that vanishes well before its stated end time was bought, one that vanishes at or after its end time expired. An item purchased in the final moments before expiry can be misclassified, though this matches the approach used by established community trackers and is accurate in the large majority of cases.

---

## Backend service

The public API has no sale history endpoint. To provide history, Ledger runs a process that polls continuously and records what it observes over time. That process cannot live in a browser tab, so it runs as a small containerized service instead.

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

When an auction listing is present in one snapshot and absent in the next, one of two things happened. Either the item sold, or the listing timer expired and the item returned to its seller. The two cases are separated by comparing the listing's stated end time against the moment it disappeared, with a slack window around the 60 second poll interval.

### Schema

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

On each poll the collector loads the known active set from the database, fetches the current set from the API, and reconciles the two. New identifiers are inserted. Identifiers still present have their last seen time updated. Identifiers that are now missing are classified as sold or expired and handled accordingly. A failed or partial fetch skips the whole reconcile cycle rather than risk marking every active listing as sold.

### What the backend unlocks

- Real sale history per item variant, and therefore a price chart that shows whether an item is actually selling
- Server side seller name resolution, caching Mojang lookups that a browser cannot make directly
- Persistence across restarts, since the database lives on a mounted volume
- The option to run continuously without a browser tab open

---

## Roadmap

The four tabs shipped today cover the core liquid strategies, and the backend now records sale history even though nothing in the browser reads it yet. The list below is the fuller catalog of flip types the project aims toward, modeled on the range offered by SkyCofl. Each is a distinct market with its own data needs, so they are staged by how much new infrastructure they require.

### Shipped

| Feature | Description |
|:--------|:------------|
| Bazaar viewer | Live order book across all products |
| Order flips | Buy order to sell offer, net of fees, volume weighted |
| Craft flips | Buy ingredients, craft, sell, ranked by profit |
| Auction snipes | Attribute aware underpriced listing detection |
| Backend collector and history API | Sale detection, SQLite storage, `/api/history` endpoint |

### Planned, browser only

These need no backend, only more logic in the existing file.

| Feature | Description |
|:--------|:------------|
| Full listing search | Look up any item and see every live listing, not only flagged deals |
| Top margins by coins | Highest absolute profit gap across the bazaar |
| Top margins by percent | Highest percentage profit gap |
| Top demand | Items ranked by sell volume |
| NPC flips | Buy from a vendor, sell to the bazaar or auction house |
| Reverse NPC flips | Buy below vendor value from players, sell to the vendor |
| Book flips | Combine enchantment books to a higher level and resell |

### Planned, backend required

These depend on the collector recording data over time.

| Feature | Description |
|:--------|:------------|
| Sale history charts | Per variant price history, so you can see whether an item actually sells |
| Top movers | Largest 24 hour price swings, up and down |
| Low supply research | Thin markets flagged before you chase a niche item |
| Seller name resolution | Server side Mojang lookups, cached |
| Mayor flips | Event driven predictions based on historic mayor term pricing |
| Kat flips | Profitable pet upgrades through the Kat NPC |
| Forge flips | Dwarven forge recipes with cooldown tracking |
| Attribute and fusion flips | Shard combination opportunities |

---

## Design direction

Ledger's interface aims for a calm, corporate market terminal look rather than a gaming aesthetic. The reference points below define the target.

### Layout and typography

The page structure follows the pattern of Bazaar Tracker: a slim top navigation bar, a headline summary row of a few large stat figures, then dense sortable data tables grouped into clearly labeled sections. Each section leads with a one line description of what the numbers mean.

Typography stays in a single clean sans serif family with tabular figures, so columns of numbers align. Color is used sparingly and only to carry meaning, green for gain, red for loss, one accent for interactive elements. There are no gradients, textures, or decorative flourishes.

### Iconography

Item and category icons follow the flat, evenly weighted style used by skyblock.finance, where each icon reads clearly at small sizes and shares a consistent visual weight with its neighbors. Icons support the data rather than competing with it. Not yet implemented in the browser file; it needs an icon asset source, see the note in Roadmap.

### Principles

- Numbers are the interface. Everything else stays quiet.
- One accent color, used only for links and active states.
- Consistent icon weight across every row.
- A section is never shown without a plain language note on how to read it.

---

## References

The project draws on three existing tools. They are listed here as design and feature references, not as dependencies.

| Reference | Used for |
|:----------|:---------|
| [SkyCofl flipping hub](https://sky.coflnet.com/flips) | The catalog of flip types and how each market is framed by capital, risk, and liquidity |
| [Bazaar Tracker](https://bazaartracker.com) | Page layout, section structure, typography, and the summary stat row pattern |
| [skyblock.finance](https://skyblock.finance/) | Icon style, flat and evenly weighted at small sizes |

---

## Project layout

```
ledger/
  ledger.html            Browser terminal, self contained
  README.md              This document

  backend/
    collector.py         Polls the API and records sales
    server.py             Serves the page and history endpoints
    nbt.py                Shared gzip/NBT decoding and fingerprinting
    schema.sql            Database definition
    test_ledger.py        Self-tests for the parser and sale/expiry logic
    Dockerfile
    docker-compose.yml
```

---

## A note on scope

The browser version is intentionally the whole product for its own purpose. It answers the question "what is worth trading right now" without any infrastructure at all. The backend exists only to answer a question the browser structurally cannot, which is "what has actually been selling over time." Keeping that boundary clear is deliberate, so that the simple thing stays simple and the complex thing is added only where it earns its place.

Ledger is an independent project and is not affiliated with Hypixel Inc.
