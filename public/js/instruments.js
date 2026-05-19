'use strict';

/* Central instrument registry — single source of truth for all 17 markets. */

const INSTRUMENTS = {
  // ── Forex ──────────────────────────────────────────────────────────────────
  EURUSD: { tag: 'EUR/USD · M1', name: 'EUR/USD', apiSymbol: 'EUR/USD', contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex',     icon: '€$'  },
  GBPUSD: { tag: 'GBP/USD · M1', name: 'GBP/USD', apiSymbol: 'GBP/USD', contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex',     icon: '£$'  },
  USDJPY: { tag: 'USD/JPY · M1', name: 'USD/JPY', apiSymbol: 'USD/JPY', contractSize: 100000, slBuffer: 0.030,  decimals: 3, accent: '#3A9BD5', group: 'Forex',     icon: '$¥'  },
  GBPJPY: { tag: 'GBP/JPY · M1', name: 'GBP/JPY', apiSymbol: 'GBP/JPY', contractSize: 100000, slBuffer: 0.050,  decimals: 3, accent: '#3A9BD5', group: 'Forex',     icon: '£¥'  },
  AUDUSD: { tag: 'AUD/USD · M1', name: 'AUD/USD', apiSymbol: 'AUD/USD', contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex',     icon: 'A$'  },
  USDCHF: { tag: 'USD/CHF · M1', name: 'USD/CHF', apiSymbol: 'USD/CHF', contractSize: 100000, slBuffer: 0.0003, decimals: 5, accent: '#3A9BD5', group: 'Forex',     icon: '$Fr' },
  // ── Indizes ────────────────────────────────────────────────────────────────
  US500:  { tag: 'US500 · M1',  name: 'US500',  apiSymbol: 'SPX',     contractSize: 50,    slBuffer: 2.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'S5'  },
  NAS100: { tag: 'NAS100 · M1', name: 'NAS100', apiSymbol: 'NDX',     contractSize: 20,    slBuffer: 5.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'NQ'  },
  US30:   { tag: 'US30 · M1',   name: 'US30',   apiSymbol: 'DJI',     contractSize: 5,     slBuffer: 5.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'DJ'  },
  GER40:  { tag: 'GER40 · M1',  name: 'GER40',  apiSymbol: 'GER40',   contractSize: 25,    slBuffer: 3.0,   decimals: 2, accent: '#8B5CF6', group: 'Indizes',   icon: 'DE'  },
  // ── Rohstoffe ──────────────────────────────────────────────────────────────
  XAUUSD: { tag: 'GOLD · M1',   name: 'XAUUSD', apiSymbol: 'XAU/USD', contractSize: 100,   slBuffer: 0.50,  decimals: 2, accent: '#D4AF37', group: 'Rohstoffe', icon: 'Au'  },
  XAGUSD: { tag: 'SILBER · M1', name: 'XAGUSD', apiSymbol: 'XAG/USD', contractSize: 5000,  slBuffer: 0.05,  decimals: 3, accent: '#C0C0C0', group: 'Rohstoffe', icon: 'Ag'  },
  USOIL:  { tag: 'WTI ÖL · M1', name: 'USOIL',  apiSymbol: 'WTI/USD', contractSize: 1000,  slBuffer: 0.10,  decimals: 2, accent: '#FF6B35', group: 'Rohstoffe', icon: 'OIL' },
  XCUUSD: { tag: 'KUPFER · M1', name: 'XCUUSD', apiSymbol: 'COPPER',  contractSize: 25000, slBuffer: 0.005, decimals: 4, accent: '#B87333', group: 'Rohstoffe', icon: 'Cu'  },
  // ── Krypto ─────────────────────────────────────────────────────────────────
  BTCUSD: { tag: 'BTC · M1',    name: 'BTCUSD', apiSymbol: 'BTC/USD', contractSize: 1,     slBuffer: 50.0,  decimals: 2, accent: '#F7931A', group: 'Krypto',    icon: '₿'   },
  ETHUSD: { tag: 'ETH · M1',    name: 'ETHUSD', apiSymbol: 'ETH/USD', contractSize: 1,     slBuffer: 10.0,  decimals: 2, accent: '#627EEA', group: 'Krypto',    icon: 'Ξ'   },
  SOLUSD: { tag: 'SOL · M1',    name: 'SOLUSD', apiSymbol: 'SOL/USD', contractSize: 1,     slBuffer: 1.0,   decimals: 3, accent: '#9945FF', group: 'Krypto',    icon: '◎'   },
};

const INSTRUMENT_GROUPS = ['Forex', 'Indizes', 'Rohstoffe', 'Krypto'];
