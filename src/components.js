import { React, html, fmt } from './lib.js';
const { useState } = React;

export function Nav({ active }) {
  const tabs = [
    ['bazaar-tracker.html', 'Bazaar Tracker'],
    ['auction-tracker.html', 'Auction Tracker'],
    ['flips.html', 'Flips'],
  ];
  return html`
    <nav class="navbar">
      <a class="brand" href="index.html"><span class="mark">L</span>Ledger</a>
      <div class="nav-tabs" role="tablist">
        ${tabs.map(([href, label]) => html`
          <a key=${href} class=${'tab' + (active === href ? ' active' : '')} href=${href}>${label}</a>
        `)}
      </div>
      <div class="nav-right"><a href="privacy.html" style=${{ color: 'var(--text-3)', textDecoration: 'none' }}>Privacy</a></div>
    </nav>
  `;
}

export function PageLayout({ title, description, actions, stats, controls, children }) {
  return html`
    <div class="page">
      <div class="page-head">
        <div><h1>${title}</h1><p>${description}</p></div>
        ${actions && html`<div class="actions">${actions}</div>`}
      </div>
      ${stats && html`
        <div class="stats">
          ${stats.map((s, i) => html`
            <div class="stat" key=${i}>
              <div class="label">${s.label}</div>
              <div class="value num">${s.value}</div>
              ${s.sub && html`<div class=${'sub' + (s.subClass ? ' ' + s.subClass : '')}>${s.sub}</div>`}
            </div>
          `)}
        </div>
      `}
      ${controls && html`<div class="controls">${controls}</div>`}
      ${children}
    </div>
  `;
}

export function SearchInput({ value, onChange, placeholder }) {
  return html`
    <span class="search-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="text" value=${value} placeholder=${placeholder || 'Search'} autocomplete="off"
        onInput=${e => onChange(e.target.value)} />
    </span>
  `;
}

export function SortableTable({ columns, rows, sortKey, sortDir, onSort, renderCell, onRowClick, emptyMessage }) {
  if (!rows.length) {
    return html`<div class="empty">${emptyMessage || 'Nothing to show yet.'}</div>`;
  }
  return html`
    <table>
      <thead>
        <tr>
          ${columns.map(([key, label]) => html`
            <th key=${key} onClick=${() => key && onSort && onSort(key)}>
              ${label}${sortKey === key && html`<span class="arrow">${sortDir === 1 ? '▲' : '▼'}</span>`}
            </th>
          `)}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row, i) => html`
          <tr key=${row.key ?? i} class=${onRowClick ? 'clickable' : ''} onClick=${() => onRowClick && onRowClick(row)}>
            ${columns.map(([key]) => html`<td key=${key}>${renderCell(row, key)}</td>`)}
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

// hook for click-to-sort table state
export function useSort(initialKey, initialDir = -1) {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDir, setSortDir] = useState(initialDir);
  const onSort = key => {
    if (key === sortKey) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
  };
  const sortRows = rows => [...rows].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
    return String(av ?? '').localeCompare(String(bv ?? '')) * sortDir;
  });
  return { sortKey, sortDir, onSort, sortRows };
}

// simple multi-series canvas line/area chart -- no charting library
export function Chart({ series, height = 220, formatY = v => v }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const allPoints = series.flatMap(s => s.points);
    if (!allPoints.length) {
      ctx.fillStyle = '#98a2b3';
      ctx.font = '13px Inter, sans-serif';
      ctx.fillText('No data yet.', 16, h / 2);
      return;
    }
    const pad = { l: 46, r: 12, t: 12, b: 22 };
    const minY = Math.min(...allPoints.map(p => p.y));
    const maxY = Math.max(...allPoints.map(p => p.y)) || 1;
    const x = (i, n) => pad.l + (n <= 1 ? 0 : i / (n - 1)) * (w - pad.l - pad.r);
    const y = v => h - pad.b - ((v - minY) / (maxY - minY || 1)) * (h - pad.t - pad.b);

    ctx.strokeStyle = '#e4e7ec';
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(f => {
      const yy = pad.t + f * (h - pad.t - pad.b);
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
      ctx.fillStyle = '#98a2b3'; ctx.font = '10.5px Inter, sans-serif';
      ctx.fillText(formatY(maxY - f * (maxY - minY)), 2, yy + 3);
    });

    for (const s of series) {
      if (!s.points.length) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const px = x(i, s.points.length), py = y(p.y);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }, [series, height]);
  return html`
    <canvas ref=${ref} style=${{ width: '100%', height: height + 'px', display: 'block' }}></canvas>
    <div class="chart-legend">
      ${series.map(s => html`<span key=${s.label}><i style=${{ background: s.color }}></i>${s.label}</span>`)}
    </div>
  `;
}

export function Modal({ open, onClose, children }) {
  return html`
    <div class=${'modal-overlay' + (open ? ' open' : '')} onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal-panel">${children}</div>
    </div>
  `;
}

// Generic "what does this flip actually involve" detail: used by Craft Flips and
// Shard Flips. ingredients: [{ id, label, amount, unitPrice }] -- subtotal is derived.
export function RecipeModal({ open, onClose, title, subtitle, outCount, cost, revenue, profit, ingredients }) {
  return html`
    <${Modal} open=${open} onClose=${onClose}>
      <div class="modal-head">
        <div>
          <h2>${title}</h2>
          <div class="modal-attrs">${subtitle || (outCount > 1 ? `Yields ${outCount}x per craft` : '')}</div>
        </div>
        <button class="modal-x" onClick=${onClose} aria-label="Close">✕</button>
      </div>

      <div class="modal-grid" style=${{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div class="modal-metric"><span>Cost</span><b>${fmt(cost)}</b></div>
        <div class="modal-metric"><span>Revenue</span><b>${fmt(revenue)}</b></div>
        <div class="modal-metric"><span>Profit</span><b style=${{ color: 'var(--up)' }}>${fmt(profit)}</b></div>
      </div>

      <div class="modal-section">
        <div class="modal-label">${ingredients.length} ingredient${ingredients.length === 1 ? '' : 's'} needed</div>
        <table class="listings-table"><tbody>
          ${ingredients.map(ing => html`
            <tr key=${ing.id}>
              <td style=${{ textAlign: 'left' }}>${ing.amount}x ${ing.label}</td>
              <td class="num" style=${{ color: 'var(--text-3)' }}>@ ${fmt(ing.unitPrice)}</td>
              <td class="num" style=${{ textAlign: 'right', fontWeight: 600 }}>${fmt(ing.unitPrice * ing.amount)}</td>
            </tr>
          `)}
        </tbody></table>
      </div>
    <//>
  `;
}
