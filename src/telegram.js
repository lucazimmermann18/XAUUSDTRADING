'use strict';

const axios = require('axios');

/**
 * Send a message via Telegram Bot API.
 * Requires env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
async function sendTelegram(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN oder TELEGRAM_CHAT_ID nicht konfiguriert');
    return;
  }

  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id:    chatId,
      text,
      parse_mode: 'HTML',
    },
    { timeout: 10000 }
  );
}

/**
 * Format a confirmed trade signal for Telegram.
 */
function formatSignal({ symbol, trade, agentA, agentB }) {
  const dir      = trade.direction === 'long' ? '↑ Long' : '↓ Short';
  const dirEmoji = trade.direction === 'long' ? '🟢' : '🔴';
  const dec      = ['EURUSD','GBPUSD','AUDUSD','USDCHF'].includes(symbol) ? 5
                 : ['USDJPY','GBPJPY'].includes(symbol) ? 3
                 : ['XAGUSD','XCUUSD','SOLUSD'].includes(symbol) ? 3 : 2;

  const fmt = v => parseFloat(v).toFixed(dec);

  const confA = agentA?.confidence || 'HIGH';
  const confB = agentB?.confidence || 'HIGH';

  return [
    `${dirEmoji} <b>${symbol} · ${dir}</b>`,
    ``,
    `Entry:  <code>${fmt(trade.entry)}</code>`,
    `SL:     <code>${fmt(trade.sl)}</code>`,
    `TP:     <code>${fmt(trade.tp)}</code>`,
    `RR:     <code>1:${parseFloat(trade.rr).toFixed(2)}</code>`,
    trade.lot ? `Lot:    <code>${parseFloat(trade.lot).toFixed(2)}</code>` : null,
    ``,
    `◈ Claude ${confA.toLowerCase()}  ⬡ GPT-4o ${confB.toLowerCase()}`,
    `<i>${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} · ICT Sniper</i>`,
  ].filter(l => l !== null).join('\n');
}

module.exports = { sendTelegram, formatSignal };
