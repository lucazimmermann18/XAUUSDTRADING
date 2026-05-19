/**
 * ict-analyzer.js
 * ICT (Inner Circle Trader) analysis engine for XAUUSD / BTCUSD M1 charts.
 * Analyzes 200 M1 candles and produces trade signals with full context.
 */

'use strict';

const ICTAnalyzer = (() => {

  // ── Swing Detection ──────────────────────────────────────────────────────

  /**
   * Find swing highs: a candle is a swing high if its high is greater than
   * the 2 candles before AND the 2 candles after.
   * Returns array of { index, price, time }
   */
  function findSwingHighs(candles, lookback = 2) {
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const c = candles[i];
      let isHigh = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) { isHigh = false; break; }
      }
      if (isHigh) swings.push({ index: i, price: c.high, time: c.time });
    }
    return swings;
  }

  /**
   * Find swing lows: a candle is a swing low if its low is less than
   * the 2 candles before AND the 2 candles after.
   */
  function findSwingLows(candles, lookback = 2) {
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const c = candles[i];
      let isLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].low <= c.low) { isLow = false; break; }
      }
      if (isLow) swings.push({ index: i, price: c.low, time: c.time });
    }
    return swings;
  }

  // ── Structure Analysis ───────────────────────────────────────────────────

  function analyzeStructure(candles) {
    const highs = findSwingHighs(candles);
    const lows  = findSwingLows(candles);

    if (highs.length < 2 || lows.length < 2) {
      return {
        trend: 'neutral',
        label: 'Neutral · Keine klare Struktur',
        swingHighs: highs,
        swingLows: lows,
        lastSwingHigh: highs[highs.length - 1] || null,
        lastSwingLow:  lows[lows.length - 1]  || null,
      };
    }

    // Take last 3 swing highs and lows
    const recentHighs = highs.slice(-3);
    const recentLows  = lows.slice(-3);

    // HH = Higher High, HL = Higher Low → Bullish
    // LH = Lower High,  LL = Lower Low  → Bearish
    const hhCount = countSequence(recentHighs.map(s => s.price), 'increasing');
    const hlCount = countSequence(recentLows.map(s => s.price),  'increasing');
    const lhCount = countSequence(recentHighs.map(s => s.price), 'decreasing');
    const llCount = countSequence(recentLows.map(s => s.price),  'decreasing');

    let trend = 'neutral';
    let label = 'Neutral · Konsolidierung';

    if (hhCount >= 1 && hlCount >= 1) {
      trend = 'bullish';
      label = 'Bullisch · HH+HL bestätigt';
    } else if (lhCount >= 1 && llCount >= 1) {
      trend = 'bearish';
      label = 'Bärisch · LH+LL bestätigt';
    } else if (hhCount >= 1) {
      trend = 'bullish';
      label = 'Bullisch · HH erkannt';
    } else if (llCount >= 1) {
      trend = 'bearish';
      label = 'Bärisch · LL erkannt';
    }

    return {
      trend,
      label,
      swingHighs: highs,
      swingLows: lows,
      lastSwingHigh: highs[highs.length - 1],
      lastSwingLow:  lows[lows.length - 1],
      recentHighs,
      recentLows,
    };
  }

  function countSequence(prices, direction) {
    if (prices.length < 2) return 0;
    let count = 0;
    for (let i = 1; i < prices.length; i++) {
      if (direction === 'increasing' && prices[i] > prices[i - 1]) count++;
      if (direction === 'decreasing' && prices[i] < prices[i - 1]) count++;
    }
    return count;
  }

  // ── Liquidity Analysis ───────────────────────────────────────────────────

  function analyzeLiquidity(candles, swingHighs, swingLows) {
    const recent = candles.slice(-20); // last 20 candles = "recent"
    const currentPrice = candles[candles.length - 1].close;

    // BSL = Buy Side Liquidity = recent swing highs (price needs to sweep above)
    // SSL = Sell Side Liquidity = recent swing lows (price needs to sweep below)

    // Focus on last 5 swing highs / lows as relevant liquidity
    const bslLevels = swingHighs.slice(-5).map(s => s.price).filter(p => p > currentPrice);
    const sslLevels = swingLows.slice(-5).map(p => p.price).filter(p => p < currentPrice);

    // Nearest BSL above current price
    const nearestBSL = bslLevels.length > 0 ? Math.min(...bslLevels) : null;
    // Nearest SSL below current price
    const nearestSSL = sslLevels.length > 0 ? Math.max(...sslLevels) : null;

    // Check if BSL was swept in recent candles (price went above it)
    let bslSwept = false;
    let bslSweptLevel = null;
    const bslAboveLevels = swingHighs.slice(-8).map(s => s.price);
    for (const level of bslAboveLevels) {
      for (const c of recent) {
        if (c.high > level) {
          bslSwept = true;
          bslSweptLevel = level;
          break;
        }
      }
      if (bslSwept) break;
    }

    // Check if SSL was swept in recent candles
    let sslSwept = false;
    let sslSweptLevel = null;
    const sslBelowLevels = swingLows.slice(-8).map(s => s.price);
    for (const level of sslBelowLevels) {
      for (const c of recent) {
        if (c.low < level) {
          sslSwept = true;
          sslSweptLevel = level;
          break;
        }
      }
      if (sslSwept) break;
    }

    let label = '';
    let bslLabel = '';
    let sslLabel = '';

    if (nearestBSL) {
      bslLabel = bslSwept
        ? `BSL bei ${fmt(nearestBSL)} gesweept ✓`
        : `BSL bei ${fmt(nearestBSL)} noch offen`;
    }
    if (nearestSSL) {
      sslLabel = sslSwept
        ? `SSL bei ${fmt(nearestSSL)} gesweept ✓`
        : `SSL bei ${fmt(nearestSSL)} noch offen`;
    }

    if (bslLabel && sslLabel) label = bslLabel + '\n' + sslLabel;
    else if (bslLabel) label = bslLabel;
    else if (sslLabel) label = sslLabel;
    else label = 'Keine klare Liquidität erkannt';

    return {
      label,
      nearestBSL,
      nearestSSL,
      bslSwept,
      sslSwept,
      bslSweptLevel,
      sslSweptLevel,
      bslLevels,
      sslLevels,
    };
  }

  // ── FVG Detection ────────────────────────────────────────────────────────

  function analyzeFVG(candles) {
    const lookback = Math.min(50, candles.length - 2);
    const startIdx = candles.length - lookback;
    const currentPrice = candles[candles.length - 1].close;

    const fvgs = [];

    for (let i = startIdx + 2; i < candles.length; i++) {
      const c0 = candles[i - 2];
      const c1 = candles[i - 1]; // middle candle (not needed for gap check)
      const c2 = candles[i];

      // Bullish FVG: gap between c0.high and c2.low (c0.high < c2.low)
      if (c0.high < c2.low) {
        const gapTop    = c2.low;
        const gapBottom = c0.high;
        const midpoint  = (gapTop + gapBottom) / 2;

        // Check if mitigated: has price returned into the gap?
        let mitigated = false;
        for (let k = i + 1; k < candles.length; k++) {
          if (candles[k].low <= gapTop && candles[k].high >= gapBottom) {
            mitigated = true;
            break;
          }
        }
        fvgs.push({ type: 'bullish', top: gapTop, bottom: gapBottom, midpoint, index: i, time: c2.time, mitigated });
      }

      // Bearish FVG: gap between c0.low and c2.high (c0.low > c2.high)
      if (c0.low > c2.high) {
        const gapTop    = c0.low;
        const gapBottom = c2.high;
        const midpoint  = (gapTop + gapBottom) / 2;

        let mitigated = false;
        for (let k = i + 1; k < candles.length; k++) {
          if (candles[k].low <= gapTop && candles[k].high >= gapBottom) {
            mitigated = true;
            break;
          }
        }
        fvgs.push({ type: 'bearish', top: gapTop, bottom: gapBottom, midpoint, index: i, time: c2.time, mitigated });
      }
    }

    // Get most recent unmitigated FVG
    const unmitigated = fvgs.filter(f => !f.mitigated);
    const mostRecent  = unmitigated.length > 0 ? unmitigated[unmitigated.length - 1] : null;

    let label = 'Kein aktives FVG gefunden';
    if (mostRecent) {
      const dir = mostRecent.type === 'bullish' ? '↑ Bullisch' : '↓ Bärisch';
      label = `${dir} FVG · ${fmt(mostRecent.bottom)}–${fmt(mostRecent.top)}\nNicht mitigiert`;
    }

    return {
      label,
      activeFVG: mostRecent,
      allFVGs: fvgs,
      unmitigated,
    };
  }

  // ── Premium / Discount ───────────────────────────────────────────────────

  function analyzePremiumDiscount(candles, swingHighs, swingLows) {
    if (swingHighs.length === 0 || swingLows.length === 0) {
      return { label: 'Keine Struktur verfügbar', zone: 'unknown', eq: 0, swingHigh: 0, swingLow: 0 };
    }

    // Use last major swing high and swing low from recent candles
    const lastHigh = swingHighs[swingHighs.length - 1];
    const lastLow  = swingLows[swingLows.length - 1];

    const swingHigh = Math.max(lastHigh.price, lastLow.price);
    const swingLow  = Math.min(lastHigh.price, lastLow.price);
    const eq        = (swingHigh + swingLow) / 2;
    const currentPrice = candles[candles.length - 1].close;

    const zone = currentPrice > eq ? 'premium' : 'discount';

    const pct = ((currentPrice - swingLow) / (swingHigh - swingLow) * 100).toFixed(1);

    const label = zone === 'discount'
      ? `Discount · EQ bei ${fmt(eq)}`
      : `Premium · EQ bei ${fmt(eq)}`;

    return { label, zone, eq, swingHigh, swingLow, pct: parseFloat(pct) };
  }

  // ── Trade Calculation ────────────────────────────────────────────────────

  function calculateTrade(candles, structure, liquidity, premDisc, symbol, capital) {
    const currentPrice = candles[candles.length - 1].close;
    const entry = currentPrice;

    // Determine direction
    const isBullish = structure.trend === 'bullish' && premDisc.zone === 'discount';
    const isBearish = structure.trend === 'bearish' && premDisc.zone === 'premium';

    let direction = isBullish ? 'long' : isBearish ? 'short' : (structure.trend === 'bullish' ? 'long' : 'short');

    // Buffer sizes
    const slBuffer = symbol === 'XAUUSD' ? 0.50 : 50;

    let sl, tp;

    if (direction === 'long') {
      // SL: recent swing low minus buffer
      const recentSwingLow = structure.lastSwingLow ? structure.lastSwingLow.price : (entry * 0.995);
      sl = recentSwingLow - slBuffer;

      // TP: target first BSL above that gives RR 1.8–4.0
      const riskPips = entry - sl;
      if (riskPips <= 0) {
        sl = entry * 0.995;
      }

      const bslAbove = liquidity.bslLevels.filter(p => p > entry).sort((a, b) => a - b);
      tp = null;
      for (const bsl of bslAbove) {
        const rr = (bsl - entry) / (entry - sl);
        if (rr >= 1.8 && rr <= 4.0) { tp = bsl; break; }
      }
      if (!tp) tp = entry + (entry - sl) * 2.5; // default 1:2.5

    } else {
      // Short
      const recentSwingHigh = structure.lastSwingHigh ? structure.lastSwingHigh.price : (entry * 1.005);
      sl = recentSwingHigh + slBuffer;

      const riskPips = sl - entry;
      if (riskPips <= 0) {
        sl = entry * 1.005;
      }

      const sslBelow = liquidity.sslLevels.filter(p => p < entry).sort((a, b) => b - a);
      tp = null;
      for (const ssl of sslBelow) {
        const rr = (entry - ssl) / (sl - entry);
        if (rr >= 1.8 && rr <= 4.0) { tp = ssl; break; }
      }
      if (!tp) tp = entry - (sl - entry) * 2.5;
    }

    // Safety clamp
    if (direction === 'long') {
      if (sl >= entry) sl = entry * 0.995;
      if (tp <= entry) tp = entry + (entry - sl) * 2.5;
    } else {
      if (sl <= entry) sl = entry * 1.005;
      if (tp >= entry) tp = entry - (sl - entry) * 2.5;
    }

    const risk   = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr     = reward / risk;

    // Lot sizing
    const contractSize = symbol === 'XAUUSD' ? 100 : 1;
    const lot = Math.round((capital * 0.10) / (risk * contractSize) * 100) / 100;

    // P&L
    const tpPnl = lot * reward * contractSize;
    const slPnl = lot * risk  * contractSize;

    // Percentage
    const riskPct   = ((slPnl / capital) * 100).toFixed(2);
    const rewardPct = ((tpPnl / capital) * 100).toFixed(2);

    return {
      direction,
      entry,
      sl,
      tp,
      rr,
      lot,
      risk,
      reward,
      tpPnl,
      slPnl,
      riskPct: parseFloat(riskPct),
      rewardPct: parseFloat(rewardPct),
      contractSize,
    };
  }

  // ── Main Analyze Function ────────────────────────────────────────────────

  /**
   * Run full ICT analysis on candle data.
   * @param {Array} candles - array of { time, open, high, low, close }
   * @param {string} symbol - 'XAUUSD' or 'BTCUSD'
   * @param {number} capital - trading capital in EUR/USD
   * @returns {object} Full analysis result
   */
  function analyze(candles, symbol, capital) {
    if (!candles || candles.length < 20) {
      throw new Error('Nicht genug Candledaten für die Analyse');
    }

    const structure  = analyzeStructure(candles);
    const liquidity  = analyzeLiquidity(candles, structure.swingHighs, structure.swingLows);
    const fvg        = analyzeFVG(candles);
    const premDisc   = analyzePremiumDiscount(candles, structure.swingHighs, structure.swingLows);
    const trade      = calculateTrade(candles, structure, liquidity, premDisc, symbol, capital);

    return {
      symbol,
      capital,
      candles,
      structure,
      liquidity,
      fvg,
      premDisc,
      trade,
      timestamp: Date.now(),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function fmt(num) {
    if (num === null || num === undefined) return '–';
    // Format price numbers sensibly
    if (num > 10000) return num.toFixed(0);
    if (num > 1000)  return num.toFixed(2);
    return num.toFixed(2);
  }

  return { analyze, findSwingHighs, findSwingLows };
})();
