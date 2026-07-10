'use strict';
// Shared by ledger.html and item.html: formatting helpers, gzip/NBT decoding
// (native DecompressionStream, no library), fingerprinting, and snipe detection.
// Kept in one file so both pages decode auctions and group variants identically.

const FEE = 0.0125;
const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const AUCTIONS_URL = 'https://api.hypixel.net/v2/skyblock/auctions';
const AUCTIONS_ENDED_URL = 'https://api.hypixel.net/v2/skyblock/auctions_ended';
const ELECTION_URL = 'https://api.hypixel.net/v2/resources/skyblock/election';
const ITEMS_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';
const neuItemUrl = id => `https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/items/${id}.json`;

// ---------- formatting ----------
function fmt(n) {
  if (n == null || isNaN(n)) return '-';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e9) return sign + (n / 1e9).toFixed(2) + 'b';
  if (n >= 1e6) return sign + (n / 1e6).toFixed(2) + 'm';
  if (n >= 1e3) return sign + (n / 1e3).toFixed(1) + 'k';
  return sign + n.toFixed(0);
}
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => (a[key] - b[key]) * dir || String(a.name || '').localeCompare(b.name || ''));
}
function niceName(id) {
  return id.replace(/_/g, ' ');
}
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

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
function parseNbt(bytes) {
  const c = new Cursor(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const rootType = readUByte(c);
  readString(c); // root name, unused
  return readPayload(c, rootType);
}
async function decodeItemBytes(b64) {
  const raw = await gunzip(b64ToBytes(b64));
  const nbt = parseNbt(raw);
  return nbt.i || [];
}

// ---------- fingerprint ----------
// ponytail: pet level is grouped by tier only, not the full 20-level band from the spec.
// The XP breakpoint table needed for exact bands is large; add it if pet snipes need finer grouping.
function fingerprint(itemId, ea) {
  const parts = [itemId || 'UNKNOWN'];
  if (!ea) return parts.join('|');
  if (ea.rarity_upgrades) parts.push('R');
  const stars = ea.upgrade_level || ea.dungeon_item_level;
  if (stars) parts.push('S' + stars);
  const hpb = ea.hot_potato_count;
  if (hpb && hpb > 10) parts.push('FPB' + (hpb - 10));
  if (ea.enchantments) {
    const ench = Object.entries(ea.enchantments)
      .filter(([name, lvl]) => name.startsWith('ultimate_') || lvl >= 6)
      .map(([name, lvl]) => `${name}${lvl}`)
      .sort();
    if (ench.length) parts.push(ench.join(','));
  }
  if (itemId === 'PET' && ea.petInfo) {
    try {
      const p = JSON.parse(ea.petInfo);
      parts.push(`PET:${p.type}:${p.tier}:${p.heldItem || ''}`);
    } catch (e) { /* malformed petInfo, skip pet-specific grouping */ }
  }
  if (ea.new_years_cake) parts.push('CAKE' + ea.new_years_cake);
  if (ea.party_hat_color) parts.push('HAT' + ea.party_hat_color + (ea.party_hat_emoji || ''));
  return parts.join('|');
}

// human-readable label for a fingerprint's attribute parts, e.g. "5 Stars, Recombobulated"
function describeFingerprint(itemId, ea) {
  if (!ea) return 'Plain';
  const bits = [];
  if (ea.rarity_upgrades) bits.push('Recombobulated');
  const stars = ea.upgrade_level || ea.dungeon_item_level;
  if (stars) bits.push(`${stars} Star${stars > 1 ? 's' : ''}`);
  const hpb = ea.hot_potato_count;
  if (hpb && hpb > 10) bits.push(`+${hpb - 10} Fuming Potato`);
  if (ea.enchantments) {
    const ench = Object.entries(ea.enchantments)
      .filter(([name, lvl]) => name.startsWith('ultimate_') || lvl >= 6)
      .map(([name, lvl]) => `${niceName(name)} ${lvl}`);
    bits.push(...ench);
  }
  return bits.length ? bits.join(', ') : 'Plain';
}

function findSnipes(groups) {
  const snipes = [];
  for (const listings of groups.values()) {
    if (listings.length < 4) continue;
    const sorted = [...listings].sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
    const med = median(sorted.slice(1).map(l => l.price));
    const gap = sorted[1].price - cheapest.price;
    if (cheapest.price <= med * 0.8 && gap > 0) {
      snipes.push({ cheapest, median: med, listings: sorted });
    }
  }
  return snipes.sort((a, b) => (b.median - b.cheapest.price) - (a.median - a.cheapest.price));
}

// ---------- Minecraft color code rendering (for item preview tooltips) ----------
const MC_COLORS = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000',
  '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA', '8': '#555555', '9': '#5555FF',
  a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
function mcLineToHtml(line) {
  let html = '';
  let span = false;
  const parts = line.split('§');
  html += escapeHtml(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    const code = parts[i][0]?.toLowerCase();
    const rest = parts[i].slice(1);
    if (span) html += '</span>';
    span = false;
    const styles = [];
    if (MC_COLORS[code]) styles.push(`color:${MC_COLORS[code]}`);
    if (code === 'l') styles.push('font-weight:bold');
    if (code === 'o') styles.push('font-style:italic');
    if (code === 'n') styles.push('text-decoration:underline');
    if (styles.length) { html += `<span style="${styles.join(';')}">`; span = true; }
    html += escapeHtml(rest);
  }
  if (span) html += '</span>';
  return html;
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
