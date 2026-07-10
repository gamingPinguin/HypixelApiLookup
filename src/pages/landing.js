import { React, html, createRoot } from '../lib.js';
import { Nav } from '../components.js';

const FEATURES = [
  { icon: '📊', title: 'Bazaar Tracker', desc: 'Live buy/sell prices, spreads, and volume for every bazaar product, with price history charts and margin research — modeled on Bazaar Tracker.', href: 'bazaar-tracker.html' },
  { icon: '🔨', title: 'Auction Tracker', desc: 'Look up any item to see every live listing, recent sales, and price history in one place — modeled on SkyCofl\'s item pages.', href: 'auction-tracker.html' },
  { icon: '🎯', title: 'Snipe finder', desc: 'Decodes each listing\'s real attributes client-side and flags the ones priced well below comparable listings, with an estimated resale profit.', href: 'auction-tracker.html' },
  { icon: '💰', title: 'Flips', desc: 'Order flips, craft flips, book flips, and reverse NPC flips, ranked by profit and weighted by liquidity so illiquid traps sort to the bottom.', href: 'flips.html' },
];

function Landing() {
  return html`
    <${Nav} active="index.html" />

    <section class="hero">
      <h1>A market terminal for Hypixel Skyblock</h1>
      <p>Ledger tracks bazaar prices, finds profitable flips, and scans the auction house for underpriced listings using true item attributes instead of display names.</p>
      <div class="cta-row">
        <a class="btn primary" href="bazaar-tracker.html">Open Bazaar Tracker</a>
        <a class="btn" href="auction-tracker.html" style=${{ background: 'rgba(255,255,255,.08)', color: '#fff', borderColor: 'rgba(255,255,255,.25)' }}>Open Auction Tracker</a>
      </div>
    </section>

    <div class="trust-row">
      <span class="item"><span class="n">✓</span> No account or install needed</span>
      <span class="item"><span class="n">✓</span> Open source on GitHub</span>
      <span class="item"><span class="n">✓</span> Bazaar data refreshes every 60s</span>
    </div>

    <section class="section">
      <h2>Everything in one place</h2>
      <p class="lead">Four tools, one data pipeline. Nothing here requires a login — open a page and it starts working.</p>
      <div class="feature-grid">
        ${FEATURES.map(f => html`
          <a key=${f.title} href=${f.href} style=${{ textDecoration: 'none', color: 'inherit' }}>
            <div class="feature-card">
              <div class="icon">${f.icon}</div>
              <h3>${f.title}</h3>
              <p>${f.desc}</p>
            </div>
          </a>
        `)}
      </div>
    </section>

    <section class="section dark">
      <h2>What this is, and isn't</h2>
      <p class="lead">Ledger is a research tool. Every figure is an estimate based on current listings, not a guarantee your orders fill at the prices shown. It's an independent, non-commercial project built for the Skyblock trading community, and is not affiliated with, endorsed by, or sponsored by Hypixel Inc. or Mojang.</p>
    </section>

    <footer>
      <div>
        <a href="bazaar-tracker.html">Bazaar Tracker</a> ·
        <a href="auction-tracker.html">Auction Tracker</a> ·
        <a href="flips.html">Flips</a> ·
        <a href="privacy.html">Privacy Policy</a> ·
        <a href="https://github.com/gamingPinguin/HypixelApiLookup" target="_blank" rel="noopener">GitHub</a>
      </div>
      <div style=${{ marginTop: '6px' }}>Ledger is an independent project and is not affiliated with Hypixel Inc.</div>
    </footer>
  `;
}

createRoot(document.getElementById('root')).render(html`<${Landing} />`);
