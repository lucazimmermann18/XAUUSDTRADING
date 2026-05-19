'use strict';

const DualValidatorUI = (() => {

  // ── Helpers ───────────────────────────────────────────────────────────────

  function decisionBadge(decision, score) {
    const scoreStr = score !== undefined ? ` · ${score}/16` : '';
    if (decision === 'TRADE')    return `<span class="dv-decision trade">✓ TRADE${scoreStr}</span>`;
    if (decision === 'NO_TRADE') return `<span class="dv-decision notrade">⊘ NO TRADE${scoreStr}</span>`;
    return `<span class="dv-decision error">⚠ ${decision || 'ERROR'}${scoreStr}</span>`;
  }

  function agentLogo(label) {
    if (label === 'Claude') return `<span class="dv-logo claude">◈</span>`;
    if (label === 'GPT-4o') return `<span class="dv-logo openai">⬡</span>`;
    return `<span class="dv-logo">?</span>`;
  }

  function pillarRow(num, label, content) {
    return `<div class="dv-pillar"><span class="dv-pillar-num">${num}</span><span class="dv-pillar-label">${label}</span><span class="dv-pillar-val">${content || '–'}</span></div>`;
  }

  function watchZoneBlock(zone, i) {
    const cls  = zone.type === 'long' ? 'long' : 'short';
    const icon = zone.type === 'long' ? '↑' : '↓';
    return `<div class="dv-watchzone ${cls}">
      <div class="dv-wz-head">${icon} ${zone.type === 'long' ? 'Long' : 'Short'}-Zone · ${zone.price_range || '–'}</div>
      <div class="dv-wz-row"><span>Warum:</span>${zone.why || '–'}</div>
      <div class="dv-wz-row"><span>Bedingungen:</span>${zone.conditions || '–'}</div>
      <div class="dv-wz-row ok"><span>Gültig wenn:</span>${zone.valid_if || '–'}</div>
      <div class="dv-wz-row fail"><span>Ungültig wenn:</span>${zone.invalid_if || '–'}</div>
    </div>`;
  }

  // ── Build agent card HTML ─────────────────────────────────────────────────

  function buildAgentCard(agent, side) {
    const label    = agent.label || (side === 'a' ? 'Claude' : 'GPT-4o');
    const isError  = agent.decision === 'ERROR';
    const isTrade  = agent.decision === 'TRADE';
    const noTrade  = agent.decision === 'NO_TRADE';

    let bodyHTML = '';

    if (isError) {
      bodyHTML = `<div class="dv-error-msg">⚠ ${agent.error || 'Analyse fehlgeschlagen'}</div>`;
    } else {
      // 4 pillars
      const pillars = `
        <div class="dv-pillars">
          ${pillarRow('①', 'Struktur',   agent.structure?.label)}
          ${pillarRow('②', 'Liquidität', agent.liquidity?.label)}
          ${pillarRow('③', 'FVG',        agent.fvg?.label)}
          ${pillarRow('④', 'P/D',        agent.premDisc?.label)}
        </div>`;

      if (isTrade && agent.trade) {
        const t   = agent.trade;
        const dir = t.direction === 'long' ? '↑ Long' : '↓ Short';
        bodyHTML = `
          ${pillars}
          <div class="dv-trade-mini">
            <div class="dv-trade-dir ${t.direction}">${dir}</div>
            <div class="dv-trade-levels">
              <span class="entry">Entry ${t.entry}</span>
              <span class="sl">SL ${t.sl}</span>
              <span class="tp">TP ${t.tp}</span>
              <span class="rr">RR 1:${(t.rr || 0).toFixed(2)}</span>
            </div>
          </div>`;
      } else if (noTrade && agent.no_trade) {
        const zones = (agent.no_trade.watch_zones || []).map((z, i) => watchZoneBlock(z, i)).join('');
        bodyHTML = `
          ${pillars}
          <div class="dv-notrade-reason">${agent.no_trade.reason || '–'}</div>
          <div class="dv-watchzones">${zones}</div>`;
      } else {
        bodyHTML = pillars;
      }
    }

    return `
      <div class="dv-agent-card ${isTrade ? 'trade' : noTrade ? 'notrade' : 'error'}" id="dv-agent-${side}">
        <div class="dv-agent-header">
          ${agentLogo(label)}
          <span class="dv-agent-name">${label}</span>
          ${decisionBadge(agent.decision, agent.setup_score)}
        </div>
        <div class="dv-agent-body">${bodyHTML}</div>
      </div>`;
  }

  // ── Skeleton while agents load ────────────────────────────────────────────

  function renderSkeleton(container) {
    container.innerHTML = `
      <div class="dv-panel" id="dv-panel">
        <div class="dv-header">
          <span class="dv-title">🔍 Dual-KI Analyse</span>
          <span class="dv-subtitle">Beide Agenten analysieren unabhängig voneinander…</span>
        </div>
        <div class="dv-agents">
          <div class="dv-agent-card loading" id="dv-agent-a">
            <div class="dv-agent-header">${agentLogo('Claude')}<span class="dv-agent-name">Claude</span><div class="dv-spinner"></div></div>
            <div class="dv-agent-body">Analysiert…</div>
          </div>
          <div class="dv-agent-card loading" id="dv-agent-b">
            <div class="dv-agent-header">${agentLogo('GPT-4o')}<span class="dv-agent-name">GPT-4o</span><div class="dv-spinner"></div></div>
            <div class="dv-agent-body">Analysiert…</div>
          </div>
        </div>
        <div class="dv-gate"  id="dv-gate"     style="display:none"></div>
        <div class="dv-mediator" id="dv-mediator" style="display:none"></div>
      </div>`;
  }

  // ── Fill agent cards with actual results ──────────────────────────────────

  function fillAgents(agentA, agentB) {
    const panel = document.getElementById('dv-panel');
    if (!panel) return;

    const agentsEl = panel.querySelector('.dv-agents');
    if (agentsEl) {
      agentsEl.innerHTML = buildAgentCard(agentA, 'a') + buildAgentCard(agentB, 'b');
    }
  }

  // ── Gate ──────────────────────────────────────────────────────────────────

  function showGate(agreement, agentA, agentB) {
    const el = document.getElementById('dv-gate');
    if (!el) return;
    el.style.display = '';

    if (agreement) {
      const dir = agentA.trade?.direction === 'long' ? '↑ Long' : '↓ Short';
      el.className = 'dv-gate pass';
      el.innerHTML = `
        <span class="dv-gate-icon">✅</span>
        <div class="dv-gate-text">
          <strong>Übereinstimmung</strong> — beide KIs bestätigen <span class="dv-dir ${agentA.trade?.direction}">${dir}</span>
          <div class="dv-gate-sub">Vermittler-Agent bestätigt finales Urteil…</div>
        </div>`;
    } else {
      const reasonA = agentA.decision === 'NO_TRADE' ? 'Claude: NO TRADE' : `Claude: ${(agentA.trade?.direction || 'ERROR').toUpperCase()}`;
      const reasonB = agentB.decision === 'NO_TRADE' ? 'GPT-4o: NO TRADE' : `GPT-4o: ${(agentB.trade?.direction || 'ERROR').toUpperCase()}`;
      el.className = 'dv-gate fail';
      el.innerHTML = `
        <span class="dv-gate-icon">⚠</span>
        <div class="dv-gate-text">
          <strong>Kein Trade</strong> — ${reasonA} · ${reasonB}
          <div class="dv-gate-sub">Vermittler identifiziert Watch-Zones…</div>
        </div>`;
    }
  }

  // ── Mediator streaming ────────────────────────────────────────────────────

  async function streamMediatorSSE(endpoint, payload, onToken, onDone) {
    let res;
    try {
      res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } catch (err) {
      onDone(null, err.message);
      return;
    }

    if (!res.ok) { onDone(null, `HTTP ${res.status}`); return; }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   full    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.token) { full += evt.token; onToken(full); }
          if (evt.done)  { onDone(full); return; }
          if (evt.error) { onDone(null, evt.error); return; }
        } catch (_) {}
      }
    }
    onDone(full);
  }

  function parseConfidence(text) {
    const m = text.match(/\*\*Konfidenz:\*\*\s*(\d+)\s*\/\s*100/i)
           || text.match(/Konfidenz[:\s]+(\d+)\s*\/\s*100/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function renderMediatorPanel(text, streaming, isWatchZone) {
    const el = document.getElementById('dv-mediator');
    if (!el) return;
    el.style.display = '';

    const conf    = !isWatchZone ? parseConfidence(text) : null;
    const confBar = conf !== null
      ? `<div class="dv-conf-bar"><div class="dv-conf-fill" style="width:${conf}%"></div><span class="dv-conf-label">${conf}/100</span></div>`
      : '';

    const html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/📍/g, '<span style="color:var(--accent)">📍</span>')
      .replace(/\n/g, '<br>');

    const title = isWatchZone ? '📍 Watch-Zones · Vermittler-Analyse' : '📋 Vermittler-Urteil';

    el.innerHTML = `
      <div class="dv-med-header">
        <span class="dv-med-title">${title}</span>
        ${!streaming && conf !== null ? confBar : ''}
      </div>
      <div class="dv-med-body ${streaming ? 'streaming' : ''}">${html}${streaming ? '<span class="dv-cursor">▋</span>' : ''}</div>`;
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  async function start(container, { agentA, agentB, agreement, symbol, capital, candles, onPassed, onNoTrade }) {
    renderSkeleton(container);

    // Small tick to let skeleton render
    await new Promise(r => setTimeout(r, 50));

    fillAgents(agentA, agentB);
    showGate(agreement, agentA, agentB);

    if (agreement) {
      // ── Both agree on TRADE ── stream mediator confirmation ──────────────
      const trade    = agentA.trade; // use Claude's trade as primary
      const analysis = {
        structure: agentA.structure,
        liquidity: agentA.liquidity,
        fvg:       agentA.fvg,
        premDisc:  agentA.premDisc,
      };

      const legacyAgentA = {
        direction:    trade.direction.toUpperCase(),
        confidence:   'HIGH',
        reasons:      [agentA.structure?.label, agentA.liquidity?.label, agentA.fvg?.label].filter(Boolean).slice(0, 3),
        risk_warning: agentA.premDisc?.label || '',
        label:        'Claude',
      };
      const legacyAgentB = {
        direction:    agentB.trade.direction.toUpperCase(),
        confidence:   'HIGH',
        reasons:      [agentB.structure?.label, agentB.liquidity?.label, agentB.fvg?.label].filter(Boolean).slice(0, 3),
        risk_warning: agentB.premDisc?.label || '',
        label:        'GPT-4o',
      };

      const medPayload = { symbol, analysis, trade, capital, agentA: legacyAgentA, agentB: legacyAgentB };

      let finalText = '';
      await streamMediatorSSE('/api/mediator', medPayload,
        (partial)    => renderMediatorPanel(partial, true, false),
        (full, err)  => { finalText = full || ''; renderMediatorPanel(finalText, false, false); }
      );

      const mediatorConfidence = parseConfidence(finalText);

      // Build result for Trade Card
      const result = {
        symbol,
        capital,
        candles,
        structure: agentA.structure,
        liquidity: agentA.liquidity,
        fvg:       agentA.fvg,
        premDisc:  agentA.premDisc,
        trade,
        timestamp: Date.now(),
        source:    'dual-ai',
      };

      let tradeId = null;
      if (typeof JournalStore !== 'undefined') {
        tradeId = JournalStore.add(result, {
          qualityGate:       'passed',
          agentA:            legacyAgentA,
          agentB:            legacyAgentB,
          mediatorConfidence,
          mediatorNarrative: finalText,
        });
      }

      onPassed && onPassed({ tradeId, result });

    } else {
      // ── No agreement / NO_TRADE ── stream watch-zone mediator ────────────
      await streamMediatorSSE('/api/mediator-watchzones', { symbol, agentA, agentB },
        (partial)   => renderMediatorPanel(partial, true, true),
        (full, err) => renderMediatorPanel(full || '', false, true)
      );

      if (typeof JournalStore !== 'undefined') {
        JournalStore.addRejected({ symbol, capital, timestamp: Date.now() }, {
          agentA, agentB,
          rejectionReason: agentA.decision === 'NO_TRADE' && agentB.decision === 'NO_TRADE'
            ? 'Beide Agenten: NO_TRADE'
            : `Keine Übereinstimmung (Claude: ${agentA.decision}, GPT-4o: ${agentB.decision})`,
          qualityGate: 'rejected',
        });
      }

      onNoTrade && onNoTrade({ agentA, agentB });
    }
  }

  return { start };

})();
