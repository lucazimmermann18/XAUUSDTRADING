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
      time: Math.floor(new Date(v.datetime).getTime() / 1000),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .reverse(); // TwelveData returns newest first

  return candles;
}

/**
 * Fetch current price for a symbol
 * @param {string} symbol
 * @param {string} apiKey
 */
async function fetchPrice(symbol, apiKey) {
  const tdSymbol = toTDSymbol(symbol);
  const url = `${BASE_URL}/price`;

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
}

module.exports = {
  fetchTimeSeries,
  fetchPrice,
  toTDSymbol,
  WS_URL,
};
