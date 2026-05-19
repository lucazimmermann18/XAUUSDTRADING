/**
 * websocket-client.js
 * Manages the WebSocket connection to the ICT Sniper backend relay.
 * Dispatches custom events on window for other modules to consume.
 */

'use strict';

const WSClient = (() => {
  let ws = null;
  let reconnectTimer = null;
  let currentSymbols = new Set();
  let isConnected = false;
  const MAX_RECONNECT_DELAY = 30000;
  let reconnectDelay = 1000;

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    console.log('[WSClient] Connecting...');
    ws = new WebSocket(getWsUrl());

    ws.addEventListener('open', () => {
      console.log('[WSClient] Connected');
      isConnected = true;
      reconnectDelay = 1000;
      clearTimeout(reconnectTimer);

      // Dispatch connected event
      window.dispatchEvent(new CustomEvent('ws:connected'));

      // Re-subscribe to any active symbols
      if (currentSymbols.size > 0) {
        subscribeSymbols([...currentSymbols]);
      }
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.addEventListener('close', () => {
      isConnected = false;
      console.log('[WSClient] Disconnected, reconnecting in', reconnectDelay, 'ms');
      window.dispatchEvent(new CustomEvent('ws:disconnected'));
      scheduleReconnect();
    });

    ws.addEventListener('error', (err) => {
      console.error('[WSClient] WebSocket error:', err);
      isConnected = false;
      ws.close();
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  }

  function handleMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'connected':
        // Server relay acknowledged
        break;

      case 'tick': {
        // Normalize symbol: "XAU/USD" -> "XAUUSD"
        const rawSym = msg.symbol || '';
        const symbol = rawSym.replace('/', '');
        window.dispatchEvent(new CustomEvent('ws:tick', {
          detail: {
            symbol,
            price: msg.price,
            timestamp: msg.timestamp,
          }
        }));
        break;
      }

      default:
        break;
    }
  }

  function subscribeSymbols(symbols) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: 'subscribe', symbol: symbols }));
  }

  function unsubscribeSymbols(symbols) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: 'unsubscribe', symbol: symbols }));
  }

  /**
   * Subscribe to live price ticks for a symbol.
   * @param {string} symbol - e.g. 'XAUUSD'
   */
  function subscribe(symbol) {
    const sym = symbol.toUpperCase();
    if (currentSymbols.has(sym)) return;
    currentSymbols.add(sym);

    if (isConnected) {
      subscribeSymbols([sym]);
    } else {
      connect();
    }
  }

  /**
   * Unsubscribe from a symbol.
   * @param {string} symbol
   */
  function unsubscribe(symbol) {
    const sym = symbol.toUpperCase();
    if (!currentSymbols.has(sym)) return;
    currentSymbols.delete(sym);
    unsubscribeSymbols([sym]);
  }

  /**
   * Switch to a different symbol (unsubscribe old, subscribe new).
   * @param {string} newSymbol
   * @param {string} [oldSymbol]
   */
  function switchSymbol(newSymbol, oldSymbol) {
    if (oldSymbol && oldSymbol !== newSymbol) {
      unsubscribe(oldSymbol);
    }
    subscribe(newSymbol);
  }

  // Auto-connect on load
  connect();

  return { connect, subscribe, unsubscribe, switchSymbol, isConnected: () => isConnected };
})();
