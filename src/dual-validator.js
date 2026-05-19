'use strict';

const axios = require('axios');

// ── Validator Prompt ──────────────────────────────────────────────────────────

function buildValidatorPrompt(symbol, analysis, trade) {
  return `Du bist ein unabhängiger ICT-Trading-Analyst. Bewerte das folgende M1-Setup objektiv.

INSTRUMENT: ${symbol}

ICT-ANALYSE:
① Struktur:          ${analysis.structure?.label || '–'}
② Liquidität:        ${analysis.liquidity?.label || '–'}
③ FVG:               ${analysis.fvg?.label || '–'}
④ Premium/Discount:  ${analysis.premDisc?.label || '–'}

VORGESCHLAGENER TRADE:
Richtung:    ${(trade.direction || '').toUpperCase()}
Entry:       ${trade.entry}
Stop Loss:   ${trade.sl}
Take Profit: ${trade.tp}
RR:          1:${trade.rr}

Antworte AUSSCHLIESSLICH mit diesem JSON — kein Text davor oder danach, kein Markdown:
{
  "direction": "LONG",
  "confidence": "HIGH",
  "reasons": ["Grund 1", "Grund 2", "Grund 3"],
  "risk_warning": "Hauptrisiko in einem Satz"
}

Regeln:
- direction: "LONG" | "SHORT" | "NO_TRADE"
- confidence: "HIGH" | "MEDIUM" | "LOW"
- reasons: max. 3 Punkte, auf Deutsch, präzise
- risk_warning: auf Deutsch, ein Satz
- Stimmt das Setup mit den ICT-Säulen überein? Falls nicht → NO_TRADE`;
}

// ── Mediator Prompt ───────────────────────────────────────────────────────────

function buildMediatorPrompt(symbol, analysis, trade, capital, agentA, agentB) {
  const dir = trade.direction === 'long' ? 'LONG ↑' : 'SHORT ↓';

  const fmtAgent = (a, name) =>
    `${name}: ${a.direction} (${a.confidence})\n  • ${a.reasons.join('\n  • ')}\n  Risiko: ${a.risk_warning}`;

  return `Zwei unabhängige KI-Analysten haben das folgende ICT-Setup unabhängig voneinander bestätigt.

═══ TRADE-SIGNAL ═══
Symbol:      ${symbol}
Richtung:    ${dir}
Entry:       ${trade.entry}
Stop Loss:   ${trade.sl}
Take Profit: ${trade.tp}
RR:          1:${trade.rr}
Kapital:     ${capital} $

═══ ICT-ANALYSE ═══
① Struktur:          ${analysis.structure?.label || '–'}
② Liquidität:        ${analysis.liquidity?.label || '–'}
③ FVG:               ${analysis.fvg?.label || '–'}
④ Premium/Discount:  ${analysis.premDisc?.label || '–'}

═══ AGENT A (Claude) ═══
${fmtAgent(agentA, 'Claude')}

═══ AGENT B (OpenAI) ═══
${fmtAgent(agentB, 'OpenAI')}

═══ DEINE AUFGABE (Vermittler-Agent) ═══
Beide Agenten sind sich einig. Liefere das finale Urteil in diesem Format:

**Urteil:** [2–3 Sätze auf Deutsch — warum dieser Trade jetzt Sinn macht]

**Entry-Fenster:** [Wann genau einsteigen — z. B. "Sofort bei Market Order" oder "Warte auf FVG-Retest bei X"]

**Risiken:** ① [Risiko 1] ② [Risiko 2] ③ [Risiko 3]

**Konfidenz:** [Zahl zwischen 0 und 100]/100

Direkt und präzise. Nur Deutsch. Keine Einleitungen.`;
}

// ── Claude non-streaming call ─────────────────────────────────────────────────

async function callClaude(prompt, apiKey) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-opus-4-7',
      max_tokens: 400,
      messages:   [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 30000,
    }
  );
  // Strip any markdown fences before parsing
  const text = res.data.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  return JSON.parse(text);
}

// ── OpenAI non-streaming call ─────────────────────────────────────────────────

async function callOpenAI(prompt, apiKey) {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model:           'gpt-4o',
      max_tokens:      400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an ICT trading analyst. Respond only with valid JSON.' },
        { role: 'user',   content: prompt },
      ],
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type':  'application/json',
      },
      timeout: 30000,
    }
  );
  const text = res.data.choices[0].message.content.trim();
  return JSON.parse(text);
}

// ── Parse + validate verdict ──────────────────────────────────────────────────

function parseVerdict(raw) {
  const dir = (raw.direction || '').toUpperCase();
  if (!['LONG', 'SHORT', 'NO_TRADE'].includes(dir)) {
    throw new Error(`Unbekannte Richtung: "${dir}"`);
  }
  return {
    direction:    dir,
    confidence:   (['HIGH', 'MEDIUM', 'LOW'].includes((raw.confidence || '').toUpperCase())
                    ? raw.confidence.toUpperCase() : 'MEDIUM'),
    reasons:      Array.isArray(raw.reasons) ? raw.reasons.slice(0, 3) : [],
    risk_warning: typeof raw.risk_warning === 'string' ? raw.risk_warning : '',
  };
}

function noTradeResult(label, reason) {
  return { ok: false, direction: 'NO_TRADE', confidence: 'LOW', reasons: [reason], risk_warning: '', label };
}

async function safeCall(fn, label) {
  try {
    const raw    = await fn();
    const parsed = parseVerdict(raw);
    return { ok: true, label, ...parsed };
  } catch (err) {
    console.warn(`[DualValidator] ${label} fehler:`, err.message);
    return noTradeResult(label, err.message.slice(0, 120));
  }
}

// ── Main: parallel dual validation ───────────────────────────────────────────

async function dualValidate({ symbol, analysis, trade, apiKeys }) {
  const prompt = buildValidatorPrompt(symbol, analysis, trade);

  const missingA = !apiKeys.anthropic || apiKeys.anthropic.startsWith('your_');
  const missingB = !apiKeys.openai    || apiKeys.openai.startsWith('your_');

  const [agentA, agentB] = await Promise.all([
    missingA
      ? Promise.resolve(noTradeResult('Claude', 'Anthropic API-Key nicht konfiguriert'))
      : safeCall(() => callClaude(prompt, apiKeys.anthropic), 'Claude'),

    missingB
      ? Promise.resolve(noTradeResult('OpenAI', 'OpenAI API-Key nicht konfiguriert'))
      : safeCall(() => callOpenAI(prompt, apiKeys.openai), 'OpenAI'),
  ]);

  const agreement =
    agentA.direction !== 'NO_TRADE' &&
    agentB.direction !== 'NO_TRADE' &&
    agentA.direction === agentB.direction;

  const rejectionReason = !agreement
    ? (agentA.direction === 'NO_TRADE' || agentB.direction === 'NO_TRADE')
        ? 'Ein Agent hat kein klares Setup erkannt'
        : `Richtungen stimmen nicht überein (Claude: ${agentA.direction} / OpenAI: ${agentB.direction})`
    : null;

  return { agentA, agentB, agreement, direction: agreement ? agentA.direction : null, rejectionReason };
}

module.exports = { dualValidate, buildMediatorPrompt };
