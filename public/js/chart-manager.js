/**
 * chart-manager.js
 * Manages the lightweight-charts candlestick chart, data loading,
 * live WebSocket updates, and drawing ICT level lines.
 */

'use strict';

const ChartManager = (() => {

  let chart        = null;
  let candleSeries = null;
  let volumeSeries = null;

  // Level lines for ICT markers
  let entryLine = null;
  let slLine    = null;
  let tpLine    = null;

  // Current state
  let currentSymbol  = 'XAUUSD';
  let currentCandles = [];
  let lastCandleTime = 0;

  // ── Init ─────────────────────────────────────────────────────────────────

  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('[ChartManager] Container not found:', containerId);
      return;
    }

    chart = LightweightCharts.createChart(container, {
      width:  container.clientWidth,
      height: container.clientHeight || 400,
      layout: {
        background: { color: '#0A0F1C' },
        textColor:  '#94A3B8',
        fontSize:   12,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines:  { color: 'rgba(148,163,184,0.05)' },
        horzLines:  { color: 'rgba(148,163,184,0.05)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color:     'rgba(91,141,239,0.4)',
          labelBackgroundColor: '#1a2540',
        },
        horzLine: {
          color:     'rgba(91,141,239,0.4)',
          labelBackgroundColor: '#1a2540',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(148,163,184,0.08)',
        textColor:   '#94A3B8',
      },
      timeScale: {
        borderColor:     'rgba(148,163,184,0.08)',
        textColor:       '#94A3B8',
        timeVisible:     true,
        secondsVisible:  false,
        rightOffset:     10,
        fixLeftEdge:     false,
        fixRightEdge:    false,
      },
      handleScale:  { axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    candleSeries = chart.addCandlestickSeries({
      upColor:          '#22C55E',
      downColor:        '#EF4444',
      borderUpColor:    '#22C55E',
      borderDownColor:  '#EF4444',
      wickUpColor:      '#22C55E',
      wickDownColor:    '#EF4444',
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height: height || 400 });
      }
    });
    resizeObserver.observe(container);

    console.log('[ChartManager] Initialized');
  }

  // ── Data Loading ─────────────────────────────────────────────────────────

  async function loadCandles(symbol) {
    currentSymbol = symbol;
    try {
      const res = await fetch(`/api/candles?symbol=${symbol}&interval=1min&outputsize=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.candles || json.candles.length === 0) {
        throw new Error(json.error || 'Kein Datenfeed für dieses Symbol (Free Plan)');
      }

      currentCandles = json.candles;

      // Set data
      candleSeries.setData(currentCandles);

      // Track last candle time for live updates
      lastCandleTime = currentCandles[currentCandles.length - 1].time;

      // Fit to content, leave some right space
      chart.timeScale().fitContent();

      console.log(`[ChartManager] Loaded ${currentCandles.length} candles for ${symbol}`);
      return currentCandles;
    } catch (err) {
      console.error('[ChartManager] loadCandles error:', err);
      throw err;
    }
  }

  // ── Live Price Updates ────────────────────────────────────────────────────

  /**
   * Handle an incoming price tick and update the last candle.
   * @param {string} symbol
   * @param {number} price
   * @param {number} timestamp - unix timestamp in seconds
   */
  function handleTick(symbol, price, timestamp) {
    if (symbol.toUpperCase() !== currentSymbol) return;
    if (!candleSeries || currentCandles.length === 0) return;

    // TwelveData WebSocket gives a price event every second.
    // We update the "current" 1-minute candle by updating close price.
    const tickTime = timestamp ? Math.floor(timestamp) : Math.floor(Date.now() / 1000);

    // Determine the candle minute boundary
    const candleTime = tickTime - (tickTime % 60);

    const lastCandle = currentCandles[currentCandles.length - 1];

    if (candleTime > lastCandle.time) {
      // New candle has started
      const newCandle = {
        time:  candleTime,
        open:  lastCandle.close,
        high:  Math.max(lastCandle.close, price),
        low:   Math.min(lastCandle.close, price),
        close: price,
      };
      currentCandles.push(newCandle);
      lastCandleTime = candleTime;
      candleSeries.update(newCandle);
    } else {
      // Update existing last candle
      const updatedCandle = {
        time:  lastCandle.time,
        open:  lastCandle.open,
        high:  Math.max(lastCandle.high, price),
        low:   Math.min(lastCandle.low, price),
        close: price,
      };
      currentCandles[currentCandles.length - 1] = updatedCandle;
      candleSeries.update(updatedCandle);
    }
  }

  // ── ICT Level Lines ───────────────────────────────────────────────────────

  /**
   * Draw horizontal price lines for Entry, SL, and TP.
   * @param {object} trade - { entry, sl, tp, direction }
   */
  function drawLevelLines(trade) {
    clearLevelLines();

    const { entry, sl, tp, direction } = trade;

    entryLine = candleSeries.createPriceLine({
      price:       entry,
      color:       'rgba(91,141,239,0.9)',
      lineWidth:   2,
      lineStyle:   LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title:       '● Entry',
    });

    slLine = candleSeries.createPriceLine({
      price:       sl,
      color:       'rgba(239,68,68,0.9)',
      lineWidth:   2,
      lineStyle:   LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title:       '✕ SL',
    });

    tpLine = candleSeries.createPriceLine({
      price:       tp,
      color:       'rgba(34,197,94,0.9)',
      lineWidth:   2,
      lineStyle:   LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title:       '★ TP',
    });

    console.log('[ChartManager] Drew level lines: Entry', entry, 'SL', sl, 'TP', tp);
  }

  function clearLevelLines() {
    if (entryLine) { try { candleSeries.removePriceLine(entryLine); } catch(e){} entryLine = null; }
    if (slLine)    { try { candleSeries.removePriceLine(slLine);    } catch(e){} slLine    = null; }
    if (tpLine)    { try { candleSeries.removePriceLine(tpLine);    } catch(e){} tpLine    = null; }
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  function getCandles()      { return currentCandles; }
  function getCurrentSymbol(){ return currentSymbol;  }

  /** Returns base64 PNG of the current chart (no data: prefix). */
  function takeScreenshot() {
    if (!chart) throw new Error('Chart not initialized');
    const canvas = chart.takeScreenshot();
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  }

  return {
    init,
    loadCandles,
    handleTick,
    drawLevelLines,
    clearLevelLines,
    getCandles,
    getCurrentSymbol,
    takeScreenshot,
  };
})();
