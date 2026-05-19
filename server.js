'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { fetchTimeSeries, fetchPrice, toTDSymbol, WS_URL } = require('./src/twelvedata');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const PORT = process.env.PORT || 3000;

// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── REST: Candles ───────────────────────────────────────────────────────────
app.get('/api/candles', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'XAUUSD';
    const interval = req.query.interval || '1min';
    const outputsize = parseInt(req.query.outputsize) || 200;

    const candles = await fetchTimeSeries(symbol, interval, outputsize, API_KEY);
    res.json({ success: true, symbol, candles });
  } catch (err) {
    console.error('[/api/candles]', err.message);
    res.status(500).json({ success: false, error: err.message });
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

// ─── WebSocket relay ─────────────────────────────────────────────────────────

// Track which symbols each browser client is subscribed to
const clientSubscriptions = new Map(); // ws -> Set<symbol>

// Single upstream TwelveData WebSocket connection
let tdWs = null;
let tdConnecting = false;
let tdConnected = false;
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
  tdConnecting = true;

  console.log('[WS] Connecting to TwelveData WebSocket...');
  tdWs = new WebSocket(`${WS_URL}?apikey=${API_KEY}`);

  tdWs.on('open', () => {
    tdConnecting = false;
    tdConnected = true;
    console.log('[WS] Connected to TwelveData');

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
          type: 'tick',
          symbol: msg.symbol, // e.g. "XAU/USD"
          price: parseFloat(msg.price),
          timestamp: msg.timestamp,
        };
        broadcast(tick);
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  tdWs.on('close', () => {
    tdConnecting = false;
    tdConnected = false;
    console.log('[WS] TwelveData connection closed, reconnecting in 5s...');
    setTimeout(connectTwelveDataWS, 5000);
  });

  tdWs.on('error', (err) => {
    tdConnecting = false;
    tdConnected = false;
    console.error('[WS] TwelveData error:', err.message);
    tdWs.terminate();
    setTimeout(connectTwelveDataWS, 5000);
  });
}

function subscribeTD(symbols) {
  if (!tdConnected || !tdWs) {
    symbols.forEach(s => pendingSubscriptions.add(s));
    connectTwelveDataWS();
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

        // Connect and subscribe upstream if needed
        if (!tdConnected) {
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
        unsubscribeTD(syms.map(s => s.toUpperCase()));
      }
    } catch (e) {
      // ignore
    }
  });

  ws.on('close', () => {
    const syms = [...(clientSubscriptions.get(ws) || [])];
    clientSubscriptions.delete(ws);
    if (syms.length > 0) {
      unsubscribeTD(syms);
    }
    console.log('[WS] Browser client disconnected');
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ICT Sniper running at http://localhost:${PORT}\n`);
  // Pre-connect to TwelveData WS for XAUUSD
  pendingSubscriptions.add('XAUUSD');
  connectTwelveDataWS();
});
