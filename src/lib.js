// Shared across all pages: React/htm bootstrap, API fetchers, formatting,
// gzip/NBT decoding, fingerprinting, and the snipe-detection algorithm.
// Plain ES modules, loaded with <script type="module"> -- no bundler.

import React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

export { React, createRoot };
export const html = htm.bind(React.createElement);

// ---------- endpoints ----------
export const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
export const AUCTIONS_URL = 'https://api.hypixel.net/v2/skyblock/auctions';
export const AUCTIONS_ENDED_URL = 'https://api.hypixel.net/v2/skyblock/auctions_ended';
export const ELECTION_URL = 'https://api.hypixel.net/v2/resources/skyblock/election';
export const ITEMS_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';
export const neuItemUrl = id => `https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/items/${id}.json`;

// ---------- formatting ----------
export function fmt(n) {
  if (n == null || isNaN(n)) return '-';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e9) return sign + (n / 1e9).toFixed(2) + 'b';
  if (n >= 1e6) return sign + (n / 1e6).toFixed(2) + 'm';
  if (n >= 1e3) return sign + (n / 1e3).toFixed(1) + 'k';
  return sign + n.toFixed(0);
}
export function coins(n) { return fmt(n) + ' coins'; }
export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export function niceName(id) { return id.replace(/_/g, ' '); }
export function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const TIERS = {
  COMMON: ['#475467', '#f2f4f7'], UNCOMMON: ['#067647', '#ecfdf3'], RARE: ['#1d4ed8', '#eff6ff'],
  EPIC: ['#7c3aed', '#f5f3ff'], LEGENDARY: ['#b54708', '#fffaeb'], MYTHIC: ['#c11574', '#fdf2fa'],
  DIVINE: ['#0e7090', '#f0f9ff'], SPECIAL: ['#b42318', '#fef3f2'], VERY_SPECIAL: ['#b42318', '#fef3f2'],
  SUPREME: ['#5925dc', '#f4f3ff'],
};

// ---------- gzip + NBT (native platform decompression, no library) ----------
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
class Cursor { constructor(view) { this.view = view; this.pos = 0; } }
const readByte = c => { const v = c.view.getInt8(c.pos); c.pos += 1; return v; };
const readUByte = c => { const v = c.view.getUint8(c.pos); c.pos += 1; return v; };
const readShort = c => { const v = c.view.getInt16(c.pos); c.pos += 2; return v; };
const readInt = c => { const v = c.view.getInt32(c.pos); c.pos += 4; return v; };
const readLong = c => { const v = c.view.getBigInt64(c.pos); c.pos += 8; return Number(v); };
const readFloat = c => { const v = c.view.getFloat32(c.pos); c.pos += 4; return v; };
const readDouble = c => { const v = c.view.getFloat64(c.pos); c.pos += 8; return v; };
function readString(c) {
  const len = readShort(c) & 0xffff;
  const bytes = new Uint8Array(c.view.buffer, c.view.byteOffset + c.pos, len);
  c.pos += len;
  return new TextDecoder('utf-8').decode(bytes);
}
function readPayload(c, type) {
  switch (type) {
    case 1: return readByte(c);
    case 2: return readShort(c);
    case 3: return readInt(c);
    case 4: return readLong(c);
    case 5: return readFloat(c);
    case 6: return readDouble(c);
    case 7: { const len = readInt(c); const a = []; for (let i = 0; i < len; i++) a.push(readByte(c)); return a; }
    case 8: return readString(c);
    case 9: { const t = readUByte(c); const len = readInt(c); const a = []; for (let i = 0; i < len; i++) a.push(readPayload(c, t)); return a; }
    case 10: { const o = {}; while (true) { const t = readUByte(c); if (t === 0) break; const name = readString(c); o[name] = readPayload(c, t); } return o; }
    case 11: { const len = readInt(c); const a = []; for (let i = 0; i < len; i++) a.push(readInt(c)); return a; }
    case 12: { const len = readInt(c); const a = []; for (let i = 0; i < len; i++) a.push(readLong(c)); return a; }
    default: throw new Error('unknown NBT tag type ' + type);
  }
}
export function parseNbt(bytes) {
  const c = new Cursor(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const rootType = readUByte(c);
  readString(c); // root name, unused
  return readPayload(c, rootType);
}
export async function decodeItemBytes(b64) {
  const raw = await gunzip(b64ToBytes(b64));
  const nbt = parseNbt(raw);
  return nbt.i || [];
}

// ---------- fingerprint ----------
// Pet level is bucketed straight from the displayed "[Lvl N]" text into 20-level bands --
// no XP breakpoint table needed, the game already shows the level for us to read.
export function fingerprint(itemId, ea, displayName) {
  const parts = [itemId || 'UNKNOWN'];
  if (!ea) return parts.join('|');
  if (ea.rarity_upgrades) parts.push('R');
  const stars = ea.upgrade_level || ea.dungeon_item_level;
  if (stars) parts.push('S' + stars);
  const hpb = ea.hot_potato_count;
  if (hpb && hpb > 10) parts.push('FPB' + (hpb - 10));
  if (ea.enchantments) {
    // every enchantment counts, not just the "meaningful" high ones -- a Sharpness 5
    // sword and a bare one are different items and shouldn't be treated as comparable.
    const ench = Object.entries(ea.enchantments)
      .map(([name, lvl]) => `${name}${lvl}`)
      .sort();
    if (ench.length) parts.push(ench.join(','));
  }
  if (itemId === 'PET' && ea.petInfo) {
    try {
      const p = JSON.parse(ea.petInfo);
      const lvl = +((displayName || '').match(/\[Lvl (\d+)\]/) || [])[1] || 0;
      const band = Math.floor(lvl / 20) * 20;
      parts.push(`PET:${p.type}:${p.tier}:${band}:${p.heldItem || ''}`);
    } catch (e) { /* malformed petInfo, skip pet-specific grouping */ }
  }
  if (ea.new_years_cake) parts.push('CAKE' + ea.new_years_cake);
  if (ea.party_hat_color) parts.push('HAT' + ea.party_hat_color + (ea.party_hat_emoji || ''));
  return parts.join('|');
}

// human-readable summary of what makes a fingerprint distinct, e.g. "recombobulated · 5★"
export function attrSummary(ea, displayName) {
  if (!ea) return '';
  if (ea.id === 'PET' && ea.petInfo) {
    try {
      const pi = JSON.parse(ea.petInfo);
      const bits = [pi.tier.toLowerCase() + ' pet'];
      const lvl = +((displayName || '').match(/\[Lvl (\d+)\]/) || [])[1] || 0;
      const b = Math.floor(lvl / 20) * 20;
      bits.push(`lvl ${b}–${b + 19}`);
      if (pi.heldItem) bits.push('holds item');
      return bits.join(' · ');
    } catch (e) { return ''; }
  }
  const bits = [];
  if (ea.rarity_upgrades > 0) bits.push('recombobulated');
  const stars = ea.upgrade_level ?? ea.dungeon_item_level ?? 0;
  if (stars > 0) bits.push(stars + '★');
  if ((ea.hot_potato_count || 0) > 10) bits.push('+' + (ea.hot_potato_count - 10) + ' fuming');
  const ench = Object.entries(ea.enchantments || {}).sort((a, b) => b[1] - a[1]);
  if (ench.length) bits.push(
    ench.slice(0, 3).map(([n, l]) => n.replace('ultimate_', 'U. ').replace(/_/g, ' ') + ' ' + l).join(', ')
    + (ench.length > 3 ? ` +${ench.length - 3} more` : ''));
  return bits.join(' · ') || 'clean';
}

// ---------- Minecraft color code rendering (item preview tooltips) ----------
const MC_COLORS = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa',
  '6': '#ffaa00', '7': '#aaaaaa', '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function loreToHtml(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : lines;
  let out = '', color = '#c8c8c8', bold = false, open = false;
  const flush = () => { if (open) { out += '</span>'; open = false; } };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '§') {
      const code = text[++i]?.toLowerCase();
      if (MC_COLORS[code]) { flush(); color = MC_COLORS[code]; bold = false; }
      else if (code === 'l') { bold = true; }
      else if (code === 'r') { flush(); color = '#c8c8c8'; bold = false; }
      continue;
    }
    if (ch === '\n') { flush(); out += '<br>'; continue; }
    if (!open) { out += `<span style="color:${color}${bold ? ';font-weight:700' : ''}">`; open = true; }
    out += escapeHtml(ch);
  }
  flush();
  return out;
}

// ---------- snipe detection ----------
// Guardrails beyond "below median", found by testing the original simpler rule against
// real auction data: a single fluke high listing among 4 comparables could still trigger
// a false positive with only a median check. Three conditions together:
//  - the lowest sits >=20% below the median of the OTHER listings (drops itself so the
//    snipe doesn't drag its own reference down)
//  - there's a real absolute coin gap to the 2nd cheapest (50k floor -- guards against
//    a "gap" that's just rounding on cheap items)
//  - the lowest is itself >=15% below the 2nd cheapest specifically, not just the median
// Profit is modelled against reselling at the 2nd-cheapest price (what you'd realistically
// undercut to), net of a 2% claim tax on that resale.
export const AH_CLAIM_TAX = 0.02;

export function findSnipes(groups) {
  const rows = [];
  for (const [fp, list] of groups) {
    if (list.length < 4) continue;
    const sorted = [...list].sort((a, b) => a.price - b.price);
    const prices = sorted.map(l => l.price);
    const low = sorted[0];
    const rest = prices.slice(1);
    const ref = median(rest);
    const second = prices[1];
    const belowMedian = 1 - low.price / ref;
    const gap = second - low.price;

    if (belowMedian >= 0.20 && gap > 50000 && low.price < second * 0.85) {
      const profit = second * (1 - AH_CLAIM_TAX) - low.price;
      if (profit <= 0) continue;
      rows.push({ fp, low, second, ref, profit, ratio: belowMedian * 100, count: list.length, listings: sorted });
    }
  }
  return rows.sort((a, b) => b.profit - a.profit);
}

// ---------- API fetchers ----------
export async function fetchJson(url) { return (await fetch(url)).json(); }

export async function fetchBazaar() {
  const data = await fetchJson(BAZAAR_URL);
  if (!data.success) throw new Error('bazaar fetch failed');
  return new Map(Object.entries(data.products).map(([id, p]) => [id, p.quick_status]));
}

export async function fetchAllBinAuctions(onProgress) {
  const first = await fetchJson(`${AUCTIONS_URL}?page=0`);
  const totalPages = first.totalPages;
  const all = first.auctions.filter(a => a.bin);
  onProgress?.(1, totalPages, all.length);
  for (let p = 1; p < totalPages; p++) {
    const data = await fetchJson(`${AUCTIONS_URL}?page=${p}`);
    all.push(...data.auctions.filter(a => a.bin));
    onProgress?.(p + 1, totalPages, all.length);
  }
  return all;
}

export async function decodeAuctionsForItem(auctions, itemId, onProgress) {
  const groups = new Map();
  const listings = [];
  let done = 0, idx = 0;
  async function worker() {
    while (idx < auctions.length) {
      const auction = auctions[idx++];
      try {
        const items = await decodeItemBytes(auction.item_bytes);
        const item = items[0];
        const ea = item?.tag?.ExtraAttributes;
        const displayName = item?.tag?.display?.Name;
        const decodedId = ea?.id || auction.item_name;
        if (!itemId || decodedId === itemId) {
          const fp = fingerprint(decodedId, ea, displayName);
          const listing = {
            price: auction.starting_bid, uuid: auction.uuid, auctioneer: auction.auctioneer,
            itemName: auction.item_name, tier: auction.tier, end: auction.end,
            attrs: attrSummary(ea, displayName), fp, lore: item?.tag?.display?.Lore,
          };
          listings.push(listing);
          if (!groups.has(fp)) groups.set(fp, []);
          groups.get(fp).push(listing);
        }
      } catch (e) { /* malformed item_bytes, skip this listing */ }
      done++;
      if (done % 500 === 0) onProgress?.(done, auctions.length);
    }
  }
  await Promise.all(Array.from({ length: 25 }, worker));
  onProgress?.(auctions.length, auctions.length);
  return { groups, listings };
}

export async function fetchMayor() {
  const data = await fetchJson(ELECTION_URL);
  if (!data.mayor) throw new Error('no mayor in response');
  return data.mayor;
}

// ---------- backend (optional, same-origin only) ----------
export async function fetchHistory(fingerprintKey) {
  const res = await fetch(`/api/history?fingerprint=${encodeURIComponent(fingerprintKey)}`);
  if (!res.ok) throw new Error('backend unreachable');
  return res.json();
}
export async function fetchMovers() {
  const res = await fetch('/api/movers');
  if (!res.ok) throw new Error('backend unreachable');
  return res.json();
}
export async function fetchLowSupply() {
  const res = await fetch('/api/low-supply');
  if (!res.ok) throw new Error('backend unreachable');
  return res.json();
}
export async function resolvePlayerName(uuid) {
  const res = await fetch(`/api/player?uuid=${uuid}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.name;
}

// ---------- item data (NEU repo + Hypixel items resource) ----------
const itemDataCache = new Map();
export async function getItemData(id) {
  if (itemDataCache.has(id)) return itemDataCache.get(id);
  const lsKey = 'ledger_item_' + id;
  const cached = localStorage.getItem(lsKey);
  if (cached !== null) {
    const val = cached === 'null' ? null : JSON.parse(cached);
    itemDataCache.set(id, val);
    return val;
  }
  let data = null;
  try {
    const res = await fetch(neuItemUrl(id));
    if (res.ok) data = await res.json();
  } catch (e) { /* treated as no data */ }
  localStorage.setItem(lsKey, JSON.stringify(data));
  itemDataCache.set(id, data);
  return data;
}
