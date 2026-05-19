'use strict';

/* Central instrument registry — single source of truth for all markets. */

const INSTRUMENTS = {
  // ── Forex Majors ──────────────────────────────────────────────────────────
  EURUSD:  { tag: 'EUR/USD · M1', name: 'EUR/USD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex', icon: '€$'  },
  GBPUSD:  { tag: 'GBP/USD · M1', name: 'GBP/USD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex', icon: '£$'  },
  USDJPY:  { tag: 'USD/JPY · M1', name: 'USD/JPY',  contractSize: 100000, slBuffer: 0.030,  decimals: 3, accent: '#3A9BD5', group: 'Forex', icon: '$¥'  },
  USDCHF:  { tag: 'USD/CHF · M1', name: 'USD/CHF',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex', icon: '$Fr' },
  AUDUSD:  { tag: 'AUD/USD · M1', name: 'AUD/USD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex', icon: 'A$'  },
  USDCAD:  { tag: 'USD/CAD · M1', name: 'USD/CAD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex', icon: '$C$' },
  NZDUSD:  { tag: 'NZD/USD · M1', name: 'NZD/USD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex', icon: 'NZ$' },
  // EUR Crosses
  EURGBP:  { tag: 'EUR/GBP · M1', name: 'EUR/GBP',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#5BABF5', group: 'Forex', icon: '€£'  },
  EURJPY:  { tag: 'EUR/JPY · M1', name: 'EUR/JPY',  contractSize: 100000, slBuffer: 0.030,  decimals: 3, accent: '#5BABF5', group: 'Forex', icon: '€¥'  },
  EURCHF:  { tag: 'EUR/CHF · M1', name: 'EUR/CHF',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#5BABF5', group: 'Forex', icon: '€Fr' },
  EURAUD:  { tag: 'EUR/AUD · M1', name: 'EUR/AUD',  contractSize: 100000, slBuffer: 0.0004, decimals: 5, accent: '#5BABF5', group: 'Forex', icon: '€A$' },
  EURCAD:  { tag: 'EUR/CAD · M1', name: 'EUR/CAD',  contractSize: 100000, slBuffer: 0.0004, decimals: 5, accent: '#5BABF5', group: 'Forex', icon: '€C$' },
  EURNZD:  { tag: 'EUR/NZD · M1', name: 'EUR/NZD',  contractSize: 100000, slBuffer: 0.0005, decimals: 5, accent: '#5BABF5', group: 'Forex', icon: '€NZ' },
  // GBP Crosses
  GBPJPY:  { tag: 'GBP/JPY · M1', name: 'GBP/JPY',  contractSize: 100000, slBuffer: 0.050,  decimals: 3, accent: '#7CC4F5', group: 'Forex', icon: '£¥'  },
  GBPCHF:  { tag: 'GBP/CHF · M1', name: 'GBP/CHF',  contractSize: 100000, slBuffer: 0.0004, decimals: 5, accent: '#7CC4F5', group: 'Forex', icon: '£Fr' },
  GBPAUD:  { tag: 'GBP/AUD · M1', name: 'GBP/AUD',  contractSize: 100000, slBuffer: 0.0005, decimals: 5, accent: '#7CC4F5', group: 'Forex', icon: '£A$' },
  GBPCAD:  { tag: 'GBP/CAD · M1', name: 'GBP/CAD',  contractSize: 100000, slBuffer: 0.0004, decimals: 5, accent: '#7CC4F5', group: 'Forex', icon: '£C$' },
  GBPNZD:  { tag: 'GBP/NZD · M1', name: 'GBP/NZD',  contractSize: 100000, slBuffer: 0.0006, decimals: 5, accent: '#7CC4F5', group: 'Forex', icon: '£NZ' },
  // JPY Crosses
  AUDJPY:  { tag: 'AUD/JPY · M1', name: 'AUD/JPY',  contractSize: 100000, slBuffer: 0.030,  decimals: 3, accent: '#9DD4F5', group: 'Forex', icon: 'A¥'  },
  CADJPY:  { tag: 'CAD/JPY · M1', name: 'CAD/JPY',  contractSize: 100000, slBuffer: 0.030,  decimals: 3, accent: '#9DD4F5', group: 'Forex', icon: 'C¥'  },
  CHFJPY:  { tag: 'CHF/JPY · M1', name: 'CHF/JPY',  contractSize: 100000, slBuffer: 0.030,  decimals: 3, accent: '#9DD4F5', group: 'Forex', icon: 'Fr¥' },
  NZDJPY:  { tag: 'NZD/JPY · M1', name: 'NZD/JPY',  contractSize: 100000, slBuffer: 0.030,  decimals: 3, accent: '#9DD4F5', group: 'Forex', icon: 'NZ¥' },
  // Other Crosses
  AUDCAD:  { tag: 'AUD/CAD · M1', name: 'AUD/CAD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#BDE4F5', group: 'Forex', icon: 'AC$' },
  AUDCHF:  { tag: 'AUD/CHF · M1', name: 'AUD/CHF',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#BDE4F5', group: 'Forex', icon: 'AFr' },
  AUDNZD:  { tag: 'AUD/NZD · M1', name: 'AUD/NZD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#BDE4F5', group: 'Forex', icon: 'ANZ' },
  CADCHF:  { tag: 'CAD/CHF · M1', name: 'CAD/CHF',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#BDE4F5', group: 'Forex', icon: 'CFr' },
  NZDCAD:  { tag: 'NZD/CAD · M1', name: 'NZD/CAD',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#BDE4F5', group: 'Forex', icon: 'NZC' },
  NZDCHF:  { tag: 'NZD/CHF · M1', name: 'NZD/CHF',  contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#BDE4F5', group: 'Forex', icon: 'NZF' },
  // ── Indizes ────────────────────────────────────────────────────────────────
  US500:   { tag: 'US500 · M1',   name: 'US500',    contractSize: 50,    slBuffer: 2.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'S5'  },
  NAS100:  { tag: 'NAS100 · M1',  name: 'NAS100',   contractSize: 20,    slBuffer: 5.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'NQ'  },
  US30:    { tag: 'US30 · M1',    name: 'US30',     contractSize: 5,     slBuffer: 5.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'DJ'  },
  GER40:   { tag: 'GER40 · M1',   name: 'GER40',    contractSize: 25,    slBuffer: 3.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'DE'  },
  // ── Rohstoffe ──────────────────────────────────────────────────────────────
  XAUUSD:  { tag: 'GOLD · M1',    name: 'XAUUSD',   contractSize: 100,   slBuffer: 0.50,  decimals: 2, accent: '#D4AF37', group: 'Rohstoffe', icon: 'Au'  },
  XAGUSD:  { tag: 'SILBER · M1',  name: 'XAGUSD',   contractSize: 5000,  slBuffer: 0.05,  decimals: 3, accent: '#C0C0C0', group: 'Rohstoffe', icon: 'Ag'  },
  USOIL:   { tag: 'WTI ÖL · M1',  name: 'USOIL',    contractSize: 1000,  slBuffer: 0.10,  decimals: 2, accent: '#FF6B35', group: 'Rohstoffe', icon: 'OIL' },
  XCUUSD:  { tag: 'KUPFER · M1',  name: 'XCUUSD',   contractSize: 25000, slBuffer: 0.005, decimals: 4, accent: '#B87333', group: 'Rohstoffe', icon: 'Cu'  },
  // ── Krypto ─────────────────────────────────────────────────────────────────
  BTCUSD:  { tag: 'BTC · M1',     name: 'BTCUSD',   contractSize: 1,  slBuffer: 50.0,  decimals: 2, accent: '#F7931A', group: 'Krypto', icon: '₿'   },
  ETHUSD:  { tag: 'ETH · M1',     name: 'ETHUSD',   contractSize: 1,  slBuffer: 10.0,  decimals: 2, accent: '#627EEA', group: 'Krypto', icon: 'Ξ'   },
  SOLUSD:  { tag: 'SOL · M1',     name: 'SOLUSD',   contractSize: 1,  slBuffer: 1.0,   decimals: 3, accent: '#9945FF', group: 'Krypto', icon: '◎'   },
  XRPUSD:  { tag: 'XRP · M1',     name: 'XRPUSD',   contractSize: 1,  slBuffer: 0.005, decimals: 4, accent: '#00AAE4', group: 'Krypto', icon: 'XRP' },
  BNBUSD:  { tag: 'BNB · M1',     name: 'BNBUSD',   contractSize: 1,  slBuffer: 1.0,   decimals: 2, accent: '#F3BA2F', group: 'Krypto', icon: 'BNB' },
  ADAUSD:  { tag: 'ADA · M1',     name: 'ADAUSD',   contractSize: 1,  slBuffer: 0.005, decimals: 4, accent: '#0033AD', group: 'Krypto', icon: 'ADA' },
  DOGEUSD: { tag: 'DOGE · M1',    name: 'DOGEUSD',  contractSize: 1,  slBuffer: 0.002, decimals: 4, accent: '#C2A633', group: 'Krypto', icon: 'D'   },
  LTCUSD:  { tag: 'LTC · M1',     name: 'LTCUSD',   contractSize: 1,  slBuffer: 0.5,   decimals: 2, accent: '#BFBBBB', group: 'Krypto', icon: 'Ł'   },
  DOTUSD:  { tag: 'DOT · M1',     name: 'DOTUSD',   contractSize: 1,  slBuffer: 0.05,  decimals: 3, accent: '#E6007A', group: 'Krypto', icon: 'DOT' },
  LINKUSD: { tag: 'LINK · M1',    name: 'LINKUSD',  contractSize: 1,  slBuffer: 0.05,  decimals: 3, accent: '#2A5ADA', group: 'Krypto', icon: '⬡'   },
  AVAXUSD: { tag: 'AVAX · M1',    name: 'AVAXUSD',  contractSize: 1,  slBuffer: 0.2,   decimals: 2, accent: '#E84142', group: 'Krypto', icon: 'AV'  },
  MATICUSD:{ tag: 'MATIC · M1',   name: 'MATICUSD', contractSize: 1,  slBuffer: 0.005, decimals: 4, accent: '#8247E5', group: 'Krypto', icon: 'M'   },
};

const INSTRUMENT_GROUPS = ['Forex', 'Indizes', 'Rohstoffe', 'Krypto'];
