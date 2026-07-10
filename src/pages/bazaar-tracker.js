import { React, html, createRoot, fmt, niceName, fetchBazaar, fetchBazaarHistory } from '../lib.js';
import { Nav, PageLayout, SearchInput, Chart } from '../components.js';

const { useState, useEffect, useMemo } = React;
const FEE = 0.0125;

function useBazaar() {
  const [bazaar, setBazaar] = useState(new Map());
  const [updated, setUpdated] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const map = await fetchBazaar();
        if (!stop) { setBazaar(map); setUpdated(new Date()); setError(false); }
      } catch (e) { if (!stop) setError(true); }
    }
    load();
    const id = setInterval(load, 60000);
    return () => { stop = true; clearInterval(id); };
  }, []);
  return { bazaar, updated, error };
}

function productRows(bazaar) {
  return [...bazaar.entries()].map(([id, s]) => {
    const margin = s.buyPrice * (1 - FEE) - s.sellPrice;
    const marginPct = s.sellPrice ? margin / s.sellPrice * 100 : 0;
    const volume = (s.buyMovingWeek || 0) + (s.sellMovingWeek || 0);
    return { id, name: niceName(id), buyPrice: s.buyPrice, sellPrice: s.sellPrice, margin, marginPct, volume };
  });
}

function TopList({ title, lead, rows, valueFn, formatFn }) {
  const top = [...rows].sort((a, b) => valueFn(b) - valueFn(a)).slice(0, 6);
  return html`
    <div style=${{ marginBottom: '36px' }}>
      <div style=${{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px' }}>
        <h2 style=${{ fontSize: '17px' }}>${title}</h2>
      </div>
      <p style=${{ color: 'var(--text-2)', fontSize: '13px', marginBottom: '14px' }}>${lead}</p>
      <div class="feature-grid" style=${{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        ${top.map(r => html`
          <a key=${r.id} href=${'bazaar-tracker.html?product=' + r.id} style=${{ textDecoration: 'none', color: 'inherit' }}>
            <div class="feature-card" style=${{ padding: '14px 16px' }}>
              <div style=${{ fontWeight: 600, color: 'var(--brand)', fontSize: '13.5px', marginBottom: '6px' }}>${r.name}</div>
              <div style=${{ fontSize: '12px', color: 'var(--text-2)' }}>${formatFn(r)}</div>
            </div>
          </a>
        `)}
      </div>
    </div>
  `;
}

function Overview({ bazaar }) {
  const rows = useMemo(() => productRows(bazaar).filter(r => r.buyPrice > 0), [bazaar]);
  if (!rows.length) return html`<div class="empty">Loading bazaar data…</div>`;
  return html`
    <${TopList} title="Top Demand" lead="Items with the highest weekly traded volume."
      rows=${rows} valueFn=${r => r.volume}
      formatFn=${r => `Volume: ${fmt(r.volume)}/wk`} />
    <${TopList} title="Top Margins ($)" lead="Highest absolute profit gap between buy and sell orders."
      rows=${rows.filter(r => r.margin > 0)} valueFn=${r => r.margin}
      formatFn=${r => `Margin: ${fmt(r.margin)} (${r.marginPct.toFixed(1)}%)`} />
    <${TopList} title="Top Margins (%)" lead="Highest percentage profit gap, regardless of volume."
      rows=${rows.filter(r => r.margin > 0 && r.volume > 1000)} valueFn=${r => r.marginPct}
      formatFn=${r => `Margin: ${r.marginPct.toFixed(1)}% (${fmt(r.margin)})`} />
  `;
}

function ProductView({ id, bazaar }) {
  const s = bazaar.get(id);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    let stop = false;
    fetchBazaarHistory(id).then(rows => { if (!stop) setHistory(rows); })
      .catch(() => { if (!stop) setHistoryError(true); });
    return () => { stop = true; };
  }, [id]);

  if (!s) {
    return html`<div class="empty">Loading ${niceName(id)}… if this doesn't resolve, it may not be a live bazaar product.</div>`;
  }

  const stats = [
    { label: 'Buy Price', value: fmt(s.buyPrice) },
    { label: 'Buy Orders', value: s.buyOrders ?? '-' },
    { label: 'Sell Price', value: fmt(s.sellPrice) },
    { label: 'Sell Orders', value: s.sellOrders ?? '-' },
  ];

  const chronological = history ? history.slice().reverse() : [];
  const series = chronological.length
    ? [
        { label: 'Buy Price', color: '#2f5ce5', points: chronological.map(r => ({ y: r.buy_price })) },
        { label: 'Sell Price', color: '#067647', points: chronological.map(r => ({ y: r.sell_price })) },
      ]
    : [];

  return html`
    <${PageLayout} title=${niceName(id) + ' Price'} description="Real-time Hypixel Skyblock bazaar price and stats."
      stats=${stats}>
      <div class="chart-card" style=${{ marginBottom: '20px' }}>
        <div class="modal-label">Price history</div>
        ${history === null && !historyError && html`<div class="empty" style=${{ padding: '24px' }}>Loading…</div>`}
        ${historyError && html`<div class="empty" style=${{ padding: '24px' }}>Backend not reachable — price history needs the optional backend running.</div>`}
        ${history && !history.length && html`<div class="empty" style=${{ padding: '24px' }}>No snapshots recorded yet for this product — the backend snapshots bazaar prices roughly every 10 minutes, so a new deployment needs a little time before this fills in.</div>`}
        ${series.length > 0 && html`<${Chart} series=${series} formatY=${fmt} />`}
      </div>

      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div class="card" style=${{ padding: '16px 18px' }}>
          <div class="modal-label">Buying</div>
          <${InfoRow} label="Volume" value=${fmt(s.buyVolume)} />
          <${InfoRow} label="Weekly volume" value=${fmt(s.buyMovingWeek)} />
          <${InfoRow} label="Orders" value=${s.buyOrders ?? '-'} />
        </div>
        <div class="card" style=${{ padding: '16px 18px' }}>
          <div class="modal-label">Selling</div>
          <${InfoRow} label="Volume" value=${fmt(s.sellVolume)} />
          <${InfoRow} label="Weekly volume" value=${fmt(s.sellMovingWeek)} />
          <${InfoRow} label="Orders" value=${s.sellOrders ?? '-'} />
        </div>
      </div>
    <//>
  `;
}

function InfoRow({ label, value }) {
  return html`
    <div style=${{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '13.5px' }}>
      <span style=${{ color: 'var(--text-2)' }}>${label}</span><span class="num" style=${{ fontWeight: 600 }}>${value}</span>
    </div>
  `;
}

function App() {
  const { bazaar, updated, error } = useBazaar();
  const [query, setQuery] = useState('');
  const productId = new URLSearchParams(location.search).get('product');

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return [...bazaar.keys()].filter(id => niceName(id).toLowerCase().includes(q)).slice(0, 8);
  }, [query, bazaar]);

  const searchBox = html`
    <div class="search-dropdown" style=${{ width: '320px' }}>
      <${SearchInput} value=${query} onChange=${setQuery} placeholder="Search a bazaar item..." />
      ${matches.length > 0 && html`
        <div class="search-results">
          ${matches.map(id => html`
            <a key=${id} href=${'bazaar-tracker.html?product=' + id} style=${{ textDecoration: 'none', color: 'inherit' }}>
              <div class="search-result-row"><span>${niceName(id)}</span><span class="id">${id}</span></div>
            </a>
          `)}
        </div>
      `}
    </div>
  `;

  if (productId) {
    return html`
      <${Nav} active="bazaar-tracker.html" />
      <div class="page" style=${{ paddingBottom: 0 }}>
        <div class="controls">${searchBox}<span class="meta">${updated ? 'Updated ' + updated.toLocaleTimeString() : error ? 'Fetch failed' : 'Loading…'}</span></div>
      </div>
      <${ProductView} id=${productId} bazaar=${bazaar} />
    `;
  }

  return html`
    <${Nav} active="bazaar-tracker.html" />
    <${PageLayout} title="Bazaar Tracker" description="Live Hypixel Skyblock bazaar prices, updated every 60 seconds."
      controls=${html`${searchBox}<span class="meta">${updated ? 'Updated ' + updated.toLocaleTimeString() : error ? 'Fetch failed' : 'Loading…'}</span>`}>
      <${Overview} bazaar=${bazaar} />
    <//>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
