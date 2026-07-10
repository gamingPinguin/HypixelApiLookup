# Ledger

A market data terminal for Hypixel Skyblock. Ledger tracks bazaar prices, surfaces profitable order flips and craft flips, scans the auction house for underpriced listings using true item attributes rather than display names, and includes a per-item auction tracker with price history and an in-game-style item preview.

The site is a handful of static HTML pages with no build step, meant to be hosted for free (e.g. GitHub Pages). A small containerized backend, run separately and optionally, records sale history — a capability the public Hypixel API does not provide on its own.

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
| `ledger.html` | The market terminal: bazaar, order/book/craft/NPC flips, snipes, trends |
| `item.html` | Auction tracker for a single item — `item.html?id=HYPERION` |
| `privacy.html` | Privacy policy (GDPR / Swiss revFADP / CCPA) |

---

## Status

| Component | State | Notes |
|:----------|:------|:------|
| Bazaar viewer | Shipped | Live order book, sortable, preset "top demand" / "top spread" sorts |
| Order flip finder | Shipped | Margin net of fees, volume weighted, preset sorts by score/coins/percent |
| Craft flip finder | Shipped | Recipes fetched live from the NEU repo, cached in the browser |
| Book flip finder | Shipped | Enchant chains derived from bazaar product ids, no static table |
| Auction snipe scanner | Shipped | Attribute aware, decodes item NBT, includes full listing search |
| Reverse NPC flips | Shipped | Uses Hypixel's own `npc_sell_price` resource, not a guessed value |
| Forward NPC flips | Not implemented | No verified live source for NPC purchase prices — not guessed |
| Kat / Forge / Attribute-fusion flips | Not implemented | Need large static cost tables with no verified live source — not guessed |
| Mayor widget | Shipped | Current mayor and perks, live from Hypixel's election resource |
| Backend collector and API | Shipped | Records BIN sales and bazaar price history, containerized |
| Top movers | Shipped | `/api/movers`, needs ~24h of collector uptime to populate |
| Low supply | Shipped | `/api/low-supply`, reads the collector's live active-listing counts |
| Seller name resolution | Shipped | Backend caches Mojang lookups; browser never calls Mojang directly |
| Item auction tracker | Shipped | `item.html` — live listings, variant grouping, recent sales, price chart |
| Sale history graph | Shipped | Canvas chart on `item.html`, reads `/api/history` |
| Item preview on click | Shipped | In-game-style tooltip decoded from the listing's own NBT data |
| Landing page | Shipped | `index.html` |
| Privacy policy | Shipped | `privacy.html` — GDPR / Swiss revFADP / CCPA |

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

A listing is flagged as a snipe only when its variant has at least four comparable listings, the price sits at least twenty percent below the median of the other listings, and there is a real coin gap above the next cheapest listing. Selecting a snipe opens a detail panel showing a price breakdown of every listing for that variant and a link to each seller's profile. A search box on the same tab shows every live listing for an item, not only flagged deals. When the backend is reachable, seller UUIDs in the detail panel resolve to usernames instead of showing raw links.

### Book flips

Enchanted books combine two of the same enchantment and level into one book a level higher. Ledger detects the whole chain directly from bazaar product ids (`ENCHANTMENT_<NAME>_<LEVEL>`) rather than a hand-written table of enchantments, so it keeps working as new tiers are added to the game. The small anvil coin cost isn't included in the profit shown.

### NPC flips

Reverse NPC flips buy an item from other players at the bazaar's instant-buy price, then sell it straight to an NPC vendor for more than the bazaar currently pays. This uses Hypixel's own `npc_sell_price` field from the `/resources/skyblock/items` endpoint — not the NEU repo, which doesn't carry that field at all. Forward NPC flips (buying from a vendor to resell) aren't shown, because there's no verified live source for NPC purchase prices to check against.

### Market trends

Two panels backed by the collector's own history: Top Movers ranks bazaar products by 24 hour price change, and Low Supply surfaces items with very few active Buy It Now listings right now. Both need the backend running; Top Movers specifically needs about a day of uptime before it has anything to compare against.

### Mayor

The header shows the current Skyblock mayor and their active perks, fetched directly from Hypixel's public election resource. This is informational only — there's no historic mayor-to-price dataset behind it, so no predictions are made from it.

### Item auction tracker

`item.html?id=HYPERION` gives any single item its own page, similar in spirit to SkyCofl's per-item view:

- **Live listings**, decoded and grouped by the same attribute fingerprint the snipe scanner uses, so a plain item, a 5-star one, and a recombobulated one show up as separate, comparable variants instead of one blended price.
- **Attribute variants overview** — a compact table of every variant currently listed, with count, cheapest, and median price, which is what "similar items priced the same way" means in practice: group first, compare within the group, not across it.
- **Flagged underpriced listings**, using the same four-comparables / 20%-below-median rule as Auction Snipes, scoped to this one item.
- **Recent activity**, pulled from Hypixel's `auctions_ended` feed (roughly the last hour, no scan required) so there's something to look at immediately.
- **Price history chart**, drawn on a plain `<canvas>` from the backend's `/api/history` — empty until the backend has recorded at least one sale for this item.
- **Item preview on click** — selecting any live listing opens its actual in-game tooltip: name and lore decoded straight from that listing's own NBT data and rendered with real Minecraft color codes, not a generic description.

Live listings require pressing "Scan live listings," the same on-demand pattern as Auction Snipes, since finding every listing for one item still means decoding the whole auction house client-side.

---

## How it works

The browser version is a single self contained HTML file. There is no build step and no server required to use it standalone.

```
Browser (Ledger single file)
  |
  |-- fetch bazaar          --> Hypixel API  (refreshed every 60s)
  |-- fetch auction pages   --> Hypixel API  (on demand scan)
  |-- fetch recipes         --> NEU repo     (on demand, cached in localStorage)
  |-- fetch item resources  --> Hypixel API  (NPC sell prices, on demand)
  |-- fetch election        --> Hypixel API  (mayor widget, on load)
  |-- fetch movers/low-supply/history/player --> backend API (if reachable)
  |
  |-- decode item_bytes     --> gzip + base64 + NBT parse, in browser
  |-- fingerprint items     --> attribute based grouping
  |-- compute flips, crafts, book flips, NPC flips, snipes
  |
  '-- render tables and detail panels
```

### Item attribute decoding

Every auction carries an `item_bytes` field containing the item's full attribute set as gzip compressed, base64 encoded named binary tag data. Ledger decompresses this in the browser, walks the tag tree, and reads the `ExtraAttributes` block. This is what allows a clean item to be told apart from a maxed one that happens to share a display name. The backend collector decodes the same format in Python so both sides group auctions into identical variants.

---

## Running the browser version

1. Download the whole repository (or just `index.html`, `ledger.html`, `item.html`, `privacy.html`, and `ledger-core.js` — they need to sit next to each other).
2. Open `index.html` in any modern browser, or host the folder as-is on any static host (this is what GitHub Pages does).

That is the whole process. No API key is needed. The bazaar and auction endpoints used here are public and cached upstream, so they do not require authentication. Without the backend running, everything works except sale history, movers, low supply, and seller names — those sections show a plain "backend not reachable" message instead of failing silently.

---

## Running the backend

```
cd backend
docker compose build
docker compose up
```

All four pages, `ledger-core.js`, and the API are served together on port 8080 — visiting `http://localhost:8080/` gets you the landing page, with everything else linked from there. Data lives in a named Docker volume, so it survives container restarts. Run the self-tests with `python backend/test_ledger.py` before building if you've changed the collector, parser, or server routes.

---

## Data sources

| Source | Use | Authentication |
|:-------|:----|:---------------|
| Hypixel bazaar endpoint | Live product prices and volume | None |
| Hypixel auctions endpoint | Active Buy It Now listings | None |
| Hypixel `auctions_ended` endpoint | Recently sold/expired auctions, for `item.html`'s recent activity feed | None |
| Hypixel `/resources/skyblock/items` | NPC sell prices, for reverse NPC flips | None |
| Hypixel `/resources/skyblock/election` | Current mayor and perks | None |
| NotEnoughUpdates repository | Crafting recipes | None, fetched live and cached |
| Mojang session server | Seller UUID to username | None, called by the backend only |
| SkyCrypt | Seller profile links | None, opened in a new tab |

The Hypixel endpoints are cached on Hypixel's side and refresh roughly once per minute. Requesting them more often than that returns identical data, so the refresh interval is set to sixty seconds to match.

---

## Accuracy and known limits

Ledger is a research tool. Every figure it shows is an estimate based on current listings and assumes your orders fill at the prices displayed. Treat its output as a shortlist to verify in game, not as a guarantee.

Specific limits worth understanding:

**Craft flips, book flips, and NPC flips** only cover recipes and items where every price involved is a real, non-zero bazaar price. A bazaar buy or sell price of 0 means no orders currently exist on that side of the book, not a free ingredient or a free sale — those cases are filtered out rather than shown as impossible-looking guaranteed profit. Craft flips only cover recipes where every ingredient trades on the bazaar; recipes that require auction only items, non tradeable items, or NPC purchases are excluded. Profit assumes ingredients are bought at instant buy, so patient buy orders will do better than the figures shown.

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

On each poll the collector loads the known active set from the database, fetches the current set from the API, and reconciles the two. New identifiers are inserted. Identifiers still present have their last seen time updated. Identifiers that are now missing are classified as sold or expired and handled accordingly. A failed or partial fetch skips the whole reconcile cycle rather than risk marking every active listing as sold.

Every 10th poll cycle (about 10 minutes at the default 60 second interval) the collector also snapshots every bazaar product's buy and sell price, and prunes snapshots older than 48 hours. This is deliberately less frequent than the auction poll — a snapshot every 10 minutes is dense enough to find a point close to 24 hours ago, without growing the database by the full product count on every single cycle.

### What the backend unlocks

- Real sale history per item variant, served over `/api/history` and charted on `item.html`'s price history graph
- Server side seller name resolution (`/api/player`), caching Mojang lookups that a browser cannot make directly — used on the Auction Snipes detail panel and throughout `item.html`
- Bazaar price snapshots every ~10 minutes, powering the Top Movers panel (`/api/movers`) once ~24h of history exists
- Live active-listing counts per item, powering the Low Supply panel (`/api/low-supply`)
- Persistence across restarts, since the database lives on a mounted volume
- The option to run continuously without a browser tab open

---

## Roadmap

Most of the SkyCofl-style catalog this project aims toward is now shipped, either in the browser file alone or backed by the collector. What's left splits into one real gap and a set of features deliberately left unbuilt.

### Shipped

| Feature | Description |
|:--------|:------------|
| Bazaar viewer | Live order book across all products, preset top-demand / top-spread sorts |
| Order flips | Buy order to sell offer, net of fees, volume weighted, preset sorts |
| Craft flips | Buy ingredients, craft, sell, ranked by profit |
| Book flips | Combine enchantment books to a higher level and resell, self-detected from bazaar ids |
| Auction snipes | Attribute aware underpriced listing detection, plus full listing search |
| Reverse NPC flips | Buy below vendor value from players, sell to the vendor |
| Mayor widget | Current mayor and active perks |
| Backend collector and history API | Sale detection, bazaar price history, SQLite storage |
| Top movers | Largest 24 hour bazaar price swings, up and down |
| Low supply research | Thin markets flagged from the collector's live active-listing counts |
| Seller name resolution | Backend-cached Mojang lookups, browser never calls Mojang directly |
| Item auction tracker | `item.html` — live listings, attribute-variant grouping, recent sales, price chart, item preview |
| Landing page and privacy policy | `index.html`, `privacy.html` |

### Not implemented — no verified data source

These would need either fabricated numbers or a data source that doesn't appear to exist publicly. Rather than guess values people might trade real coins against, they're left out — happy to revisit any of these if a verified source turns up.

| Feature | Description | Blocker |
|:--------|:------------|:--------|
| Forward NPC flips | Buy from a vendor, sell to the bazaar or auction house | No live source for NPC purchase (vendor buy) prices |
| Kat flips | Profitable pet upgrades through the Kat NPC | No verified source for the ~100+ pet upgrade cost table |
| Forge flips | Dwarven forge recipes with cooldown tracking | No verified source for forge recipe costs and durations |
| Attribute and fusion flips | Shard combination opportunities | No verified source for fusion recipe data |
| Mayor-based price predictions | Event driven predictions based on historic mayor term pricing | No historic price dataset correlated to past elections; the mayor widget shows the current mayor only |

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
| [SkyCofl item page](https://sky.coflnet.com/item/HYPERION) | Shape of `item.html`: per-item live listings, recent sales, and price history in one view |
| [Bazaar Tracker](https://bazaartracker.com) | Page layout, section structure, typography, and the summary stat row pattern |
| [skyblock.finance](https://skyblock.finance/) | Icon style, flat and evenly weighted at small sizes |

---

## Privacy and legal

`privacy.html` covers what little data processing exists (essentially none — the site is static, your browser talks to third-party APIs directly, and there's no analytics or tracking). It addresses GDPR (EU/EEA), Switzerland's revFADP, and the US CCPA/CPRA, and explains why the project doesn't publish a separate Impressum: that requirement applies to commercial or business-like services, and this is a non-commercial personal project. None of this is a substitute for actual legal advice — see the disclaimer on that page.

---

## Project layout

```
ledger/
  index.html             Landing page
  ledger.html            Market terminal
  item.html              Per-item auction tracker
  privacy.html           Privacy policy
  ledger-core.js         Shared gzip/NBT decoding, fingerprinting, formatting -- used by ledger.html and item.html
  README.md              This document

  backend/
    collector.py        Polls the API, records sales, snapshots bazaar prices
    server.py            Serves the page and the history/movers/low-supply/player endpoints
    nbt.py                Shared gzip/NBT decoding and fingerprinting
    schema.sql            Database definition
    test_ledger.py        Self-tests for the parser, sale/expiry logic, and endpoints
    Dockerfile
    docker-compose.yml
```

---

## A note on scope

The browser version is intentionally the whole product for its own purpose. It answers the question "what is worth trading right now" without any infrastructure at all. The backend exists only to answer a question the browser structurally cannot, which is "what has actually been selling over time." Keeping that boundary clear is deliberate, so that the simple thing stays simple and the complex thing is added only where it earns its place.

Ledger is an independent project and is not affiliated with Hypixel Inc.
