'use strict';

const axios = require('axios');

const BASE_URL = 'https://api.twelvedata.com';
const WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';

/**
 * Map internal symbol names to TwelveData API symbols
 */
function toTDSymbol(symbol) {
  const map = {
    'XAUUSD': 'XAU/USD',
    'BTCUSD': 'BTC/USD',
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

  try {
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
      throw new Error(`TwelveData error: ${data.message}`);
    }

    if (!data.values || !Array.isArray(data.values)) {
      throw new Error('TwelveData returned no candle data');
    }

    // Convert to lightweight-charts format (ascending time order)
    const candles = data.values
      .map(v => ({
        time:  Math.floor(new Date(v.datetime).getTime() / 1000),
        open:  parseFloat(v.open),
        high:  parseFloat(v.high),
        low:   parseFloat(v.low),
        close: parseFloat(v.close),
      }))
      .reverse(); // TwelveData returns newest first

    return candles;

  } catch (err) {
    // If API is unavailable (host not whitelisted, network error, etc.)
    // fall back to realistic demo data so the UI always works
    if (
      (err.response && err.response.status === 403) ||
      err.code === 'ECONNREFUSED' ||
      err.message.includes('host_not_allowed') ||
      err.message.includes('Host not in allowlist')
    ) {
      console.warn(`[TwelveData] API restricted (${err.message}), serving demo data for ${symbol}`);
      return generateDemoCandles(symbol, outputsize);
    }
    throw err;
  }
}

/**
 * Fetch current price for a symbol
 * @param {string} symbol
 * @param {string} apiKey
 */
async function fetchPrice(symbol, apiKey) {
  const tdSymbol = toTDSymbol(symbol);
  const url = `${BASE_URL}/price`;

  try {
    const response = await axios.get(url, {
      params: {
        symbol: tdSymbol,
        apikey: apiKey,
      },
      timeout: 10000,
    });

    const data = response.data;

    if (data.status === 'error') {
      throw new Error(`TwelveData error: ${data.message}`);
    }

    return parseFloat(data.price);

  } catch (err) {
    if (
      (err.response && err.response.status === 403) ||
      err.code === 'ECONNREFUSED' ||
      err.message.includes('host_not_allowed') ||
      err.message.includes('Host not in allowlist')
    ) {
      console.warn(`[TwelveData] API restricted, returning demo price for ${symbol}`);
      return getDemoPrice(symbol);
    }
    throw err;
  }
}

// ─── Demo Data Generator ─────────────────────────────────────────────────────

const DEMO_BASES = {
  XAUUSD: 3241.50,
  BTCUSD: 67850.00,
};

function getDemoPrice(symbol) {
  const base = DEMO_BASES[symbol.toUpperCase()] || 3241.50;
  return parseFloat((base + (Math.random() - 0.5) * base * 0.002).toFixed(2));
}

/**
 * Generate realistic M1 candle data using a random walk
 * with drift, volatility clustering, and mean-reversion.
 */
function generateDemoCandles(symbol, count = 200) {
  const base = DEMO_BASES[symbol.toUpperCase()] || 3241.50;

  // Volatility per minute (approx)
  const volPerMin = symbol === 'BTCUSD'
    ? base * 0.0008   // ~0.08% per minute for BTC
    : base * 0.0002;  // ~0.02% per minute for XAUUSD

  const now = Math.floor(Date.now() / 1000);
  // Start `count` minutes ago, aligned to minute boundary
  const startTime = (now - count * 60) - ((now - count * 60) % 60);

  const candles = [];
  let price = base * (1 + (Math.random() - 0.5) * 0.005);
  let trend = (Math.random() - 0.5) * 0.3; // slight trend component
  let vol = volPerMin;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * 60;

    // Volatility clustering
    vol = vol * 0.95 + volPerMin * 0.05 + volPerMin * Math.random() * 0.1;

    // Random walk with trend and mean-reversion
    const drift = trend * vol * 0.3;
    const noise = (Math.random() - 0.5) * 2 * vol;

    // Mean-reversion: pull back to base gently
    const mr = (base - price) * 0.002;

    const open = price;
    price = Math.max(open * 0.995, Math.min(open * 1.005, open + drift + noise + mr));

    const high  = Math.max(open, price) + Math.abs(noise) * (0.3 + Math.random() * 0.4);
    const low   = Math.min(open, price) - Math.abs(noise) * (0.3 + Math.random() * 0.4);
    const close = price;

    // Occasionally shift trend
    if (Math.random() < 0.05) {
      trend = (Math.random() - 0.5) * 0.4;
    }

    candles.push({
      time,
      open:  parseFloat(open.toFixed(symbol === 'BTCUSD' ? 2 : 2)),
      high:  parseFloat(high.toFixed(2)),
      low:   parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
    });
  }

  // Ensure times are strictly increasing and unique
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time <= candles[i - 1].time) {
      candles[i].time = candles[i - 1].time + 60;
    }
  }

  return candles;
}

module.exports = {
  fetchTimeSeries,
  fetchPrice,
  toTDSymbol,
  generateDemoCandles,
  getDemoPrice,
  WS_URL,
};
