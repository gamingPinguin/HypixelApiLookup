import {
  React, html, createRoot, fmt, coins, niceName, timeAgo, median, TIERS,
  fetchJson, ITEMS_URL, AUCTIONS_ENDED_URL, fetchAllBinAuctions, decodeAuctionsForItem,
  fetchHistory, resolvePlayerName, loreToHtml, findSnipes, AH_CLAIM_TAX,
} from '../lib.js';
import { Nav, PageLayout, SearchInput, SortableTable, Chart, Modal, useSort } from '../components.js';

const { useState, useEffect, useMemo } = React;

function useItemIndex() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    fetchJson(ITEMS_URL).then(d => setItems(d.items || [])).catch(() => {});
  }, []);
  return items;
}

function ItemSearch({ items }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return items.filter(i => (i.name || '').toLowerCase().includes(q)).slice(0, 8);
  }, [query, items]);
  return html`
    <div class="search-dropdown" style=${{ width: '320px' }}>
      <${SearchInput} value=${query} onChange=${setQuery} placeholder="Search an item, e.g. Hyperion..." />
      ${matches.length > 0 && html`
        <div class="search-results">
          ${matches.map(i => html`
            <a key=${i.id} href=${'auction-tracker.html?item=' + i.id} style=${{ textDecoration: 'none', color: 'inherit' }}>
              <div class="search-result-row"><span>${i.name}</span><span class="id">${i.id}</span></div>
            </a>
          `)}
        </div>
      `}
    </div>
  `;
}

function tierBadge(tier) {
  const [c, bg] = TIERS[tier] || TIERS.COMMON;
  return html`<span class="tier-badge" style=${{ color: c, background: bg }}>${(tier || '').toLowerCase().replace('_', ' ')}</span>`;
}

function copyViewAuction(uuid) {
  navigator.clipboard?.writeText(`/viewauction ${uuid}`);
}

// ---------- shared detail modal (used by both the item view and the snipe scanner) ----------
function ListingModal({ open, onClose, name, tier, attrs, metrics, lore, listings, lowUuid }) {
  const [names, setNames] = useState({});
  useEffect(() => {
    if (!open) return;
    let stop = false;
    const uuids = [...new Set(listings.slice(0, 12).map(l => l.auctioneer))];
    uuids.forEach(u => resolvePlayerName(u).then(n => { if (n && !stop) setNames(prev => ({ ...prev, [u]: n })); }).catch(() => {}));
    return () => { stop = true; };
  }, [open, listings]);

  if (!open) return null;
  const low = listings[0];
  return html`
    <${Modal} open=${open} onClose=${onClose}>
      <div class="modal-head">
        <div>
          ${tier && tierBadge(tier)}
          <h2>${name}</h2>
          <div class="modal-attrs">${attrs || 'clean'}</div>
        </div>
        <button class="modal-x" onClick=${onClose} aria-label="Close">✕</button>
      </div>

      ${metrics && html`
        <div class="modal-grid" style=${{ gridTemplateColumns: `repeat(${metrics.length}, 1fr)` }}>
          ${metrics.map(m => html`<div class="modal-metric" key=${m.label}><span>${m.label}</span><b style=${m.color ? { color: m.color } : {}}>${m.value}</b></div>`)}
        </div>
      `}

      <div class="modal-section">
        <div class="modal-label">In-game tooltip</div>
        <div class="lore-box" dangerouslySetInnerHTML=${{ __html: lore ? loreToHtml(lore) : '<span style="color:#98a2b3">No tooltip data</span>' }}></div>
      </div>

      <div class="modal-section">
        <div class="modal-label">${listings.length} listing${listings.length === 1 ? '' : 's'} · price · seller</div>
        <table class="listings-table"><tbody>
          ${listings.slice(0, 12).map((l, i) => html`
            <tr key=${l.uuid}>
              <td style=${{ textAlign: 'left', color: l.uuid === lowUuid ? 'var(--up)' : 'var(--text)', fontWeight: l.uuid === lowUuid ? 600 : 400 }}>
                ${l.uuid === lowUuid ? '▸ ' : ''}${fmt(l.price)}${l.uuid === lowUuid ? html` <span class="chip up" style=${{ fontSize: '11px' }}>cheapest</span>` : ''}
              </td>
              <td class="num" style=${{ color: 'var(--text-3)' }}>${i === 0 ? '' : `+${fmt(l.price - low.price)}`}</td>
              <td style=${{ textAlign: 'left' }}>
                <a href=${'https://sky.shiiyu.moe/stats/' + l.auctioneer} target="_blank" rel="noopener" class="seller-link">${names[l.auctioneer] || l.auctioneer.slice(0, 8) + '…'}</a>
              </td>
              <td class="num" style=${{ textAlign: 'right' }}>
                <button class="btn" style=${{ padding: '3px 9px', fontSize: '12px' }} onClick=${() => copyViewAuction(l.uuid)}>Copy /viewauction</button>
              </td>
            </tr>
          `)}
        </tbody></table>
        ${listings.length > 12 && html`<div style=${{ color: 'var(--text-3)', fontSize: '12px', padding: '8px 2px' }}>…and ${listings.length - 12} more</div>`}
      </div>

      <div class="modal-warn">
        Profit estimates assume you resell at the current 2nd-cheapest price, net of a 2% claim tax. Gemstone slots and exact pet levels within a 20-level bucket aren't compared — check the tooltip above before buying.
      </div>
    <//>
  `;
}

// ---------- snipe scanner (whole auction house, ref.html-derived) ----------
function SnipeScanner() {
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');
  const [snipes, setSnipes] = useState([]);
  const [modalRow, setModalRow] = useState(null);
  const { sortKey, sortDir, onSort, sortRows } = useSort('profit', -1);

  async function scan() {
    setScanning(true);
    setStatus('fetching auction pages…');
    try {
      const auctions = await fetchAllBinAuctions((page, total, count) => setStatus(`fetched ${page}/${total} pages · ${count} BIN listings`));
      setStatus(`decoding ${auctions.length} listings…`);
      const { groups } = await decodeAuctionsForItem(auctions, null, (done, total) => setStatus(`decoded ${done}/${total}`));
      const rows = findSnipes(groups).map(r => ({
        key: r.fp, name: r.low.itemName.replace(/^[◆⚚➊➋➌➍➎]+\s*/, '').trim(), attrs: r.low.attrs,
        tier: r.low.tier, low: r.low.price, ref: r.ref, second: r.second, profit: r.profit, ratio: r.ratio, count: r.count,
        listings: r.listings, lore: r.low.lore,
      }));
      setSnipes(rows);
      setStatus(`${rows.length} flagged out of ${auctions.length} BIN listings scanned`);
    } catch (e) {
      setStatus('scan failed: ' + e.message);
    }
    setScanning(false);
  }

  const columns = [
    ['name', 'Item'], ['low', 'Lowest BIN'], ['ref', 'Market (median)'], ['second', 'Undercut To'],
    ['profit', 'Est. Profit'], ['ratio', 'Below Market'], ['count', 'Listings'],
  ];
  const renderCell = (row, key) => {
    if (key === 'name') return html`${row.name}<span style=${{ display: 'block', fontSize: '11.5px', color: 'var(--text-3)', fontWeight: 400 }}>${row.attrs || 'clean'}</span>`;
    if (key === 'ratio') return html`<span class="chip up">−${row.ratio.toFixed(0)}%</span>`;
    if (['low', 'ref', 'second', 'profit'].includes(key)) return fmt(row[key]);
    return row[key];
  };

  return html`
    <${PageLayout} title="Snipe Scanner" description="Scans every active Buy It Now listing and flags the ones priced well below comparable listings of the same item and attributes."
      actions=${html`<button class="btn primary" disabled=${scanning} onClick=${scan}>${scanning ? 'Scanning…' : 'Scan auction house'}</button>`}
      controls=${status && html`<span class="meta">${status}</span>`}>
      <div class="card">
        <${SortableTable} columns=${columns} rows=${sortRows(snipes)} sortKey=${sortKey} sortDir=${sortDir} onSort=${onSort}
          renderCell=${renderCell} onRowClick=${setModalRow}
          emptyMessage=${scanning ? 'Scanning…' : 'Press "Scan auction house" to find underpriced listings.'} />
      </div>
    <//>
    ${modalRow && html`
      <${ListingModal} open=${!!modalRow} onClose=${() => setModalRow(null)}
        name=${modalRow.name} tier=${modalRow.tier} attrs=${modalRow.attrs}
        metrics=${[
          { label: 'Buy at', value: fmt(modalRow.low) },
          { label: 'Market median', value: fmt(modalRow.ref) },
          { label: 'Est. profit', value: fmt(modalRow.profit), color: 'var(--up)' },
          { label: 'Below market', value: `−${modalRow.ratio.toFixed(0)}%`, color: 'var(--up)' },
        ]}
        lore=${modalRow.lore} listings=${modalRow.listings} lowUuid=${modalRow.listings[0]?.uuid} />
    `}
  `;
}

// ---------- per-item view (coflnet-style) ----------
function ItemView({ itemId }) {
  const [recent, setRecent] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [listings, setListings] = useState([]);
  const [groups, setGroups] = useState(new Map());
  const [modalRow, setModalRow] = useState(null);
  const { sortKey, sortDir, onSort, sortRows } = useSort('price', 1);

  useEffect(() => {
    setRecent(null); setHistory(null); setHistoryError(false); setListings([]); setGroups(new Map());
    let stop = false;
    fetchJson(AUCTIONS_ENDED_URL).then(async data => {
      const { listings: decoded } = await decodeAuctionsForItem(data.auctions, itemId);
      if (!stop) setRecent(decoded.map(l => ({ ...l, ts: data.auctions.find(a => a.uuid === l.uuid)?.timestamp })));
    }).catch(() => { if (!stop) setRecent([]); });
    fetchHistory(itemId).then(rows => { if (!stop) setHistory(rows); }).catch(() => { if (!stop) setHistoryError(true); });
    return () => { stop = true; };
  }, [itemId]);

  async function scan() {
    setScanning(true);
    setScanStatus('fetching auction pages…');
    try {
      const auctions = await fetchAllBinAuctions((page, total) => setScanStatus(`fetched ${page}/${total} pages`));
      setScanStatus(`decoding ${auctions.length} listings…`);
      const { groups: g, listings: l } = await decodeAuctionsForItem(auctions, itemId, (done, total) => setScanStatus(`decoded ${done}/${total}`));
      setGroups(g); setListings(l);
      setScanStatus(`${l.length} live listings found`);
    } catch (e) {
      setScanStatus('scan failed: ' + e.message);
    }
    setScanning(false);
  }

  const flagged = useMemo(() => new Set(findSnipes(groups).map(s => s.low.uuid)), [groups]);
  const variantRows = useMemo(() => [...groups.entries()].map(([fp, list]) => {
    const prices = list.map(l => l.price);
    return { key: fp, variant: list[0].attrs || 'clean', count: list.length, cheapest: Math.min(...prices), median: median(prices) };
  }).sort((a, b) => b.count - a.count), [groups]);

  const prices = listings.map(l => l.price);
  const stats = [
    { label: 'Lowest BIN', value: prices.length ? fmt(Math.min(...prices)) : '-' },
    { label: 'Live listings', value: listings.length || '-' },
    { label: 'Attribute variants', value: groups.size || '-' },
    { label: 'Flagged underpriced', value: flagged.size || '-' },
  ];

  const series = history && history.length
    ? [{ label: 'Sale price', color: '#2f5ce5', points: history.slice().reverse().map(r => ({ y: r.price })) }]
    : [];

  const listingCols = [['price', 'Price'], ['variant', 'Variant'], ['auctioneer', 'Seller']];
  const listingRows = sortRows(listings.map(l => ({ ...l, key: l.uuid, variant: l.attrs || 'clean' })));

  return html`
    <${PageLayout} title=${niceName(itemId)} description=${itemId}
      stats=${stats}>

      <h3 class="modal-label" style=${{ margin: '0 0 10px' }}>Price history</h3>
      <div class="chart-card" style=${{ marginBottom: '24px' }}>
        ${history === null && !historyError && html`<div class="empty" style=${{ padding: '24px' }}>Loading…</div>`}
        ${historyError && html`<div class="empty" style=${{ padding: '24px' }}>Backend not reachable — run the optional backend to see recorded sale history.</div>`}
        ${history && !history.length && html`<div class="empty" style=${{ padding: '24px' }}>No recorded sales yet for this item.</div>`}
        ${series.length > 0 && html`<${Chart} series=${series} formatY=${fmt} />`}
      </div>

      <h3 class="modal-label" style=${{ margin: '0 0 10px' }}>Recent activity <span style=${{ fontWeight: 400, textTransform: 'none', color: 'var(--text-3)' }}>· last ~hour, from Hypixel's ended-auctions feed</span></h3>
      <div class="card" style=${{ marginBottom: '24px' }}>
        ${recent === null && html`<div class="empty">Loading…</div>`}
        ${recent && !recent.length && html`<div class="empty">No sales for this item in the last hour.</div>`}
        ${recent && recent.length > 0 && html`
          <table><thead><tr><th>When</th><th>Price</th><th>Variant</th></tr></thead>
          <tbody>${recent.sort((a, b) => b.ts - a.ts).map(r => html`
            <tr key=${r.uuid}><td>${timeAgo(r.ts)}</td><td>${fmt(r.price)}</td><td>${r.attrs || 'clean'}</td></tr>
          `)}</tbody></table>
        `}
      </div>

      <h3 class="modal-label" style=${{ margin: '0 0 10px' }}>Attribute variants</h3>
      <p style=${{ color: 'var(--text-2)', fontSize: '13px', marginBottom: '10px' }}>Live listings grouped by the same attributes that decide resale value, so cheapest/median compare like with like.</p>
      <div class="card" style=${{ marginBottom: '24px' }}>
        <${SortableTable} columns=${[['variant', 'Variant'], ['count', 'Listings'], ['cheapest', 'Cheapest'], ['median', 'Median']]}
          rows=${variantRows} renderCell=${(r, k) => k === 'variant' ? r.variant : (k === 'count' ? r.count : fmt(r[k]))}
          emptyMessage="Run a scan below to see live variants." />
      </div>

      <div class="page-head" style=${{ marginBottom: '10px' }}>
        <div><h3 class="modal-label" style=${{ margin: 0 }}>Live listings</h3></div>
        <div class="actions">
          <button class="btn primary" disabled=${scanning} onClick=${scan}>${scanning ? 'Scanning…' : 'Scan live listings'}</button>
        </div>
      </div>
      ${scanStatus && html`<p style=${{ color: 'var(--text-3)', fontSize: '12.5px', marginBottom: '10px' }}>${scanStatus}</p>`}
      <div class="card">
        <${SortableTable} columns=${listingCols} sortKey=${sortKey} sortDir=${sortDir} onSort=${onSort}
          rows=${listingRows} onRowClick=${setModalRow}
          renderCell=${(r, k) => {
            if (k === 'price') return html`${fmt(r.price)}${flagged.has(r.uuid) ? html` <span class="chip up">underpriced</span>` : ''}`;
            if (k === 'auctioneer') return r.auctioneer.slice(0, 8) + '…';
            return r[k];
          }}
          emptyMessage="Press \"Scan live listings\" to see every active listing for this item." />
      </div>
    <//>
    ${modalRow && html`
      <${ListingModal} open=${!!modalRow} onClose=${() => setModalRow(null)}
        name=${modalRow.itemName} tier=${modalRow.tier} attrs=${modalRow.attrs}
        metrics=${[{ label: 'Price', value: fmt(modalRow.price) }]}
        lore=${modalRow.lore} listings=${[modalRow]} lowUuid=${modalRow.uuid} />
    `}
  `;
}

function App() {
  const items = useItemIndex();
  const itemId = new URLSearchParams(location.search).get('item');
  return html`
    <${Nav} active="auction-tracker.html" />
    <div class="page" style=${{ paddingBottom: 0 }}>
      <div class="controls"><${ItemSearch} items=${items} /></div>
    </div>
    ${itemId ? html`<${ItemView} itemId=${itemId} />` : html`<${SnipeScanner} />`}
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
