'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { fetchTimeSeries, fetchTimeSeriesCached, fetchPrice, toTDSymbol, isSymbolLive, WS_URL } = require('./src/twelvedata');
const { streamAI, callClaudeVision, callOpenAIAnalysis, sseToken, sseDone, sseError } = require('./src/ai-providers');
const { dualValidate, buildMediatorPrompt, buildMediatorWatchZonePrompt }            = require('./src/dual-validator');
const scheduler                                                         = require('./src/scheduler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const PORT = process.env.PORT || 3000;


// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Page Routes ─────────────────────────────────────────────────────────────
app.get('/journal', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'journal.html'));
});

app.get('/pairs', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pairs.html'));
});


// ─── REST: Candles ───────────────────────────────────────────────────────────
app.get('/api/candles', async (req, res) => {
  const symbol     = (req.query.symbol || 'XAUUSD').toUpperCase();
  const interval   = req.query.interval || '1min';
  const outputsize = parseInt(req.query.outputsize) || 200;

  try {
    const candles = await fetchTimeSeriesCached(symbol, interval, outputsize, API_KEY);
    res.json({ success: true, symbol, candles, source: 'live' });
  } catch (err) {
    console.error(`[/api/candles] ${symbol}:`, err.message);
    res.status(200).json({ success: false, symbol, error: err.message, candles: [] });
  }
});

// ─── REST: Price ─────────────────────────────────────────────────────────────
app.get('/api/price', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'XAUUSD';
    const price = await fetchPrice(symbol, API_KEY);
    res.json({ success: true, symbol, price });
  } catch (err) {
    console.error('[/api/price]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── REST: Pairs Status (SSE) — diagnostic check of all instruments ──────────
const PAIRS_STATUS_LIST = [
  // Forex Majors
  { symbol: 'EURUSD',   name: 'EUR/USD',   group: 'Forex'     },
  { symbol: 'GBPUSD',   name: 'GBP/USD',   group: 'Forex'     },
  { symbol: 'USDJPY',   name: 'USD/JPY',   group: 'Forex'     },
  { symbol: 'USDCHF',   name: 'USD/CHF',   group: 'Forex'     },
  { symbol: 'AUDUSD',   name: 'AUD/USD',   group: 'Forex'     },
  { symbol: 'USDCAD',   name: 'USD/CAD',   group: 'Forex'     },
  { symbol: 'NZDUSD',   name: 'NZD/USD',   group: 'Forex'     },
  // EUR Crosses
  { symbol: 'EURGBP',   name: 'EUR/GBP',   group: 'Forex'     },
  { symbol: 'EURJPY',   name: 'EUR/JPY',   group: 'Forex'     },
  { symbol: 'EURCHF',   name: 'EUR/CHF',   group: 'Forex'     },
  { symbol: 'EURAUD',   name: 'EUR/AUD',   group: 'Forex'     },
  { symbol: 'EURCAD',   name: 'EUR/CAD',   group: 'Forex'     },
  { symbol: 'EURNZD',   name: 'EUR/NZD',   group: 'Forex'     },
  // GBP Crosses
  { symbol: 'GBPJPY',   name: 'GBP/JPY',   group: 'Forex'     },
  { symbol: 'GBPCHF',   name: 'GBP/CHF',   group: 'Forex'     },
  { symbol: 'GBPAUD',   name: 'GBP/AUD',   group: 'Forex'     },
  { symbol: 'GBPCAD',   name: 'GBP/CAD',   group: 'Forex'     },
  { symbol: 'GBPNZD',   name: 'GBP/NZD',   group: 'Forex'     },
  // JPY Crosses
  { symbol: 'AUDJPY',   name: 'AUD/JPY',   group: 'Forex'     },
  { symbol: 'CADJPY',   name: 'CAD/JPY',   group: 'Forex'     },
  { symbol: 'CHFJPY',   name: 'CHF/JPY',   group: 'Forex'     },
  { symbol: 'NZDJPY',   name: 'NZD/JPY',   group: 'Forex'     },
  // Other Crosses
  { symbol: 'AUDCAD',   name: 'AUD/CAD',   group: 'Forex'     },
  { symbol: 'AUDCHF',   name: 'AUD/CHF',   group: 'Forex'     },
  { symbol: 'AUDNZD',   name: 'AUD/NZD',   group: 'Forex'     },
  { symbol: 'CADCHF',   name: 'CAD/CHF',   group: 'Forex'     },
  { symbol: 'NZDCAD',   name: 'NZD/CAD',   group: 'Forex'     },
  { symbol: 'NZDCHF',   name: 'NZD/CHF',   group: 'Forex'     },
  // Indices
  { symbol: 'US500',    name: 'US500',      group: 'Indizes'   },
  { symbol: 'NAS100',   name: 'NAS100',     group: 'Indizes'   },
  { symbol: 'US30',     name: 'US30',       group: 'Indizes'   },
  { symbol: 'GER40',    name: 'GER40',      group: 'Indizes'   },
  // Commodities
  { symbol: 'XAUUSD',   name: 'Gold',       group: 'Rohstoffe' },
  { symbol: 'XAGUSD',   name: 'Silber',     group: 'Rohstoffe' },
  { symbol: 'USOIL',    name: 'WTI Öl',     group: 'Rohstoffe' },
  { symbol: 'XCUUSD',   name: 'Kupfer',     group: 'Rohstoffe' },
  // Crypto
  { symbol: 'BTCUSD',   name: 'Bitcoin',    group: 'Krypto'    },
  { symbol: 'ETHUSD',   name: 'Ethereum',   group: 'Krypto'    },
  { symbol: 'SOLUSD',   name: 'Solana',     group: 'Krypto'    },
  { symbol: 'XRPUSD',   name: 'XRP',        group: 'Krypto'    },
  { symbol: 'BNBUSD',   name: 'BNB',        group: 'Krypto'    },
  { symbol: 'ADAUSD',   name: 'Cardano',    group: 'Krypto'    },
  { symbol: 'DOGEUSD',  name: 'Dogecoin',   group: 'Krypto'    },
  { symbol: 'LTCUSD',   name: 'Litecoin',   group: 'Krypto'    },
  { symbol: 'DOTUSD',   name: 'Polkadot',   group: 'Krypto'    },
  { symbol: 'LINKUSD',  name: 'Chainlink',  group: 'Krypto'    },
  { symbol: 'AVAXUSD',  name: 'Avalanche',  group: 'Krypto'    },
  { symbol: 'MATICUSD', name: 'Polygon',    group: 'Krypto'    },
];

app.get('/api/pairs-status', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('start', { total: PAIRS_STATUS_LIST.length });

  for (let i = 0; i < PAIRS_STATUS_LIST.length; i++) {
    const inst = PAIRS_STATUS_LIST[i];
    try {
      const price = await fetchPrice(inst.symbol, API_KEY);
      send('result', { ...inst, price, status: 'live', index: i });
    } catch (err) {
      const msg    = err.message || '';
      const status = msg.includes('429') || msg.toLowerCase().includes('rate') ? 'rate_limit' : 'unavailable';
      send('result', { ...inst, price: null, status, error: msg.slice(0, 120), index: i });
    }
    // Respect Free Plan rate limit: 8 req/min ≈ 1 per 8s
    if (i < PAIRS_STATUS_LIST.length - 1) await new Promise(r => setTimeout(r, 8000));
  }

  send('done', { total: PAIRS_STATUS_LIST.length });
  res.end();
});

// ─── REST: Claude Vision — primary ICT analysis from chart screenshot ────────
app.post('/api/claude-analyze', async (req, res) => {
  const { image, symbol, capital, currentPrice, candles } = req.body;

  if (!image || !symbol || !capital) {
    return res.status(400).json({ error: 'Fehlende Parameter: image, symbol, capital' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY nicht konfiguriert' });
  }

  try {
    const result = await callClaudeVision({ image, symbol, capital, currentPrice, candles, apiKey });
    res.json({ success: true, result });
  } catch (err) {
    console.error('[/api/claude-analyze]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── REST: Dual-KI Quality Gate ──────────────────────────────────────────────
app.post('/api/dual-validate', async (req, res) => {
  const { symbol, analysis, trade, capital, primaryVerdict } = req.body;
  if (!symbol || !analysis || !trade) {
    return res.status(400).json({ error: 'Fehlende Parameter' });
  }

  const apiKeys = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
  };

  try {
    const result = await dualValidate({ symbol, analysis, trade, apiKeys, primaryVerdict });
    res.json(result);
  } catch (err) {
    console.error('[/api/dual-validate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST: Dual Analyze — Claude + OpenAI independent full ICT analysis ────────
app.post('/api/dual-analyze', async (req, res) => {
  const { image, symbol, capital, currentPrice, candles } = req.body;

  if (!symbol || !capital) {
    return res.status(400).json({ success: false, error: 'Fehlende Parameter: symbol, capital' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;

  const [claudeResult, openaiResult] = await Promise.allSettled([
    (anthropicKey && !anthropicKey.startsWith('your_'))
      ? callClaudeVision({ image, symbol, capital, currentPrice, candles, apiKey: anthropicKey })
      : Promise.reject(new Error('Anthropic API-Key nicht konfiguriert')),

    (openaiKey && !openaiKey.startsWith('your_'))
      ? callOpenAIAnalysis({ image, symbol, capital, currentPrice, candles, apiKey: openaiKey })
      : Promise.reject(new Error('OpenAI API-Key nicht konfiguriert')),
  ]);

  const agentA = claudeResult.status === 'fulfilled'
    ? { ...claudeResult.value, label: 'Claude', ok: true }
    : { decision: 'ERROR', label: 'Claude', ok: false, error: claudeResult.reason?.message || 'Fehler' };

  const agentB = openaiResult.status === 'fulfilled'
    ? { ...openaiResult.value, label: 'GPT-4o', ok: true }
    : { decision: 'ERROR', label: 'GPT-4o', ok: false, error: openaiResult.reason?.message || 'Fehler' };

  const agreement =
    agentA.decision === 'TRADE' &&
    agentB.decision === 'TRADE' &&
    (agentA.trade?.direction || '').toLowerCase() === (agentB.trade?.direction || '').toLowerCase();

  console.log(`[/api/dual-analyze] ${symbol} — Claude: ${agentA.decision}, GPT-4o: ${agentB.decision}, Agreement: ${agreement}`);

  res.json({ success: true, agentA, agentB, agreement, symbol, capital });
});

// ─── REST: Mediator Agent (SSE streaming) ────────────────────────────────────
app.post('/api/mediator', async (req, res) => {
  const { symbol, analysis, trade, capital, agentA, agentB } = req.body;
  if (!symbol || !analysis || !trade || !agentA || !agentB) {
    return res.status(400).json({ error: 'Fehlende Parameter' });
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const prompt  = buildMediatorPrompt(symbol, analysis, trade, capital, agentA, agentB);
  const apiKeys = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
  };

  try {
    // Prefer Claude for mediator; fall back to OpenAI
    if (apiKeys.anthropic && !apiKeys.anthropic.startsWith('your_')) {
      await streamAI({ provider: 'anthropic', symbol, candles: [], analysis, trade, capital, apiKeys, res,
                       _customPrompt: prompt });
    } else if (apiKeys.openai && !apiKeys.openai.startsWith('your_')) {
      await streamAI({ provider: 'openai', symbol, candles: [], analysis, trade, capital, apiKeys, res,
                       _customPrompt: prompt });
    } else {
      sseError(res, 'Kein Mediator-API-Key konfiguriert');
    }
  } catch (err) {
    sseError(res, err.message);
  }

  sseDone(res);
  res.end();
});

// ─── REST: Mediator Watch Zones (SSE streaming) — when agents disagree ────────
app.post('/api/mediator-watchzones', async (req, res) => {
  const { symbol, agentA, agentB } = req.body;
  if (!symbol || !agentA || !agentB) {
    return res.status(400).json({ error: 'Fehlende Parameter' });
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const prompt  = buildMediatorWatchZonePrompt(symbol, agentA, agentB);
  const apiKeys = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
  };

  try {
    if (apiKeys.anthropic && !apiKeys.anthropic.startsWith('your_')) {
      await streamAI({ provider: 'anthropic', symbol, candles: [], analysis: {}, trade: {}, capital: 0, apiKeys, res,
                       _customPrompt: prompt });
    } else if (apiKeys.openai && !apiKeys.openai.startsWith('your_')) {
      await streamAI({ provider: 'openai', symbol, candles: [], analysis: {}, trade: {}, capital: 0, apiKeys, res,
                       _customPrompt: prompt });
    } else {
      sseError(res, 'Kein API-Key konfiguriert');
    }
  } catch (err) {
    sseError(res, err.message);
  }

  sseDone(res);
  res.end();
});

// ─── REST: AI Analyze (SSE streaming) ────────────────────────────────────────
app.post('/api/ai-analyze', async (req, res) => {
  const { provider, symbol, candles, analysis, trade, capital } = req.body;

  if (!provider || !symbol || !candles || !analysis || !trade) {
    return res.status(400).json({ error: 'Fehlende Parameter' });
  }

  const apiKeys = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    deepseek:  process.env.DEEPSEEK_API_KEY,
    gemini:    process.env.GEMINI_API_KEY,
  };

  // streamAI sets SSE headers and writes to res directly
  await streamAI({ provider, symbol, candles, analysis, trade, capital, apiKeys, res });
});

// ─── WebSocket relay ─────────────────────────────────────────────────────────

// Track which symbols each browser client is subscribed to
const clientSubscriptions = new Map(); // ws -> Set<symbol>

// Demo tick simulator state (used when real WS unavailable)
let demoMode = false;
let demoTickInterval = null;
const demoPrices = {}; // symbol -> current simulated price

// Simulate realistic price movement for demo mode
const DEMO_BASES_SERVER = {
  EURUSD: 1.08450, GBPUSD: 1.27320, USDJPY: 149.650, GBPJPY: 190.420,
  AUDUSD: 0.65180, USDCHF: 0.89750,
  US500: 5280.50, NAS100: 18420.00, US30: 39150.00, GER40: 18320.00,
  XAUUSD: 3241.50, XAGUSD: 32.450, USOIL: 78.35, XCUUSD: 4.4250,
  BTCUSD: 67850.00, ETHUSD: 3480.00, SOLUSD: 172.50,
};

const DEMO_VOL_PCT = {
  BTCUSD: 0.0003, ETHUSD: 0.0004, SOLUSD: 0.0005,
  US500: 0.00006, NAS100: 0.00008, US30: 0.00005, GER40: 0.00007,
  XAUUSD: 0.00008, XAGUSD: 0.00012, USOIL: 0.00012, XCUUSD: 0.00012,
};

function initDemoPrice(symbol) {
  if (!demoPrices[symbol]) {
    demoPrices[symbol] = DEMO_BASES_SERVER[symbol] || 1.0;
  }
}

function tickDemoPrice(symbol) {
  initDemoPrice(symbol);
  const base = demoPrices[symbol];
  const volPct = DEMO_VOL_PCT[symbol] || 0.00003; // forex default
  const vol = base * volPct;
  const dec = ['EURUSD','GBPUSD','AUDUSD','USDCHF'].includes(symbol) ? 5
            : ['USDJPY','GBPJPY'].includes(symbol) ? 3
            : ['XAGUSD','XCUUSD'].includes(symbol) ? 4 : 2;
  demoPrices[symbol] = parseFloat((base + (Math.random() - 0.5) * 2 * vol).toFixed(dec));
  return demoPrices[symbol];
}

function startDemoTicks() {
  if (demoTickInterval) return;
  console.log('[WS] Demo mode: simulating live price ticks');
  demoMode = true;

  demoTickInterval = setInterval(() => {
    const activeSymbols = getSubscribedSymbols();
    if (activeSymbols.size === 0) return;

    for (const sym of activeSymbols) {
      // Only tick symbols that have real candle data — don't fake prices
      // for symbols the Free Plan doesn't support
      if (!isSymbolLive(sym)) continue;
      const price = tickDemoPrice(sym);
      const tick = {
        type:      'tick',
        symbol:    sym,
        price,
        timestamp: Math.floor(Date.now() / 1000),
      };
      broadcast(tick);
    }
  }, 1000); // tick every second, like TwelveData WS
}

function stopDemoTicks() {
  if (demoTickInterval) {
    clearInterval(demoTickInterval);
    demoTickInterval = null;
  }
  demoMode = false;
}

// Single upstream TwelveData WebSocket connection
let tdWs = null;
let tdConnecting = false;
let tdConnected = false;
let tdFailCount = 0;
const MAX_TD_FAILS = 2; // after this many failures, switch to demo mode
const pendingSubscriptions = new Set(); // symbols to subscribe when connected

function getSubscribedSymbols() {
  const all = new Set();
  for (const syms of clientSubscriptions.values()) {
    for (const s of syms) all.add(s);
  }
  return all;
}

function connectTwelveDataWS() {
  if (tdConnecting || tdConnected) return;
  if (demoMode) return; // already in demo mode, don't keep trying

  tdConnecting = true;

  console.log('[WS] Connecting to TwelveData WebSocket...');
  tdWs = new WebSocket(`${WS_URL}?apikey=${API_KEY}`);

  tdWs.on('open', () => {
    tdConnecting = false;
    tdConnected = true;
    tdFailCount = 0;
    console.log('[WS] Connected to TwelveData');
    stopDemoTicks();

    // Subscribe to all pending symbols
    const syms = [...getSubscribedSymbols(), ...pendingSubscriptions];
    pendingSubscriptions.clear();
    if (syms.length > 0) {
      subscribeTD(syms);
    }
  });

  tdWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // TwelveData sends heartbeat, subscribe confirm, and price events
      if (msg.event === 'price') {
        const tick = {
          type:      'tick',
          symbol:    msg.symbol, // e.g. "XAU/USD" -> normalized in client
          price:     parseFloat(msg.price),
          timestamp: msg.timestamp,
        };
        broadcast(tick);
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  tdWs.on('close', (code, reason) => {
    tdConnecting = false;
    tdConnected = false;
    tdFailCount++;

    if (code === 403 || (reason && reason.toString().includes('403')) || tdFailCount >= MAX_TD_FAILS) {
      console.warn(`[WS] TwelveData WS access denied (code=${code}), switching to demo mode`);
      startDemoTicks();
      return; // don't reconnect
    }

    console.log(`[WS] TwelveData connection closed (${code}), reconnecting in 5s...`);
    setTimeout(connectTwelveDataWS, 5000);
  });

  tdWs.on('error', (err) => {
    tdConnecting = false;
    tdConnected = false;
    tdFailCount++;
    console.error('[WS] TwelveData error:', err.message);

    try { tdWs.terminate(); } catch(e) {}

    if (tdFailCount >= MAX_TD_FAILS) {
      console.warn('[WS] TwelveData repeatedly failing, switching to demo mode');
      startDemoTicks();
      return;
    }

    setTimeout(connectTwelveDataWS, 5000);
  });
}

function subscribeTD(symbols) {
  if (!tdConnected || !tdWs) {
    symbols.forEach(s => pendingSubscriptions.add(s));
    if (!demoMode) connectTwelveDataWS();
    return;
  }
  const tdSymbols = symbols.map(s => toTDSymbol(s));
  tdWs.send(JSON.stringify({
    action: 'subscribe',
    params: { symbols: tdSymbols },
  }));
  console.log('[WS] Subscribed to:', tdSymbols);
}

function unsubscribeTD(symbols) {
  if (!tdConnected || !tdWs) return;
  const remaining = getSubscribedSymbols();
  const toUnsub = symbols.filter(s => !remaining.has(s));
  if (toUnsub.length === 0) return;
  const tdSymbols = toUnsub.map(s => toTDSymbol(s));
  tdWs.send(JSON.stringify({
    action: 'unsubscribe',
    params: { symbols: tdSymbols },
  }));
  console.log('[WS] Unsubscribed from:', tdSymbols);
}

function broadcast(payload) {
  const json = JSON.stringify(payload);
  for (const [client] of clientSubscriptions) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// Browser WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('[WS] Browser client connected');
  clientSubscriptions.set(ws, new Set());

  // Send welcome
  ws.send(JSON.stringify({ type: 'connected', message: 'ICT Sniper relay ready' }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.action === 'subscribe' && msg.symbol) {
        const syms = Array.isArray(msg.symbol) ? msg.symbol : [msg.symbol];
        const clientSyms = clientSubscriptions.get(ws);
        syms.forEach(s => clientSyms.add(s.toUpperCase()));

        if (demoMode) {
          // In demo mode, just make sure demo ticks are running
          syms.forEach(s => initDemoPrice(s.toUpperCase()));
          if (!demoTickInterval) startDemoTicks();
        } else if (!tdConnected) {
          syms.forEach(s => pendingSubscriptions.add(s.toUpperCase()));
          connectTwelveDataWS();
        } else {
          subscribeTD(syms.map(s => s.toUpperCase()));
        }
      }

      if (msg.action === 'unsubscribe' && msg.symbol) {
        const syms = Array.isArray(msg.symbol) ? msg.symbol : [msg.symbol];
        const clientSyms = clientSubscriptions.get(ws);
        syms.forEach(s => clientSyms.delete(s.toUpperCase()));
        if (!demoMode) unsubscribeTD(syms.map(s => s.toUpperCase()));
      }
    } catch (e) {
      // ignore
    }
  });

  ws.on('close', () => {
    const syms = [...(clientSubscriptions.get(ws) || [])];
    clientSubscriptions.delete(ws);
    if (syms.length > 0 && !demoMode) {
      unsubscribeTD(syms);
    }
    console.log('[WS] Browser client disconnected');
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), mode: demoMode ? 'demo' : 'live' });
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ICT Sniper running at http://localhost:${PORT}\n`);
  // Pre-connect to TwelveData WS for XAUUSD; will fall back to demo mode if needed
  pendingSubscriptions.add('XAUUSD');
  connectTwelveDataWS();
  // Start Telegram signal scheduler (07:00–21:00 Berlin, every 30 min)
  scheduler.start();
});

// ─── Graceful shutdown (PM2 / SIGTERM) ───────────────────────────────────────
function shutdown() {
  console.log('\n[Server] Shutting down gracefully...');
  if (demoTickInterval) clearInterval(demoTickInterval);
  if (tdWs) try { tdWs.terminate(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000); // hard kill after 5s
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
