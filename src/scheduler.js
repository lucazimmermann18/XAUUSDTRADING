'use strict';

const cron                               = require('node-cron');
const { fetchTimeSeriesCached, fetchPrice } = require('./twelvedata');
const { callClaudeVision }               = require('./ai-providers');
const { dualValidate }                   = require('./dual-validator');
const { sendTelegram, formatSignal }     = require('./telegram');

// All instruments — scheduler only processes those that return real data
const INSTRUMENTS = [
  // Forex Majors
  { symbol: 'EURUSD',   contractSize: 100000 },
  { symbol: 'GBPUSD',   contractSize: 100000 },
  { symbol: 'USDJPY',   contractSize: 100000 },
  { symbol: 'USDCHF',   contractSize: 100000 },
  { symbol: 'AUDUSD',   contractSize: 100000 },
  { symbol: 'USDCAD',   contractSize: 100000 },
  { symbol: 'NZDUSD',   contractSize: 100000 },
  // EUR Crosses
  { symbol: 'EURGBP',   contractSize: 100000 },
  { symbol: 'EURJPY',   contractSize: 100000 },
  { symbol: 'EURCHF',   contractSize: 100000 },
  { symbol: 'EURAUD',   contractSize: 100000 },
  { symbol: 'EURCAD',   contractSize: 100000 },
  { symbol: 'EURNZD',   contractSize: 100000 },
  // GBP Crosses
  { symbol: 'GBPJPY',   contractSize: 100000 },
  { symbol: 'GBPCHF',   contractSize: 100000 },
  { symbol: 'GBPAUD',   contractSize: 100000 },
  { symbol: 'GBPCAD',   contractSize: 100000 },
  { symbol: 'GBPNZD',   contractSize: 100000 },
  // JPY Crosses
  { symbol: 'AUDJPY',   contractSize: 100000 },
  { symbol: 'CADJPY',   contractSize: 100000 },
  { symbol: 'CHFJPY',   contractSize: 100000 },
  { symbol: 'NZDJPY',   contractSize: 100000 },
  // Other Crosses
  { symbol: 'AUDCAD',   contractSize: 100000 },
  { symbol: 'AUDCHF',   contractSize: 100000 },
  { symbol: 'AUDNZD',   contractSize: 100000 },
  { symbol: 'CADCHF',   contractSize: 100000 },
  { symbol: 'NZDCAD',   contractSize: 100000 },
  { symbol: 'NZDCHF',   contractSize: 100000 },
  // Indices
  { symbol: 'US500',    contractSize: 50     },
  { symbol: 'NAS100',   contractSize: 20     },
  { symbol: 'US30',     contractSize: 5      },
  { symbol: 'GER40',    contractSize: 25     },
  // Commodities
  { symbol: 'XAUUSD',   contractSize: 100    },
  { symbol: 'XAGUSD',   contractSize: 5000   },
  { symbol: 'USOIL',    contractSize: 1000   },
  { symbol: 'XCUUSD',   contractSize: 25000  },
  // Crypto
  { symbol: 'BTCUSD',   contractSize: 1      },
  { symbol: 'ETHUSD',   contractSize: 1      },
  { symbol: 'SOLUSD',   contractSize: 1      },
  { symbol: 'XRPUSD',   contractSize: 1      },
  { symbol: 'BNBUSD',   contractSize: 1      },
  { symbol: 'ADAUSD',   contractSize: 1      },
  { symbol: 'DOGEUSD',  contractSize: 1      },
  { symbol: 'LTCUSD',   contractSize: 1      },
  { symbol: 'DOTUSD',   contractSize: 1      },
  { symbol: 'LINKUSD',  contractSize: 1      },
  { symbol: 'AVAXUSD',  contractSize: 1      },
  { symbol: 'MATICUSD', contractSize: 1      },
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
