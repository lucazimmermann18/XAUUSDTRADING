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

  // ── State ─────────────────────────────────────────────────────────────────
  let currentSymbol    = 'XAUUSD';
  let currentCategory  = 'Rohstoffe';
  let lastPrice        = null;
  let isAnalysing      = false;

  // ── Apply accent color from instrument config ─────────────────────────────
  function applyAccent(symbol) {
    const cfg = INSTRUMENTS[symbol];
    if (!cfg) return;
    const root = document.documentElement;
    root.style.setProperty('--accent',     cfg.accent);
    root.style.setProperty('--accent-dim', cfg.accent + '22');
    root.style.setProperty('--accent-glow',cfg.accent + '55');
  }

  // ── Build instrument selector UI ──────────────────────────────────────────
  function buildCategoryTabs() {
    categoriesEl.innerHTML = INSTRUMENT_GROUPS.map(group => `
      <button class="inst-cat-btn${group === currentCategory ? ' active' : ''}" data-group="${group}">
        ${group}
      </button>
    `).join('');

    categoriesEl.querySelectorAll('.inst-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => switchCategory(btn.dataset.group));
    });
  }

  function buildChips(group) {
    const symbols = Object.keys(INSTRUMENTS).filter(s => INSTRUMENTS[s].group === group);
    chipsBarEl.innerHTML = symbols.map(sym => {
      const cfg = INSTRUMENTS[sym];
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

  function switchCategory(group) {
    currentCategory = group;

    // Update category tab active state
    categoriesEl.querySelectorAll('.inst-cat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.group === group);
    });

    // If current symbol is not in this group, switch to first symbol of group
    const cfg = INSTRUMENTS[currentSymbol];
    if (!cfg || cfg.group !== group) {
      const first = Object.keys(INSTRUMENTS).find(s => INSTRUMENTS[s].group === group);
      if (first) switchInstrument(first);
      else buildChips(group);
    } else {
      buildChips(group);
    }
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
    const cfg = INSTRUMENTS[currentSymbol];
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
          lastPrice = json.price;
          updatePriceDisplay(json.price, prev);
        }
      } catch (_) { /* non-critical */ }

    } catch (err) {
      showChartLoading(false);
      setStatus('error', `Fehler: ${err.message.slice(0, 50)}`);
      console.error('[App] loadSymbol error:', err);
    }
  }

  // ── Switch Instrument ─────────────────────────────────────────────────────
  function switchInstrument(symbol) {
    if (symbol === currentSymbol) return;

    const prevSymbol = currentSymbol;
    currentSymbol = symbol;

    // Update category if necessary
    const cfg = INSTRUMENTS[symbol];
    if (cfg && cfg.group !== currentCategory) {
      currentCategory = cfg.group;
      categoriesEl.querySelectorAll('.inst-cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.group === currentCategory);
      });
    }

    // Rebuild chips for current category
    buildChips(currentCategory);

    // Apply instrument accent color
    applyAccent(symbol);

    // Reset analysis card and AI panel
    cardOutput.innerHTML = `<div class="card-placeholder">
      <div class="placeholder-icon">◈</div>
      <p>Klicke auf <strong>Analysieren</strong> um eine ICT-Analyse zu starten</p>
    </div>`;
    aiPanelContainer.innerHTML = '';

    // Reset price display
    currentPriceEl.textContent = '–';
    currentPriceEl.className = 'current-price';
    lastPrice = null;

    // Switch WS subscription
    WSClient.switchSymbol(symbol, prevSymbol);

    // Load new candles
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
    lastPrice = price;
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

    setStatus('loading', 'ICT-Analyse läuft…');
    await new Promise(r => setTimeout(r, 300));

    try {
      const result  = ICTAnalyzer.analyze(candles, currentSymbol, capital);
      ChartManager.drawLevelLines(result.trade);
      const cardHTML = TradeCard.render(result);
      cardOutput.innerHTML = cardHTML;

      // Auto-save to journal
      const tradeId = JournalStore.add(result);
      showJournalToast(tradeId);

      // Inject AI commentary panel below trade card
      aiPanelContainer.innerHTML = AICommentator.renderPanel();
      AICommentator.setAnalysisResult(result);
      AICommentator.bindEvents();

      cardOutput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const dir = result.trade.direction === 'long' ? '↑ Long' : '↓ Short';
      setStatus('ready', `${dir} · RR 1:${result.trade.rr.toFixed(2)} · Analyse abgeschlossen`);

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

    // Animate in
    requestAnimationFrame(() => toast.classList.add('visible'));

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  ChartManager.init('chart-container');
  applyAccent(currentSymbol);
  buildCategoryTabs();
  buildChips(currentCategory);

  await loadSymbol(currentSymbol);
  WSClient.subscribe(currentSymbol);

  console.log('[App] ICT Sniper ready ✓ — 17 Märkte aktiv');

})();
