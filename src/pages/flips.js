import { React, html, createRoot, fmt, niceName, fetchBazaar, fetchJson, ITEMS_URL, getItemData } from '../lib.js';
import { Nav, PageLayout, SearchInput, SortableTable, useSort } from '../components.js';

const { useState, useEffect, useMemo } = React;
const FEE = 0.0125;
const RECIPE_SLOTS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

function useBazaar() {
  const [bazaar, setBazaar] = useState(new Map());
  useEffect(() => {
    let stop = false;
    const load = () => fetchBazaar().then(m => { if (!stop) setBazaar(m); }).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => { stop = true; clearInterval(id); };
  }, []);
  return bazaar;
}

function parseRecipeSlot(v) {
  if (!v) return null;
  const [id, amt] = String(v).split(':');
  if (!id || id === 'null') return null;
  return { id, amount: amt ? parseInt(amt, 10) : 1 };
}

function OrderFlips({ bazaar }) {
  const [query, setQuery] = useState('');
  const { sortKey, sortDir, onSort, sortRows } = useSort('score', -1);
  const rows = useMemo(() => [...bazaar.entries()].map(([id, s]) => {
    const margin = s.buyPrice * (1 - FEE) - s.sellPrice;
    const volume = Math.min(s.buyMovingWeek || 0, s.sellMovingWeek || 0);
    const marginPct = s.sellPrice ? margin / s.sellPrice * 100 : 0;
    return { key: id, name: niceName(id), buyAt: s.sellPrice, sellAt: s.buyPrice, margin, marginPct, volume, score: margin * volume };
  }).filter(r => r.margin > 0), [bazaar]);
  const filtered = rows.filter(r => r.name.toLowerCase().includes(query.toLowerCase()));

  return html`
    <${PageLayout} title="Order Flips" description="Buy order at the low price, resell with a sell order at the high price. Margin is net of the 1.25% bazaar fee. Flip Score weights margin by weekly volume so illiquid items sort to the bottom."
      controls=${html`<${SearchInput} value=${query} onChange=${setQuery} placeholder="Filter items..." /><span class="meta">${filtered.length} items</span>`}>
      <div class="card">
        <${SortableTable}
          columns=${[['name', 'Item'], ['buyAt', 'Buy Order'], ['sellAt', 'Sell Order'], ['margin', 'Margin'], ['marginPct', 'Margin %'], ['volume', 'Volume (7d)'], ['score', 'Flip Score']]}
          rows=${sortRows(filtered).slice(0, 300)} sortKey=${sortKey} sortDir=${sortDir} onSort=${onSort}
          renderCell=${(r, k) => k === 'name' ? r.name : k === 'marginPct' ? r.marginPct.toFixed(2) + '%' : fmt(r[k])} />
      </div>
    <//>
  `;
}

function BookFlips({ bazaar }) {
  const { sortKey, sortDir, onSort, sortRows } = useSort('profit', -1);
  const rows = useMemo(() => {
    const ENCHANT_RE = /^ENCHANTMENT_(.+)_(\d+)$/;
    const results = [];
    for (const id of bazaar.keys()) {
      const m = id.match(ENCHANT_RE);
      if (!m) continue;
      const nextId = `ENCHANTMENT_${m[1]}_${parseInt(m[2], 10) + 1}`;
      const lower = bazaar.get(id), higher = bazaar.get(nextId);
      if (!higher || !lower.sellPrice) continue;
      const cost = 2 * lower.sellPrice;
      const revenue = higher.buyPrice * (1 - FEE);
      const profit = revenue - cost;
      if (profit > 0) results.push({ key: nextId, name: niceName(nextId), cost, revenue, profit });
    }
    return results;
  }, [bazaar]);

  return html`
    <${PageLayout} title="Book Flips" description="Combine two copies of an enchanted book at an anvil for one book a level higher. The chain is derived straight from bazaar product ids, not a hand-written table. Cost and revenue use bazaar order prices; the small anvil coin fee isn't included.">
      <div class="card">
        <${SortableTable} columns=${[['name', 'Book'], ['cost', 'Cost (2x lower)'], ['revenue', 'Revenue'], ['profit', 'Profit']]}
          rows=${sortRows(rows)} sortKey=${sortKey} sortDir=${sortDir} onSort=${onSort}
          renderCell=${(r, k) => k === 'name' ? r.name : fmt(r[k])}
          emptyMessage="No profitable book combines right now." />
      </div>
    <//>
  `;
}

function CraftFlips({ bazaar }) {
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const { sortKey, sortDir, onSort, sortRows } = useSort('profit', -1);

  async function scan() {
    setScanning(true);
    const ids = [...bazaar.keys()];
    const results = [];
    let done = 0, idx = 0;
    async function worker() {
      while (idx < ids.length) {
        const id = ids[idx++];
        const data = await getItemData(id);
        done++;
        if (done % 50 === 0) setStatus(`scanning ${done}/${ids.length}`);
        const recipe = data?.recipe;
        if (!recipe) continue;
        const slots = RECIPE_SLOTS.map(k => parseRecipeSlot(recipe[k])).filter(Boolean);
        if (!slots.length || !slots.every(s => bazaar.get(s.id)?.buyPrice > 0)) continue;
        const outCount = parseInt(recipe.count || '1', 10) || 1;
        const outQ = bazaar.get(id);
        if (!outQ?.sellPrice) continue;
        const cost = slots.reduce((sum, s) => sum + bazaar.get(s.id).buyPrice * s.amount, 0);
        const revenue = outQ.sellPrice * outCount * (1 - FEE);
        const profit = revenue - cost;
        if (profit > 0) results.push({ key: id, name: niceName(id), cost, revenue, profit, outCount, slots });
      }
    }
    await Promise.all(Array.from({ length: 10 }, worker));
    setRows(results);
    setStatus(`${results.length} profitable crafts out of ${ids.length} bazaar items scanned`);
    setScanning(false);
  }

  const filtered = rows.filter(r => r.name.toLowerCase().includes(query.toLowerCase()));

  return html`
    <${PageLayout} title="Craft Flips" description="Cost is the bazaar buy price of every ingredient; revenue is the crafted item's bazaar sell price net of fees. Recipes are fetched live from the NotEnoughUpdates community repo."
      actions=${html`<button class="btn primary" disabled=${scanning} onClick=${scan}>${scanning ? 'Scanning…' : 'Scan crafts'}</button>`}
      controls=${html`<${SearchInput} value=${query} onChange=${setQuery} placeholder="Filter items..." />${status && html`<span class="meta">${status}</span>`}`}>
      <div class="card">
        <${SortableTable} columns=${[['name', 'Item'], ['cost', 'Cost'], ['revenue', 'Revenue'], ['profit', 'Profit']]}
          rows=${sortRows(filtered)} sortKey=${sortKey} sortDir=${sortDir} onSort=${onSort}
          onRowClick=${r => setExpanded(expanded === r.key ? null : r.key)}
          renderCell=${(r, k) => k === 'name' ? r.name : fmt(r[k])}
          emptyMessage=${scanning ? 'Scanning…' : 'Press "Scan crafts" to find profitable recipes.'} />
        ${expanded && (() => {
          const r = rows.find(x => x.key === expanded);
          if (!r) return null;
          return html`
            <div style=${{ padding: '14px 20px', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-2)', background: '#fcfcfd' }}>
              ${r.slots.map(s => html`<div key=${s.id}>${s.amount}x ${niceName(s.id)} @ ${fmt(bazaar.get(s.id)?.buyPrice)}</div>`)}
            </div>
          `;
        })()}
      </div>
    <//>
  `;
}

function NpcFlips({ bazaar }) {
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const { sortKey, sortDir, onSort, sortRows } = useSort('profit', -1);

  async function scan() {
    setScanning(true);
    setStatus('fetching item list…');
    try {
      const data = await fetchJson(ITEMS_URL);
      const results = [];
      for (const item of data.items) {
        const npcPrice = item.npc_sell_price;
        const buyPrice = bazaar.get(item.id)?.buyPrice;
        if (!npcPrice || !buyPrice) continue;
        const profit = npcPrice - buyPrice;
        if (profit > 0) results.push({ key: item.id, name: niceName(item.id), buyPrice, npcPrice, profit });
      }
      setRows(results);
      setStatus(`${results.length} reverse NPC flips out of ${data.items.length} items checked`);
    } catch (e) { setStatus('scan failed: ' + e.message); }
    setScanning(false);
  }

  const filtered = rows.filter(r => r.name.toLowerCase().includes(query.toLowerCase()));

  return html`
    <${PageLayout} title="NPC Flips" description="Reverse NPC flip: buy an item from other players via the bazaar, then sell it straight to an NPC vendor for more than the bazaar currently pays. Uses instant buy/sell, so no bazaar fee applies. Forward NPC flips aren't shown — there's no verified live source for NPC purchase prices."
      actions=${html`<button class="btn primary" disabled=${scanning} onClick=${scan}>${scanning ? 'Scanning…' : 'Scan NPC flips'}</button>`}
      controls=${html`<${SearchInput} value=${query} onChange=${setQuery} placeholder="Filter items..." />${status && html`<span class="meta">${status}</span>`}`}>
      <div class="card">
        <${SortableTable} columns=${[['name', 'Item'], ['buyPrice', 'Bazaar Buy Price'], ['npcPrice', 'NPC Sell Price'], ['profit', 'Profit']]}
          rows=${sortRows(filtered)} sortKey=${sortKey} sortDir=${sortDir} onSort=${onSort}
          renderCell=${(r, k) => k === 'name' ? r.name : fmt(r[k])}
          emptyMessage=${scanning ? 'Scanning…' : 'Press "Scan NPC flips" to find reverse NPC flips.'} />
      </div>
    <//>
  `;
}

const SUBTABS = [
  ['order', 'Order Flips'], ['book', 'Book Flips'], ['craft', 'Craft Flips'], ['npc', 'NPC Flips'],
];

function App() {
  const bazaar = useBazaar();
  const [sub, setSub] = useState('order');
  return html`
    <${Nav} active="flips.html" />
    <div class="page" style=${{ paddingBottom: 0 }}>
      <div class="nav-tabs" style=${{ height: '40px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
        ${SUBTABS.map(([key, label]) => html`
          <button key=${key} class=${'tab' + (sub === key ? ' active' : '')} onClick=${() => setSub(key)}>${label}</button>
        `)}
      </div>
    </div>
    ${sub === 'order' && html`<${OrderFlips} bazaar=${bazaar} />`}
    ${sub === 'book' && html`<${BookFlips} bazaar=${bazaar} />`}
    ${sub === 'craft' && html`<${CraftFlips} bazaar=${bazaar} />`}
    ${sub === 'npc' && html`<${NpcFlips} bazaar=${bazaar} />`}
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
