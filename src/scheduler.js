'use strict';

const cron                               = require('node-cron');
const { fetchTimeSeriesCached, fetchPrice } = require('./twelvedata');
const { callClaudeVision }               = require('./ai-providers');
const { dualValidate }                   = require('./dual-validator');
const { sendTelegram, formatSignal }     = require('./telegram');

// All 17 instruments with their API symbols and contract sizes
const INSTRUMENTS = [
  { symbol: 'XAUUSD',  apiSymbol: 'XAU/USD', contractSize: 100   },
  { symbol: 'XAGUSD',  apiSymbol: 'XAG/USD', contractSize: 5000  },
  { symbol: 'BTCUSD',  apiSymbol: 'BTC/USD', contractSize: 1     },
  { symbol: 'ETHUSD',  apiSymbol: 'ETH/USD', contractSize: 1     },
  { symbol: 'SOLUSD',  apiSymbol: 'SOL/USD', contractSize: 1     },
  { symbol: 'EURUSD',  apiSymbol: 'EUR/USD', contractSize: 100000 },
  { symbol: 'GBPUSD',  apiSymbol: 'GBP/USD', contractSize: 100000 },
  { symbol: 'USDJPY',  apiSymbol: 'USD/JPY', contractSize: 100000 },
  { symbol: 'GBPJPY',  apiSymbol: 'GBP/JPY', contractSize: 100000 },
  { symbol: 'AUDUSD',  apiSymbol: 'AUD/USD', contractSize: 100000 },
  { symbol: 'USDCHF',  apiSymbol: 'USD/CHF', contractSize: 100000 },
  { symbol: 'US500',   apiSymbol: 'SPX',     contractSize: 50    },
  { symbol: 'NAS100',  apiSymbol: 'NDX',     contractSize: 20    },
  { symbol: 'US30',    apiSymbol: 'DJI',     contractSize: 5     },
  { symbol: 'GER40',   apiSymbol: 'GER40',   contractSize: 25    },
  { symbol: 'USOIL',   apiSymbol: 'WTI/USD', contractSize: 1000  },
  { symbol: 'XCUUSD',  apiSymbol: 'COPPER',  contractSize: 25000 },
];

// Dedup: track last sent signal per symbol within a 1h window
const lastSent = {}; // symbol -> { direction, sentAt }

function isDuplicate(symbol, direction) {
  const prev = lastSent[symbol];
  if (!prev) return false;
  const age = Date.now() - prev.sentAt;
  return prev.direction === direction && age < 60 * 60 * 1000;
}

function markSent(symbol, direction) {
  lastSent[symbol] = { direction, sentAt: Date.now() };
}

// Delay helper to avoid API rate limits between instruments
const delay = ms => new Promise(r => setTimeout(r, ms));

async function analyseInstrument(inst, capital) {
  const { symbol } = inst;
  try {
    const [candles, price] = await Promise.all([
      fetchTimeSeriesCached(symbol, '1min', 200, process.env.TWELVE_DATA_API_KEY),
      fetchPrice(symbol, process.env.TWELVE_DATA_API_KEY),
    ]);

    if (!candles || candles.length < 20) {
      console.log(`[Scheduler] ${symbol}: zu wenig Daten, übersprungen`);
      return;
    }

    const currentPrice = price || candles[candles.length - 1].close;

    // Claude Vision (text-only, no screenshot in headless mode)
    let visionResult;
    try {
      visionResult = await callClaudeVision({
        image:        null,  // headless — no screenshot
        symbol,
        capital,
        currentPrice,
        candles,
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    } catch (err) {
      console.warn(`[Scheduler] ${symbol} Claude Vision Fehler:`, err.message);
      return;
    }

    const { structure, liquidity, fvg, premDisc, trade } = visionResult;
    if (!trade?.direction || !trade?.entry || !trade?.sl || !trade?.tp) {
      console.log(`[Scheduler] ${symbol}: kein vollständiges Trade-Setup`);
      return;
    }

    // Build primary verdict from Claude Vision result (reuse pattern from dual-validator-ui)
    const primaryVerdict = {
      direction:    trade.direction.toUpperCase(),
      confidence:   'HIGH',
      reasons: [structure?.label, liquidity?.label, fvg?.label].filter(Boolean).slice(0, 3),
      risk_warning: premDisc?.label || '',
    };

    // Dual-validate: Claude verdict already known, only calls OpenAI
    const gateResult = await dualValidate({
      symbol,
      analysis: { structure, liquidity, fvg, premDisc },
      trade,
      apiKeys: {
        anthropic: process.env.ANTHROPIC_API_KEY,
        openai:    process.env.OPENAI_API_KEY,
      },
      primaryVerdict,
    });

    if (!gateResult.agreement) {
      console.log(`[Scheduler] ${symbol}: keine Übereinstimmung (Claude: ${primaryVerdict.direction}, GPT-4o: ${gateResult.agentB?.direction})`);
      return;
    }

    const direction = trade.direction;
    if (isDuplicate(symbol, direction)) {
      console.log(`[Scheduler] ${symbol}: Signal bereits in letzter Stunde gesendet, übersprungen`);
      return;
    }

    const msg = formatSignal({ symbol, trade, agentA: gateResult.agentA, agentB: gateResult.agentB });
    await sendTelegram(msg);
    markSent(symbol, direction);
    console.log(`[Scheduler] ✅ ${symbol} · ${direction.toUpperCase()} Signal gesendet`);

  } catch (err) {
    console.error(`[Scheduler] ${symbol} Fehler:`, err.message);
  }
}

async function runScan() {
  const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  console.log(`\n[Scheduler] Scan gestartet — ${now}`);

  const capital = parseFloat(process.env.SCHEDULER_CAPITAL) || 1000;

  for (const inst of INSTRUMENTS) {
    await analyseInstrument(inst, capital);
    await delay(3000); // 3s zwischen Instrumenten
  }

  console.log(`[Scheduler] Scan abgeschlossen\n`);
}

function start() {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Scheduler] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID fehlen — Scheduler deaktiviert');
    return;
  }

  // Every 30 minutes, between 07:00 and 21:00, Berlin time
  // node-cron uses server time, so we check Berlin hour inside the callback
  cron.schedule('0,30 * * * *', async () => {
    const berlinHour = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }),
      10
    );

    if (berlinHour < 7 || berlinHour >= 21) {
      return; // außerhalb der Handelszeit
    }

    await runScan();
  }, {
    timezone: 'Europe/Berlin',
  });

  console.log('[Scheduler] Aktiv — alle 30 min zwischen 07:00 und 21:00 Berliner Zeit');
}

module.exports = { start, runScan };
