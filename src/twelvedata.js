'use strict';

const axios = require('axios');

const BASE_URL = 'https://api.twelvedata.com';
const WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';

/**
 * Map internal symbol names to TwelveData API symbols
 */
function toTDSymbol(symbol) {
  const map = {
    // Forex
    'EURUSD': 'EUR/USD',
    'GBPUSD': 'GBP/USD',
    'USDJPY': 'USD/JPY',
    'GBPJPY': 'GBP/JPY',
    'AUDUSD': 'AUD/USD',
    'USDCHF': 'USD/CHF',
    // Indizes
    'US500':  'SPX',
    'NAS100': 'NDX',
    'US30':   'DJI',
    'GER40':  'GER40',
    // Rohstoffe
    'XAUUSD': 'XAU/USD',
    'XAGUSD': 'XAG/USD',
    'USOIL':  'WTI/USD',
    'XCUUSD': 'COPPER',
    // Krypto
    'BTCUSD': 'BTC/USD',
    'ETHUSD': 'ETH/USD',
    'SOLUSD': 'SOL/USD',
  };
  return map[symbol.toUpperCase()] || symbol;
}

/**
 * Fetch historical time series candle data
 * @param {string} symbol - e.g. 'XAUUSD'
 * @param {string} interval - e.g. '1min'
 * @param {number} outputsize - number of candles
 * @param {string} apiKey
 */
async function fetchTimeSeries(symbol, interval, outputsize, apiKey) {
  const tdSymbol = toTDSymbol(symbol);
  const url = `${BASE_URL}/time_series`;

  const response = await axios.get(url, {
    params: {
      symbol: tdSymbol,
      interval,
      outputsize,
      apikey: apiKey,
      format: 'JSON',
    },
    timeout: 15000,
  });

  const data = response.data;

  if (data.status === 'error') {
    throw new Error(data.message || 'TwelveData API Fehler');
  }

  if (!data.values || !Array.isArray(data.values) || data.values.length === 0) {
    throw new Error('Keine Kerzendaten verfügbar');
  }

  return data.values
    .map(v => ({
      time:  Math.floor(new Date(v.datetime).getTime() / 1000),
      open:  parseFloat(v.open),
      high:  parseFloat(v.high),
      low:   parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .reverse(); // TwelveData returns newest first
}

/**
 * Fetch current price for a symbol
 * @param {string} symbol
 * @param {string} apiKey
 */
async function fetchPrice(symbol, apiKey) {
  const tdSymbol = toTDSymbol(symbol);

  const response = await axios.get(`${BASE_URL}/price`, {
    params: { symbol: tdSymbol, apikey: apiKey },
    timeout: 10000,
  });

  const data = response.data;

  if (data.status === 'error') {
    throw new Error(data.message || 'TwelveData API Fehler');
  }

  if (!data.price) {
    throw new Error('Kein Preis verfügbar');
  }

  return parseFloat(data.price);
}


// ─── Candle Cache (in-memory, 5-min TTL) ─────────────────────────────────────
// Shared by server API routes and scheduler to avoid redundant API calls.

const _candleCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchTimeSeriesCached(symbol, interval, outputsize, apiKey) {
  const key   = `${symbol.toUpperCase()}:${interval}`;
  const entry = _candleCache.get(key);

  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.candles;
  }

  const candles = await fetchTimeSeries(symbol, interval, outputsize, apiKey);
  _candleCache.set(key, { candles, fetchedAt: Date.now() });
  return candles;
}

/** Returns true if the symbol has live candle data in the cache. */
function isSymbolLive(symbol) {
  const key   = `${symbol.toUpperCase()}:1min`;
  const entry = _candleCache.get(key);
  return !!(entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS);
}

module.exports = {
  fetchTimeSeries,
  fetchTimeSeriesCached,
  fetchPrice,
  toTDSymbol,
  isSymbolLive,
  WS_URL,
};
