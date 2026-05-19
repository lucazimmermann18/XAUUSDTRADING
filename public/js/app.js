/**
 * app.js
 * Main application controller. Wires together all modules:
 * ChartManager, WSClient, ICTAnalyzer, TradeCard.
 */

'use strict';

(async function () {

  // ── DOM References ────────────────────────────────────────────────────────
  const analyseBtn    = document.getElementById('analyse-btn');
  const capitalInput  = document.getElementById('capital-input');
  const statusBadge   = document.getElementById('status-badge');
  const statusText    = document.getElementById('status-text');
  const chartLoading  = document.getElementById('chart-loading');
  const cardOutput    = document.getElementById('card-output');
  const cardPlaceholder = document.getElementById('card-placeholder');
  const currentPriceEl = document.getElementById('current-price');
  const liveDot       = document.getElementById('live-dot');
  const btnGold       = document.getElementById('btn-gold');
  const btnBtc        = document.getElementById('btn-btc');

  // ── State ─────────────────────────────────────────────────────────────────
  let currentSymbol   = 'XAUUSD';
  let lastPrice       = null;
  let isAnalysing     = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function setStatus(state, text) {
    statusBadge.className = `status-badge ${state}`;
    statusText.textContent = text;
  }

  function showChartLoading(visible) {
    chartLoading.classList.toggle('hidden', !visible);
  }

  function updatePriceDisplay(price, prev) {
    if (!price) return;
    currentPriceEl.textContent = formatPrice(price, currentSymbol);
    if (prev !== null) {
      currentPriceEl.className = `current-price ${price > prev ? 'up' : price < prev ? 'down' : ''}`;
    }
  }

  function formatPrice(price, symbol) {
    if (!price) return '–';
    if (symbol === 'BTCUSD') return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Chart Initialization ──────────────────────────────────────────────────

  ChartManager.init('chart-container');

  // ── Load candles for a symbol ─────────────────────────────────────────────

  async function loadSymbol(symbol) {
    showChartLoading(true);
    setStatus('loading', `${symbol} · Daten laden…`);

    try {
      const candles = await ChartManager.loadCandles(symbol);
      showChartLoading(false);
      setStatus('ready', `M1 · ${candles.length} Kerzen geladen`);

      // Fetch current price separately for topbar
      try {
        const res = await fetch(`/api/price?symbol=${symbol}`);
        const json = await res.json();
        if (json.success && json.price) {
          const prev = lastPrice;
          lastPrice = json.price;
          updatePriceDisplay(json.price, prev);
        }
      } catch (e) {
        // non-critical
      }

    } catch (err) {
      showChartLoading(false);
      setStatus('error', `Fehler: ${err.message.slice(0, 50)}`);
      console.error('[App] loadSymbol error:', err);
    }
  }

  // ── Instrument Selector ───────────────────────────────────────────────────

  function switchInstrument(symbol) {
    if (symbol === currentSymbol) return;

    const prevSymbol = currentSymbol;
    currentSymbol = symbol;

    // Update button states
    document.querySelectorAll('.inst-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.symbol === symbol);
    });

    // Reset analysis card
    cardOutput.innerHTML = `<div class="card-placeholder" id="card-placeholder">
      <div class="placeholder-icon">◈</div>
      <p>Klicke auf <strong>Analysieren</strong> um eine ICT-Analyse zu starten</p>
    </div>`;

    // Reset price display
    currentPriceEl.textContent = '–';
    currentPriceEl.className = 'current-price';
    lastPrice = null;

    // Switch WS subscription
    WSClient.switchSymbol(symbol, prevSymbol);

    // Load new candles
    loadSymbol(symbol);
  }

  btnGold.addEventListener('click', () => switchInstrument('XAUUSD'));
  btnBtc.addEventListener('click',  () => switchInstrument('BTCUSD'));

  // ── WebSocket Events ──────────────────────────────────────────────────────

  window.addEventListener('ws:connected', () => {
    liveDot.classList.add('connected');
    WSClient.subscribe(currentSymbol);
  });

  window.addEventListener('ws:disconnected', () => {
    liveDot.classList.remove('connected');
  });

  window.addEventListener('ws:tick', (event) => {
    const { symbol, price, timestamp } = event.detail;

    if (symbol !== currentSymbol) return;

    const prev = lastPrice;
    lastPrice = price;

    // Update topbar price
    updatePriceDisplay(price, prev);

    // Update chart
    ChartManager.handleTick(symbol, price, timestamp);
  });

  // ── Analyse Button ────────────────────────────────────────────────────────

  analyseBtn.addEventListener('click', async () => {
    if (isAnalysing) return;

    const candles = ChartManager.getCandles();
    if (!candles || candles.length < 20) {
      setStatus('error', 'Nicht genug Daten für Analyse');
      return;
    }

    const capital = parseFloat(capitalInput.value) || 1000;
    if (capital < 50) {
      capitalInput.focus();
      return;
    }

    isAnalysing = true;
    analyseBtn.disabled = true;
    analyseBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block"></span> Analysiere…';

    setStatus('loading', 'ICT-Analyse läuft…');

    // Small delay for UX
    await new Promise(r => setTimeout(r, 300));

    try {
      const result = ICTAnalyzer.analyze(candles, currentSymbol, capital);

      // Draw level lines on chart
      ChartManager.drawLevelLines(result.trade);

      // Generate trade card
      const cardHTML = TradeCard.render(result);

      // Inject into output area
      cardOutput.innerHTML = cardHTML;
      cardOutput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const { rr, direction } = result.trade;
      const dir = direction === 'long' ? '↑ Long' : '↓ Short';
      setStatus('ready', `${dir} · RR 1:${rr.toFixed(2)} · Analyse abgeschlossen`);

    } catch (err) {
      console.error('[App] Analysis error:', err);
      cardOutput.innerHTML = `
        <div class="card-placeholder">
          <div class="placeholder-icon" style="color:var(--bear)">⚠</div>
          <p><strong>Analyse-Fehler</strong><br>${err.message}</p>
        </div>`;
      setStatus('error', `Fehler: ${err.message.slice(0, 50)}`);
    } finally {
      isAnalysing = false;
      analyseBtn.disabled = false;
      analyseBtn.innerHTML = '<span class="analyse-icon">⚡</span> Analysieren';
    }
  });

  // ── Keyboard Shortcut ─────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter or Cmd+Enter = Analyse
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      analyseBtn.click();
    }
  });

  // ── Initial Load ──────────────────────────────────────────────────────────
  await loadSymbol(currentSymbol);

  // Subscribe to WS (will also trigger on ws:connected)
  WSClient.subscribe(currentSymbol);

  console.log('[App] ICT Sniper ready ✓');

})();
