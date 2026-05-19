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
  // Commodities
  XAUUSD:   { tag: 'GOLD · M1',    contractSize: 100,   lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 100)',    accent: '#D4AF37' },
  XAGUSD:   { tag: 'SILBER · M1',  contractSize: 5000,  lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 5000)',   accent: '#94A3B8' },
  USOIL:    { tag: 'OIL · M1',     contractSize: 1000,  lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1000)',   accent: '#78716C' },
  XCUUSD:   { tag: 'KUPFER · M1',  contractSize: 25000, lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 25000)',  accent: '#B45309' },
  // Indices
  US500:    { tag: 'US500 · M1',   contractSize: 50,    lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 50)',     accent: '#6366F1' },
  NAS100:   { tag: 'NAS100 · M1',  contractSize: 20,    lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 20)',     accent: '#06B6D4' },
  US30:     { tag: 'US30 · M1',    contractSize: 5,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 5)',      accent: '#84CC16' },
  GER40:    { tag: 'GER40 · M1',   contractSize: 25,    lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 25)',     accent: '#F97316' },
  // Crypto
  BTCUSD:   { tag: 'BTC · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#F7931A' },
  ETHUSD:   { tag: 'ETH · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#818CF8' },
  SOLUSD:   { tag: 'SOL · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#34D399' },
  XRPUSD:   { tag: 'XRP · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#00AAE4' },
  BNBUSD:   { tag: 'BNB · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#F3BA2F' },
  ADAUSD:   { tag: 'ADA · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#0033AD' },
  DOGEUSD:  { tag: 'DOGE · M1',    contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#C2A633' },
  LTCUSD:   { tag: 'LTC · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#BFBBBB' },
  DOTUSD:   { tag: 'DOT · M1',     contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#E6007A' },
  LINKUSD:  { tag: 'LINK · M1',    contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#2A5ADA' },
  AVAXUSD:  { tag: 'AVAX · M1',    contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#E84142' },
  MATICUSD: { tag: 'MATIC · M1',   contractSize: 1,     lotFormula: '(Kapital × 0,10) / (|Entry − SL| × 1)',      accent: '#8247E5' },
};

// Returns instrument meta with smart fallback for forex pairs not explicitly listed
function getInstrumentMeta(symbol) {
  const up = symbol.toUpperCase();
  if (INSTRUMENTS_META[up]) return INSTRUMENTS_META[up];
  // Standard forex pairs all have contractSize 100000
  const forex100k = { tag: `${up} · M1`, contractSize: 100000,
    lotFormula: `(Kapital × 0,10) / (|Entry − SL| × 100000)`, accent: '#3A9BD5' };
  // Crypto/alts (symbol ends with USD, contract 1)
  const cryptoDefault = { tag: `${up} · M1`, contractSize: 1,
    lotFormula: `(Kapital × 0,10) / (|Entry − SL| × 1)`, accent: '#94A3B8' };

  if (up.endsWith('JPY')) return forex100k;
  if (up.length === 6 && !up.startsWith('X')) return forex100k; // 6-char forex like EURUSD
  if (up.endsWith('USD') && up.length <= 8) return cryptoDefault;
  return INSTRUMENTS_META['XAUUSD']; // true fallback
}

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
  const meta     = getInstrumentMeta(symbol);
  const last200  = candles ? candles.slice(-200) : [];
  const candlesTxt = last200.length > 0
    ? `\n═══ MARKTDATEN — letzte ${last200.length} M1-Kerzen ═══\n` +
      `Zeit   Open        High        Low         Close\n` +
      buildCandleTable(last200)
    : '';

  return `Du bist ein ICT-Trading-Assistent für ${symbol} auf dem M1-Chart.
Ausgabe: komplett auf Deutsch. RR-Ziel: zwischen 1:1,8 und 1:4.

WICHTIG: Du bist kein Signalgeber, der immer einen Trade finden muss.
Deine Hauptaufgabe ist es, schlechte, späte oder unsaubere Trades auszufiltern.
No Trade ist ein vollkommen gültiges Ergebnis.

Analysiere ausschließlich den sichtbaren Screenshot und die bereitgestellten Kerzendaten.
Erfinde keine unsichtbaren HTF-Daten. Erfinde keine News. Erfinde keine Sessions.
Nutze nur was im Screenshot und in den Kerzendaten sichtbar ist.

═══ INSTRUMENT-PARAMETER ═══
Symbol:          ${symbol}
Mini-Tag:        ${meta.tag}
Kontraktgröße:   ${meta.contractSize}
Lot-Formel:      ${meta.lotFormula}
Handelskapital:  ${capital} $
Aktueller Preis: ${currentPrice}
${candlesTxt}

═══ ANALYSE (4 ICT-Säulen) ═══
① Struktur — HH/HL (bullisch) oder LH/LL (bärisch) · letzter Strukturbruch (MSS/CHOCH) sichtbar?
② Liquidität — BSL (Swing-Highs) · SSL (Swing-Lows) · bereits gesweept oder noch offen?
③ FVG — Bullisch: C[i-2].high < C[i].low · Bärisch: C[i-2].low > C[i].high · mitigiert oder offen?
④ Premium/Discount — EQ = (sichtbares High + Low) / 2 · Preis in Premium, Discount oder Mitte?

═══ SETUP-SCORE (0–16 Punkte) ═══
Bewerte jedes Kriterium mit 0–2 Punkten:
- Struktur klar:             0–2
- Liquidität sichtbar:       0–2
- Sweep vorhanden:           0–2
- MSS/CHOCH bestätigt:       0–2
- Displacement sauber:       0–2
- FVG/Retest-Zone vorhanden: 0–2
- Premium/Discount passend:  0–2
- RR + SL logisch:           0–2

→ Ab 12/16 Punkten: TRADE.
→ Unter 12 Punkten: NO_TRADE mit Watch-Zones.

═══ ENTSCHEIDUNGSLOGIK ═══
Prüfe vor jedem Trade alle 9 Bedingungen:
1. Gibt es einen sichtbaren Liquiditäts-Sweep?
2. Gibt es danach einen klaren MSS/CHOCH?
3. Gibt es ein sauberes Displacement?
4. Gibt es einen nicht mitigierten FVG oder eine klare Retest-Zone?
5. Liegt der Entry logisch in Premium oder Discount?
6. Ist der SL hinter einem echten strukturellen Punkt?
7. Liegt der TP an sichtbarer Gegen-Liquidität?
8. Ist das RR zwischen 1:1,8 und 1:4?
9. Ist der Trade nicht zu spät (kein bereits gelaufener Move)?

Mindestens 7 von 9 UND Score ≥ 12/16 → TRADE. Sonst → NO_TRADE.

═══ BERECHNUNG (nur wenn TRADE) ═══
- Entry: aktueller Preis ODER sinnvolle sichtbare Entry-Zone — NICHT mitten im Move
- SL: hinter letztem strukturellen Punkt + kleiner Puffer — nicht willkürlich
- TP: erste sichtbare Gegen-Liquidität mit RR zwischen 1,8 und 4,0
- Lot = ${meta.lotFormula} (auf 0,01 runden)
- tpPnl   = Lot × |TP − Entry| × ${meta.contractSize}
- slPnl   = Lot × |Entry − SL| × ${meta.contractSize}
- riskPct   = (|slPnl| / ${capital}) × 100
- rewardPct = (tpPnl / ${capital}) × 100

═══ AUSGABE ═══
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt — kein Text, kein Markdown.

Wenn TRADE (Score ≥ 12):
{
  "decision": "TRADE",
  "setup_score": 13,
  "structure": { "label": "...", "trend": "bullish" },
  "liquidity": { "label": "..." },
  "fvg":       { "label": "...", "type": "bullish" },
  "premDisc":  { "label": "...", "zone": "discount", "eq": 0.0 },
  "trade": {
    "direction":  "long",
    "entry":      0.0,
    "sl":         0.0,
    "tp":         0.0,
    "rr":         0.0,
    "lot":        0.0,
    "tpPnl":      0.0,
    "slPnl":      0.0,
    "riskPct":    0.0,
    "rewardPct":  0.0
  }
}

Wenn NO_TRADE (Score < 12):
{
  "decision": "NO_TRADE",
  "setup_score": 7,
  "structure": { "label": "...", "trend": "neutral" },
  "liquidity": { "label": "..." },
  "fvg":       { "label": "...", "type": "none" },
  "premDisc":  { "label": "...", "zone": "discount", "eq": 0.0 },
  "no_trade": {
    "reason": "Kurze Erklärung warum kein Trade",
    "watch_zones": [
      {
        "type": "long",
        "price_range": "0.0–0.0",
        "why": "Warum diese Zone interessant ist",
        "conditions": "Was passieren muss für einen gültigen Entry",
        "valid_if": "Gültigkeitsbedingung",
        "invalid_if": "Invalidierung"
      },
      {
        "type": "short",
        "price_range": "0.0–0.0",
        "why": "Warum diese Zone interessant ist",
        "conditions": "Was passieren muss für einen gültigen Entry",
        "valid_if": "Gültigkeitsbedingung",
        "invalid_if": "Invalidierung"
      }
    ]
  }
}

Regeln:
- decision: "TRADE" oder "NO_TRADE"
- direction (wenn TRADE): "long" oder "short"
- trend: "bullish" / "bearish" / "neutral"
- type (FVG): "bullish" / "bearish" / "none"
- zone: "premium" / "discount"
- Alle Preisangaben aus sichtbaren Chart-Levels
- watch_zones: genau 2 Zonen (eine long, eine short) nur aus sichtbaren Chart-Bereichen`;
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

async function callOpenAIAnalysis({ image, symbol, capital, currentPrice, candles, apiKey }) {
  const prompt = buildClaudeVisionPrompt(symbol, capital, currentPrice, candles);

  const userContent = image
    ? [
        { type: 'text',      text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image}`, detail: 'high' } },
      ]
    : prompt;

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model:           'gpt-4o',
      max_tokens:      1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Du bist ein ICT-Trading-Analyst. Antworte ausschließlich mit gültigem JSON.' },
        { role: 'user',   content: userContent },
      ],
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type':  'application/json',
      },
      timeout: 60000,
    }
  );

  const text = response.data.choices[0].message.content.trim();
  return JSON.parse(text);
}

module.exports = { streamAI, callClaudeVision, callOpenAIAnalysis, streamAnthropicRaw, sseToken, sseDone, sseError };

// ── Raw streaming helpers (re-exported for mediator) ─────────────────────────

async function streamAnthropicRaw(prompt, apiKey, res) {
  await streamAnthropic(prompt, apiKey, res);
}
