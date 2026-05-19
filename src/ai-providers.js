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

async function streamAI({ provider, symbol, candles, analysis, trade, capital, apiKeys, res, _customPrompt }) {
  // Set SSE headers (skip if already set — e.g. from /api/mediator)
  if (!res.headersSent) {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();
  }

  const prompt = _customPrompt || buildPrompt(symbol, candles, analysis, trade, capital);

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

// ── Claude Vision — primary ICT analysis from chart screenshot ────────────────

const INSTRUMENTS_META = {
  XAUUSD: { tag: 'GOLD · M1',  contractSize: 100, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100)', accent: '#D4AF37' },
  BTCUSD: { tag: 'BTC · M1',   contractSize: 1,   lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',   accent: '#F7931A' },
  EURUSD: { tag: 'EURUSD · M1',contractSize: 100000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100000)', accent: '#3B82F6' },
  GBPUSD: { tag: 'GBPUSD · M1',contractSize: 100000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100000)', accent: '#8B5CF6' },
  USDJPY: { tag: 'USDJPY · M1',contractSize: 100000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100000)', accent: '#EC4899' },
  GBPJPY: { tag: 'GBPJPY · M1',contractSize: 100000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100000)', accent: '#F59E0B' },
  AUDUSD: { tag: 'AUDUSD · M1',contractSize: 100000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100000)', accent: '#10B981' },
  USDCHF: { tag: 'USDCHF · M1',contractSize: 100000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100000)', accent: '#EF4444' },
  US500:  { tag: 'US500 · M1', contractSize: 50,   lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 50)',   accent: '#6366F1' },
  NAS100: { tag: 'NAS100 · M1',contractSize: 20,   lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 20)',  accent: '#06B6D4' },
  US30:   { tag: 'US30 · M1',  contractSize: 5,    lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 5)',   accent: '#84CC16' },
  GER40:  { tag: 'GER40 · M1', contractSize: 25,   lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 25)',  accent: '#F97316' },
  XAGUSD: { tag: 'SILBER · M1',contractSize: 5000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 5000)',accent: '#94A3B8' },
  USOIL:  { tag: 'OIL · M1',   contractSize: 1000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1000)', accent: '#78716C' },
  XCUUSD: { tag: 'KUPFER · M1',contractSize: 25000,lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 25000)',accent: '#B45309' },
  ETHUSD: { tag: 'ETH · M1',   contractSize: 1,    lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',   accent: '#818CF8' },
  SOLUSD: { tag: 'SOL · M1',   contractSize: 1,    lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',   accent: '#34D399' },
};

function buildCandleTable(candles) {
  return candles
    .map(c => {
      const dt = new Date(c.time * 1000);
      const ts = `${dt.getUTCHours().toString().padStart(2,'0')}:${dt.getUTCMinutes().toString().padStart(2,'0')}`;
      return `${ts}  O:${c.open}  H:${c.high}  L:${c.low}  C:${c.close}`;
    })
    .join('\n');
}

function buildClaudeVisionPrompt(symbol, capital, currentPrice, candles) {
  const meta      = INSTRUMENTS_META[symbol] || INSTRUMENTS_META['XAUUSD'];
  const last200   = candles ? candles.slice(-200) : [];
  const candlesTxt = last200.length > 0
    ? `\n═══ MARKTDATEN — letzte ${last200.length} M1-Kerzen (für präzise Berechnung) ═══\n` +
      `Zeit   Open        High        Low         Close\n` +
      buildCandleTable(last200)
    : '';

  return `Du bist ein ICT-Trading-Assistent für ${symbol} auf dem M1-Chart.
Ausgabe: komplett auf Deutsch. RR zwischen 1:1,8 und 1:4.

Du erhältst ZWEI Informationsquellen:
1. Den Chart-Screenshot → für visuelle Mustererkennung (Struktur, FVGs, Liquidität)
2. Die exakten OHLCV-Kerzendaten → für präzise numerische Berechnungen (SL, TP, Lot)
Nutze beide kombiniert. Der Screenshot zeigt was, die Zahlen bestätigen und präzisieren.

═══ INSTRUMENT-PARAMETER ═══
Symbol:          ${symbol}
Mini-Tag:        ${meta.tag}
Kontraktgröße:   ${meta.contractSize}
Lot-Formel:      ${meta.lotFormula}
Handelskapital:  ${capital} $
Aktueller Preis: ${currentPrice}
${candlesTxt}
═══ ANALYSE (4 ICT-Säulen) ═══
① Struktur — Identifiziere HH/HL (bullisch) oder LH/LL (bärisch) anhand der Swing-Punkte in den Kerzendaten
② Liquidität — Finde BSL (Swing-Highs) und SSL (Swing-Lows); prüfe ob gesweept (Kerze hat darüber/darunter geclosed)
③ FVG — Suche 3-Kerzen-Muster: Bullisch wenn C[i-2].high < C[i].low; Bärisch wenn C[i-2].low > C[i].high; nur nicht-mitigierte zählen
④ Premium / Discount — EQ = (letzter Swing-High + letzter Swing-Low) / 2; aktueller Preis darüber = Premium, darunter = Discount

═══ BERECHNUNG (mit den exakten Kerzenwerten rechnen) ═══
- Entry   = ${currentPrice} (aktueller Preis)
- SL      = hinter dem letzten relevanten Swing-Punkt + Puffer (exakten Low/High aus den Daten nehmen)
- TP      = nächste Liquidität auf der Zielseite die RR 1:1,8–1:4 ergibt
- Lot     = ${meta.lotFormula}, gerundet auf 0,01
- tpPnl   = Lot × |TP − Entry| × ${meta.contractSize}
- slPnl   = Lot × |Entry − SL| × ${meta.contractSize}
- riskPct   = (slPnl / ${capital}) × 100
- rewardPct = (tpPnl / ${capital}) × 100
- RR      = |TP − Entry| / |Entry − SL|

═══ AUSGABE ═══
Antworte AUSSCHLIESSLICH mit diesem JSON — kein Text davor oder danach, kein Markdown:

{
  "structure": { "label": "Bullisch · HH+HL bestätigt", "trend": "bullish" },
  "liquidity": { "label": "BSL bei X.XX gesweept ✓\\nSSL bei Y.YY noch offen" },
  "fvg":       { "label": "↑ Bullisch FVG · X.XX–Y.YY\\nNicht mitigiert", "type": "bullish" },
  "premDisc":  { "label": "Discount · EQ bei X.XX", "zone": "discount" },
  "trade": {
    "direction":  "long",
    "entry":      0.00,
    "sl":         0.00,
    "tp":         0.00,
    "rr":         0.00,
    "lot":        0.00,
    "tpPnl":      0.00,
    "slPnl":      0.00,
    "riskPct":    10.00,
    "rewardPct":  0.00
  }
}

Regeln:
- direction: "long" oder "short"
- trend: "bullish" / "bearish" / "neutral"
- type (FVG): "bullish" / "bearish" / "none"
- zone: "premium" / "discount"
- Alle Preisangaben aus den echten Kerzendaten — keine Schätzungen
- SL und TP müssen reale Levels aus den Swing-Daten sein`;
}

async function callClaudeVision({ image, symbol, capital, currentPrice, candles, apiKey }) {
  const prompt = buildClaudeVisionPrompt(symbol, capital, currentPrice, candles);

  // image is optional — when null (e.g. headless scheduler), send text-only
  const content = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
        { type: 'text',  text: prompt },
      ]
    : prompt;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-opus-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content }],
    },
    {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 45000,
    }
  );

  const raw  = response.data.content[0].text.trim()
    .replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  const json = JSON.parse(raw);

  // Validate required fields
  if (!json.trade || !json.structure || !json.liquidity || !json.fvg || !json.premDisc) {
    throw new Error('Claude Vision: unvollständige Antwort');
  }

  return json;
}

module.exports = { streamAI, callClaudeVision, streamAnthropicRaw, sseToken, sseDone, sseError };

// ── Raw streaming helpers (re-exported for mediator) ─────────────────────────

async function streamAnthropicRaw(prompt, apiKey, res) {
  await streamAnthropic(prompt, apiKey, res);
}
