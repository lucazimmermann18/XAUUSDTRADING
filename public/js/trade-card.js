/**
 * trade-card.js
 * Generates a beautiful ICT trade card HTML widget from analysis results.
 */

'use strict';

const TradeCard = (() => {

  // ── Number Formatting ───────────────────────────────────────────────────

  /** Format money in German style: 1.234,56 */
  function fmtMoney(n) {
    if (n === null || n === undefined) return '–';
    return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Format price using instrument-specific decimals */
  function fmtPrice(n, symbol) {
    if (n === null || n === undefined) return '–';
    const cfg = (typeof INSTRUMENTS !== 'undefined' && INSTRUMENTS[symbol]);
    const dec = cfg ? cfg.decimals : 2;
    return n.toFixed(dec);
  }

  /** Format lot size */
  function fmtLot(n) {
    if (!n || n === 0) return '0.01';
    return n.toFixed(2);
  }

  /** Format RR */
  function fmtRR(n) {
    return n.toFixed(2);
  }

  // ── Mini SVG Chart Builder ──────────────────────────────────────────────

  /**
   * Build a 580×220 SVG mini chart showing:
   * - Premium/Discount zones
   * - TP / Entry / SL dashed lines
   * - Simplified white price history line
   * - Green bezier projection to TP
   * - Pulsing entry dot
   */
  function buildSVGChart(result) {
    const { trade, candles, premDisc } = result;
    const { entry, sl, tp, direction } = trade;

    const W = 580, H = 220;
    const padL = 8, padR = 90, padT = 12, padB = 12;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    // Use last 60 candles for the line
    const lineCandles = candles.slice(-60);
    const prices = lineCandles.map(c => c.close);

    // Determine visible price range including TP/SL
    const allPrices = [...prices, tp, sl, entry];
    const minP = Math.min(...allPrices) * 0.9995;
    const maxP = Math.max(...allPrices) * 1.0005;
    const priceRange = maxP - minP;

    // Coordinate helpers
    const px = (i, total) => padL + (i / (total - 1)) * chartW;
    const py = (price) => padT + chartH - ((price - minP) / priceRange) * chartH;

    const tpY  = py(tp);
    const entY = py(entry);
    const slY  = py(sl);

    // EQ line y
    const eqY = py(premDisc.eq);

    // Premium/Discount split
    const premiumBg   = `<rect x="${padL}" y="${padT}" width="${chartW}" height="${Math.max(0, eqY - padT)}" fill="rgba(239,68,68,0.04)" />`;
    const discountBg  = `<rect x="${padL}" y="${eqY}" width="${chartW}" height="${Math.max(0, padT + chartH - eqY)}" fill="rgba(34,197,94,0.04)" />`;

    // Zone labels
    const premiumLabel  = `<text x="${padL + 8}" y="${padT + 16}" font-family="Plus Jakarta Sans,sans-serif" font-size="10" font-weight="700" fill="rgba(239,68,68,0.5)" letter-spacing="2">PREMIUM</text>`;
    const discountLabel = `<text x="${padL + 8}" y="${padT + chartH - 8}" font-family="Plus Jakarta Sans,sans-serif" font-size="10" font-weight="700" fill="rgba(34,197,94,0.5)" letter-spacing="2">DISCOUNT</text>`;

    // EQ dashed line
    const eqLine = `<line x1="${padL}" y1="${eqY}" x2="${padL + chartW}" y2="${eqY}" stroke="rgba(148,163,184,0.25)" stroke-width="1" stroke-dasharray="4,4" />`;

    // TP / Entry / SL dashed lines + labels
    const clampY = (y) => Math.max(padT, Math.min(padT + chartH, y));
    const tpYc  = clampY(tpY);
    const entYc = clampY(entY);
    const slYc  = clampY(slY);

    const tpLine  = `<line x1="${padL}" y1="${tpYc}"  x2="${padL + chartW}" y2="${tpYc}"  stroke="rgba(34,197,94,0.8)"   stroke-width="1.5" stroke-dasharray="6,3" />`;
    const entLine = `<line x1="${padL}" y1="${entYc}" x2="${padL + chartW}" y2="${entYc}" stroke="rgba(91,141,239,0.8)"  stroke-width="1.5" stroke-dasharray="6,3" />`;
    const slLine  = `<line x1="${padL}" y1="${slYc}"  x2="${padL + chartW}" y2="${slYc}"  stroke="rgba(239,68,68,0.8)"   stroke-width="1.5" stroke-dasharray="6,3" />`;

    const labelX = padL + chartW + 4;
    const tpLabel  = `<text x="${labelX}" y="${tpYc  + 4}" font-family="JetBrains Mono,monospace" font-size="9.5" fill="rgba(34,197,94,0.9)"  font-weight="600">TP ${fmtPrice(tp, result.symbol)}</text>`;
    const entLabel = `<text x="${labelX}" y="${entYc + 4}" font-family="JetBrains Mono,monospace" font-size="9.5" fill="rgba(91,141,239,0.9)" font-weight="600">ENT ${fmtPrice(entry, result.symbol)}</text>`;
    const slLabel  = `<text x="${labelX}" y="${slYc  + 4}" font-family="JetBrains Mono,monospace" font-size="9.5" fill="rgba(239,68,68,0.9)"  font-weight="600">SL ${fmtPrice(sl, result.symbol)}</text>`;

    // Vertical "now" line at 75% of chart width
    const nowX = padL + chartW * 0.75;
    const nowLine = `<line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${padT + chartH}" stroke="rgba(148,163,184,0.2)" stroke-width="1" stroke-dasharray="3,3" />`;
    const nowLabel = `<text x="${nowX - 2}" y="${padT + 10}" font-family="Plus Jakarta Sans,sans-serif" font-size="9" fill="rgba(148,163,184,0.4)" text-anchor="end">jetzt</text>`;

    // Price history polyline (first 75% of chart width = historical)
    const histCount = Math.ceil(lineCandles.length * 0.75);
    const histCandles = lineCandles.slice(0, histCount);
    let points = histCandles.map((c, i) => {
      const x = padL + (i / (lineCandles.length - 1)) * chartW * 0.75;
      const y = clampY(py(c.close));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const priceLine = `<polyline points="${points}" fill="none" stroke="rgba(241,245,249,0.5)" stroke-width="1.5" stroke-linejoin="round" />`;

    // Last historical point
    const lastHistX = padL + ((histCount - 1) / (lineCandles.length - 1)) * chartW * 0.75;
    const lastHistY = clampY(py(histCandles[histCandles.length - 1].close));

    // Green bezier projection arrow from "now" to TP
    const projStartX = nowX;
    const projStartY = entYc;
    const projEndX   = padL + chartW - 4;
    const projEndY   = clampY(tpYc);
    const cp1X = projStartX + (projEndX - projStartX) * 0.3;
    const cp1Y = projStartY;
    const cp2X = projStartX + (projEndX - projStartX) * 0.7;
    const cp2Y = projEndY;

    const projPath = `<path d="M${projStartX},${projStartY} C${cp1X},${cp1Y} ${cp2X},${cp2Y} ${projEndX},${projEndY}" fill="none" stroke="rgba(34,197,94,0.7)" stroke-width="2" stroke-dasharray="5,3" />`;

    // Arrow head at TP end
    const arrowSize = 5;
    const angle = Math.atan2(projEndY - cp2Y, projEndX - cp2X);
    const ax1 = projEndX - arrowSize * Math.cos(angle - 0.4);
    const ay1 = projEndY - arrowSize * Math.sin(angle - 0.4);
    const ax2 = projEndX - arrowSize * Math.cos(angle + 0.4);
    const ay2 = projEndY - arrowSize * Math.sin(angle + 0.4);
    const arrowHead = `<polygon points="${projEndX},${projEndY} ${ax1.toFixed(1)},${ay1.toFixed(1)} ${ax2.toFixed(1)},${ay2.toFixed(1)}" fill="rgba(34,197,94,0.8)" />`;

    // Pulsing entry dot
    const entryDot = `
      <circle cx="${projStartX}" cy="${entYc}" r="5" fill="rgba(91,141,239,0.25)" class="entry-pulse" />
      <circle cx="${projStartX}" cy="${entYc}" r="3" fill="rgba(91,141,239,1)" />
    `;

    const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="background:rgba(15,22,41,0.7);border-radius:12px;">
  ${premiumBg}
  ${discountBg}
  ${premiumLabel}
  ${discountLabel}
  ${eqLine}
  ${nowLine}
  ${nowLabel}
  ${priceLine}
  ${tpLine}
  ${entLine}
  ${slLine}
  ${tpLabel}
  ${entLabel}
  ${slLabel}
  ${projPath}
  ${arrowHead}
  ${entryDot}
</svg>`.trim();

    return svg;
  }

  // ── ICT Grid Cells ──────────────────────────────────────────────────────

  function buildICTGrid(result) {
    const { structure, liquidity, fvg, premDisc } = result;

    const colorize = (text) => {
      return text
        .replace(/(Bullisch|bullisch|Long|↑|gesweept ✓)/g, '<span class="bull">$1</span>')
        .replace(/(Bärisch|bärisch|Short|↓)/g, '<span class="bear">$1</span>')
        .replace(/(Premium)/g, '<span class="bear">$1</span>')
        .replace(/(Discount)/g, '<span class="bull">$1</span>')
        .replace(/(FVG)/g, '<span class="accent">$1</span>')
        .replace(/\n/g, '<br>');
    };

    const cells = [
      { num: '①', title: 'Struktur', value: structure.label },
      { num: '②', title: 'Liquidität', value: liquidity.label },
      { num: '③', title: 'FVG', value: fvg.label },
      { num: '④', title: 'Premium / Discount', value: premDisc.label },
    ];

    return cells.map(cell => `
      <div class="ict-cell">
        <div class="ict-cell__header">
          <span class="ict-num">${cell.num}</span>
          <span class="ict-title">${cell.title}</span>
        </div>
        <div class="ict-value">${colorize(cell.value)}</div>
      </div>
    `).join('');
  }

  // ── Main Render Function ────────────────────────────────────────────────

  /**
   * Generate the full trade card HTML.
   * @param {object} result - from ICTAnalyzer.analyze()
   * @returns {string} HTML string
   */
  function render(result) {
    const { symbol, capital, trade } = result;
    const { direction, entry, sl, tp, rr, lot, tpPnl, slPnl, riskPct, rewardPct } = trade;

    const isLong = direction === 'long';
    const cfg           = (typeof INSTRUMENTS !== 'undefined' && INSTRUMENTS[symbol]) || {};
    const displaySymbol = symbol;
    const tagSymbol     = cfg.tag || (symbol + ' · M1');

    const dirClass   = isLong ? 'long'  : 'short';
    const dirLabel   = isLong ? '↑ Long' : '↓ Short';
    const dirIcon    = isLong ? '▲' : '▼';

    // Capital outcomes
    const capitalWin  = capital + tpPnl;
    const capitalLoss = capital - slPnl;

    // RR bar: risk% on left, reward% on right
    const totalPct  = riskPct + rewardPct;
    const riskWidth = totalPct > 0 ? ((riskPct   / totalPct) * 100).toFixed(1) : '50';
    const rewWidth  = totalPct > 0 ? ((rewardPct / totalPct) * 100).toFixed(1) : '50';

    // Points
    const tpPts = Math.abs(tp - entry).toFixed(2);
    const slPts = Math.abs(entry - sl).toFixed(2);

    const svgChart = buildSVGChart(result);
    const ictGrid  = buildICTGrid(result);

    return `
<div class="trade-card">

  <!-- ① Header -->
  <div class="card-header">
    <div class="card-header__left">
      <span class="card-mini-tag">${tagSymbol}</span>
      <div class="card-symbol-row">
        <span class="card-symbol">${displaySymbol}</span>
        <span class="direction-pill ${dirClass}">${dirLabel}</span>
      </div>
    </div>
    <div class="card-header__right">
      <span class="lot-value">${fmtLot(lot)}</span>
      <span class="lot-label">Lot · Risiko 10%</span>
    </div>
  </div>

  <!-- ② ICT Analysis Grid -->
  <div class="ict-grid">
    ${ictGrid}
  </div>

  <!-- ③ Mini SVG Chart -->
  <div class="card-chart-wrap">
    ${svgChart}
  </div>

  <!-- ④ Outcome Cards -->
  <div class="outcome-row">
    <div class="outcome-card tp">
      <div class="outcome-label">▲ Take Profit</div>
      <div class="outcome-amount">+${fmtMoney(tpPnl)} $</div>
      <div class="outcome-pts">+${tpPts} Pts</div>
    </div>
    <div class="outcome-card sl">
      <div class="outcome-label">▼ Stop Loss</div>
      <div class="outcome-amount">−${fmtMoney(slPnl)} $</div>
      <div class="outcome-pts">−${slPts} Pts</div>
    </div>
  </div>

  <!-- ⑤ RR Bar -->
  <div class="rr-section">
    <div class="rr-labels">
      <span class="rr-label-risk">Risiko ${riskPct}%</span>
      <span class="rr-label-center">RR 1 : ${fmtRR(rr)}</span>
      <span class="rr-label-reward">Gewinn ${rewardPct}%</span>
    </div>
    <div class="rr-bar-track">
      <div class="rr-bar-risk"   style="width:${riskWidth}%"></div>
      <div class="rr-bar-reward" style="width:${rewWidth}%"></div>
    </div>
  </div>

  <!-- ⑥ Capital Footer -->
  <div class="card-footer">
    <span class="footer-label">Kapital</span>
    <span class="footer-capital">${fmtMoney(capital)} $</span>
    <span class="footer-arrow">→</span>
    <span class="footer-win">${fmtMoney(capitalWin)} $</span>
    <span class="footer-sep">·</span>
    <span class="footer-loss">${fmtMoney(capitalLoss)} $</span>
  </div>

</div>`.trim();
  }

  return { render };
})();
