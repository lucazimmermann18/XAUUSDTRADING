'use strict';

/**
 * journal-page.js — Controller for /journal.html
 */

(function () {

  let filterStatus = 'all'; // all | open | win | loss | breakeven
  let sortKey      = 'createdAt';
  let sortDir      = -1; // -1 = descending
  let equityChart  = null;
  let equitySeries = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmt(n, dec = 2) {
    if (n === null || n === undefined) return '–';
    return parseFloat(n).toLocaleString('de-DE', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  function fmtDate(ts) {
    if (!ts) return '–';
    return new Date(ts).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function statusBadge(status) {
    const map = {
      open:       '<span class="j-badge open">Offen</span>',
      win:        '<span class="j-badge win">Win ✓</span>',
      loss:       '<span class="j-badge loss">Loss ✗</span>',
      breakeven:  '<span class="j-badge be">BE ≈</span>',
    };
    return map[status] || status;
  }

  function dirBadge(dir) {
    return dir === 'long'
      ? '<span class="j-dir long">↑ Long</span>'
      : '<span class="j-dir short">↓ Short</span>';
  }

  function symbolAccent(symbol) {
    const cfg = typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS[symbol] : null;
    return cfg ? cfg.accent : '#94A3B8';
  }

  function pnlClass(v) {
    if (v === null || v === undefined) return '';
    return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  }

  // ── Stats Cards ───────────────────────────────────────────────────────────

  function renderStats() {
    const s  = JournalStore.getStats();
    const el = document.getElementById('stats-row');
    if (!el) return;

    const pfDisplay = typeof s.profitFactor === 'string' ? s.profitFactor : fmt(s.profitFactor);
    const netClass  = s.netPnl >= 0 ? 'pos' : 'neg';
    const pfClass   = s.profitFactor === '∞' || s.profitFactor >= 1 ? 'pos' : 'neg';

    el.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Trades gesamt</div>
        <div class="stat-value">${s.total}</div>
        <div class="stat-sub">${s.open} offen · ${s.closed} geschlossen</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Winrate</div>
        <div class="stat-value ${s.winRate >= 50 ? 'pos' : 'neg'}">${s.winRate}%</div>
        <div class="stat-sub">${s.wins}W · ${s.losses}L · ${s.breakevens}BE</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Profit Factor</div>
        <div class="stat-value ${pfClass}">${pfDisplay}</div>
        <div class="stat-sub">+${fmt(s.grossWin)} $ / −${fmt(s.grossLoss)} $</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Net P&L</div>
        <div class="stat-value ${netClass}">${s.netPnl >= 0 ? '+' : ''}${fmt(s.netPnl)} $</div>
        <div class="stat-sub">Ø RR 1:${fmt(s.avgRR)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Bestes Instrument</div>
        <div class="stat-value" style="color:${symbolAccent(s.bestSymbol)}">${s.bestSymbol}</div>
        <div class="stat-sub">${s.wins} Wins insgesamt</div>
      </div>
    `;
  }

  // ── Equity Curve ──────────────────────────────────────────────────────────

  function renderEquityCurve() {
    const container = document.getElementById('equity-chart');
    if (!container) return;

    const { equityCurve } = JournalStore.getStats();

    if (equityCurve.length === 0) {
      container.innerHTML = '<div class="equity-empty">Equity-Kurve erscheint nach dem ersten geschlossenen Trade</div>';
      return;
    }

    container.innerHTML = '';

    if (!equityChart) {
      equityChart = LightweightCharts.createChart(container, {
        width:  container.clientWidth,
        height: 180,
        layout: {
          background: { color: 'transparent' },
          textColor:  '#94A3B8',
          fontSize:   11,
        },
        grid: {
          vertLines:  { color: 'rgba(148,163,184,0.06)' },
          horzLines:  { color: 'rgba(148,163,184,0.06)' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: 'rgba(148,163,184,0.1)' },
        timeScale: {
          borderColor:     'rgba(148,163,184,0.1)',
          timeVisible:     true,
          secondsVisible:  false,
        },
        handleScroll:  true,
        handleScale:   true,
      });

      equitySeries = equityChart.addLineSeries({
        color:         '#22C55E',
        lineWidth:     2,
        priceFormat:   { type: 'price', precision: 2, minMove: 0.01 },
        crosshairMarkerVisible: true,
      });

      new ResizeObserver(() => {
        equityChart?.applyOptions({ width: container.clientWidth });
      }).observe(container);
    }

    // Color line based on final value
    const finalVal = equityCurve[equityCurve.length - 1]?.value ?? 0;
    equitySeries.applyOptions({ color: finalVal >= 0 ? '#22C55E' : '#EF4444' });
    equitySeries.setData(equityCurve);
    equityChart.timeScale().fitContent();
  }

  // ── Trade Table ───────────────────────────────────────────────────────────

  function renderTable() {
    const all     = JournalStore.getAll();
    const tbody   = document.getElementById('journal-tbody');
    const countEl = document.getElementById('trade-count');
    if (!tbody) return;

    let trades = filterStatus === 'all' ? all : all.filter(t => t.status === filterStatus);

    // Sort
    trades = [...trades].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return av < bv ? sortDir : av > bv ? -sortDir : 0;
    });

    if (countEl) countEl.textContent = `${trades.length} Trade${trades.length !== 1 ? 's' : ''}`;

    if (trades.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="j-empty">Keine Trades in dieser Ansicht</td></tr>`;
      return;
    }

    tbody.innerHTML = trades.map(t => {
      const accent  = symbolAccent(t.symbol);
      const pnlVal  = t.actualPnl !== null ? `${t.actualPnl >= 0 ? '+' : ''}${fmt(t.actualPnl)} $` : '–';
      const actions = t.status === 'open'
        ? `<div class="j-actions">
             <button class="j-close-btn win"  data-id="${t.id}" data-status="win">Win</button>
             <button class="j-close-btn loss" data-id="${t.id}" data-status="loss">Loss</button>
             <button class="j-close-btn be"   data-id="${t.id}" data-status="breakeven">BE</button>
           </div>`
        : `<div class="j-actions">
             <button class="j-reopen-btn" data-id="${t.id}">↺</button>
           </div>`;

      return `
        <tr class="j-row ${t.status}" data-id="${t.id}">
          <td class="j-cell date">${fmtDate(t.createdAt)}</td>
          <td class="j-cell symbol" style="color:${accent}">${t.symbol}</td>
          <td class="j-cell">${dirBadge(t.direction)}</td>
          <td class="j-cell mono">${t.entry}</td>
          <td class="j-cell mono sl">${t.sl}</td>
          <td class="j-cell mono tp">${t.tp}</td>
          <td class="j-cell mono">${fmt(t.rr)}</td>
          <td class="j-cell mono">${fmt(t.lot)}</td>
          <td class="j-cell">${statusBadge(t.status)}</td>
          <td class="j-cell mono ${pnlClass(t.actualPnl)}">${pnlVal}</td>
          <td class="j-cell actions">${actions}</td>
        </tr>`;
    }).join('');

    // Bind close buttons
    tbody.querySelectorAll('.j-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCloseModal(btn.dataset.id, btn.dataset.status);
      });
    });

    // Bind reopen buttons
    tbody.querySelectorAll('.j-reopen-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        JournalStore.update(btn.dataset.id, {
          status: 'open', exitPrice: null, actualPnl: null, closedAt: null,
        });
        refresh();
      });
    });

    // Row click → detail modal
    tbody.querySelectorAll('.j-row').forEach(row => {
      row.addEventListener('click', () => openDetailModal(row.dataset.id));
    });
  }

  // ── Close Modal ───────────────────────────────────────────────────────────

  function openCloseModal(id, preStatus) {
    const t = JournalStore.getById(id);
    if (!t) return;

    const modal = document.getElementById('close-modal');
    const form  = document.getElementById('close-form');
    if (!modal || !form) return;

    // Pre-fill
    form.querySelector('[name="status"]').value      = preStatus;
    form.querySelector('[name="exit-price"]').value  = preStatus === 'win' ? t.tp : preStatus === 'loss' ? t.sl : t.entry;
    form.querySelector('[name="notes"]').value       = t.notes || '';

    modal.dataset.tradeId = id;
    modal.classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  // ── Detail Modal ──────────────────────────────────────────────────────────

  function openDetailModal(id) {
    const t = JournalStore.getById(id);
    if (!t) return;

    const modal   = document.getElementById('detail-modal');
    const content = document.getElementById('detail-content');
    if (!modal || !content) return;

    const accent   = symbolAccent(t.symbol);
    const cfg      = typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS[t.symbol] : null;
    const dec      = cfg ? cfg.decimals : 2;
    const pnlColor = t.actualPnl > 0 ? 'var(--bull)' : t.actualPnl < 0 ? 'var(--bear)' : 'var(--text-muted)';

    content.innerHTML = `
      <div class="detail-header">
        <span class="detail-symbol" style="color:${accent}">${t.symbol}</span>
        ${dirBadge(t.direction)}
        ${statusBadge(t.status)}
        ${t.actualPnl !== null ? `<span class="detail-pnl" style="color:${pnlColor}">${t.actualPnl >= 0 ? '+' : ''}${fmt(t.actualPnl)} $</span>` : ''}
      </div>

      <div class="detail-grid">
        <div class="detail-item"><span class="detail-key">Entry</span><span class="detail-val mono">${t.entry.toFixed(dec)}</span></div>
        <div class="detail-item"><span class="detail-key">Stop Loss</span><span class="detail-val mono sl">${t.sl.toFixed(dec)}</span></div>
        <div class="detail-item"><span class="detail-key">Take Profit</span><span class="detail-val mono tp">${t.tp.toFixed(dec)}</span></div>
        <div class="detail-item"><span class="detail-key">RR</span><span class="detail-val mono">1:${fmt(t.rr)}</span></div>
        <div class="detail-item"><span class="detail-key">Lot</span><span class="detail-val mono">${fmt(t.lot)}</span></div>
        <div class="detail-item"><span class="detail-key">Kapital</span><span class="detail-val mono">${fmt(t.capital)} $</span></div>
        <div class="detail-item"><span class="detail-key">TP-Ziel</span><span class="detail-val mono pos">+${fmt(t.tpPnl)} $</span></div>
        <div class="detail-item"><span class="detail-key">SL-Risiko</span><span class="detail-val mono neg">−${fmt(t.slPnl)} $</span></div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">ICT-Analyse</div>
        <div class="detail-ict">
          <div><span class="ict-num">①</span> <strong>Struktur</strong> — ${t.ict.structure || '–'}</div>
          <div><span class="ict-num">②</span> <strong>Liquidität</strong> — ${t.ict.liquidity || '–'}</div>
          <div><span class="ict-num">③</span> <strong>FVG</strong> — ${t.ict.fvg || '–'}</div>
          <div><span class="ict-num">④</span> <strong>Premium/Discount</strong> — ${t.ict.premDisc || '–'}</div>
        </div>
      </div>

      ${t.notes ? `<div class="detail-section"><div class="detail-section-title">Notizen</div><div class="detail-notes">${t.notes}</div></div>` : ''}

      <div class="detail-meta">
        Eröffnet: ${fmtDate(t.createdAt)}
        ${t.closedAt ? ` · Geschlossen: ${fmtDate(t.closedAt)}` : ''}
        ${t.exitPrice ? ` · Exit: ${t.exitPrice}` : ''}
      </div>
    `;

    modal.classList.add('open');
  }

  // ── Filter Tabs ───────────────────────────────────────────────────────────

  function bindFilterTabs() {
    document.querySelectorAll('.j-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterStatus = btn.dataset.status;
        document.querySelectorAll('.j-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTable();
      });
    });
  }

  // ── Sort headers ──────────────────────────────────────────────────────────

  function bindSortHeaders() {
    document.querySelectorAll('[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) sortDir *= -1;
        else { sortKey = key; sortDir = -1; }

        document.querySelectorAll('[data-sort]').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(sortDir === -1 ? 'sort-desc' : 'sort-asc');
        renderTable();
      });
    });
  }

  // ── Close modal form ──────────────────────────────────────────────────────

  function bindCloseForm() {
    const form = document.getElementById('close-form');
    if (!form) return;

    // Status button toggle
    form.querySelectorAll('.status-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        form.querySelectorAll('.status-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        form.querySelector('[name="status"]').value = btn.dataset.val;

        // Pre-fill exit price
        const modal = document.getElementById('close-modal');
        const t = JournalStore.getById(modal?.dataset.tradeId);
        if (!t) return;
        const ep = form.querySelector('[name="exit-price"]');
        if (btn.dataset.val === 'win')       ep.value = t.tp;
        else if (btn.dataset.val === 'loss') ep.value = t.sl;
        else                                 ep.value = t.entry;
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const modal = document.getElementById('close-modal');
      const id    = modal?.dataset.tradeId;
      if (!id) return;

      const status    = form.querySelector('[name="status"]').value;
      const exitPrice = parseFloat(form.querySelector('[name="exit-price"]').value) || null;
      const notes     = form.querySelector('[name="notes"]').value;

      JournalStore.update(id, { notes });
      JournalStore.closeTrade(id, status, exitPrice);
      closeModal('close-modal');
      refresh();
    });
  }

  // ── Clear all ─────────────────────────────────────────────────────────────

  function bindClearBtn() {
    document.getElementById('clear-btn')?.addEventListener('click', () => {
      if (confirm('Alle Trades löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
        JournalStore.clear();
        equityChart = null;
        equitySeries = null;
        refresh();
      }
    });
  }

  // ── Modal close triggers ──────────────────────────────────────────────────

  function bindModalClose() {
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
      }
    });
  }

  // ── Refresh all ───────────────────────────────────────────────────────────

  function refresh() {
    renderStats();
    renderEquityCurve();
    renderTable();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    bindFilterTabs();
    bindSortHeaders();
    bindCloseForm();
    bindClearBtn();
    bindModalClose();
    refresh();
  });

})();
