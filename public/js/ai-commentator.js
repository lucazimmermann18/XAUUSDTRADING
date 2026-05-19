'use strict';

const AICommentator = (() => {

  const PROVIDERS = [
    { id: 'anthropic', label: 'Claude',   model: 'claude-opus-4-7',   color: '#CC785C', icon: '◆' },
    { id: 'openai',    label: 'GPT-4o',   model: 'gpt-4o',            color: '#10A37F', icon: '◉' },
    { id: 'deepseek',  label: 'DeepSeek', model: 'deepseek-chat',     color: '#4D6BFE', icon: '◈' },
    { id: 'gemini',    label: 'Gemini',   model: 'gemini-2.0-flash',  color: '#4285F4', icon: '✦' },
  ];

  let selectedProvider = 'anthropic';
  let isStreaming       = false;
  let currentAnalysis   = null; // stored after ICT analysis runs

  // ── Store result for later AI request ────────────────────────────────────
  function setAnalysisResult(result) {
    currentAnalysis = result;
  }

  // ── Render the AI panel HTML ──────────────────────────────────────────────
  function renderPanel() {
    const providerChips = PROVIDERS.map(p => `
      <button class="ai-provider-chip${p.id === selectedProvider ? ' active' : ''}"
              data-provider="${p.id}"
              style="${p.id === selectedProvider ? `--chip-color:${p.color};` : ''}">
        <span class="ai-chip-icon">${p.icon}</span>
        ${p.label}
        <span class="ai-chip-model">${p.model}</span>
      </button>
    `).join('');

    return `
<div class="ai-panel" id="ai-panel">
  <div class="ai-panel__header">
    <div class="ai-panel__title">
      <span class="ai-panel__icon">🤖</span>
      <span>KI-Kommentar</span>
    </div>
    <div class="ai-provider-chips" id="ai-provider-chips">
      ${providerChips}
    </div>
    <button class="ai-ask-btn" id="ai-ask-btn">
      <span class="ai-ask-icon">⚡</span>
      KI befragen
    </button>
  </div>

  <div class="ai-output" id="ai-output">
    <div class="ai-placeholder">
      Wähle einen Anbieter und klicke auf <strong>KI befragen</strong>
    </div>
  </div>
</div>`.trim();
  }

  // ── Format markdown-like text to HTML ────────────────────────────────────
  function formatOutput(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^(#{1,3} .+)$/gm, '<span class="ai-heading">$1</span>')
      .replace(/(Trade nehmen ✓)/g, '<span class="ai-bull">$1</span>')
      .replace(/(Überspringen ✗)/g, '<span class="ai-bear">$1</span>')
      .replace(/(Warten ⏳)/g,       '<span class="ai-warn">$1</span>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  // ── Wire up events after panel is injected into DOM ───────────────────────
  function bindEvents() {
    // Provider selection
    document.querySelectorAll('.ai-provider-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedProvider = btn.dataset.provider;
        const p = PROVIDERS.find(x => x.id === selectedProvider);

        document.querySelectorAll('.ai-provider-chip').forEach(b => {
          b.classList.remove('active');
          b.style.removeProperty('--chip-color');
        });
        btn.classList.add('active');
        if (p) btn.style.setProperty('--chip-color', p.color);
      });
    });

    // Ask button
    document.getElementById('ai-ask-btn')?.addEventListener('click', requestAnalysis);
  }

  // ── Stream AI analysis ────────────────────────────────────────────────────
  async function requestAnalysis() {
    if (isStreaming) return;
    if (!currentAnalysis) {
      showError('Bitte zuerst eine ICT-Analyse durchführen.');
      return;
    }

    isStreaming = true;
    const askBtn  = document.getElementById('ai-ask-btn');
    const outputEl = document.getElementById('ai-output');

    if (askBtn) {
      askBtn.disabled = true;
      askBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></span> Analysiert…';
    }

    const p = PROVIDERS.find(x => x.id === selectedProvider);
    outputEl.innerHTML = `
      <div class="ai-streaming">
        <div class="ai-provider-badge" style="--badge-color:${p?.color || '#888'}">
          ${p?.icon || '◆'} ${p?.label || 'KI'} · ${p?.model || ''}
        </div>
        <div class="ai-text" id="ai-text"><span class="ai-cursor">▌</span></div>
      </div>`;

    const { symbol, candles, structure, liquidity, fvg, premDisc, trade, capital } = currentAnalysis;

    try {
      const response = await fetch('/api/ai-analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          symbol,
          candles:  candles.slice(-50), // send last 50 candles
          analysis: { structure, liquidity, fvg, premDisc },
          trade,
          capital,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      const textEl  = document.getElementById('ai-text');
      let   rawText = '';
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw);

            if (event.error) {
              showError(event.error);
              isStreaming = false;
              return;
            }

            if (event.token) {
              rawText += event.token;
              if (textEl) {
                textEl.innerHTML = `<p>${formatOutput(rawText)}</p><span class="ai-cursor">▌</span>`;
              }
            }

            if (event.done && textEl) {
              textEl.innerHTML = `<p>${formatOutput(rawText)}</p>`;
            }
          } catch (_) {}
        }
      }

    } catch (err) {
      showError(`Verbindungsfehler: ${err.message}`);
    } finally {
      isStreaming = false;
      if (askBtn) {
        askBtn.disabled = false;
        askBtn.innerHTML = '<span class="ai-ask-icon">⚡</span> Erneut befragen';
      }
    }
  }

  function showError(msg) {
    const outputEl = document.getElementById('ai-output');
    if (outputEl) {
      outputEl.innerHTML = `
        <div class="ai-error">
          <span style="color:var(--bear)">⚠</span> ${msg}
        </div>`;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return { renderPanel, bindEvents, setAnalysisResult };

})();
