'use strict';

/**
 * JournalStore — localStorage-backed trade journal.
 * Works in both main app context and journal page context.
 */
const JournalStore = (() => {

  const KEY = 'ict_sniper_journal_v1';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function save(trades) {
    localStorage.setItem(KEY, JSON.stringify(trades));
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  function getAll() {
    return load();
  }

  function getById(id) {
    return load().find(t => t.id === id) || null;
  }

  /**
   * Add a new trade from ICTAnalyzer result.
   * @param {object} result - from ICTAnalyzer.analyze()
   * @returns {string} trade id
   */
  function buildEntry(result, status, gateMeta) {
    const { symbol, capital, trade, structure, liquidity, fvg, premDisc } = result;
    const g = gateMeta || {};
    return {
      id:         genId(),
      createdAt:  Date.now(),
      symbol,
      capital,
      direction:  trade.direction,
      entry:      trade.entry,
      sl:         trade.sl,
      tp:         trade.tp,
      rr:         trade.rr,
      lot:        trade.lot,
      tpPnl:      trade.tpPnl,
      slPnl:      trade.slPnl,
      riskPct:    trade.riskPct,
      rewardPct:  trade.rewardPct,
      ict: {
        structure: structure?.label || '',
        liquidity: liquidity?.label || '',
        fvg:       fvg?.label       || '',
        premDisc:  premDisc?.label  || '',
      },
      // Quality gate
      qualityGate:         g.qualityGate         || 'skipped',
      agentA:              g.agentA              || null,
      agentB:              g.agentB              || null,
      mediatorConfidence:  g.mediatorConfidence  || null,
      mediatorNarrative:   g.mediatorNarrative   || '',
      rejectionReason:     g.rejectionReason     || '',
      // Outcome
      status,
      exitPrice:  null,
      actualPnl:  null,
      closedAt:   null,
      notes:      '',
    };
  }

  /**
   * Add a validated (gate-passed) trade — status: 'open'
   * @param {object} result   - from ICTAnalyzer.analyze()
   * @param {object} gateMeta - { qualityGate, agentA, agentB, mediatorConfidence, mediatorNarrative }
   */
  function add(result, gateMeta) {
    const trades = load();
    const entry  = buildEntry(result, 'open', gateMeta);
    trades.unshift(entry);
    save(trades);
    return entry.id;
  }

  /**
   * Add a rejected trade (gate failed) — status: 'rejected'
   * Saved for learning purposes; not monitored by TradeMonitor.
   */
  function addRejected(result, gateMeta) {
    const trades = load();
    const entry  = buildEntry(result, 'rejected', { ...gateMeta, qualityGate: 'rejected' });
    trades.unshift(entry);
    save(trades);
    return entry.id;
  }

  /**
   * Update fields of an existing trade.
   */
  function update(id, changes) {
    const trades = load();
    const idx = trades.findIndex(t => t.id === id);
    if (idx === -1) return false;
    trades[idx] = { ...trades[idx], ...changes };
    save(trades);
    return true;
  }

  /**
   * Close a trade: status = win | loss | breakeven
   */
  function closeTrade(id, status, exitPrice) {
    const trades = load();
    const t = trades.find(t => t.id === id);
    if (!t) return false;

    let actualPnl = 0;
    if (status === 'win') {
      actualPnl = t.tpPnl;
    } else if (status === 'loss') {
      actualPnl = -t.slPnl;
    } else {
      actualPnl = 0; // breakeven
    }

    // If user provided exit price, recalculate
    if (exitPrice != null && !isNaN(exitPrice)) {
      const ep = parseFloat(exitPrice);
      const cfg = typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS[t.symbol] : null;
      const cs  = cfg ? cfg.contractSize : 100;
      if (t.direction === 'long') {
        actualPnl = t.lot * (ep - t.entry) * cs;
      } else {
        actualPnl = t.lot * (t.entry - ep) * cs;
      }
    }

    Object.assign(trades.find(x => x.id === id), {
      status,
      exitPrice:  exitPrice ?? (status === 'win' ? t.tp : status === 'loss' ? t.sl : t.entry),
      actualPnl:  parseFloat(actualPnl.toFixed(2)),
      closedAt:   Date.now(),
    });

    save(trades);
    return true;
  }

  function remove(id) {
    const trades = load().filter(t => t.id !== id);
    save(trades);
  }

  function clear() {
    save([]);
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  function getStats() {
    const trades    = load();
    const active    = trades.filter(t => t.status !== 'rejected'); // exclude rejected from P&L stats
    const closed    = active.filter(t => t.status !== 'open');
    const wins        = active.filter(t => t.status === 'win');
    const losses      = active.filter(t => t.status === 'loss');
    const rejected    = trades.filter(t => t.status === 'rejected');
    const winRate     = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const grossWin    = wins.reduce((s, t)   => s + (t.actualPnl || 0), 0);
    const grossLoss   = losses.reduce((s, t) => s + Math.abs(t.actualPnl || 0), 0);
    const profitFactor= grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? Infinity : 0;
    const netPnl      = closed.reduce((s, t) => s + (t.actualPnl || 0), 0);
    const avgRR       = active.length > 0 ? active.reduce((s, t) => s + t.rr, 0) / active.length : 0;

    // Best instrument by wins
    const bySymbol = {};
    wins.forEach(t => { bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + 1; });
    const bestSymbol = Object.entries(bySymbol).sort((a, b) => b[1] - a[1])[0]?.[0] || '–';

    // Equity curve: cumulative P&L per closed trade (sorted by closedAt)
    const equityCurve = [];
    let cumPnl = 0;
    [...closed]
      .sort((a, b) => a.closedAt - b.closedAt)
      .forEach(t => {
        cumPnl += (t.actualPnl || 0);
        equityCurve.push({
          time:  Math.floor(t.closedAt / 1000),
          value: parseFloat(cumPnl.toFixed(2)),
        });
      });

    return {
      total:        trades.length,
      open:         trades.filter(t => t.status === 'open').length,
      closed:       closed.length,
      wins:         wins.length,
      losses:       losses.length,
      breakevens:   active.filter(t => t.status === 'breakeven').length,
      rejected:     rejected.length,
      winRate:      parseFloat(winRate.toFixed(1)),
      grossWin:     parseFloat(grossWin.toFixed(2)),
      grossLoss:    parseFloat(grossLoss.toFixed(2)),
      profitFactor: isFinite(profitFactor) ? parseFloat(profitFactor.toFixed(2)) : '∞',
      netPnl:       parseFloat(netPnl.toFixed(2)),
      avgRR:        parseFloat(avgRR.toFixed(2)),
      bestSymbol,
      equityCurve,
    };
  }

  return { getAll, getById, add, addRejected, update, closeTrade, remove, clear, getStats };
})();
