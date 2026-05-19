'use strict';

/**
 * TradeMonitor — watches every live price tick and auto-closes
 * open journal trades when TP or SL is hit.
 *
 * Depends on: JournalStore, WSClient (both loaded before this file).
 */
const TradeMonitor = (() => {

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getOpenTrades() {
    return JournalStore.getAll().filter(t => t.status === 'open');
  }

  function getMonitoredSymbols() {
    return [...new Set(getOpenTrades().map(t => t.symbol))];
  }

  /** Subscribe to live feed for every symbol that has an open trade. */
  function subscribeAll() {
    getMonitoredSymbols().forEach(s => WSClient.subscribe(s));
  }

  /**
   * Check whether the latest price closes a trade.
   * @returns {'win'|'loss'|null}
   */
  function checkTrade(trade, price) {
    if (trade.direction === 'long') {
      if (price >= trade.tp) return 'win';
      if (price <= trade.sl) return 'loss';
    } else {
      // short
      if (price <= trade.tp) return 'win';
      if (price >= trade.sl) return 'loss';
    }
    return null;
  }

  // ── Tick handler ──────────────────────────────────────────────────────────

  function onTick({ symbol, price }) {
    const sym    = (symbol || '').toUpperCase();
    const trades = getOpenTrades().filter(t => t.symbol === sym);
    if (trades.length === 0) return;

    for (const trade of trades) {
      const outcome = checkTrade(trade, price);
      if (outcome) {
        JournalStore.closeTrade(trade.id, outcome, price);
        showNotification(trade, outcome, price);
      }
    }
  }

  // ── Notification ──────────────────────────────────────────────────────────

  let notifStack = 0; // stack offset for multiple simultaneous notifications

  function showNotification(trade, status, exitPrice) {
    const cfg      = typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS[trade.symbol] : null;
    const accent   = cfg ? cfg.accent : (status === 'win' ? '#22C55E' : '#EF4444');
    const isWin    = status === 'win';
    const pnl      = isWin ? trade.tpPnl : -trade.slPnl;
    const pnlStr   = (pnl >= 0 ? '+' : '') + Math.abs(pnl).toFixed(2);
    const dirArrow = trade.direction === 'long' ? '↑' : '↓';
    const dirLabel = trade.direction === 'long' ? 'Long' : 'Short';
    const dec      = cfg ? cfg.decimals : 2;
    const ep       = parseFloat(exitPrice).toFixed(dec);

    const el = document.createElement('div');
    el.className = `tm-notif ${isWin ? 'win' : 'loss'}`;
    el.style.setProperty('--notif-offset', `${notifStack * 100}px`);
    notifStack++;

    el.innerHTML = `
      <div class="tm-notif__icon">${isWin ? '🎯' : '🛑'}</div>
      <div class="tm-notif__body">
        <div class="tm-notif__title">
          <span class="tm-notif__symbol" style="color:${accent}">${trade.symbol}</span>
          <span class="tm-notif__dir">${dirArrow} ${dirLabel}</span>
          <span class="tm-notif__verdict ${isWin ? 'win' : 'loss'}">${isWin ? 'Take Profit ✓' : 'Stop Loss ✗'}</span>
        </div>
        <div class="tm-notif__prices">
          Entry ${parseFloat(trade.entry).toFixed(dec)} → Exit ${ep}
        </div>
        <div class="tm-notif__pnl ${isWin ? 'win' : 'loss'}">${isWin ? '+' : '−'}${pnlStr} $</div>
      </div>
      <div class="tm-notif__actions">
        <a href="/journal" class="tm-notif__link">Journal →</a>
        <button class="tm-notif__close">✕</button>
      </div>
    `;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));

    // Dismiss button
    el.querySelector('.tm-notif__close').addEventListener('click', () => dismiss(el));

    // Auto-dismiss after 10 s
    setTimeout(() => dismiss(el), 10000);
  }

  function dismiss(el) {
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => {
      el.remove();
      notifStack = Math.max(0, notifStack - 1);
    }, { once: true });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Call once at app startup.
   */
  function init() {
    subscribeAll();

    // Re-subscribe whenever WS reconnects (switchSymbol can remove subs)
    window.addEventListener('ws:connected', subscribeAll);

    // Listen to every price tick
    window.addEventListener('ws:tick', e => onTick(e.detail));

    console.log('[TradeMonitor] Watching', getMonitoredSymbols().length, 'symbol(s)');
  }

  /**
   * Call after a new trade is added to the journal so we subscribe immediately.
   */
  function onNewTrade(symbol) {
    WSClient.subscribe(symbol.toUpperCase());
  }

  /**
   * Call after the user switches instruments (switchSymbol unsubscribes old).
   * This restores subscriptions for all monitored symbols.
   */
  function resubscribeAll() {
    subscribeAll();
  }

  return { init, onNewTrade, resubscribeAll };

})();
