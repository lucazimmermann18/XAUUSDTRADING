'use strict';

/**
 * DualValidatorUI — renders the two-agent quality gate panel
 * and streams the mediator narrative.
 *
 * Usage:
 *   DualValidatorUI.start(containerEl, { result, capital, onPassed, onRejected })
 */
const DualValidatorUI = (() => {

  // ── Helpers ───────────────────────────────────────────────────────────────

  function confBadge(conf) {
    const map = { HIGH: 'hoch', MEDIUM: 'mittel', LOW: 'niedrig' };
    const cls = { HIGH: 'high', MEDIUM: 'med', LOW: 'low' };
    return `<span class="dv-conf ${cls[conf] || 'med'}">${map[conf] || conf}</span>`;
  }

  function dirBadge(dir) {
    if (dir === 'LONG')     return '<span class="dv-dir long">↑ Long</span>';
    if (dir === 'SHORT')    return '<span class="dv-dir short">↓ Short</span>';
    return '<span class="dv-dir none">⊘ No Trade</span>';
  }

  function agentLogo(label) {
    if (label === 'Claude') return `<span class="dv-logo claude">◈</span>`;
    if (label === 'OpenAI') return `<span class="dv-logo openai">⬡</span>`;
    return `<span class="dv-logo">?</span>`;
  }

  // ── Skeleton ──────────────────────────────────────────────────────────────

  function renderSkeleton(container) {
    container.innerHTML = `
      <div class="dv-panel" id="dv-panel">
        <div class="dv-header">
          <span class="dv-title">🔍 Dual-KI Validation</span>
          <span class="dv-subtitle">Beide Agenten analysieren unabhängig…</span>
        </div>

        <div class="dv-agents">
          <div class="dv-agent-card loading" id="dv-agent-a">
            <div class="dv-agent-header">
              ${agentLogo('Claude')}
              <span class="dv-agent-name">Claude</span>
              <div class="dv-spinner"></div>
            </div>
            <div class="dv-agent-body">Analysiert…</div>
          </div>
          <div class="dv-agent-card loading" id="dv-agent-b">
            <div class="dv-agent-header">
              ${agentLogo('OpenAI')}
              <span class="dv-agent-name">GPT-4o</span>
              <div class="dv-spinner"></div>
            </div>
            <div class="dv-agent-body">Analysiert…</div>
          </div>
        </div>

        <div class="dv-gate" id="dv-gate" style="display:none"></div>
        <div class="dv-mediator" id="dv-mediator" style="display:none"></div>
      </div>
    `;
  }

  // ── Fill one agent card ───────────────────────────────────────────────────

  function fillAgent(id, label, agent) {
    const el = document.getElementById(id);
    if (!el) return;

    const ok      = agent.direction !== 'NO_TRADE';
    const icon    = ok ? '✓' : '✗';
    const iconCls = ok ? 'ok' : 'fail';

    el.classList.remove('loading');
    el.classList.add(ok ? 'ok' : 'fail');

    const reasonsHTML = agent.reasons.length
      ? `<ul class="dv-reasons">${agent.reasons.map(r => `<li>${r}</li>`).join('')}</ul>`
      : '';

    const riskHTML = agent.risk_warning
      ? `<div class="dv-risk">⚠ ${agent.risk_warning}</div>`
      : '';

    el.innerHTML = `
      <div class="dv-agent-header">
        ${agentLogo(label)}
        <span class="dv-agent-name">${label}</span>
        <span class="dv-agent-verdict-icon ${iconCls}">${icon}</span>
      </div>
      <div class="dv-agent-body">
        <div class="dv-verdict-row">
          ${dirBadge(agent.direction)}
          ${confBadge(agent.confidence)}
        </div>
        ${reasonsHTML}
        ${riskHTML}
      </div>
    `;
  }

  // ── Gate result ───────────────────────────────────────────────────────────

  function showGate(agreement, direction, rejectionReason) {
    const el = document.getElementById('dv-gate');
    if (!el) return;
    el.style.display = '';

    if (agreement) {
      el.className = 'dv-gate pass';
      el.innerHTML = `
        <span class="dv-gate-icon">✅</span>
        <div class="dv-gate-text">
          <strong>Übereinstimmung</strong> — beide KIs bestätigen ${dirBadge(direction)}
          <div class="dv-gate-sub">Vermittler-Agent synthesisiert das finale Urteil…</div>
        </div>
      `;
    } else {
      el.className = 'dv-gate fail';
      el.innerHTML = `
        <span class="dv-gate-icon">❌</span>
        <div class="dv-gate-text">
          <strong>Kein Trade</strong> — ${rejectionReason || 'Keine Übereinstimmung'}
          <div class="dv-gate-sub">Der Trade wird nicht genommen. Im Journal als "Abgelehnt" gespeichert.</div>
        </div>
      `;
    }
  }

  // ── Mediator streaming ────────────────────────────────────────────────────

  async function streamMediator(payload, onToken, onDone) {
    const res = await fetch('/api/mediator', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      onDone('Mediator nicht verfügbar');
      return;
    }

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

  // ── Parse mediator confidence from text ──────────────────────────────────

  function parseConfidence(text) {
    const m = text.match(/\*\*Konfidenz:\*\*\s*(\d+)\s*\/\s*100/i)
           || text.match(/Konfidenz[:\s]+(\d+)\s*\/\s*100/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // ── Render mediator panel ─────────────────────────────────────────────────

  function renderMediatorPanel(text, streaming) {
    const el = document.getElementById('dv-mediator');
    if (!el) return;
    el.style.display = '';

    const conf    = parseConfidence(text);
    const confBar = conf !== null
      ? `<div class="dv-conf-bar">
           <div class="dv-conf-fill" style="width:${conf}%"></div>
           <span class="dv-conf-label">${conf}/100</span>
         </div>`
      : '';

    // Convert markdown bold to spans
    const html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    el.innerHTML = `
      <div class="dv-med-header">
        <span class="dv-med-title">📋 Vermittler-Urteil</span>
        ${!streaming && conf !== null ? confBar : ''}
      </div>
      <div class="dv-med-body ${streaming ? 'streaming' : ''}">${html}${streaming ? '<span class="dv-cursor">▋</span>' : ''}</div>
    `;
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  async function start(container, { result, capital, onPassed, onRejected }) {
    renderSkeleton(container);

    // Build minimal payload for backend
    const payload = {
      symbol:   result.symbol,
      analysis: {
        structure: result.structure,
        liquidity: result.liquidity,
        fvg:       result.fvg,
        premDisc:  result.premDisc,
      },
      trade:   result.trade,
      capital,
    };

    // When Claude Vision ran as primary analyst, reuse its verdict instead of
    // calling Claude again in the dual-validate endpoint (avoids 529 rate limits).
    if (result.source === 'claude-vision' && result.trade) {
      payload.primaryVerdict = {
        direction:    (result.trade.direction || 'NO_TRADE').toUpperCase(),
        confidence:   'HIGH',
        reasons: [
          result.structure?.label,
          result.liquidity?.label,
          result.fvg?.label,
        ].filter(Boolean).slice(0, 3),
        risk_warning: result.premDisc?.label || '',
      };
    }

    let gateResult;

    try {
      const res  = await fetch('/api/dual-validate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      gateResult = await res.json();
    } catch (err) {
      // Network failure — show error, skip gate
      const gate = document.getElementById('dv-gate');
      if (gate) { gate.style.display = ''; gate.className = 'dv-gate fail'; gate.textContent = `Fehler: ${err.message}`; }
      return;
    }

    const { agentA, agentB, agreement, direction, rejectionReason } = gateResult;

    // Fill agent cards
    fillAgent('dv-agent-a', 'Claude', agentA);
    fillAgent('dv-agent-b', 'GPT-4o', agentB);

    // Show gate result
    showGate(agreement, direction, rejectionReason);

    if (!agreement) {
      // Save rejected trade to journal
      if (typeof JournalStore !== 'undefined') {
        JournalStore.addRejected(result, {
          agentA, agentB,
          rejectionReason,
          qualityGate: 'rejected',
        });
      }
      onRejected && onRejected({ agentA, agentB, rejectionReason });
      return;
    }

    // Gate passed — stream mediator
    const medPayload = { ...payload, agentA, agentB };

    let finalText = '';
    await streamMediator(medPayload,
      (partial) => renderMediatorPanel(partial, true),
      (full, err) => {
        finalText = full || '';
        renderMediatorPanel(finalText, false);
      }
    );

    // Parse final confidence
    const mediatorConfidence = parseConfidence(finalText);

    // Save to journal
    const gateMeta = {
      qualityGate:        'passed',
      agentA,
      agentB,
      mediatorConfidence,
      mediatorNarrative:  finalText,
    };

    let tradeId = null;
    if (typeof JournalStore !== 'undefined') {
      tradeId = JournalStore.add(result, gateMeta);
    }

    onPassed && onPassed({ tradeId, agentA, agentB, mediatorConfidence, mediatorNarrative: finalText });
  }

  return { start };

})();
