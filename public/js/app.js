'use strict';

(async function () {

  // ── DOM References ────────────────────────────────────────────────────────
  const analyseBtn       = document.getElementById('analyse-btn');
  const capitalInput     = document.getElementById('capital-input');
  const statusBadge      = document.getElementById('status-badge');
  const statusText       = document.getElementById('status-text');
  const chartLoading     = document.getElementById('chart-loading');
  const cardOutput       = document.getElementById('card-output');
  const currentPriceEl   = document.getElementById('current-price');
  const liveDot          = document.getElementById('live-dot');
  const categoriesEl     = document.getElementById('inst-categories');
  const chipsBarEl       = document.getElementById('inst-chips-bar');
  const aiPanelContainer = document.getElementById('ai-panel-container');

  // ── Only Gold and Bitcoin are active in the trading UI ───────────────────
  const ACTIVE_SYMBOLS = ['XAUUSD', 'BTCUSD'];

  // ── State ─────────────────────────────────────────────────────────────────
  let currentSymbol = 'XAUUSD';
  let lastPrice     = null;
  let isAnalysing   = false;

  // ── Apply accent color from instrument config ─────────────────────────────
  function applyAccent(symbol) {
    const cfg = INSTRUMENTS[symbol];
    if (!cfg) return;
    const root = document.documentElement;
    root.style.setProperty('--accent',      cfg.accent);
    root.style.setProperty('--accent-dim',  cfg.accent + '22');
    root.style.setProperty('--accent-glow', cfg.accent + '55');
  }

  // ── Build flat instrument selector (Gold + Bitcoin only) ──────────────────
  function buildInstrumentSelector() {
    if (categoriesEl) categoriesEl.style.display = 'none';

    chipsBarEl.innerHTML = ACTIVE_SYMBOLS.map(sym => {
      const cfg      = INSTRUMENTS[sym];
      const isActive = sym === currentSymbol;
      return `
        <button class="inst-chip${isActive ? ' active' : ''}" data-symbol="${sym}"
                style="${isActive ? `--accent:${cfg.accent};--accent-dim:${cfg.accent}22;--accent-glow:${cfg.accent}55;` : ''}">
          <span class="inst-chip__icon">${cfg.icon}</span>
          ${cfg.name}
        </button>
      `;
    }).join('');

    chipsBarEl.querySelectorAll('.inst-chip').forEach(btn => {
      btn.addEventListener('click', () => switchInstrument(btn.dataset.symbol));
    });
  }

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
    const cfg      = INSTRUMENTS[currentSymbol];
    const decimals = cfg ? cfg.decimals : 2;
    currentPriceEl.textContent = price.toFixed(Math.min(decimals, 5));
    if (prev !== null) {
      currentPriceEl.className = `current-price ${price > prev ? 'up' : price < prev ? 'down' : ''}`;
    }
  }

  // ── Load candles for a symbol ─────────────────────────────────────────────
  async function loadSymbol(symbol) {
    showChartLoading(true);
    setStatus('loading', `${symbol} · Daten laden…`);

    try {
      const candles = await ChartManager.loadCandles(symbol);
      showChartLoading(false);
      setStatus('ready', `M1 · ${candles.length} Kerzen geladen`);

      try {
        const res  = await fetch(`/api/price?symbol=${symbol}`);
        const json = await res.json();
        if (json.success && json.price) {
          const prev = lastPrice;
          lastPrice  = json.price;
          updatePriceDisplay(json.price, prev);
        }
      } catch (_) { /* non-critical */ }

    } catch (err) {
      showChartLoading(false);
      ChartManager.clearLevelLines();
      currentPriceEl.textContent = '–';
      setStatus('error', `${symbol} · Nicht verfügbar im Free Plan`);
      cardOutput.innerHTML = `<div class="card-placeholder">
        <div class="placeholder-icon" style="color:var(--bear)">⚠</div>
        <p><strong>${symbol} nicht verfügbar</strong><br>Kein Datenfeed über TwelveData Free Plan.</p>
      </div>`;
    }
  }

  // ── Switch Instrument ─────────────────────────────────────────────────────
  function switchInstrument(symbol) {
    if (symbol === currentSymbol || !ACTIVE_SYMBOLS.includes(symbol)) return;

    const prevSymbol = currentSymbol;
    currentSymbol    = symbol;

    buildInstrumentSelector();
    applyAccent(symbol);

    cardOutput.innerHTML = `<div class="card-placeholder">
      <div class="placeholder-icon">◈</div>
      <p>Klicke auf <strong>Analysieren</strong> um eine ICT-Analyse zu starten</p>
    </div>`;
    aiPanelContainer.innerHTML = '';

    currentPriceEl.textContent = '–';
    currentPriceEl.className   = 'current-price';
    lastPrice = null;

    WSClient.switchSymbol(symbol, prevSymbol);
    TradeMonitor.resubscribeAll();
    loadSymbol(symbol);
  }

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
    lastPrice  = price;
    updatePriceDisplay(price, prev);
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
    if (capital < 50) { capitalInput.focus(); return; }

    isAnalysing = true;
    analyseBtn.disabled = true;
    analyseBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block"></span> Analysiere…';

    setStatus('loading', 'Claude & GPT-4o analysieren unabhängig voneinander…');
    aiPanelContainer.innerHTML = '';
    cardOutput.innerHTML = `<div class="card-placeholder">
      <div class="placeholder-icon">◈</div>
      <p>Dual-KI analysiert — bitte warten…</p>
    </div>`;

    await new Promise(r => setTimeout(r, 100));

    try {
      const screenshot = ChartManager.takeScreenshot();
      const apiRes = await fetch('/api/dual-analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          image:        screenshot,
          symbol:       currentSymbol,
          capital,
          currentPrice: lastPrice || candles[candles.length - 1]?.close,
          candles:      candles.slice(-200),
        }),
      });

      const json = await apiRes.json();
      if (!json.success) throw new Error(json.error || 'Dual-Analyse Fehler');

      const { agentA, agentB, agreement } = json;

      setStatus('loading', agreement
        ? 'Übereinstimmung — Vermittler bestätigt…'
        : 'Kein Trade — Watch-Zones werden generiert…');

      DualValidatorUI.start(aiPanelContainer, {
        agentA,
        agentB,
        agreement,
        symbol:  currentSymbol,
        capital,
        candles,
        onPassed: ({ tradeId, result }) => {
          const dir = result.trade.direction === 'long' ? '↑ Long' : '↓ Short';
          ChartManager.drawLevelLines(result.trade);
          cardOutput.innerHTML = TradeCard.render(result);
          cardOutput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (tradeId) showJournalToast(tradeId);
          TradeMonitor.onNewTrade(result.symbol);
          setStatus('ready', `${dir} · RR 1:${result.trade.rr.toFixed(2)} · ✅ Dual-KI bestätigt`);
        },
        onNoTrade: () => {
          cardOutput.innerHTML = `<div class="card-placeholder">
            <div class="placeholder-icon" style="color:var(--warn)">⚠</div>
            <p><strong>Kein Trade · Watch-Zones aktiv</strong><br>
            Beide KIs konnten kein sauberes Setup bestätigen.<br>
            Sieh die Watch-Zones im Analyse-Panel.</p>
          </div>`;
          setStatus('ready', '⚠ No Trade · Watch-Zones · Warte auf bessere Zone');
        },
      });

    } catch (err) {
      console.error('[App] Dual-Analyse Fehler:', err);
      cardOutput.innerHTML = `<div class="card-placeholder">
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      analyseBtn.click();
    }
  });

  // ── Journal Toast ─────────────────────────────────────────────────────────
  function showJournalToast(tradeId) {
    const existing = document.getElementById('journal-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'journal-toast';
    toast.className = 'journal-toast';
    toast.innerHTML = `
      <span>✓ Trade gespeichert</span>
      <a href="/journal" class="toast-link">Journal →</a>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  ChartManager.init('chart-container');
  applyAccent(currentSymbol);
  buildInstrumentSelector();

  await loadSymbol(currentSymbol);
  WSClient.subscribe(currentSymbol);
  TradeMonitor.init();

  console.log('[App] ICT Sniper ready ✓ — Gold & Bitcoin aktiv');

})();
