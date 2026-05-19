'use strict';

const axios = require('axios');

// ── Prompt Builder ────────────────────────────────────────────────────────────

function buildPrompt(symbol, candles, analysis, trade, capital) {
  // Use last 30 candles for a compact but meaningful context
  const recent = candles.slice(-30);
  const candleTable = recent.map(c =>
    `${new Date(c.time * 1000).toISOString().slice(11,16)}  O:${c.open}  H:${c.high}  L:${c.low}  C:${c.close}`
  ).join('\n');

  const dir      = trade.direction === 'long' ? '↑ Long' : '↓ Short';
  const rrFmt    = trade.rr ? trade.rr.toFixed(2) : '–';
  const lotFmt   = trade.lot ? trade.lot.toFixed(2) : '–';

  return `Du bist ein erfahrener ICT-Trader und Marktanalyst. Analysiere die folgenden M1-Chart-Daten für ${symbol} und kommentiere die automatische ICT-Analyse.

═══ MARKTDATEN (letzte 30 M1-Kerzen) ═══
${candleTable}

═══ AUTOMATISCHE ICT-ANALYSE ═══
① Struktur:          ${analysis.structure?.label || '–'}
② Liquidität:        ${analysis.liquidity?.label || '–'}
③ FVG:               ${analysis.fvg?.label || '–'}
④ Premium/Discount:  ${analysis.premDisc?.label || '–'}

═══ TRADE-SIGNAL ═══
Richtung:   ${dir}
Entry:      ${trade.entry}
Stop Loss:  ${trade.sl}
Take Profit:${trade.tp}
RR:         1:${rrFmt}
Lot:        ${lotFmt} (Kapital: ${capital}$, Risiko: 10%)

═══ DEINE AUFGABE ═══
Schreibe einen präzisen deutschen Kommentar in genau diesem Format:

**Markteinschätzung:** [1-2 Sätze — was zeigt der Chart gerade wirklich?]

**ICT-Analyse:** [Stimmst du zu oder widersprichst du? Begründe kurz.]

**Risikofaktoren:** [1-2 konkrete Risiken die man beachten sollte]

**Empfehlung:** [Genau eine Option: "Trade nehmen ✓" / "Warten ⏳" / "Überspringen ✗"] + 1 Satz Begründung

Keine langen Einleitungen. Direkt und präzise. Nur Deutsch.`;
}

// ── SSE Helper ────────────────────────────────────────────────────────────────

function sseToken(res, token) {
  res.write(`data: ${JSON.stringify({ token })}\n\n`);
}

function sseDone(res) {
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
}

function sseError(res, message) {
  res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────

async function streamAnthropic(prompt, apiKey, res) {
  if (!apiKey || apiKey === 'your_anthropic_key_here') {
    sseError(res, 'Anthropic API-Key nicht gesetzt. Bitte in der .env-Datei eintragen.');
    return;
  }

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-opus-4-7',
      max_tokens: 800,
      stream:     true,
      messages:   [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      responseType: 'stream',
      timeout:      30000,
    }
  );

  let buffer = '';
  for await (const chunk of response.data) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        const event = JSON.parse(raw);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          sseToken(res, event.delta.text);
        }
      } catch (_) {}
    }
  }
}

// ── OpenAI-compatible (OpenAI + DeepSeek) ────────────────────────────────────

async function streamOpenAICompat(prompt, apiKey, model, baseURL, res) {
  if (!apiKey || apiKey.startsWith('your_')) {
    sseError(res, `${model} API-Key nicht gesetzt. Bitte in der .env-Datei eintragen.`);
    return;
  }

  const response = await axios.post(
    `${baseURL}/chat/completions`,
    {
      model,
      stream:   true,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type':  'application/json',
      },
      responseType: 'stream',
      timeout:      30000,
    }
  );

  let buffer = '';
  for await (const chunk of response.data) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]' || !raw) continue;
      try {
        const event = JSON.parse(raw);
        const token = event.choices?.[0]?.delta?.content;
        if (token) sseToken(res, token);
      } catch (_) {}
    }
  }
}

// ── Google Gemini ─────────────────────────────────────────────────────────────

async function streamGemini(prompt, apiKey, res) {
  if (!apiKey || apiKey === 'your_gemini_key_here') {
    sseError(res, 'Gemini API-Key nicht gesetzt. Bitte in der .env-Datei eintragen.');
    return;
  }

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 800 },
    },
    {
      headers: { 'content-type': 'application/json' },
      responseType: 'stream',
      timeout:      30000,
    }
  );

  let buffer = '';
  for await (const chunk of response.data) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        const event = JSON.parse(raw);
        const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) sseToken(res, text);
      } catch (_) {}
    }
  }
}

// ── Main Stream Dispatcher ────────────────────────────────────────────────────

async function streamAI({ provider, symbol, candles, analysis, trade, capital, apiKeys, res }) {
  // Set SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const prompt = buildPrompt(symbol, candles, analysis, trade, capital);

  try {
    switch (provider) {
      case 'anthropic':
        await streamAnthropic(prompt, apiKeys.anthropic, res);
        break;
      case 'openai':
        await streamOpenAICompat(prompt, apiKeys.openai, 'gpt-4o', 'https://api.openai.com/v1', res);
        break;
      case 'deepseek':
        await streamOpenAICompat(prompt, apiKeys.deepseek, 'deepseek-chat', 'https://api.deepseek.com', res);
        break;
      case 'gemini':
        await streamGemini(prompt, apiKeys.gemini, res);
        break;
      default:
        sseError(res, `Unbekannter Anbieter: ${provider}`);
    }
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || 'Unbekannter Fehler';
    console.error(`[AI:${provider}]`, msg);
    sseError(res, `API-Fehler (${provider}): ${msg}`);
  }

  sseDone(res);
  res.end();
}

module.exports = { streamAI };
