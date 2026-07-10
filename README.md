# Ledger

A market data terminal for Hypixel Skyblock. Ledger tracks bazaar prices, finds profitable flips, and scans the auction house for underpriced listings using true item attributes rather than display names.

The site is a set of static pages — no build step, meant to be hosted for free (e.g. GitHub Pages). UI is built with React, loaded straight from a CDN as ES modules with an import map, so there's still nothing to compile or bundle. A small containerized backend, run separately and optionally, records sale history — a capability the public Hypixel API does not provide on its own.

---

## Contents

1. [Pages](#pages)
2. [Status](#status)
3. [Features](#features)
4. [How it works](#how-it-works)
5. [Running the browser version](#running-the-browser-version)
6. [Running the backend](#running-the-backend)
7. [Data sources](#data-sources)
8. [Accuracy and known limits](#accuracy-and-known-limits)
9. [Backend service](#backend-service)
10. [Roadmap](#roadmap)
11. [Design direction](#design-direction)
12. [References](#references)
13. [Privacy and legal](#privacy-and-legal)
14. [Project layout](#project-layout)

---

## Pages

| Page | Purpose |
|:-----|:--------|
| `index.html` | Landing page — what the project is, links to everything else |
| `bazaar-tracker.html` | Bazaar price research: top demand/margins lists, and a per-product page with a price chart |
| `auction-tracker.html` | Search any item for live listings, recent sales, and price history; also hosts the whole-auction-house snipe scanner |
| `flips.html` | Order flips, book flips, craft flips, and reverse NPC flips, as sub-tabs of one page |
| `privacy.html` | Privacy policy (GDPR / Swiss revFADP / CCPA) |

---

## Status

| Component | State | Notes |
|:----------|:------|:------|
| Bazaar Tracker | Shipped | Top Demand / Top Margins ($) / Top Margins (%) lists, per-product page with stat pills and price chart |
| Auction Tracker | Shipped | Per-item search, live listings by attribute variant, recent sales, price chart, in-game item preview |
| Snipe Scanner | Shipped | Whole-auction-house scan; three-guardrail detection (below-median, absolute coin gap, below-2nd-cheapest); resale-tax-aware profit estimate |
| Order flips | Shipped | Margin net of fees, volume weighted, sortable |
| Book flips | Shipped | Enchant chains derived from bazaar product ids, no static table |
| Craft flips | Shipped | Recipes fetched live from the NEU repo, cached in the browser |
| Reverse NPC flips | Shipped | Uses Hypixel's own `npc_sell_price` resource, not a guessed value |
| Forward NPC flips | Not implemented | No verified live source for NPC purchase prices — not guessed |
| Kat / Forge / Attribute-fusion flips | Not implemented | Need large static cost tables with no verified live source — not guessed |
| Backend collector and API | Shipped | Records BIN sales and bazaar price history, containerized |
| Seller name resolution | Shipped | Backend caches Mojang lookups; browser never calls Mojang directly |
| Landing page | Shipped | `index.html` |
| Privacy policy | Shipped | `privacy.html` — GDPR / Swiss revFADP / CCPA |

---

## Features

### Bazaar Tracker

Modeled on [Bazaar Tracker](https://bazaartracker.com): an overview page with Top Demand, Top Margins ($), and Top Margins (%) card lists (each a one-line description plus the top 6 products), a search box, and a per-product page (`?product=SEA_LUMIES`) showing buy/sell price and order-count stat pills, a price history chart backed by the collector, and buying/selling volume breakdowns.

### Auction Tracker

Modeled on [SkyCofl's item pages](https://sky.coflnet.com/item/HYPERION): search any item (`?item=HYPERION`) to see its lowest live BIN price, recent sales pulled from Hypixel's `auctions_ended` feed (no scan needed), a price history chart from the backend, live listings grouped by attribute variant so cheapest/median compare like with like, and underpriced listings flagged using the same rule as the Snipe Scanner. Clicking any listing opens its real in-game tooltip — name and lore decoded from that listing's own item data, rendered with actual Minecraft color codes.

### Snipe Scanner

Scans every active Buy It Now listing across the whole auction house and flags the ones priced well below comparable listings of the same item and attributes:

- Internal item identifier
- Recombobulation, stars and master stars, fuming potato books beyond ten
- Enchantments at level six or above, plus all ultimate enchantments
- Pet type, tier, and level bucketed into 20-level bands read straight from the displayed `[Lvl N]` text — no XP breakpoint table needed
- New Year Cake year and party hat variants

Reforges are deliberately excluded, since they're cheap to reapply and don't meaningfully change resale value. A listing is flagged only when its variant has at least 4 comparable listings, sits at least 20% below their median, has a real absolute coin gap to the 2nd-cheapest (not just a rounding difference), and is itself at least 15% below that 2nd-cheapest price specifically. Estimated profit assumes reselling at the 2nd-cheapest price, net of a 2% claim tax. Selecting a result opens a detail panel with a tier badge, the in-game tooltip, every comparable listing with seller links, and a button that copies `/viewauction <uuid>` to paste in game.

### Flips

Order flips, book flips, craft flips, and reverse NPC flips as sub-tabs of one page — see [Roadmap](#roadmap) for exactly what each covers and what's deliberately left out.

---

## How it works

```
Browser
  |
  |-- fetch bazaar / auctions / auctions_ended / items / election  --> Hypixel API
  |-- fetch recipes                                                --> NEU repo (cached in localStorage)
  |-- fetch history / movers / low-supply / player                 --> backend API (if reachable)
  |
  |-- decode item_bytes     --> gzip + base64 + NBT parse, in browser
  |-- fingerprint items     --> attribute based grouping
  |-- compute flips, snipes, variant groupings
  |
  '-- React renders pages from src/pages/*.js
```

`src/lib.js` holds the API fetchers, formatting helpers, the gzip/NBT decoder, fingerprinting, and the snipe-detection algorithm. `src/components.js` holds the shared React pieces (nav, page layout, sortable table, chart, modal). Each page is a thin HTML shell that loads its own `src/pages/*.js` entry point as an ES module.

### Item attribute decoding

Every auction carries an `item_bytes` field: the item's full attribute set as gzip compressed, base64 encoded NBT data. Ledger decompresses this in the browser, walks the tag tree, and reads the `ExtraAttributes` and `display` blocks — telling a clean item apart from a maxed one that happens to share a display name, and providing the real name and lore for the item preview. The backend collector decodes the same format in Python so both sides group auctions into identical variants.

---

## Running the browser version

1. Download the repository — the pages import each other via relative paths, so they need to sit together as they are in the repo.
2. Open `index.html` in any modern browser, or host the folder as-is on any static host (this is what GitHub Pages does).

No API key is needed. Without the backend running, everything works except sale history, movers, low supply, and seller names — those sections show a plain "backend not reachable" message instead of failing silently or showing stale data as if it were live.

React and its supporting libraries load from `esm.sh` at runtime via a `<script type="importmap">` block in each page's `<head>`; there's no `npm install` or bundler involved.

---

## Running the backend

```
cd backend
docker compose build
docker compose up
```

All pages, `src/`, and the API are served together on port 8080 — visiting `http://localhost:8080/` gets the landing page, with everything else linked from there. Data lives in a named Docker volume, so it survives container restarts. Run the self-tests with `python backend/test_ledger.py` before building if you've changed the collector, parser, or server routes.

---

## Data sources

| Source | Use | Authentication |
|:-------|:----|:---------------|
| Hypixel bazaar endpoint | Live product prices and volume | None |
| Hypixel auctions endpoint | Active Buy It Now listings | None |
| Hypixel `auctions_ended` endpoint | Recently sold/expired auctions, for the Auction Tracker's recent activity feed | None |
| Hypixel `/resources/skyblock/items` | NPC sell prices, for reverse NPC flips | None |
| Hypixel `/resources/skyblock/election` | Current mayor (informational, not currently surfaced in the UI) | None |
| NotEnoughUpdates repository | Crafting recipes | None, fetched live and cached |
| Mojang session server | Seller UUID to username | None, called by the backend only |
| SkyCrypt | Seller profile links | None, opened in a new tab |
| esm.sh | Serves React, ReactDOM, and htm as ES modules | None |

The Hypixel endpoints are cached on Hypixel's side and refresh roughly once per minute. Requesting them more often than that returns identical data, so the bazaar refresh interval is set to sixty seconds to match.

---

## Accuracy and known limits

Ledger is a research tool. Every figure is an estimate based on current listings and assumes orders fill at the prices displayed. Treat its output as a shortlist to verify in game, not as a guarantee.

Specific limits worth understanding:

**Craft flips, book flips, and NPC flips** only cover recipes and items where every price involved is a real, non-zero bazaar price. A bazaar buy or sell price of 0 means no orders currently exist on that side of the book, not a free ingredient or a free sale — those cases are filtered out rather than shown as impossible-looking guaranteed profit. Craft flips only cover recipes where every ingredient trades on the bazaar; recipes that require auction only items, non tradeable items, or NPC purchases are excluded.

**Snipe fingerprints** do not yet account for gemstone slots, attribute shards, or dungeon drill components. Pets are grouped by type, tier, and a 20-level band, so two pets in the same band are treated as equivalent even when their exact levels differ.

**The snipe scanner's profit estimate assumes a specific resale strategy** — undercutting to the current 2nd-cheapest listing, net of a 2% claim tax — not the item's true market value. A thin market's "2nd cheapest" can itself be mispriced.

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
|  |  diff state, |        |  bazaar snapshots     |   |
|  |  record sales|        |  player name cache    |   |
|  +-------------+                  |                 |
|                        +----------------------+     |
|  browser  ---------->  |  Web server (API)    |     |
|                        |  serves the pages    |     |
|                        |  serves history data |     |
|                        +----------------------+     |
+---------------------------------------------------+
```

### Sale detection

The collector infers sales by comparing consecutive snapshots of the active auction set. When a listing is present in one snapshot and absent in the next, it either sold or its timer expired. The two cases are separated by comparing the listing's stated end time against the moment it disappeared, with a slack window around the 60 second poll interval.

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

-- periodic bazaar price snapshots, for the top movers 24h change endpoint
CREATE TABLE bazaar_snapshots (
  ts         INTEGER,
  product_id TEXT,
  buy_price  REAL,
  sell_price REAL
);
CREATE INDEX idx_snap_product_ts ON bazaar_snapshots (product_id, ts);

-- Mojang UUID -> username cache, so the browser never calls Mojang directly
CREATE TABLE players (
  uuid      TEXT PRIMARY KEY,
  name      TEXT,
  cached_at INTEGER
);
```

On each poll the collector loads the known active set, fetches the current set from the API, and reconciles the two. New identifiers are inserted; identifiers still present get their last-seen time updated; identifiers now missing are classified as sold or expired. A failed or partial fetch skips the whole reconcile cycle rather than risk marking every active listing as sold. Every 10th cycle (about 10 minutes) the collector also snapshots every bazaar product's price, pruning snapshots older than 48 hours.

### API endpoints

| Endpoint | Returns |
|:---------|:--------|
| `/api/history?fingerprint=X` | Up to 500 most recent recorded sales for a fingerprint |
| `/api/movers` | Bazaar products ranked by 24h price change |
| `/api/low-supply` | Items with very few active listings right now |
| `/api/player?uuid=X` | Cached Mojang username for an auction seller |

---

## Roadmap

Most of the SkyCofl/Bazaar-Tracker-style catalog this project aims toward is shipped. What's left splits into features deliberately left unbuilt for lack of a verified data source.

### Not implemented — no verified data source

Rather than guess values people might trade real coins against, these are left out. Happy to revisit any of them if a verified source turns up.

| Feature | Description | Blocker |
|:--------|:------------|:--------|
| Forward NPC flips | Buy from a vendor, sell to the bazaar or auction house | No live source for NPC purchase (vendor buy) prices |
| Kat flips | Profitable pet upgrades through the Kat NPC | No verified source for the ~100+ pet upgrade cost table |
| Forge flips | Dwarven forge recipes with cooldown tracking | No verified source for forge recipe costs and durations |
| Attribute and fusion flips | Shard combination opportunities | No verified source for fusion recipe data |
| Mayor-based price predictions | Event driven predictions based on historic mayor term pricing | No historic price dataset correlated to past elections |

### Possible next steps

- Sale history charts on the Snipe Scanner's detail panel (currently only on the per-item Auction Tracker view)
- Gemstone slot and attribute shard pricing in the fingerprint
- Full pet XP-curve level bands instead of the current 20-level bucket

---

## Design direction

Ledger's interface aims for a calm, corporate market terminal look. Palette, typography, and most component styles (nav, stat cards, tables, modal) come directly from a hand-built reference implementation, extended for the landing page and per-page chart/search components.

### Principles

- Numbers are the interface. Everything else stays quiet.
- One accent color (`--brand`, a blue), used only for links, active states, and primary actions.
- Green for gain, red for loss.
- A section is never shown without a plain language note on how to read it.
- An honest empty state ("backend not reachable," "no data yet") instead of hiding a section or showing stale/fake data.

---

## References

The project draws on existing tools as design and feature references, not as dependencies.

| Reference | Used for |
|:----------|:---------|
| [SkyCofl flipping hub](https://sky.coflnet.com/flips) | The catalog of flip types and how each market is framed by capital, risk, and liquidity |
| [SkyCofl item page](https://sky.coflnet.com/item/HYPERION) | Shape of the Auction Tracker: per-item live listings, recent sales, and price history in one view |
| [Bazaar Tracker](https://bazaartracker.com) | Bazaar Tracker's page layout, the Top Demand/Margins card-list pattern, and per-product page structure |

---

## Privacy and legal

`privacy.html` covers what little data processing exists (essentially none — the site is static, the browser talks to third-party APIs directly, and there's no analytics or tracking). It addresses GDPR (EU/EEA), Switzerland's revFADP, and the US CCPA/CPRA, is written in a neutral third-person register rather than addressing the reader directly, and explains why the project doesn't publish a separate Impressum: that requirement applies to commercial or business-like services, and this is a non-commercial personal project. None of this is a substitute for actual legal advice — see the disclaimer on that page.

---

## Project layout

```
ledger/
  index.html               Landing page
  bazaar-tracker.html       Bazaar price research + per-product page
  auction-tracker.html      Item search + snipe scanner
  flips.html                Order/book/craft/NPC flips
  privacy.html               Privacy policy
  README.md                 This document

  src/
    theme.css               Shared styles for every page
    lib.js                  API fetchers, formatting, gzip/NBT decode, fingerprinting, snipe algorithm
    components.js            Shared React components (Nav, PageLayout, SortableTable, Chart, Modal)
    pages/
      landing.js
      bazaar-tracker.js
      auction-tracker.js
      flips.js

  backend/
    collector.py            Polls the API, records sales, snapshots bazaar prices
    server.py                Serves the pages and the history/movers/low-supply/player endpoints
    nbt.py                    Shared gzip/NBT decoding and fingerprinting (Python side)
    schema.sql                Database definition
    test_ledger.py            Self-tests for the parser, sale/expiry logic, and endpoints
    Dockerfile
    docker-compose.yml
```

---

## A note on scope

The browser version is intentionally the whole product for its own purpose. It answers "what is worth trading right now" without any infrastructure at all. The backend exists only to answer a question the browser structurally cannot, which is "what has actually been selling over time." Keeping that boundary clear is deliberate, so the simple thing stays simple and the complex thing is added only where it earns its place.

Ledger is an independent project and is not affiliated with Hypixel Inc.
