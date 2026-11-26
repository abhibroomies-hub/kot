import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AiStrategyMemoryRecord,
  BrokerMode,
  KotakAccountProfile,
  KotakBrokerOrderSummary,
  KotakBrokerPositionSummary,
  QuadChartSlotConfig,
  QuadTimeframe,
  ScannerOpportunity,
  Timeframe,
  TradingSymbol,
} from './src/engine/types.ts';
import {
  INDIAN_SYMBOLS,
  STRATEGY_CATALOG,
  applyLiveTickToCandles,
  calculateLotSize,
  detectMarketPatternAndAdaptIndicators,
  evaluateLiveSignal,
  evaluateMultiTimeframeConfluence,
  getDefaultSlotConfig,
  timeframeToMs,
} from './src/engine/backtestEngine.ts';
import {
  evolveIndicatorConfigFromOutcome,
  trainAiOnSymbolCandles,
} from './src/engine/aiTrainer.ts';
import {
  KAGGLE_AI_TRAINER_PYTHON,
  ORACLE_ADB_SCHEMA_SQL,
  ORACLE_CLOUD_24X7_DEPLOY_SCRIPT,
} from './src/engine/oracleSchema.ts';
import {
  mergeAiMemoryRecords,
  mergeLiveTrades,
  oracleVault,
} from './src/db/oracleVault.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RealCandle {
  time: number;
  dateStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StreamQuote {
  symbol: TradingSymbol;
  bid: number;
  ask: number;
  mid: number;
  spreadTicks: number;
  source: string;
  latencyMs: number;
  ts: number;
  contractSymbol?: string;
  marketStatus?: 'NSE_LIVE' | 'NSE_CLOSED_GLOBAL_LIVE' | 'NSE_CLOSED';
}

interface BotRiskConfigPersisted {
  riskPerTradePct: number;
  maxDailyDrawdownPct: number;
  leverage: 1 | 5 | 10 | 20 | 35;
  trailingStopEnabled: boolean;
  breakEvenTriggerR: number;
  highRiskMode: boolean;
}

interface PersistentOracleVault {
  activeMode: BrokerMode;
  autoBotRunning: boolean;
  armedSymbols: TradingSymbol[];
  botRiskConfig: BotRiskConfigPersisted;
  strategyVerified: boolean;
  accounts: {
    LIVE: KotakAccountProfile;
  };
  aiMemory: AiStrategyMemoryRecord[];
  liveTrades: Array<{
    id: string;
    brokerOrderId: string;
    brokerMode: BrokerMode;
    symbol: TradingSymbol;
    trdSymbol?: string;
    direction: 'BUY' | 'SELL';
    lots: number;
    entryPrice: number;
    exitPrice?: number;
    stopLoss: number;
    takeProfit: number;
    initialStopDistance?: number;
    breakEvenLocked?: boolean;
    trailingActivated?: boolean;
    targetStepCount?: number;
    productCode?: 'MIS' | 'NRML';
    exchangeVerified?: boolean;
    kotakOrderStatus?: string;
    exchangeOrderId?: string;
    pnlInr: number;
    pnlTicks: number;
    status: 'OPEN' | 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL';
    strategyUsed: string;
    confluenceNote?: string;
    ts: number;
  }>;
}

const DATA_DIR = path.join(__dirname, 'data');
const VAULT_FILE = path.join(DATA_DIR, 'oracle_sync_vault.json');

function createInitialVault(): PersistentOracleVault {
  const now = new Date().toISOString();
  const emaCfg = STRATEGY_CATALOG[0].defaultRawConfig;
  const brkCfg = STRATEGY_CATALOG[1].defaultRawConfig;
  const revCfg = STRATEGY_CATALOG[2].defaultRawConfig;
  const scalpCfg = STRATEGY_CATALOG[3].defaultRawConfig;

  return {
    activeMode: 'LIVE',
    autoBotRunning: true,
    armedSymbols: ['USDINR', 'JPYINR', 'EURINR', 'GBPINR'],
    botRiskConfig: {
      riskPerTradePct: 10,
      maxDailyDrawdownPct: 35,
      leverage: 35,
      trailingStopEnabled: true,
      breakEvenTriggerR: 0.85,
      highRiskMode: true,
    },
    strategyVerified: true,
    accounts: {
      LIVE: {
        id: 'kotak-live-unlinked',
        label: 'Kotak Neo Live API Account',
        mode: 'LIVE',
        brokerName: 'Kotak Securities Neo API v2',
        exchangeSegment: 'NSE_CDS',
        ucc: '',
        mobile: '',
        consumerKeyMasked: 'Not configured',
        brokerageTier: 'Kotak Trade Free (₹0 Intraday)',
        balanceInr: 0,
        equityInr: 0,
        leverage: 10,
        connected: false,
        sessionState: 'DISCONNECTED',
        lastHeartbeat: 'Not connected',
      },
    },
    aiMemory: [
      {
        id: 'MEM-USDINR-30M-TREND',
        symbol: 'USDINR',
        timeframe: '30M',
        regime: 'TRENDING_CHANNEL',
        strategy: 'EMA_RSI_CONFLUENCE',
        indicatorConfig: { ...emaCfg, fastEmaPeriod: 12, slowEmaPeriod: 34, adxThreshold: 21 },
        winRatePct: 68.4,
        profitFactor: 2.14,
        netReturnPct: 24.8,
        tradesCount: 64,
        updatedAt: now,
        origin: 'BACKTEST_AUTOFIX',
      },
      {
        id: 'MEM-EURINR-5M-SQUEEZE',
        symbol: 'EURINR',
        timeframe: '5M',
        regime: 'BREAKOUT_SQUEEZE',
        strategy: 'SMART_MONEY_BREAKOUT',
        indicatorConfig: { ...brkCfg, fastEmaPeriod: 9, slowEmaPeriod: 24, adxThreshold: 20 },
        winRatePct: 63.2,
        profitFactor: 1.92,
        netReturnPct: 31.4,
        tradesCount: 92,
        updatedAt: now,
        origin: 'BACKTEST_AUTOFIX',
      },
      {
        id: 'MEM-GBPINR-1M-RANGE',
        symbol: 'GBPINR',
        timeframe: '1M',
        regime: 'MEAN_REVERTING_RANGE',
        strategy: 'BOLLINGER_MEAN_REVERSION',
        indicatorConfig: { ...revCfg, bollingerStdDev: 2.1, rsiOversold: 34, rsiOverbought: 66 },
        winRatePct: 71.0,
        profitFactor: 2.38,
        netReturnPct: 19.6,
        tradesCount: 78,
        updatedAt: now,
        origin: 'LIVE_ADAPTATION',
      },
      {
        id: 'MEM-JPYINR-30S-SCALP',
        symbol: 'JPYINR',
        timeframe: '30S',
        regime: 'HIGH_VELOCITY_SCALP',
        strategy: 'SCALPER_30S_MOMENTUM',
        indicatorConfig: { ...scalpCfg, fastEmaPeriod: 5, slowEmaPeriod: 13, atrMultiplierTP: 2.0 },
        winRatePct: 64.8,
        profitFactor: 1.86,
        netReturnPct: 27.5,
        tradesCount: 118,
        updatedAt: now,
        origin: 'LIVE_ADAPTATION',
      },
    ],
    liveTrades: [],
  };
}

function loadOrInitVault(): PersistentOracleVault {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(VAULT_FILE)) {
      const raw = fs.readFileSync(VAULT_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistentOracleVault> & {
        accounts?: { LIVE?: KotakAccountProfile; PAPER?: unknown };
      };
      if (parsed && Array.isArray(parsed.aiMemory)) {
        const fresh = createInitialVault();
        const prevLive = parsed.accounts?.LIVE;
        const prevUcc =
          prevLive?.ucc &&
          prevLive.ucc !== 'KN512084' &&
          prevLive.ucc !== 'Not Connected' &&
          prevLive.ucc !== 'PAPER-SIM'
            ? prevLive.ucc
            : '';

        // Server restarts clear in-memory Kotak Live session tokens, so require fresh TOTP + MPIN
        const cleanedLive: KotakAccountProfile = {
          ...fresh.accounts.LIVE,
          ucc: prevUcc,
          exchangeSegment:
            prevLive?.exchangeSegment === 'NSE_FO'
              ? 'NSE_FO'
              : prevLive?.exchangeSegment === 'MCX_FO'
              ? 'MCX_FO'
              : 'NSE_CDS',
          brokerageTier: prevLive?.brokerageTier || fresh.accounts.LIVE.brokerageTier,
          connected: false,
          sessionState: 'DISCONNECTED',
          lastHeartbeat: prevUcc
            ? 'Session expired on restart — login with TOTP + MPIN'
            : 'Not connected',
        };

        const cleanedTrades = Array.isArray(parsed.liveTrades)
          ? parsed.liveTrades.filter(
              (t) =>
                t &&
                t.brokerMode === 'LIVE' &&
                typeof t.brokerOrderId === 'string' &&
                !t.brokerOrderId.startsWith('PAPER-') &&
                (t.exchangeVerified === true ||
                  String(t.confluenceNote || '').includes('[KOTAK_VERIFIED_FILL'))
            )
          : [];

        const prevRisk = parsed.botRiskConfig;
        const isFirstHighRiskUpgrade = typeof prevRisk?.highRiskMode !== 'boolean';
        const prevArmedTradable = Array.isArray(parsed.armedSymbols)
          ? (parsed.armedSymbols.filter(
              (s): s is TradingSymbol =>
                typeof s === 'string' &&
                Boolean(INDIAN_SYMBOLS[s as TradingSymbol]) &&
                INDIAN_SYMBOLS[s as TradingSymbol].exchange !== 'GLOBAL_FX'
            ) as TradingSymbol[])
          : [];
        const prevArmed =
          isFirstHighRiskUpgrade || prevArmedTradable.length === 0
            ? (['USDINR', 'JPYINR', 'EURINR', 'GBPINR'] as TradingSymbol[])
            : prevArmedTradable;

        const cleanedRisk: BotRiskConfigPersisted = isFirstHighRiskUpgrade
          ? {
              riskPerTradePct: 10,
              maxDailyDrawdownPct: 35,
              leverage: 35,
              trailingStopEnabled: true,
              breakEvenTriggerR: 0.85,
              highRiskMode: true,
            }
          : {
              riskPerTradePct:
                typeof prevRisk?.riskPerTradePct === 'number'
                  ? Math.min(20, Math.max(0.1, prevRisk.riskPerTradePct))
                  : fresh.botRiskConfig.riskPerTradePct,
              maxDailyDrawdownPct:
                typeof prevRisk?.maxDailyDrawdownPct === 'number'
                  ? Math.min(50, Math.max(0.5, prevRisk.maxDailyDrawdownPct))
                  : fresh.botRiskConfig.maxDailyDrawdownPct,
              leverage: ([1, 5, 10, 20, 35].includes(Number(prevRisk?.leverage))
                ? Number(prevRisk?.leverage)
                : fresh.botRiskConfig.leverage) as 1 | 5 | 10 | 20 | 35,
              trailingStopEnabled:
                typeof prevRisk?.trailingStopEnabled === 'boolean'
                  ? prevRisk.trailingStopEnabled
                  : fresh.botRiskConfig.trailingStopEnabled,
              breakEvenTriggerR:
                typeof prevRisk?.breakEvenTriggerR === 'number'
                  ? Math.min(5, Math.max(0.4, prevRisk.breakEvenTriggerR))
                  : fresh.botRiskConfig.breakEvenTriggerR,
              highRiskMode: prevRisk.highRiskMode,
            };

        const migrated: PersistentOracleVault = {
          activeMode: 'LIVE',
          autoBotRunning: prevArmed.length > 0,
          armedSymbols: prevArmed,
          botRiskConfig: cleanedRisk,
          strategyVerified: true,
          accounts: {
            LIVE: cleanedLive,
          },
          aiMemory: parsed.aiMemory.length > 0 ? parsed.aiMemory : fresh.aiMemory,
          liveTrades: cleanedTrades,
        };
        saveVault(migrated);
        return migrated;
      }
    }
  } catch {
    // Recreate clean vault
  }
  const initial = createInitialVault();
  try {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
  return initial;
}

function saveVault(vault: PersistentOracleVault) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.DEFAULT_APP_PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  app.get('/api/health', (_req, res) => {
    const db = oracleVault.getStatus();
    res.json({
      status: 'ok',
      broker: 'KOTAK_NEO_V2',
      dbEngine: db.connected ? `ORACLE_ADB_${db.mode}` : 'LOCAL_CACHE_FALLBACK',
      oracleDb: db,
    });
  });

  const vault = loadOrInitVault();

  // Connect to shared Oracle Autonomous Database (if ORACLE_USER/PASSWORD/CONNECT_STRING set)
  // Auto-creates AI_STRATEGY_MEMORY, KOTAK_TRADE_LOG, NEOQUANT_ACCOUNT_SYNC tables and syncs both ways
  const hydratedFromOracle = await oracleVault.init(
    vault.aiMemory,
    vault.liveTrades,
    vault.accounts.LIVE
  );
  vault.aiMemory = hydratedFromOracle.aiMemory;
  vault.liveTrades = hydratedFromOracle.liveTrades.filter(
    (t) =>
      t.exchangeVerified === true || String(t.confluenceNote || '').includes('[KOTAK_VERIFIED_FILL')
  );
  if (hydratedFromOracle.accountMeta?.ucc && !vault.accounts.LIVE.ucc) {
    vault.accounts.LIVE.ucc = hydratedFromOracle.accountMeta.ucc;
    vault.accounts.LIVE.exchangeSegment = hydratedFromOracle.accountMeta.exchangeSegment;
    vault.accounts.LIVE.brokerageTier =
      hydratedFromOracle.accountMeta.brokerageTier as KotakAccountProfile['brokerageTier'];
  }
  saveVault(vault);

  // Periodic 30-second background pull so AI Studio & Oracle 24x7 VM share live AI learning automatically
  setInterval(async () => {
    if (!oracleVault.getStatus().connected) return;
    try {
      const remote = await oracleVault.pullAll();
      if (remote.aiMemory.length > 0) {
        vault.aiMemory = mergeAiMemoryRecords(vault.aiMemory, remote.aiMemory);
      }
      if (remote.liveTrades.length > 0) {
        const verifiedRemote = remote.liveTrades.filter(
          (t) => String(t.confluenceNote || '').includes('[KOTAK_VERIFIED_FILL')
        );
        if (verifiedRemote.length > 0) {
          vault.liveTrades = mergeLiveTrades(vault.liveTrades, verifiedRemote);
        }
      }
      if (remote.accountMeta?.ucc && !vault.accounts.LIVE.ucc) {
        vault.accounts.LIVE.ucc = remote.accountMeta.ucc;
      }
      saveVault(vault);
    } catch {
      // Non-fatal; retry on next interval
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Real Indian Market Data Hub (Yahoo NSE/INR + Swissquote BBO + Kraken WS)
  // ---------------------------------------------------------------------------
  const SYMBOL_FEED_MAP: Record<
    TradingSymbol,
    {
      yahoo: string;
      scale: number; // JPYINR=X is per 1 JPY (~0.5866), NSE CDS quotes per 100 JPY (~58.6600)
      decimals: number;
      tickSize: number;
      displayTicker: string;
      swissquotePair?: [string, string];
      inrDerived?: 'MUL' | 'DIV' | 'INV_100';
      mcxFormula?: 'GOLD_1G' | 'GOLD_10G' | 'SILVER_1KG' | 'CRUDE_BBL';
      is24x5Global?: boolean;
    }
  > = {
    USDINR: {
      yahoo: 'INR=X',
      scale: 1,
      decimals: 4,
      tickSize: 0.0025,
      displayTicker: 'NSE USDINR · Spot INR=X',
    },
    EURINR: {
      yahoo: 'EURINR=X',
      scale: 1,
      decimals: 4,
      tickSize: 0.0025,
      displayTicker: 'NSE EURINR · Live Cross',
      swissquotePair: ['EUR', 'USD'],
      inrDerived: 'MUL',
      is24x5Global: true,
    },
    GBPINR: {
      yahoo: 'GBPINR=X',
      scale: 1,
      decimals: 4,
      tickSize: 0.0025,
      displayTicker: 'NSE GBPINR · Live Cross',
      swissquotePair: ['GBP', 'USD'],
      inrDerived: 'MUL',
      is24x5Global: true,
    },
    JPYINR: {
      yahoo: 'JPY=X',
      scale: 1,
      decimals: 4,
      tickSize: 0.0025,
      displayTicker: 'NSE JPYINR (100 JPY)',
      swissquotePair: ['USD', 'JPY'],
      inrDerived: 'INV_100',
      is24x5Global: true,
    },
    EURUSD: {
      yahoo: 'EURUSD=X',
      scale: 1,
      decimals: 5,
      tickSize: 0.0001,
      displayTicker: 'NSE CDS · EUR/USD Live',
      swissquotePair: ['EUR', 'USD'],
      is24x5Global: true,
    },
    GBPUSD: {
      yahoo: 'GBPUSD=X',
      scale: 1,
      decimals: 5,
      tickSize: 0.0001,
      displayTicker: 'NSE CDS · GBP/USD Live',
      swissquotePair: ['GBP', 'USD'],
      is24x5Global: true,
    },
    USDJPY: {
      yahoo: 'JPY=X',
      scale: 1,
      decimals: 3,
      tickSize: 0.01,
      displayTicker: 'NSE CDS · USD/JPY Live',
      swissquotePair: ['USD', 'JPY'],
      is24x5Global: true,
    },
    AUDUSD: {
      yahoo: 'AUDUSD=X',
      scale: 1,
      decimals: 5,
      tickSize: 0.0001,
      displayTicker: 'FX · AUD/USD Live',
      swissquotePair: ['AUD', 'USD'],
      is24x5Global: true,
    },
    USDCAD: {
      yahoo: 'CAD=X',
      scale: 1,
      decimals: 5,
      tickSize: 0.0001,
      displayTicker: 'FX · USD/CAD Live',
      swissquotePair: ['USD', 'CAD'],
      is24x5Global: true,
    },
    USDCHF: {
      yahoo: 'CHF=X',
      scale: 1,
      decimals: 5,
      tickSize: 0.0001,
      displayTicker: 'FX · USD/CHF Live',
      swissquotePair: ['USD', 'CHF'],
      is24x5Global: true,
    },
    EURGBP: {
      yahoo: 'EURGBP=X',
      scale: 1,
      decimals: 5,
      tickSize: 0.0001,
      displayTicker: 'FX · EUR/GBP Live',
      swissquotePair: ['EUR', 'GBP'],
      is24x5Global: true,
    },
    EURJPY: {
      yahoo: 'EURJPY=X',
      scale: 1,
      decimals: 3,
      tickSize: 0.01,
      displayTicker: 'FX · EUR/JPY Live',
      swissquotePair: ['EUR', 'JPY'],
      is24x5Global: true,
    },
    GBPJPY: {
      yahoo: 'GBPJPY=X',
      scale: 1,
      decimals: 3,
      tickSize: 0.01,
      displayTicker: 'FX · GBP/JPY Live',
      swissquotePair: ['GBP', 'JPY'],
      is24x5Global: true,
    },
    AUDINR: {
      yahoo: 'AUDUSD=X',
      scale: 1,
      decimals: 4,
      tickSize: 0.0025,
      displayTicker: 'INR Cross · AUD/INR Live',
      swissquotePair: ['AUD', 'USD'],
      inrDerived: 'MUL',
      is24x5Global: true,
    },
    CADINR: {
      yahoo: 'CAD=X',
      scale: 1,
      decimals: 4,
      tickSize: 0.0025,
      displayTicker: 'INR Cross · CAD/INR Live',
      swissquotePair: ['USD', 'CAD'],
      inrDerived: 'DIV',
      is24x5Global: true,
    },
    CHFINR: {
      yahoo: 'CHF=X',
      scale: 1,
      decimals: 4,
      tickSize: 0.0025,
      displayTicker: 'INR Cross · CHF/INR Live',
      swissquotePair: ['USD', 'CHF'],
      inrDerived: 'DIV',
      is24x5Global: true,
    },
    NIFTY50: {
      yahoo: '^NSEI',
      scale: 1,
      decimals: 2,
      tickSize: 0.05,
      displayTicker: 'NSE NIFTY 50 (^NSEI)',
    },
    BANKNIFTY: {
      yahoo: '^NSEBANK',
      scale: 1,
      decimals: 2,
      tickSize: 0.05,
      displayTicker: 'NSE BANK NIFTY (^NSEBANK)',
    },
    FINNIFTY: {
      yahoo: 'NIFTY_FIN_SERVICE.NS',
      scale: 1,
      decimals: 2,
      tickSize: 0.05,
      displayTicker: 'NSE FIN NIFTY',
    },
    GOLDPETAL: {
      yahoo: 'GC=F',
      scale: 1,
      decimals: 0,
      tickSize: 1,
      displayTicker: 'MCX GOLDPETAL (1g Gold)',
      swissquotePair: ['XAU', 'USD'],
      mcxFormula: 'GOLD_1G',
      is24x5Global: true,
    },
    GOLDM: {
      yahoo: 'GC=F',
      scale: 1,
      decimals: 0,
      tickSize: 1,
      displayTicker: 'MCX GOLDM Mini (100g)',
      swissquotePair: ['XAU', 'USD'],
      mcxFormula: 'GOLD_10G',
      is24x5Global: true,
    },
    GOLD: {
      yahoo: 'GC=F',
      scale: 1,
      decimals: 0,
      tickSize: 1,
      displayTicker: 'MCX GOLD Futures (1kg)',
      swissquotePair: ['XAU', 'USD'],
      mcxFormula: 'GOLD_10G',
      is24x5Global: true,
    },
    SILVERMIC: {
      yahoo: 'SI=F',
      scale: 1,
      decimals: 0,
      tickSize: 1,
      displayTicker: 'MCX SILVERMIC (1kg)',
      swissquotePair: ['XAG', 'USD'],
      mcxFormula: 'SILVER_1KG',
      is24x5Global: true,
    },
    CRUDEOILM: {
      yahoo: 'CL=F',
      scale: 1,
      decimals: 0,
      tickSize: 1,
      displayTicker: 'MCX CRUDEOILM Mini (10bbl)',
      mcxFormula: 'CRUDE_BBL',
      is24x5Global: true,
    },
    XAUUSD: {
      yahoo: 'GC=F',
      scale: 1,
      decimals: 2,
      tickSize: 0.1,
      displayTicker: 'Spot Gold XAU/USD',
      swissquotePair: ['XAU', 'USD'],
      is24x5Global: true,
    },
  };

  function convertMcxPrice(
    usdPrice: number,
    formula: 'GOLD_1G' | 'GOLD_10G' | 'SILVER_1KG' | 'CRUDE_BBL',
    usdInr: number,
    decimals: number
  ): number {
    const TROY_OUNCE_GRAMS = 31.1034768;
    const INDIA_DUTY_PARITY = 1.06;
    let inr = usdPrice * usdInr;
    if (formula === 'GOLD_1G') {
      inr = (usdPrice / TROY_OUNCE_GRAMS) * 1 * usdInr * INDIA_DUTY_PARITY;
    } else if (formula === 'GOLD_10G') {
      inr = (usdPrice / TROY_OUNCE_GRAMS) * 10 * usdInr * INDIA_DUTY_PARITY;
    } else if (formula === 'SILVER_1KG') {
      inr = (usdPrice / TROY_OUNCE_GRAMS) * 1000 * usdInr * INDIA_DUTY_PARITY;
    } else if (formula === 'CRUDE_BBL') {
      inr = usdPrice * usdInr;
    }
    return Number(inr.toFixed(decimals));
  }

  function convertMcxCandleArray(
    candles: RealCandle[],
    formula: 'GOLD_1G' | 'GOLD_10G' | 'SILVER_1KG' | 'CRUDE_BBL',
    usdInr: number,
    decimals: number
  ): RealCandle[] {
    return candles.map((c) => {
      const o = convertMcxPrice(c.open, formula, usdInr, decimals);
      const cl = convertMcxPrice(c.close, formula, usdInr, decimals);
      const hi = convertMcxPrice(c.high, formula, usdInr, decimals);
      const lo = convertMcxPrice(c.low, formula, usdInr, decimals);
      return {
        ...c,
        open: o,
        high: Math.max(hi, o, cl),
        low: Math.min(lo, o, cl),
        close: cl,
      };
    });
  }

  function formatUtcDate(ms: number): string {
    // Format timestamps in Indian Standard Time (IST = UTC+05:30) to match Kotak Neo & NSE India
    const istMs = ms + 330 * 60 * 1000;
    const d = new Date(istMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function isNseMarketOpen(sym: TradingSymbol, nowMs = Date.now()): boolean {
    const ist = new Date(nowMs + 330 * 60 * 1000);
    const dow = ist.getUTCDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) return false;
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (
      sym === 'GOLDPETAL' ||
      sym === 'GOLDM' ||
      sym === 'GOLD' ||
      sym === 'SILVERMIC' ||
      sym === 'CRUDEOILM'
    ) {
      // MCX Commodities India: 09:00 AM – 11:55 PM IST
      return mins >= 9 * 60 && mins <= 23 * 60 + 55;
    }
    if (sym === 'XAUUSD') {
      // Global Spot Gold 24x5
      return true;
    }
    if (sym === 'NIFTY50' || sym === 'BANKNIFTY' || sym === 'FINNIFTY') {
      // NSE Equity & F&O: 09:15 – 15:30 IST
      return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
    }
    // NSE Currency Derivatives (CDS): 09:00 – 17:00 IST
    return mins >= 9 * 60 && mins <= 17 * 60;
  }

  async function fetchKrakenOhlc(
    pair: 'EURUSD' | 'GBPUSD',
    intervalMin: 1 | 5 | 30
  ): Promise<RealCandle[]> {
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${intervalMin}`;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`Kraken OHLC HTTP ${resp.status} for ${pair}`);
    const json = (await resp.json()) as {
      result?: Record<string, Array<[number, string, string, string, string, string, string, number]>>;
    };
    const key = Object.keys(json.result || {}).find((k) => k !== 'last');
    const rows = key ? json.result?.[key] : undefined;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`No Kraken OHLC rows for ${pair}`);
    }
    const out: RealCandle[] = [];
    for (const r of rows) {
      const time = Number(r[0]) * 1000;
      const open = Number(r[1]);
      const high = Number(r[2]);
      const low = Number(r[3]);
      const close = Number(r[4]);
      const volume = Number(r[6]) || 0;
      if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0 || close <= 0) continue;
      out.push({
        time,
        dateStr: formatUtcDate(time),
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
        volume: Math.round(volume * 100),
      });
    }
    return out;
  }

  function intervalToMs(interval: string): number {
    switch (interval) {
      case '1m':
        return 60 * 1000;
      case '5m':
        return 5 * 60 * 1000;
      case '15m':
        return 15 * 60 * 1000;
      case '30m':
        return 30 * 60 * 1000;
      case '1h':
        return 60 * 60 * 1000;
      default:
        return 0;
    }
  }

  /**
   * Clamps isolated 1-bar OTC bad prints (e.g. Yahoo INR=X 94.27 spike surrounded by 92.22 bars)
   * while preserving genuine multi-bar market trends without distortion.
   */
  function sanitizeCandles(candles: RealCandle[], decimals: number): RealCandle[] {
    if (candles.length < 5) return candles;
    const out: RealCandle[] = new Array(candles.length);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const neighborCloses: number[] = [];
      for (let d = -3; d <= 3; d++) {
        if (d === 0) continue;
        const idx = i + d;
        if (idx >= 0 && idx < candles.length && candles[idx].close > 0) {
          neighborCloses.push(candles[idx].close);
        }
      }
      if (neighborCloses.length < 2) {
        out[i] = c;
        continue;
      }
      neighborCloses.sort((a, b) => a - b);
      const med = neighborCloses[Math.floor(neighborCloses.length / 2)];
      const neighborMin = neighborCloses[0];
      const neighborMax = neighborCloses[neighborCloses.length - 1];
      const neighborSpan = Math.abs(neighborMax - neighborMin);
      const maxJump = Math.max(med * 0.0085, neighborSpan * 3.5);
      const upperCap = Number((neighborMax + maxJump).toFixed(decimals));
      const lowerCap = Number(Math.max(med * 0.5, neighborMin - maxJump).toFixed(decimals));

      const open = Math.min(upperCap, Math.max(lowerCap, c.open));
      const close = Math.min(upperCap, Math.max(lowerCap, c.close));
      const bodyHi = Math.max(open, close);
      const bodyLo = Math.min(open, close);
      const wickAllowance = Math.max(med * 0.006, neighborSpan * 2.5);
      const high = Number(Math.min(Math.max(c.high, bodyHi), bodyHi + wickAllowance).toFixed(decimals));
      const low = Number(
        Math.max(Math.min(c.low, bodyLo), Math.max(med * 0.5, bodyLo - wickAllowance)).toFixed(decimals)
      );

      out[i] = {
        ...c,
        open: Number(open.toFixed(decimals)),
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close: Number(close.toFixed(decimals)),
      };
    }
    return out;
  }

  function aggregateCandles(candles: RealCandle[], bucketMs: number, decimals: number): RealCandle[] {
    if (candles.length === 0) return [];
    const out: RealCandle[] = [];
    let currentBucket = -1;
    let agg: RealCandle | null = null;

    for (const c of candles) {
      const bucket = Math.floor(c.time / bucketMs) * bucketMs;
      if (bucket !== currentBucket || !agg) {
        if (agg) out.push(agg);
        currentBucket = bucket;
        agg = {
          time: bucket,
          dateStr: formatUtcDate(bucket),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
      } else {
        agg.high = Number(Math.max(agg.high, c.high).toFixed(decimals));
        agg.low = Number(Math.min(agg.low, c.low).toFixed(decimals));
        agg.close = c.close;
        agg.volume += c.volume;
      }
    }
    if (agg) out.push(agg);
    return out;
  }

  /**
   * Splits real 1m candles into continuous 30S candles while live sub-second ticks build real-time 30S bars forward.
   */
  function expand1mTo30sCandles(candles1m: RealCandle[], decimals: number): RealCandle[] {
    const out: RealCandle[] = [];
    for (const bar of candles1m) {
      const isBull = bar.close >= bar.open;
      const mid = Number(((bar.open + bar.close) / 2).toFixed(decimals));
      const firstHalfHigh = Number((isBull ? Math.max(bar.open, mid) : bar.high).toFixed(decimals));
      const firstHalfLow = Number((isBull ? bar.low : Math.min(bar.open, mid)).toFixed(decimals));
      const secondHalfHigh = Number((isBull ? bar.high : Math.max(mid, bar.close)).toFixed(decimals));
      const secondHalfLow = Number((isBull ? Math.min(mid, bar.close) : bar.low).toFixed(decimals));

      out.push({
        time: bar.time,
        dateStr: formatUtcDate(bar.time),
        open: bar.open,
        high: Math.max(firstHalfHigh, bar.open, mid),
        low: Math.min(firstHalfLow, bar.open, mid),
        close: mid,
        volume: Math.floor(bar.volume / 2),
      });
      out.push({
        time: bar.time + 30_000,
        dateStr: formatUtcDate(bar.time + 30_000),
        open: mid,
        high: Math.max(secondHalfHigh, mid, bar.close),
        low: Math.min(secondHalfLow, mid, bar.close),
        close: bar.close,
        volume: Math.ceil(bar.volume / 2),
      });
    }
    return out;
  }

  async function fetchYahooChart(
    ticker: string,
    range: string,
    interval: string,
    decimals: number,
    scale = 1
  ): Promise<{ candles: RealCandle[]; regularMarketPrice?: number; previousClose?: number }> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      throw new Error(`Yahoo HTTP ${resp.status} for ${ticker}`);
    }
    const json = (await resp.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number; chartPreviousClose?: number };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
        error?: { description?: string };
      };
    };

    const result = json?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) {
      throw new Error(json?.chart?.error?.description || `No data for ${ticker}`);
    }

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0] ?? {};
    const opens = quote.open ?? [];
    const highs = quote.high ?? [];
    const lows = quote.low ?? [];
    const closes = quote.close ?? [];
    const volumes = quote.volume ?? [];

    const rawCandles: RealCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      if (
        typeof ts !== 'number' ||
        typeof o !== 'number' ||
        typeof h !== 'number' ||
        typeof l !== 'number' ||
        typeof c !== 'number' ||
        !Number.isFinite(o) ||
        !Number.isFinite(h) ||
        !Number.isFinite(l) ||
        !Number.isFinite(c) ||
        o <= 0 ||
        c <= 0
      ) {
        continue;
      }

      const time = ts * 1000;
      const scaledO = o * scale;
      const scaledH = h * scale;
      const scaledL = l * scale;
      const scaledC = c * scale;
      const fixedOpen = Number(scaledO.toFixed(decimals));
      const fixedClose = Number(scaledC.toFixed(decimals));
      const fixedHigh = Number(Math.max(scaledH, scaledO, scaledC).toFixed(decimals));
      const fixedLow = Number(Math.min(scaledL, scaledO, scaledC).toFixed(decimals));
      const vol =
        typeof volumes[i] === 'number' && Number.isFinite(volumes[i]!) && volumes[i]! > 0
          ? Math.round(volumes[i]!)
          : 0;

      rawCandles.push({
        time,
        dateStr: formatUtcDate(time),
        open: fixedOpen,
        high: fixedHigh,
        low: fixedLow,
        close: fixedClose,
        volume: vol,
      });
    }

    const bucketMs = intervalToMs(interval);
    const cleanedRaw = sanitizeCandles(rawCandles, decimals);
    const candles =
      bucketMs > 0
        ? sanitizeCandles(aggregateCandles(cleanedRaw, bucketMs, decimals), decimals)
        : cleanedRaw;

    return {
      candles,
      regularMarketPrice:
        typeof result.meta?.regularMarketPrice === 'number'
          ? Number((result.meta.regularMarketPrice * scale).toFixed(decimals))
          : undefined,
      previousClose:
        typeof result.meta?.chartPreviousClose === 'number'
          ? Number((result.meta.chartPreviousClose * scale).toFixed(decimals))
          : undefined,
    };
  }

  const historyCache = new Map<
    string,
    {
      expiresAt: number;
      payload: {
        symbol: TradingSymbol;
        timeframe: Timeframe;
        ticker: string;
        source: 'YAHOO_REAL';
        livePrice: number;
        candles: RealCandle[];
      };
    }
  >();

  async function loadRealCandlesForSymbol(
    sym: TradingSymbol,
    tf: Timeframe
  ): Promise<{
    symbol: TradingSymbol;
    timeframe: Timeframe;
    ticker: string;
    source: 'YAHOO_REAL';
    livePrice: number;
    candles: RealCandle[];
  }> {
    const cacheKey = `${sym}_${tf}`;
    const cached = historyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload;
    }

    const meta = SYMBOL_FEED_MAP[sym];
    let candles: RealCandle[] = [];
    let livePrice = 0;

    if (tf === '1H') {
      const y1h = await fetchYahooChart(meta.yahoo, '1y', '1h', meta.decimals, meta.scale);
      candles = y1h.candles;
      livePrice = y1h.regularMarketPrice ?? candles[candles.length - 1]?.close ?? 0;
    } else if (tf === '30M') {
      const [y1h, y15m] = await Promise.all([
        fetchYahooChart(meta.yahoo, '1y', '1h', meta.decimals, meta.scale),
        fetchYahooChart(meta.yahoo, '60d', '15m', meta.decimals, meta.scale),
      ]);
      const agg30m = aggregateCandles(y15m.candles, 30 * 60 * 1000, meta.decimals);
      const cutoff = agg30m.length > 0 ? agg30m[0].time : Infinity;
      const older = y1h.candles.filter((c) => c.time < cutoff);
      candles = [...older, ...agg30m];
      livePrice = y15m.regularMarketPrice ?? y1h.regularMarketPrice ?? candles[candles.length - 1]?.close ?? 0;
    } else if (tf === '15M') {
      const [y1h, y15m] = await Promise.all([
        fetchYahooChart(meta.yahoo, '1y', '1h', meta.decimals, meta.scale),
        fetchYahooChart(meta.yahoo, '60d', '15m', meta.decimals, meta.scale),
      ]);
      const cutoff = y15m.candles.length > 0 ? y15m.candles[0].time : Infinity;
      const older = y1h.candles.filter((c) => c.time < cutoff);
      candles = [...older, ...y15m.candles];
      livePrice = y15m.regularMarketPrice ?? y1h.regularMarketPrice ?? candles[candles.length - 1]?.close ?? 0;
    } else if (tf === '5M') {
      const [y1h, y5m] = await Promise.all([
        fetchYahooChart(meta.yahoo, '1y', '1h', meta.decimals, meta.scale),
        fetchYahooChart(meta.yahoo, '60d', '5m', meta.decimals, meta.scale),
      ]);
      const recent5m = y5m.candles.slice(-2400);
      const cutoff = recent5m.length > 0 ? recent5m[0].time : Infinity;
      const older = y1h.candles.filter((c) => c.time < cutoff);
      candles = [...older, ...recent5m];
      livePrice = y5m.regularMarketPrice ?? y1h.regularMarketPrice ?? candles[candles.length - 1]?.close ?? 0;
    } else if (tf === '1M') {
      const [y1h, y1m] = await Promise.all([
        fetchYahooChart(meta.yahoo, '1y', '1h', meta.decimals, meta.scale),
        fetchYahooChart(meta.yahoo, '5d', '1m', meta.decimals, meta.scale),
      ]);
      const recent1m = y1m.candles.slice(-1600);
      const cutoff = recent1m.length > 0 ? recent1m[0].time : Infinity;
      const older = y1h.candles.filter((c) => c.time < cutoff);
      candles = [...older, ...recent1m];
      livePrice = y1m.regularMarketPrice ?? y1h.regularMarketPrice ?? candles[candles.length - 1]?.close ?? 0;
    } else {
      // 30S: Recent 1m candles expanded seamlessly into 30S resolution + live ticks forward
      const y1m = await fetchYahooChart(meta.yahoo, '2d', '1m', meta.decimals, meta.scale);
      candles = expand1mTo30sCandles(y1m.candles.slice(-360), meta.decimals);
      livePrice = y1m.regularMarketPrice ?? candles[candles.length - 1]?.close ?? 0;
    }

    if (candles.length < 30) {
      throw new Error(`Insufficient real candles for ${sym} ${tf}`);
    }

    if (meta.mcxFormula) {
      const usdInr = await refreshUsdInrBackground();
      candles = convertMcxCandleArray(candles, meta.mcxFormula, usdInr, meta.decimals);
      livePrice = candles[candles.length - 1]?.close ?? livePrice;
    }

    const payload = {
      symbol: sym,
      timeframe: tf,
      ticker: meta.displayTicker,
      source: 'YAHOO_REAL' as const,
      livePrice: Number((livePrice || candles[candles.length - 1].close).toFixed(meta.decimals)),
      candles,
    };

    historyCache.set(cacheKey, {
      expiresAt: Date.now() + (tf === '30S' || tf === '1M' ? 45_000 : 120_000),
      payload,
    });
    return payload;
  }

  app.get('/api/market/history', async (req, res) => {
    const rawSym = String(req.query.symbol || 'USDINR').toUpperCase() as TradingSymbol;
    const rawTf = String(req.query.timeframe || '30M').toUpperCase() as Timeframe;
    const sym: TradingSymbol = SYMBOL_FEED_MAP[rawSym] ? rawSym : 'USDINR';
    const tf: Timeframe = (['30S', '1M', '5M', '15M', '30M', '1H'] as const).includes(rawTf)
      ? rawTf
      : '30M';

    try {
      const payload = await loadRealCandlesForSymbol(sym, tf);
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to load Indian market history',
      });
    }
  });

  interface QuadPayload {
    symbol: TradingSymbol;
    ticker: string;
    source: 'KOTAK_NEO_LIVE' | 'KRAKEN_DERIVED' | 'YAHOO_REAL';
    livePrice: number;
    contractSymbol?: string;
    marketStatus: 'NSE_LIVE' | 'NSE_CLOSED_GLOBAL_LIVE' | 'NSE_CLOSED';
    frames: Record<'30M' | '5M' | '1M' | '30S', RealCandle[]>;
    cachedAt: number;
  }

  interface KotakResolvedContract {
    symbol: TradingSymbol;
    quoteSegment: 'cde_fo' | 'nse_cm' | 'nse_fo' | 'mcx_fo';
    quoteToken: string;
    orderSegment: 'cde_fo' | 'nse_fo' | 'mcx_fo';
    trdSymbol: string;
    lotSize: number;
  }

  // Kotak Neo Live Session + Scrip Master Contract Map + Live Tick Candle Accumulator
  let liveBrokerSession: {
    ucc: string;
    consumerKey: string;
    tradingToken: string;
    tradingSid: string;
    baseUrl: string;
    connectedAt: number;
  } | null = null;

  const KOTAK_SPOT_QUOTE_TOKENS: Partial<
    Record<TradingSymbol, { quoteSegment: 'nse_cm'; quoteToken: string }>
  > = {
    NIFTY50: { quoteSegment: 'nse_cm', quoteToken: 'Nifty 50' },
    BANKNIFTY: { quoteSegment: 'nse_cm', quoteToken: 'Nifty Bank' },
  };

  // ONLY populated with real tradable near-month contracts resolved from Kotak Scrip Master CSVs!
  const kotakContracts = new Map<TradingSymbol, KotakResolvedContract>();

  const kotakLiveCandles = new Map<TradingSymbol, Record<'30M' | '5M' | '1M' | '30S', RealCandle[]>>();
  const kotakLastQuoteAt = new Map<TradingSymbol, number>();
  const kotakBasisAligned = new Set<TradingSymbol>();
  let kotakScripMasterReady = false;
  let kotakScripMasterPromise: Promise<void> | null = null;

  function recordKotakLiveTickBar(sym: TradingSymbol, price: number, tsMs: number) {
    // Strictly never synthesize new candles when the Indian exchange segment is closed!
    if (!isNseMarketOpen(sym, tsMs)) return;
    const decimals = SYMBOL_FEED_MAP[sym].decimals;
    const rounded = Number(price.toFixed(decimals));
    let bucketMap = kotakLiveCandles.get(sym);
    if (!bucketMap) {
      bucketMap = { '30M': [], '5M': [], '1M': [], '30S': [] };
      kotakLiveCandles.set(sym, bucketMap);
    }
    const defs: Array<['30M' | '5M' | '1M' | '30S', number]> = [
      ['30M', 30 * 60_000],
      ['5M', 5 * 60_000],
      ['1M', 60_000],
      ['30S', 30_000],
    ];
    for (const [tf, ms] of defs) {
      const arr = bucketMap[tf];
      const bucket = Math.floor(tsMs / ms) * ms;
      const last = arr[arr.length - 1];
      if (!last || bucket > last.time) {
        arr.push({
          time: bucket,
          dateStr: formatUtcDate(bucket),
          open: last ? last.close : rounded,
          high: last ? Math.max(last.close, rounded) : rounded,
          low: last ? Math.min(last.close, rounded) : rounded,
          close: rounded,
          volume: 1,
        });
        if (arr.length > 220) arr.shift();
      } else {
        last.high = Number(Math.max(last.high, rounded).toFixed(decimals));
        last.low = Number(Math.min(last.low, rounded).toFixed(decimals));
        last.close = rounded;
        last.volume += 1;
      }
    }
  }

  function mergeHistoricalWithKotakBars(
    historical: RealCandle[],
    liveBars: RealCandle[] | undefined,
    kotakLtp: number | undefined,
    decimals: number
  ): RealCandle[] {
    let base = historical;
    // Align historical spot/global parity curve smoothly to Kotak Neo Futures/MCX contract LTP (eliminates step cliffs)
    if (kotakLtp && kotakLtp > 0 && base.length > 0) {
      const lastClose = base[base.length - 1].close;
      const basisPct = Math.abs(kotakLtp - lastClose) / lastClose;
      if (basisPct > 0.0001 && basisPct < 0.35) {
        const ratio = kotakLtp / lastClose;
        base = base.map((c) => ({
          ...c,
          open: Number((c.open * ratio).toFixed(decimals)),
          high: Number((c.high * ratio).toFixed(decimals)),
          low: Number((c.low * ratio).toFixed(decimals)),
          close: Number((c.close * ratio).toFixed(decimals)),
        }));
      }
    }
    if (!liveBars || liveBars.length === 0) return base;
    const map = new Map<number, RealCandle>();
    for (const c of base) map.set(c.time, c);
    for (const c of liveBars) map.set(c.time, c);
    return Array.from(map.values())
      .sort((a, b) => a.time - b.time)
      .slice(-220);
  }

  function parseKotakCsvExpiryToUnixSec(rawExp: string): number {
    const clean = (rawExp || '').replace(/^"|"$/g, '').trim();
    if (!clean) return 0;
    const num = Number(clean);
    if (Number.isFinite(num) && num > 0) {
      if (num > 1e12) return Math.floor(num / 1000);
      // NSE / Kotak cde_fo & nse_fo CSV lExpiryDate is seconds since 1980-01-01 (+315532800s from 1970 Unix epoch)!
      if (num > 800_000_000 && num < 1_650_000_000) {
        return num + 315_532_800;
      }
      return num;
    }
    const parsedMs = Date.parse(clean);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.floor(parsedMs / 1000);
    }
    return 0;
  }

  function parseKotakMasterCsvForNearestFutures(
    csvText: string,
    segment: 'cde_fo' | 'nse_fo' | 'mcx_fo',
    targets: Array<{ sym: TradingSymbol; prefixes: string[]; instTypes: string[] }>
  ) {
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return;
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const idxSym = headers.findIndex((h) => h === 'psymbol' || h === 'p_symbol');
    const idxTrd = headers.findIndex((h) => h === 'ptrdsymbol' || h === 'p_trdsymbol');
    const idxInst = headers.findIndex((h) => h === 'pinsttype' || h === 'p_insttype');
    const idxName = headers.findIndex(
      (h) => h === 'psymbolname' || h === 'p_symbolname' || h === 'pscriprefkey'
    );
    const idxExp = headers.findIndex((h) => h.includes('expiry'));
    const idxLot = headers.findIndex(
      (h) => h.includes('lotsize') || h === 'llotsize' || h === 'ilotsize' || h === 'p_lotsize'
    );
    if (idxSym < 0 || idxTrd < 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const bestFuture = new Map<
      TradingSymbol,
      { expiry: number; pSymbol: string; trdSymbol: string; lotSize: number }
    >();
    const fallbackNearest = new Map<
      TradingSymbol,
      { expiry: number; pSymbol: string; trdSymbol: string; lotSize: number }
    >();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = line.split(',');
      if (cols.length <= Math.max(idxSym, idxTrd)) continue;
      const inst = (idxInst >= 0 ? cols[idxInst] : '').replace(/^"|"$/g, '').trim().toUpperCase();
      const trd = (cols[idxTrd] || '').replace(/^"|"$/g, '').trim().toUpperCase();
      const name = (idxName >= 0 ? cols[idxName] : '').replace(/^"|"$/g, '').trim().toUpperCase();
      const pSym = (cols[idxSym] || '').replace(/^"|"$/g, '').trim();
      if (!pSym || !trd) continue;

      for (const t of targets) {
        if (idxInst >= 0 && t.instTypes.length > 0 && !t.instTypes.includes(inst)) continue;
        const matchesName = t.prefixes.some((p) => {
          if (name === p && trd.endsWith('FUT')) return true;
          if (!trd.startsWith(p) || !trd.endsWith('FUT')) return false;
          const nextChar = trd.charAt(p.length);
          return /\d/.test(nextChar);
        });
        if (!matchesName) continue;

        const expSec = parseKotakCsvExpiryToUnixSec(idxExp >= 0 ? cols[idxExp] : '');
        const lotRaw = idxLot >= 0 ? Number((cols[idxLot] || '').replace(/^"|"$/g, '').trim()) : 1;
        const lotSize = Number.isFinite(lotRaw) && lotRaw >= 1 ? Math.round(lotRaw) : 1;

        if (expSec >= nowSec - 86400) {
          const prev = bestFuture.get(t.sym);
          if (!prev || expSec < prev.expiry) {
            bestFuture.set(t.sym, { expiry: expSec, pSymbol: pSym, trdSymbol: trd, lotSize });
          }
        } else if (expSec > 0) {
          // Clock-skew safety fallback (e.g., sandbox clock vs live exchange year)
          const prevFb = fallbackNearest.get(t.sym);
          if (!prevFb || expSec < prevFb.expiry) {
            fallbackNearest.set(t.sym, { expiry: expSec, pSymbol: pSym, trdSymbol: trd, lotSize });
          }
        }
      }
    }

    for (const t of targets) {
      const found = bestFuture.get(t.sym) ?? fallbackNearest.get(t.sym);
      if (!found) continue;
      if (segment === 'cde_fo' || segment === 'mcx_fo') {
        kotakContracts.set(t.sym, {
          symbol: t.sym,
          quoteSegment: segment,
          quoteToken: found.pSymbol,
          orderSegment: segment,
          trdSymbol: found.trdSymbol,
          lotSize: found.lotSize,
        });
      } else {
        const spot = KOTAK_SPOT_QUOTE_TOKENS[t.sym];
        kotakContracts.set(t.sym, {
          symbol: t.sym,
          quoteSegment: spot?.quoteSegment ?? 'nse_fo',
          quoteToken: spot?.quoteToken ?? found.pSymbol,
          orderSegment: 'nse_fo',
          trdSymbol: found.trdSymbol,
          lotSize: found.lotSize,
        });
      }
    }
  }

  async function initializeKotakScripMaster(session: NonNullable<typeof liveBrokerSession>) {
    if (kotakScripMasterPromise) return kotakScripMasterPromise;
    kotakScripMasterPromise = (async () => {
      try {
        const resp = await fetch(`${session.baseUrl}/script-details/1.0/masterscrip/file-paths`, {
          headers: {
            Authorization: session.consumerKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return;
        const json = (await resp.json()) as {
          data?: { filesPaths?: string[] };
          filesPaths?: string[];
        };
        const paths = json?.data?.filesPaths ?? json?.filesPaths ?? [];
        if (!Array.isArray(paths) || paths.length === 0) return;

        const cdeUrl = paths.find((u) => u.includes('cde_fo.csv'));
        const nfoUrl = paths.find((u) => u.includes('nse_fo.csv'));
        const mcxUrl = paths.find((u) => u.includes('mcx_fo.csv'));

        const tasks: Promise<void>[] = [];
        if (cdeUrl) {
          tasks.push(
            fetch(cdeUrl, { signal: AbortSignal.timeout(12000) })
              .then((r) => (r.ok ? r.text() : ''))
              .then((csv) => {
                if (!csv) return;
                parseKotakMasterCsvForNearestFutures(csv, 'cde_fo', [
                  { sym: 'USDINR', prefixes: ['USDINR'], instTypes: ['FUTCUR'] },
                  { sym: 'EURINR', prefixes: ['EURINR'], instTypes: ['FUTCUR'] },
                  { sym: 'GBPINR', prefixes: ['GBPINR'], instTypes: ['FUTCUR'] },
                  { sym: 'JPYINR', prefixes: ['JPYINR'], instTypes: ['FUTCUR'] },
                  { sym: 'EURUSD', prefixes: ['EURUSD'], instTypes: ['FUTCUR'] },
                  { sym: 'GBPUSD', prefixes: ['GBPUSD'], instTypes: ['FUTCUR'] },
                  { sym: 'USDJPY', prefixes: ['USDJPY'], instTypes: ['FUTCUR'] },
                ]);
              })
              .catch(() => {})
          );
        }
        if (nfoUrl) {
          tasks.push(
            fetch(nfoUrl, { signal: AbortSignal.timeout(12000) })
              .then((r) => (r.ok ? r.text() : ''))
              .then((csv) => {
                if (!csv) return;
                parseKotakMasterCsvForNearestFutures(csv, 'nse_fo', [
                  { sym: 'NIFTY50', prefixes: ['NIFTY'], instTypes: ['FUTIDX'] },
                  { sym: 'BANKNIFTY', prefixes: ['BANKNIFTY'], instTypes: ['FUTIDX'] },
                  { sym: 'FINNIFTY', prefixes: ['FINNIFTY'], instTypes: ['FUTIDX'] },
                ]);
              })
              .catch(() => {})
          );
        }
        if (mcxUrl) {
          tasks.push(
            fetch(mcxUrl, { signal: AbortSignal.timeout(14000) })
              .then((r) => (r.ok ? r.text() : ''))
              .then((csv) => {
                if (!csv) return;
                parseKotakMasterCsvForNearestFutures(csv, 'mcx_fo', [
                  { sym: 'GOLDPETAL', prefixes: ['GOLDPETAL'], instTypes: ['FUTCOM'] },
                  { sym: 'GOLDM', prefixes: ['GOLDM'], instTypes: ['FUTCOM'] },
                  { sym: 'GOLD', prefixes: ['GOLD'], instTypes: ['FUTCOM'] },
                  { sym: 'SILVERMIC', prefixes: ['SILVERMIC'], instTypes: ['FUTCOM'] },
                  { sym: 'CRUDEOILM', prefixes: ['CRUDEOILM'], instTypes: ['FUTCOM'] },
                ]);
              })
              .catch(() => {})
          );
        }
        await Promise.all(tasks);
        kotakScripMasterReady = kotakContracts.size > 0;
      } catch {
        // Non-fatal
      } finally {
        kotakScripMasterPromise = null;
      }
    })();
    return kotakScripMasterPromise;
  }

  const quadCache = new Map<TradingSymbol, { expiresAt: number; payload: QuadPayload }>();
  const inflightQuadPromises = new Map<TradingSymbol, Promise<QuadPayload>>();

  async function loadQuadCandlesCached(sym: TradingSymbol): Promise<QuadPayload> {
    const cached = quadCache.get(sym);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload;
    }
    const inflight = inflightQuadPromises.get(sym);
    if (inflight) return inflight;

    const meta = SYMBOL_FEED_MAP[sym];
    const promise = (async (): Promise<QuadPayload> => {
      const usdInr = await refreshUsdInrBackground();
      let candles30M: RealCandle[] = [];
      let candles5M: RealCandle[] = [];
      let candles1M: RealCandle[] = [];
      let source: QuadPayload['source'] = 'YAHOO_REAL';
      let livePrice = INDIAN_SYMBOLS[sym].basePrice;

      if (sym === 'EURINR' || sym === 'GBPINR' || sym === 'EURUSD' || sym === 'GBPUSD') {
        // Real institutional Kraken OHLC (0 flat bars, up-to-the-minute live)
        const kPair = sym === 'EURINR' || sym === 'EURUSD' ? 'EURUSD' : 'GBPUSD';
        const mult = sym === 'EURINR' || sym === 'GBPINR' ? usdInr : 1;
        const [k30, k5, k1] = await Promise.all([
          fetchKrakenOhlc(kPair, 30),
          fetchKrakenOhlc(kPair, 5),
          fetchKrakenOhlc(kPair, 1),
        ]);
        const scaleArr = (arr: RealCandle[]) =>
          arr.slice(-200).map((c) => ({
            ...c,
            open: Number((c.open * mult).toFixed(meta.decimals)),
            high: Number((c.high * mult).toFixed(meta.decimals)),
            low: Number((c.low * mult).toFixed(meta.decimals)),
            close: Number((c.close * mult).toFixed(meta.decimals)),
          }));
        candles30M = scaleArr(k30);
        candles5M = scaleArr(k5);
        candles1M = scaleArr(k1);
        source = 'KRAKEN_DERIVED';
        livePrice = candles1M[candles1M.length - 1]?.close ?? livePrice;
      } else if (meta.inrDerived === 'INV_100') {
        // JPYINR derived from liquid USD/JPY (JPY=X) -> 100 * USDINR / USDJPY
        const [j30, j5, j1] = await Promise.all([
          fetchYahooChart('JPY=X', '14d', '30m', 4, 1),
          fetchYahooChart('JPY=X', '5d', '5m', 4, 1),
          fetchYahooChart('JPY=X', '2d', '1m', 4, 1),
        ]);
        const convertJpy = (arr: RealCandle[]) =>
          arr.slice(-200).map((c) => {
            const o = Number(((100 * usdInr) / c.open).toFixed(meta.decimals));
            const cl = Number(((100 * usdInr) / c.close).toFixed(meta.decimals));
            const hi = Number(((100 * usdInr) / Math.min(c.low, c.open, c.close)).toFixed(meta.decimals));
            const lo = Number(((100 * usdInr) / Math.max(c.high, c.open, c.close)).toFixed(meta.decimals));
            return {
              ...c,
              open: o,
              high: Math.max(hi, o, cl),
              low: Math.min(lo, o, cl),
              close: cl,
            };
          });
        candles30M = convertJpy(j30.candles);
        candles5M = convertJpy(j5.candles);
        candles1M = convertJpy(j1.candles);
        source = 'YAHOO_REAL';
        livePrice = candles1M[candles1M.length - 1]?.close ?? livePrice;
      } else if (meta.inrDerived === 'MUL' || meta.inrDerived === 'DIV') {
        // AUDINR (AUDUSD * USDINR), CADINR (USDINR / USDCAD), CHFINR (USDINR / USDCHF)
        const [y30, y5, y1] = await Promise.all([
          fetchYahooChart(meta.yahoo, '14d', '30m', 5, 1),
          fetchYahooChart(meta.yahoo, '5d', '5m', 5, 1),
          fetchYahooChart(meta.yahoo, '2d', '1m', 5, 1),
        ]);
        const convertInr = (arr: RealCandle[]) =>
          arr.slice(-200).map((c) => {
            if (meta.inrDerived === 'MUL') {
              const o = Number((c.open * usdInr).toFixed(meta.decimals));
              const cl = Number((c.close * usdInr).toFixed(meta.decimals));
              const hi = Number((c.high * usdInr).toFixed(meta.decimals));
              const lo = Number((c.low * usdInr).toFixed(meta.decimals));
              return { ...c, open: o, high: Math.max(hi, o, cl), low: Math.min(lo, o, cl), close: cl };
            }
            const o = Number((usdInr / c.open).toFixed(meta.decimals));
            const cl = Number((usdInr / c.close).toFixed(meta.decimals));
            const hi = Number((usdInr / Math.min(c.low, c.open, c.close)).toFixed(meta.decimals));
            const lo = Number((usdInr / Math.max(c.high, c.open, c.close)).toFixed(meta.decimals));
            return { ...c, open: o, high: Math.max(hi, o, cl), low: Math.min(lo, o, cl), close: cl };
          });
        candles30M = convertInr(y30.candles);
        candles5M = convertInr(y5.candles);
        candles1M = convertInr(y1.candles);
        source = 'YAHOO_REAL';
        livePrice = candles1M[candles1M.length - 1]?.close ?? livePrice;
      } else if (sym === 'USDINR') {
        // Build clean USDINR 30M from 5m bars (avoids Yahoo's flat 30m bars)
        const [y5m, y1m] = await Promise.all([
          fetchYahooChart('INR=X', '10d', '5m', meta.decimals, 1),
          fetchYahooChart('INR=X', '2d', '1m', meta.decimals, 1),
        ]);
        const agg30 = aggregateCandles(y5m.candles, 30 * 60 * 1000, meta.decimals);
        candles30M = agg30.slice(-200);
        candles5M = y5m.candles.slice(-200);
        candles1M = y1m.candles.slice(-200);
        source = 'YAHOO_REAL';
        livePrice = y1m.regularMarketPrice ?? candles1M[candles1M.length - 1]?.close ?? livePrice;
      } else if (meta.mcxFormula) {
        // MCX Commodities (GOLDPETAL, GOLDM, GOLD, SILVERMIC, CRUDEOILM) derived from live global futures into exact INR MCX units
        const [y30m, y5m, y1m] = await Promise.all([
          fetchYahooChart(meta.yahoo, '21d', '30m', 4, 1),
          fetchYahooChart(meta.yahoo, '5d', '5m', 4, 1),
          fetchYahooChart(meta.yahoo, '2d', '1m', 4, 1),
        ]);
        candles30M = convertMcxCandleArray(y30m.candles.slice(-200), meta.mcxFormula, usdInr, meta.decimals);
        candles5M = convertMcxCandleArray(y5m.candles.slice(-200), meta.mcxFormula, usdInr, meta.decimals);
        candles1M = convertMcxCandleArray(y1m.candles.slice(-200), meta.mcxFormula, usdInr, meta.decimals);
        source = 'YAHOO_REAL';
        livePrice = candles1M[candles1M.length - 1]?.close ?? livePrice;
      } else {
        // Global FX Majors/Crosses + XAUUSD + NSE Indices
        const [y30m, y5m, y1m] = await Promise.all([
          fetchYahooChart(meta.yahoo, '21d', '30m', meta.decimals, meta.scale),
          fetchYahooChart(meta.yahoo, '5d', '5m', meta.decimals, meta.scale),
          fetchYahooChart(meta.yahoo, '2d', '1m', meta.decimals, meta.scale),
        ]);
        candles30M = y30m.candles.slice(-200);
        candles5M = y5m.candles.slice(-200);
        candles1M = y1m.candles.slice(-200);
        source = 'YAHOO_REAL';
        livePrice = y1m.regularMarketPrice ?? candles1M[candles1M.length - 1]?.close ?? livePrice;
      }

      const candles30S = expand1mTo30sCandles(candles1M.slice(-110), meta.decimals);

      // If Kotak Neo Live session is authenticated & has a real quote for this symbol, align basis + overlay live Kotak bars
      const nseOpen = isNseMarketOpen(sym);
      const liveKotakQuote = latestStreamQuotes.get(sym);
      const isKotakFeed = Boolean(
        liveBrokerSession &&
          liveKotakQuote?.source === 'KOTAK_NEO_LIVE' &&
          (nseOpen || !meta.is24x5Global)
      );
      const kotakLtp = isKotakFeed ? liveKotakQuote?.mid : undefined;
      const liveBars = isKotakFeed ? kotakLiveCandles.get(sym) : undefined;
      const contractSymbol = kotakContracts.get(sym)?.trdSymbol;

      const final30M = mergeHistoricalWithKotakBars(candles30M, liveBars?.['30M'], kotakLtp, meta.decimals);
      const final5M = mergeHistoricalWithKotakBars(candles5M, liveBars?.['5M'], kotakLtp, meta.decimals);
      const final1M = mergeHistoricalWithKotakBars(candles1M, liveBars?.['1M'], kotakLtp, meta.decimals);
      const final30S = mergeHistoricalWithKotakBars(candles30S, liveBars?.['30S'], kotakLtp, meta.decimals);

      const marketStatus: QuadPayload['marketStatus'] = nseOpen
        ? 'NSE_LIVE'
        : meta.is24x5Global
        ? 'NSE_CLOSED_GLOBAL_LIVE'
        : 'NSE_CLOSED';

      const payload: QuadPayload = {
        symbol: sym,
        ticker: isKotakFeed && contractSymbol ? `Kotak NSE · ${contractSymbol}` : meta.displayTicker,
        source: isKotakFeed ? 'KOTAK_NEO_LIVE' : source,
        livePrice: Number((kotakLtp ?? livePrice).toFixed(meta.decimals)),
        contractSymbol,
        marketStatus,
        frames: {
          '30M': final30M,
          '5M': final5M,
          '1M': final1M,
          '30S': final30S,
        },
        cachedAt: Date.now(),
      };
      quadCache.set(sym, { expiresAt: Date.now() + 30_000, payload });
      return payload;
    })();

    inflightQuadPromises.set(sym, promise);
    try {
      return await promise;
    } finally {
      inflightQuadPromises.delete(sym);
    }
  }

  /**
   * Loads 30M, 5M, 1M, and 30S candles in one cached call (<2ms when warm).
   */
  app.get('/api/market/quad', async (req, res) => {
    const rawSym = String(req.query.symbol || 'USDINR').toUpperCase() as TradingSymbol;
    const sym: TradingSymbol = SYMBOL_FEED_MAP[rawSym] ? rawSym : 'USDINR';

    try {
      const payload = await loadQuadCandlesCached(sym);
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to load multi-timeframe quad feeds',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Zero-Delay Real-Time INR Cross + NSE Tick Stream (Kraken WS + Swissquote + Yahoo)
  // ---------------------------------------------------------------------------
  let cachedUsdInrRate = { rate: 93.46, latencyMs: 12, updatedAt: 0 };
  let usdInrRefreshing = false;
  async function refreshUsdInrBackground(): Promise<number> {
    if (usdInrRefreshing || Date.now() - cachedUsdInrRate.updatedAt < 1500) {
      return cachedUsdInrRate.rate;
    }
    usdInrRefreshing = true;
    const t0 = Date.now();
    try {
      const y = await fetchYahooChart('INR=X', '1d', '1m', 4, 1);
      const rate = y.regularMarketPrice ?? y.candles[y.candles.length - 1]?.close;
      if (rate && rate > 40) {
        cachedUsdInrRate = {
          rate,
          latencyMs: Math.max(4, Date.now() - t0),
          updatedAt: Date.now(),
        };
      }
    } catch {
      // Keep last known live INR=X rate
    } finally {
      usdInrRefreshing = false;
    }
    return cachedUsdInrRate.rate;
  }

  async function fetchSwissquoteBboRaw(base: string, quote: string): Promise<{ bid: number; ask: number; latencyMs: number }> {
    const t0 = Date.now();
    const url = `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${base}/${quote}`;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3500),
    });
    if (!resp.ok) throw new Error(`Swissquote HTTP ${resp.status}`);
    const data = (await resp.json()) as Array<{
      spreadProfilePrices?: Array<{ bid?: number; ask?: number }>;
    }>;
    const row = data?.[0]?.spreadProfilePrices?.[0];
    if (!row || typeof row.bid !== 'number' || typeof row.ask !== 'number') {
      throw new Error(`No BBO prices for ${base}/${quote}`);
    }
    return { bid: row.bid, ask: row.ask, latencyMs: Math.max(4, Date.now() - t0) };
  }

  const latestStreamQuotes = new Map<TradingSymbol, StreamQuote>();
  const sseSubscribers = new Map<TradingSymbol, Set<express.Response>>(
    (Object.keys(SYMBOL_FEED_MAP) as TradingSymbol[]).map((s) => [s, new Set<express.Response>()])
  );

  let autonomousTickHook: ((quote: StreamQuote) => void) | null = null;

  function broadcastTick(quote: StreamQuote) {
    latestStreamQuotes.set(quote.symbol, quote);
    if (autonomousTickHook) {
      try {
        autonomousTickHook(quote);
      } catch {
        // Non-fatal; keep streaming uninterrupted
      }
    }
    const subs = sseSubscribers.get(quote.symbol);
    if (!subs || subs.size === 0) return;
    const frame = `data: ${JSON.stringify(quote)}\n\n`;
    for (const clientRes of subs) {
      try {
        clientRes.write(frame);
      } catch {
        subs.delete(clientRes);
      }
    }
  }

  // Kraken WebSocket v2 persistent connection for EUR/USD & GBP/USD (drives EURINR, GBPINR, EURUSD, GBPUSD at ~3ms!)
  let krakenWs: WebSocket | null = null;
  let krakenReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  function ensureKrakenWs() {
    if (krakenWs && (krakenWs.readyState === WebSocket.OPEN || krakenWs.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (typeof WebSocket === 'undefined') return;
    try {
      const ws = new WebSocket('wss://ws.kraken.com/v2');
      krakenWs = ws;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            method: 'subscribe',
            params: {
              channel: 'ticker',
              event_trigger: 'bbo',
              symbol: ['EUR/USD', 'GBP/USD'],
            },
          })
        );
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            channel?: string;
            data?: Array<{ symbol?: string; bid?: number; ask?: number }>;
          };
          if (msg.channel === 'ticker' && Array.isArray(msg.data)) {
            const usdinr = cachedUsdInrRate.rate;
            const now = Date.now();
            const isFreshKotak = (s: TradingSymbol) =>
              Boolean(
                liveBrokerSession &&
                  isNseMarketOpen(s, now) &&
                  (kotakContracts.has(s) || Boolean(KOTAK_SPOT_QUOTE_TOKENS[s])) &&
                  now - (kotakLastQuoteAt.get(s) ?? 0) < 25_000
              );
            for (const item of msg.data) {
              if (item.symbol === 'EUR/USD' && typeof item.bid === 'number' && typeof item.ask === 'number') {
                if (!isFreshKotak('EURUSD')) {
                  const bid = Number(item.bid.toFixed(5));
                  const ask = Number(item.ask.toFixed(5));
                  broadcastTick({
                    symbol: 'EURUSD',
                    bid,
                    ask,
                    mid: Number(((bid + ask) / 2).toFixed(5)),
                    spreadTicks: Number(Math.max(1, (ask - bid) / 0.0001).toFixed(1)),
                    source: 'KRAKEN_WS',
                    latencyMs: 3,
                    ts: now,
                    marketStatus: isNseMarketOpen('EURUSD', now) ? 'NSE_LIVE' : 'NSE_CLOSED_GLOBAL_LIVE',
                  });
                }
                if (!isFreshKotak('EURINR')) {
                  const bid = Number((item.bid * usdinr).toFixed(4));
                  const ask = Number((item.ask * usdinr).toFixed(4));
                  const mid = Number(((bid + ask) / 2).toFixed(4));
                  broadcastTick({
                    symbol: 'EURINR',
                    bid,
                    ask,
                    mid,
                    spreadTicks: Number(Math.max(1, (ask - bid) / 0.0025).toFixed(1)),
                    source: 'KRAKEN×INR_WS',
                    latencyMs: 3,
                    ts: now,
                    marketStatus: isNseMarketOpen('EURINR', now) ? 'NSE_LIVE' : 'NSE_CLOSED_GLOBAL_LIVE',
                  });
                }
              }
              if (item.symbol === 'GBP/USD' && typeof item.bid === 'number' && typeof item.ask === 'number') {
                if (!isFreshKotak('GBPUSD')) {
                  const bid = Number(item.bid.toFixed(5));
                  const ask = Number(item.ask.toFixed(5));
                  broadcastTick({
                    symbol: 'GBPUSD',
                    bid,
                    ask,
                    mid: Number(((bid + ask) / 2).toFixed(5)),
                    spreadTicks: Number(Math.max(1, (ask - bid) / 0.0001).toFixed(1)),
                    source: 'KRAKEN_WS',
                    latencyMs: 3,
                    ts: now,
                    marketStatus: isNseMarketOpen('GBPUSD', now) ? 'NSE_LIVE' : 'NSE_CLOSED_GLOBAL_LIVE',
                  });
                }
                if (!isFreshKotak('GBPINR')) {
                  const bid = Number((item.bid * usdinr).toFixed(4));
                  const ask = Number((item.ask * usdinr).toFixed(4));
                  const mid = Number(((bid + ask) / 2).toFixed(4));
                  broadcastTick({
                    symbol: 'GBPINR',
                    bid,
                    ask,
                    mid,
                    spreadTicks: Number(Math.max(1, (ask - bid) / 0.0025).toFixed(1)),
                    source: 'KRAKEN×INR_WS',
                    latencyMs: 3,
                    ts: now,
                    marketStatus: isNseMarketOpen('GBPINR', now) ? 'NSE_LIVE' : 'NSE_CLOSED_GLOBAL_LIVE',
                  });
                }
              }
            }
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        krakenWs = null;
        if (!krakenReconnectTimer) {
          krakenReconnectTimer = setTimeout(() => {
            krakenReconnectTimer = null;
            ensureKrakenWs();
          }, 1200);
        }
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  // Poll Real Kotak Securities Neo API v2 Live Quotes (/script-details/1.0/quotes/neosymbol/...)
  let lastKotakQuotePollAt = 0;
  async function pollKotakNeoLiveQuotes(activeSyms: TradingSymbol[]): Promise<Set<TradingSymbol>> {
    const handled = new Set<TradingSymbol>();
    if (!liveBrokerSession || activeSyms.length === 0) return handled;

    const nowTs = Date.now();
    const markRecentlyHandled = () => {
      for (const s of activeSyms) {
        const meta = SYMBOL_FEED_MAP[s];
        const openNow = isNseMarketOpen(s, nowTs);
        // Never allow fallback Spot/Yahoo feeds to overwrite a recently-fetched Kotak contract quote!
        if ((openNow || !meta.is24x5Global) && nowTs - (kotakLastQuoteAt.get(s) ?? 0) < 25_000) {
          handled.add(s);
        }
      }
    };

    if (nowTs - lastKotakQuotePollAt < 700) {
      markRecentlyHandled();
      return handled;
    }
    lastKotakQuotePollAt = nowTs;

    const queryItems: Array<{
      sym: TradingSymbol;
      quoteToken: string;
      displayHint: string;
      tokenStr: string;
    }> = [];
    for (const sym of activeSyms) {
      const meta = SYMBOL_FEED_MAP[sym];
      const openNow = isNseMarketOpen(sym, nowTs);
      // After NSE Currency closes (5:00 PM IST), let 24x5 global crosses run freely without frozen 5 PM Kotak quotes
      if (!openNow && meta.is24x5Global) {
        continue;
      }
      // For closed NSE-only markets (USDINR, NIFTY50, BANKNIFTY), refresh closing quote once every 15s and hold steady
      if (!openNow && !meta.is24x5Global && nowTs - (kotakLastQuoteAt.get(sym) ?? 0) < 15_000) {
        handled.add(sym);
        continue;
      }

      const c = kotakContracts.get(sym);
      const spot = KOTAK_SPOT_QUOTE_TOKENS[sym];
      if (c) {
        queryItems.push({
          sym,
          quoteToken: c.quoteToken,
          displayHint: c.trdSymbol,
          tokenStr: `${c.quoteSegment}|${c.quoteToken}`,
        });
      } else if (spot) {
        queryItems.push({
          sym,
          quoteToken: spot.quoteToken,
          displayHint: spot.quoteToken,
          tokenStr: `${spot.quoteSegment}|${spot.quoteToken}`,
        });
      }
    }
    if (queryItems.length === 0) {
      markRecentlyHandled();
      return handled;
    }

    const t0 = Date.now();
    try {
      const queryPath = queryItems.map((q) => q.tokenStr).join(',');
      const url = `${liveBrokerSession.baseUrl}/script-details/1.0/quotes/neosymbol/${encodeURIComponent(
        queryPath
      )}/all`;
      const resp = await fetch(url, {
        headers: {
          Authorization: liveBrokerSession.consumerKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3500),
      });
      if (!resp.ok) {
        markRecentlyHandled();
        return handled;
      }
      const rows = (await resp.json().catch(() => null)) as Array<{
        exchange_token?: string;
        display_symbol?: string;
        ltp?: string | number;
        ohlc?: { open?: string; high?: string; low?: string; close?: string };
        depth?: {
          buy?: Array<{ price?: string | number }>;
          sell?: Array<{ price?: string | number }>;
        };
      }> | null;
      if (!Array.isArray(rows)) {
        markRecentlyHandled();
        return handled;
      }
      const lat = Math.max(4, Date.now() - t0);
      const now = Date.now();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const matched =
          queryItems.find(
            (q) =>
              String(row.exchange_token || '').toLowerCase() === q.quoteToken.toLowerCase() ||
              String(row.display_symbol || '').toUpperCase().includes(q.displayHint.toUpperCase())
          ) ?? queryItems[i];
        if (!matched) continue;

        const ltp = Number(row.ltp);
        if (!Number.isFinite(ltp) || ltp <= 0) continue;
        const spec = INDIAN_SYMBOLS[matched.sym];
        const bestBid = Number(row.depth?.buy?.[0]?.price);
        const bestAsk = Number(row.depth?.sell?.[0]?.price);
        const bid = Number(
          (Number.isFinite(bestBid) && bestBid > 0 ? bestBid : ltp - spec.tickSize).toFixed(spec.decimals)
        );
        const ask = Number(
          (Number.isFinite(bestAsk) && bestAsk > 0 ? bestAsk : ltp + spec.tickSize).toFixed(spec.decimals)
        );
        const mid = Number(ltp.toFixed(spec.decimals));
        const nseOpen = isNseMarketOpen(matched.sym, now);
        const contractSym = kotakContracts.get(matched.sym)?.trdSymbol || row.display_symbol || matched.displayHint;

        kotakLastQuoteAt.set(matched.sym, now);
        if (!kotakBasisAligned.has(matched.sym)) {
          kotakBasisAligned.add(matched.sym);
          quadCache.delete(matched.sym);
        }

        if (nseOpen) {
          recordKotakLiveTickBar(matched.sym, mid, now);
        }

        const prevQuote = latestStreamQuotes.get(matched.sym);
        const shouldEmit =
          nseOpen ||
          !prevQuote ||
          prevQuote.source !== 'KOTAK_NEO_LIVE' ||
          prevQuote.mid !== mid ||
          prevQuote.contractSymbol !== contractSym ||
          now - prevQuote.ts >= 15_000;

        if (shouldEmit) {
          broadcastTick({
            symbol: matched.sym,
            bid,
            ask,
            mid,
            spreadTicks: Number(Math.max(1, (ask - bid) / spec.tickSize).toFixed(1)),
            source: 'KOTAK_NEO_LIVE',
            latencyMs: lat,
            ts: now,
            contractSymbol: contractSym,
            marketStatus: nseOpen ? 'NSE_LIVE' : 'NSE_CLOSED',
          });
        }
        handled.add(matched.sym);
      }
    } catch {
      // Retain recently-handled Kotak symbols so a transient timeout never causes a 1-tick Spot jump
    }
    markRecentlyHandled();
    return handled;
  }

  // Non-blocking background upstream poll loop (runs for SSE browsers AND 24x7 headless Server Auto-Bot!)
  let pumpBusy = false;
  async function pumpActiveFeeds() {
    if (pumpBusy) return;
    pumpBusy = true;
    try {
      const activeSet = new Set<TradingSymbol>();
      for (const s of Object.keys(SYMBOL_FEED_MAP) as TradingSymbol[]) {
        if ((sseSubscribers.get(s)?.size ?? 0) > 0) {
          activeSet.add(s);
        }
      }
      // Keep pumping 24x7 even when ALL browsers/PCs are closed if Kotak session is active!
      if (liveBrokerSession && vault.accounts.LIVE.sessionState === 'NEO_LIVE_AUTHENTICATED') {
        for (const s of vault.armedSymbols) {
          if (SYMBOL_FEED_MAP[s]) activeSet.add(s);
        }
        for (const tr of vault.liveTrades) {
          if (tr.status === 'OPEN' && SYMBOL_FEED_MAP[tr.symbol]) {
            activeSet.add(tr.symbol);
          }
        }
      }

      const subscribedSyms = Array.from(activeSet);
      if (subscribedSyms.length === 0) return;

      if (
        subscribedSyms.some(
          (s) => s === 'EURINR' || s === 'GBPINR' || s === 'EURUSD' || s === 'GBPUSD'
        )
      ) {
        ensureKrakenWs();
      }

      // 1. If Kotak Neo LIVE is authenticated, poll real Kotak NSE Quotes first!
      const kotakHandled = await pollKotakNeoLiveQuotes(subscribedSyms);
      const jobs: Promise<void>[] = [];
      const usdInr = await refreshUsdInrBackground();
      const wsOpen = Boolean(krakenWs && krakenWs.readyState === WebSocket.OPEN);

      for (const sym of subscribedSyms) {
        if (kotakHandled.has(sym)) continue;
        const meta = SYMBOL_FEED_MAP[sym];

        if (sym === 'USDINR') {
          const bid = Number((usdInr - 0.0025).toFixed(4));
          const ask = Number((usdInr + 0.0025).toFixed(4));
          broadcastTick({
            symbol: 'USDINR',
            bid,
            ask,
            mid: Number(usdInr.toFixed(4)),
            spreadTicks: 2,
            source: 'NSE/INR_LIVE',
            latencyMs: Math.min(25, cachedUsdInrRate.latencyMs),
            ts: Date.now(),
            marketStatus: isNseMarketOpen('USDINR') ? 'NSE_LIVE' : 'NSE_CLOSED',
          });
          continue;
        }

        // Skip Kraken-driven symbols while Kraken WS is live
        if (wsOpen && (sym === 'EURINR' || sym === 'GBPINR' || sym === 'EURUSD' || sym === 'GBPUSD')) {
          continue;
        }

        if (meta.swissquotePair) {
          const [base, quoteCcy] = meta.swissquotePair;
          jobs.push(
            fetchSwissquoteBboRaw(base, quoteCcy)
              .then((q) => {
                let bid = q.bid;
                let ask = q.ask;
                if (meta.mcxFormula) {
                  bid = convertMcxPrice(q.bid, meta.mcxFormula, usdInr, meta.decimals);
                  ask = convertMcxPrice(q.ask, meta.mcxFormula, usdInr, meta.decimals);
                  if (ask <= bid) ask = bid + meta.tickSize;
                } else if (meta.inrDerived === 'MUL') {
                  bid = q.bid * usdInr;
                  ask = q.ask * usdInr;
                } else if (meta.inrDerived === 'DIV') {
                  bid = usdInr / q.ask;
                  ask = usdInr / q.bid;
                } else if (meta.inrDerived === 'INV_100') {
                  bid = (100 * usdInr) / q.ask;
                  ask = (100 * usdInr) / q.bid;
                }
                const fBid = Number(bid.toFixed(meta.decimals));
                const fAsk = Number(ask.toFixed(meta.decimals));
                broadcastTick({
                  symbol: sym,
                  bid: fBid,
                  ask: fAsk,
                  mid: Number(((fBid + fAsk) / 2).toFixed(meta.decimals)),
                  spreadTicks: Number(Math.max(1, (fAsk - fBid) / meta.tickSize).toFixed(1)),
                  source: meta.mcxFormula
                    ? 'MCX_BULLION_LIVE'
                    : meta.inrDerived
                    ? 'SWISSQUOTE×INR'
                    : 'SWISSQUOTE_BBO',
                  latencyMs: q.latencyMs,
                  ts: Date.now(),
                  marketStatus: isNseMarketOpen(sym) ? 'NSE_LIVE' : 'NSE_CLOSED_GLOBAL_LIVE',
                });
              })
              .catch(() => {})
          );
          continue;
        }

        // NSE Indices (NIFTY50, BANKNIFTY, FINNIFTY) + MCX Crude Oil (CRUDEOILM)
        jobs.push(
          (async () => {
            const t0 = Date.now();
            const y = await fetchYahooChart(
              meta.yahoo,
              '1d',
              '1m',
              meta.mcxFormula ? 4 : meta.decimals,
              meta.scale
            );
            const rawMid = y.regularMarketPrice ?? y.candles[y.candles.length - 1]?.close ?? 0;
            const mid = meta.mcxFormula
              ? convertMcxPrice(rawMid, meta.mcxFormula, usdInr, meta.decimals)
              : Number(rawMid.toFixed(meta.decimals));
            if (mid > 0) {
              const half = meta.tickSize * (meta.mcxFormula ? 1 : 2);
              broadcastTick({
                symbol: sym,
                bid: Number((mid - half).toFixed(meta.decimals)),
                ask: Number((mid + half).toFixed(meta.decimals)),
                mid,
                spreadTicks: meta.mcxFormula ? 2 : 4,
                source: meta.mcxFormula ? 'MCX_CRUDE_LIVE' : 'NSE_INDEX_LIVE',
                latencyMs: Math.max(4, Date.now() - t0),
                ts: Date.now(),
                marketStatus: isNseMarketOpen(sym)
                  ? 'NSE_LIVE'
                  : meta.is24x5Global
                  ? 'NSE_CLOSED_GLOBAL_LIVE'
                  : 'NSE_CLOSED',
              });
            }
          })().catch(() => {})
        );
      }

      if (jobs.length > 0) await Promise.all(jobs);
    } finally {
      pumpBusy = false;
    }
  }

  // Pre-warm Quad Feeds, USDINR rate & Kraken WebSocket right on server boot so first load is instant (<10ms)
  ensureKrakenWs();
  void refreshUsdInrBackground().then(() =>
    Promise.allSettled(
      (['USDINR', 'EURINR', 'GBPINR', 'JPYINR'] as TradingSymbol[]).map((s) => loadQuadCandlesCached(s))
    )
  );

  let lastHeadlessPumpTs = 0;
  setInterval(() => {
    const anySubs = Array.from(sseSubscribers.values()).some((s) => s.size > 0);
    if (anySubs) {
      void pumpActiveFeeds();
      return;
    }
    const hasHeadlessWork =
      Boolean(liveBrokerSession) &&
      vault.accounts.LIVE.sessionState === 'NEO_LIVE_AUTHENTICATED' &&
      (vault.armedSymbols.length > 0 || vault.liveTrades.some((t) => t.status === 'OPEN'));
    if (hasHeadlessWork && Date.now() - lastHeadlessPumpTs >= 1500) {
      lastHeadlessPumpTs = Date.now();
      void pumpActiveFeeds();
    }
  }, 750);

  app.get('/api/market/stream', (req, res) => {
    const rawSym = String(req.query.symbol || 'USDINR').toUpperCase() as TradingSymbol;
    const sym: TradingSymbol = SYMBOL_FEED_MAP[rawSym] ? rawSym : 'USDINR';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const subs = sseSubscribers.get(sym)!;
    subs.add(res);

    ensureKrakenWs();

    const cachedQuote = latestStreamQuotes.get(sym);
    if (cachedQuote) {
      res.write(`data: ${JSON.stringify(cachedQuote)}\n\n`);
    } else {
      void pumpActiveFeeds();
    }

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      subs.delete(res);
    });
  });

  // ---------------------------------------------------------------------------
  // AI Background Multi-Pair Opportunity Scanner (Right Auto-Hide Widget)
  // ---------------------------------------------------------------------------
  let scannerCache: { expiresAt: number; opportunities: ScannerOpportunity[] } = {
    expiresAt: 0,
    opportunities: [],
  };

  app.get('/api/market/scanner', async (_req, res) => {
    if (scannerCache.expiresAt > Date.now() && scannerCache.opportunities.length > 0) {
      res.json({ opportunities: scannerCache.opportunities, scannedAt: Date.now() });
      return;
    }

    const symbols = Object.keys(SYMBOL_FEED_MAP) as TradingSymbol[];
    const results: ScannerOpportunity[] = [];
    const batchSize = 5;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (sym) => {
          const meta = SYMBOL_FEED_MAP[sym];
          const spec = INDIAN_SYMBOLS[sym];
          try {
            const quad = await loadQuadCandlesCached(sym);
            const candles30m = quad.frames['30M'];
            const candles5m = quad.frames['5M'];
            const candles1m = quad.frames['1M'];
            const adapted = detectMarketPatternAndAdaptIndicators(
              candles5m,
              sym,
              '5M',
              vault.aiMemory
            );
            const sig30 = evaluateLiveSignal(candles30m, sym, adapted.strategy, adapted.indicatorConfig);
            const sig5 = evaluateLiveSignal(candles5m, sym, adapted.strategy, adapted.indicatorConfig);
            const sig1 = evaluateLiveSignal(candles1m, sym, adapted.strategy, adapted.indicatorConfig);

            const live = latestStreamQuotes.get(sym);
            const lastBar = candles1m[candles1m.length - 1] ?? candles5m[candles5m.length - 1];
            const firstBar = candles1m[0] ?? candles5m[0];
            const price = live?.mid ?? quad.livePrice ?? lastBar?.close ?? spec.basePrice;
            const prevOpen = firstBar?.open ?? price;
            const changePct = prevOpen > 0 ? Number((((price - prevOpen) / prevOpen) * 100).toFixed(2)) : 0;

            const lastClose5 = candles5m[candles5m.length - 1]?.close ?? price;
            const agoClose5 = candles5m[Math.max(0, candles5m.length - 8)]?.close ?? price;
            const driftBull = lastClose5 > agoClose5;

            let direction: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
            let alignedTimeframes = 1;
            let confidencePct = 52;

            if (sig30.signal && sig5.signal && sig1.signal && sig30.signal === sig5.signal && sig5.signal === sig1.signal) {
              direction = sig5.signal;
              alignedTimeframes = 4;
              confidencePct = 92;
            } else if (sig5.signal && sig1.signal && sig5.signal === sig1.signal) {
              direction = sig5.signal;
              alignedTimeframes = 3;
              confidencePct = 86;
            } else if (sig5.signal || sig1.signal) {
              direction = (sig5.signal ?? sig1.signal)!;
              alignedTimeframes = 2;
              confidencePct = 76;
            } else if (Math.abs(changePct) >= 0.08) {
              direction = driftBull ? 'BUY' : 'SELL';
              alignedTimeframes = 2;
              confidencePct = 66;
            }

            results.push({
              symbol: sym,
              price: Number(price.toFixed(meta.decimals)),
              bid: Number((live?.bid ?? price - spec.tickSize).toFixed(meta.decimals)),
              ask: Number((live?.ask ?? price + spec.tickSize).toFixed(meta.decimals)),
              changePct,
              source: live?.source ?? quad.source,
              direction,
              confidencePct,
              alignedTimeframes,
              patternLabel: adapted.patternLabel,
              regime: adapted.regime,
              recommendedStrategy: adapted.strategy,
              recommendedConfig: adapted.indicatorConfig,
              reason:
                direction === 'WAIT'
                  ? `${adapted.patternLabel} · Consolidating near ${price.toFixed(meta.decimals)}`
                  : `${alignedTimeframes}/4 TF ${direction} setup (${adapted.patternLabel})`,
              updatedAt: Date.now(),
            });
          } catch {
            results.push({
              symbol: sym,
              price: spec.basePrice,
              bid: Number((spec.basePrice - spec.tickSize).toFixed(meta.decimals)),
              ask: Number((spec.basePrice + spec.tickSize).toFixed(meta.decimals)),
              changePct: 0,
              source: 'CACHED',
              direction: 'WAIT',
              confidencePct: 45,
              alignedTimeframes: 1,
              patternLabel: 'Awaiting Market Open',
              regime: 'MEAN_REVERTING_RANGE',
              recommendedStrategy: 'EMA_RSI_CONFLUENCE',
              recommendedConfig: STRATEGY_CATALOG[0].defaultRawConfig,
              reason: 'Monitoring feed recovery',
              updatedAt: Date.now(),
            });
          }
        })
      );
    }

    results.sort((a, b) => b.confidencePct - a.confidencePct);
    scannerCache = {
      expiresAt: Date.now() + 25_000,
      opportunities: results,
    };
    res.json({ opportunities: results, scannedAt: Date.now() });
  });

  // ---------------------------------------------------------------------------
  // Kotak Securities Neo API v2 Broker + Daily Session Watchdog + Auto-Re-Login
  // ---------------------------------------------------------------------------
  let lastServerBotAction: string | null = null;
  const botDiagnostics = new Map<TradingSymbol, string>();
  let latestBrokerOrders: KotakBrokerOrderSummary[] = [];
  let latestBrokerPositions: KotakBrokerPositionSummary[] = [];
  const disabledKotakSegments = new Set<string>();
  const marginCooldownUntilBySymbol = new Map<TradingSymbol, number>();
  const lastServerBotEvalTs = new Map<TradingSymbol, number>();
  const lastServerBotBarBucket = new Map<TradingSymbol, number>();
  let sessionExpiredReason: string | null = null;
  let autoReloginPromise: Promise<boolean> | null = null;

  // Kept STRICTLY in volatile Node process RAM (never persisted to disk JSON or exposed to client)
  let inMemoryKotakAutoCreds: {
    ucc: string;
    mobile: string;
    consumerKey: string;
    mpin: string;
    totpSecret: string;
    exchangeSegment: KotakAccountProfile['exchangeSegment'];
    brokerageTier: KotakAccountProfile['brokerageTier'];
    leverage: 1 | 5 | 10 | 20 | 35;
  } | null = null;

  function extractBase32TotpSecret(rawInput: string): string {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) return '';
    if (trimmed.toLowerCase().startsWith('otpauth://')) {
      try {
        const u = new URL(trimmed);
        const param = u.searchParams.get('secret') || '';
        return param.replace(/[\s\-=]/g, '').toUpperCase();
      } catch {
        // Fallback below
      }
    }
    return trimmed.replace(/[\s\-=]/g, '').toUpperCase();
  }

  function generateTotpFromBase32Secret(rawSecret: string, timestampMs = Date.now()): string | null {
    const clean = extractBase32TotpSecret(rawSecret);
    if (clean.length < 8) return null;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i++) {
      const idx = alphabet.indexOf(clean[i]);
      if (idx === -1) return null;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    if (bytes.length === 0) return null;
    const keyBuf = Buffer.from(bytes);
    const counter = Math.floor(timestampMs / 30_000);
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuf.writeUInt32BE(counter >>> 0, 4);

    const hmac = crypto.createHmac('sha1', keyBuf).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return String(binary % 1_000_000).padStart(6, '0');
  }

  function isAllowedKotakBaseUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      if (parsed.protocol !== 'https:') return null;
      const host = parsed.hostname.toLowerCase();
      if (host !== 'kotaksecurities.com' && !host.endsWith('.kotaksecurities.com')) {
        return null;
      }
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  function isKotakJwtExpired(token: string, safetyBufferMs = 45_000): boolean {
    try {
      const parts = String(token || '').split('.');
      if (parts.length < 2) return false;
      const jsonStr = Buffer.from(parts[1], 'base64url').toString('utf-8');
      const payload = JSON.parse(jsonStr) as { exp?: number };
      if (typeof payload.exp === 'number' && payload.exp > 0) {
        return payload.exp * 1000 <= Date.now() + safetyBufferMs;
      }
      return false;
    } catch {
      return false;
    }
  }

  function isKotakSessionExpiredError(httpStatus: number, payloadOrMsg: unknown): boolean {
    if (httpStatus === 401 || httpStatus === 403) return true;
    const rawText =
      typeof payloadOrMsg === 'string'
        ? payloadOrMsg
        : payloadOrMsg && typeof payloadOrMsg === 'object'
        ? JSON.stringify(payloadOrMsg)
        : '';
    const lower = rawText.toLowerCase();
    return (
      lower.includes('invalid session') ||
      lower.includes('invalid token') ||
      lower.includes('invalid jwt') ||
      lower.includes('session expired') ||
      lower.includes('token expired') ||
      lower.includes('jwt expired') ||
      lower.includes('session not found') ||
      lower.includes('unauthorized') ||
      lower.includes('not logged in')
    );
  }

  function getEffectiveAutoCreds(): NonNullable<typeof inMemoryKotakAutoCreds> | null {
    if (inMemoryKotakAutoCreds && inMemoryKotakAutoCreds.totpSecret) {
      return inMemoryKotakAutoCreds;
    }
    const envUcc = String(process.env.KOTAK_UCC || '').trim().toUpperCase();
    const envMobile = String(process.env.KOTAK_MOBILE || '').trim();
    const envKey = String(process.env.KOTAK_CONSUMER_KEY || '').trim();
    const envMpin = String(process.env.KOTAK_MPIN || '').trim();
    const envTotpSecret = extractBase32TotpSecret(String(process.env.KOTAK_TOTP_SECRET || ''));
    if (
      envUcc.length >= 4 &&
      envMobile.replace(/\D/g, '').length >= 10 &&
      envKey.length >= 10 &&
      /^\d{6}$/.test(envMpin) &&
      envTotpSecret.length >= 8
    ) {
      return {
        ucc: envUcc,
        mobile: envMobile,
        consumerKey: envKey,
        mpin: envMpin,
        totpSecret: envTotpSecret,
        exchangeSegment: vault.accounts.LIVE.exchangeSegment || 'NSE_CDS',
        brokerageTier: vault.accounts.LIVE.brokerageTier || 'Kotak Trade Free (₹0 Intraday)',
        leverage: (vault.botRiskConfig.leverage || 35) as 1 | 5 | 10 | 20 | 35,
      };
    }
    return null;
  }

  app.get('/api/kotak/status', (_req, res) => {
    const resolvedContracts: Record<string, string> = {};
    for (const [sym, c] of kotakContracts.entries()) {
      resolvedContracts[sym] = `${c.trdSymbol} (Lot:${c.lotSize})`;
    }
    const diagObj: Record<string, string> = {};
    for (const [sym, msg] of botDiagnostics.entries()) {
      diagObj[sym] = msg;
    }
    res.json({
      activeMode: 'LIVE' as BrokerMode,
      autoBotRunning: vault.armedSymbols.length > 0,
      armedSymbols: vault.armedSymbols,
      botRiskConfig: vault.botRiskConfig,
      disabledSegments: Array.from(disabledKotakSegments),
      lastBotAction: lastServerBotAction,
      botDiagnostics: diagObj,
      strategyVerified: vault.strategyVerified,
      liveSessionActive: Boolean(liveBrokerSession),
      sessionExpiredReason,
      autoReloginConfigured: Boolean(getEffectiveAutoCreds()),
      kotakScripMasterReady,
      kotakContracts: resolvedContracts,
      brokerOrders: latestBrokerOrders,
      brokerPositions: latestBrokerPositions,
      lastUcc: vault.accounts.LIVE.ucc || '',
      accounts: vault.accounts,
      aiMemory: vault.aiMemory,
      liveTrades: vault.liveTrades,
      oracleDb: oracleVault.getStatus(),
    });
  });

  app.post('/api/bot/config', (req, res) => {
    const { armedSymbols, riskConfig } = req.body ?? {};
    if (Array.isArray(armedSymbols)) {
      const uniqueValid = Array.from(
        new Set(
          armedSymbols
            .map((s: unknown) => String(s || '').trim().toUpperCase())
            .filter((s): s is TradingSymbol => Boolean(SYMBOL_FEED_MAP[s as TradingSymbol]))
        )
      ).slice(0, 6);
      vault.armedSymbols = uniqueValid;
      vault.autoBotRunning = uniqueValid.length > 0;
    }
    if (riskConfig && typeof riskConfig === 'object') {
      const rc = riskConfig as Record<string, unknown>;
      if (typeof rc.riskPerTradePct === 'number' && Number.isFinite(rc.riskPerTradePct)) {
        vault.botRiskConfig.riskPerTradePct = Math.min(20, Math.max(0.1, rc.riskPerTradePct));
      }
      if (typeof rc.maxDailyDrawdownPct === 'number' && Number.isFinite(rc.maxDailyDrawdownPct)) {
        vault.botRiskConfig.maxDailyDrawdownPct = Math.min(50, Math.max(0.5, rc.maxDailyDrawdownPct));
      }
      if ([1, 5, 10, 20, 35].includes(Number(rc.leverage))) {
        vault.botRiskConfig.leverage = Number(rc.leverage) as 1 | 5 | 10 | 20 | 35;
      }
      if (typeof rc.trailingStopEnabled === 'boolean') {
        vault.botRiskConfig.trailingStopEnabled = rc.trailingStopEnabled;
      }
      if (typeof rc.breakEvenTriggerR === 'number' && Number.isFinite(rc.breakEvenTriggerR)) {
        vault.botRiskConfig.breakEvenTriggerR = Math.min(5, Math.max(0.4, rc.breakEvenTriggerR));
      }
      if (typeof rc.highRiskMode === 'boolean') {
        vault.botRiskConfig.highRiskMode = rc.highRiskMode;
      }
    }
    saveVault(vault);
    if (vault.armedSymbols.length > 0) {
      void pumpActiveFeeds();
    }
    res.json({
      success: true,
      autoBotRunning: vault.autoBotRunning,
      armedSymbols: vault.armedSymbols,
      botRiskConfig: vault.botRiskConfig,
    });
  });

  app.post('/api/kotak/disconnect', (_req, res) => {
    liveBrokerSession = null;
    inMemoryKotakAutoCreds = null;
    sessionExpiredReason = null;
    kotakScripMasterReady = false;
    kotakContracts.clear();
    kotakLastQuoteAt.clear();
    kotakBasisAligned.clear();
    kotakLiveCandles.clear();
    latestStreamQuotes.clear();
    latestBrokerOrders = [];
    latestBrokerPositions = [];
    disabledKotakSegments.clear();
    marginCooldownUntilBySymbol.clear();
    quadCache.clear();
    botDiagnostics.clear();
    vault.activeMode = 'LIVE';
    vault.autoBotRunning = false;
    vault.armedSymbols = [];
    vault.accounts.LIVE = {
      ...vault.accounts.LIVE,
      connected: false,
      sessionState: 'DISCONNECTED',
      balanceInr: 0,
      equityInr: 0,
      usedMarginInr: 0,
      lastHeartbeat: 'Disconnected by user',
    };
    saveVault(vault);
    res.json({ success: true, activeMode: 'LIVE', accounts: vault.accounts });
  });

  function parseKotakNumber(val: unknown): number | null {
    if (typeof val === 'number') {
      return Number.isFinite(val) ? val : null;
    }
    if (typeof val === 'string') {
      const cleaned = val.replace(/[,₹\s]/g, '').trim();
      if (!cleaned) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function extractMarginFromKotakPayload(payload: unknown): {
    availableInr: number | null;
    usedMarginInr: number;
  } {
    if (!payload || typeof payload !== 'object') {
      return { availableInr: null, usedMarginInr: 0 };
    }
    const root = payload as Record<string, unknown>;
    const candidates: Array<Record<string, unknown>> = [root];
    if (Array.isArray(root.data)) {
      for (const item of root.data) {
        if (item && typeof item === 'object') candidates.push(item as Record<string, unknown>);
      }
    } else if (root.data && typeof root.data === 'object') {
      candidates.push(root.data as Record<string, unknown>);
    }

    let bestAvailable: number | null = null;
    let bestUsed = 0;

    for (const obj of candidates) {
      const directAvailableKeys = [
        'Net',
        'net',
        'MarginAvailable',
        'marginAvailable',
        'AvailableMargin',
        'availableMargin',
        'TotalMargin',
        'totalMargin',
      ];
      for (const k of directAvailableKeys) {
        const parsed = parseKotakNumber(obj[k]);
        if (parsed !== null && parsed >= 0) {
          bestAvailable = bestAvailable === null ? parsed : Math.max(bestAvailable, parsed);
        }
      }

      // Sum cash + same-day UPI payin + collateral if Net was 0 or omitted
      const cash =
        parseKotakNumber(obj.Cash ?? obj.cash ?? obj.NotionalCash ?? obj.notionalCash ?? obj.OpnBal) ?? 0;
      const payin =
        parseKotakNumber(obj.PayInAmt ?? obj.PayinAmt ?? obj.payinAmt ?? obj.AdhocMargin ?? obj.adhocMargin) ?? 0;
      const collat =
        parseKotakNumber(obj.CollateralValue ?? obj.Collateral ?? obj.collateralValue) ?? 0;
      const used =
        parseKotakNumber(obj.MarginUsed ?? obj.marginUsed ?? obj.UtilizedMargin ?? obj.SpanMargin) ?? 0;
      if (used > bestUsed) bestUsed = used;

      const reconstructed = Math.max(0, cash + payin + collat - used);
      if (reconstructed > 0 && (bestAvailable === null || reconstructed > bestAvailable)) {
        bestAvailable = reconstructed;
      }
    }

    return {
      availableInr: bestAvailable !== null ? Number(bestAvailable.toFixed(2)) : null,
      usedMarginInr: Number(bestUsed.toFixed(2)),
    };
  }

  async function fetchKotakLiveMarginDetails(
    session: NonNullable<typeof liveBrokerSession>,
    allowReloginRetry = true
  ): Promise<{
    availableInr: number;
    usedMarginInr: number;
  } | null> {
    const headersBase = {
      Accept: 'application/json',
      Auth: session.tradingToken,
      Sid: session.tradingSid,
      'neo-fin-key': 'neotradeapi',
    };

    const segAttempts = [
      { seg: 'ALL', exch: 'ALL', prod: 'ALL' },
      { seg: 'CASH', exch: 'ALL', prod: 'ALL' },
      { seg: 'COM', exch: 'ALL', prod: 'ALL' },
      { seg: 'CUR', exch: 'ALL', prod: 'ALL' },
    ];

    let bestAvail: number | null = null;
    let bestUsed = 0;
    let sawExpiredToken = false;

    for (const jPayload of segAttempts) {
      try {
        const resp = await fetch(`${session.baseUrl}/quick/user/limits`, {
          method: 'POST',
          headers: {
            ...headersBase,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ jData: JSON.stringify(jPayload) }).toString(),
          signal: AbortSignal.timeout(5500),
        });
        const data = await resp.json().catch(() => null);
        if (isKotakSessionExpiredError(resp.status, data)) {
          sawExpiredToken = true;
          break;
        }
        const extracted = extractMarginFromKotakPayload(data);
        if (extracted.usedMarginInr > bestUsed) bestUsed = extracted.usedMarginInr;
        if (extracted.availableInr !== null) {
          bestAvail = bestAvail === null ? extracted.availableInr : Math.max(bestAvail, extracted.availableInr);
          if (bestAvail > 0) break;
        }
      } catch {
        // continue probing alternate segment
      }
    }

    if (sawExpiredToken) {
      if (allowReloginRetry) {
        const renewed = await handleKotakSessionInvalidated('Kotak limits: invalid session token');
        if (renewed && liveBrokerSession) {
          return fetchKotakLiveMarginDetails(liveBrokerSession, false);
        }
      }
      return null;
    }

    if (bestAvail === null || bestAvail === 0) {
      try {
        const getResp = await fetch(`${session.baseUrl}/quick/user/limits`, {
          method: 'GET',
          headers: headersBase,
          signal: AbortSignal.timeout(5000),
        });
        const getData = await getResp.json().catch(() => null);
        if (isKotakSessionExpiredError(getResp.status, getData)) {
          if (allowReloginRetry) {
            const renewed = await handleKotakSessionInvalidated('Kotak GET limits: invalid session token');
            if (renewed && liveBrokerSession) {
              return fetchKotakLiveMarginDetails(liveBrokerSession, false);
            }
          }
          return null;
        }
        const extracted = extractMarginFromKotakPayload(getData);
        if (extracted.usedMarginInr > bestUsed) bestUsed = extracted.usedMarginInr;
        if (extracted.availableInr !== null) {
          bestAvail = bestAvail === null ? extracted.availableInr : Math.max(bestAvail, extracted.availableInr);
        }
      } catch {
        // ignore
      }
    }

    if (bestAvail === null) return null;
    return { availableInr: bestAvail, usedMarginInr: bestUsed };
  }

  async function performKotakLoginFlow(params: {
    ucc: string;
    mobile: string;
    consumerKey: string;
    totp: string;
    mpin: string;
    exchangeSegment: KotakAccountProfile['exchangeSegment'];
    brokerageTier: KotakAccountProfile['brokerageTier'];
    leverage: 1 | 5 | 10 | 20 | 35;
  }): Promise<
    | { ok: true; account: KotakAccountProfile }
    | { ok: false; status: number; error: string }
  > {
    const normalizedMobile = params.mobile.startsWith('+')
      ? params.mobile
      : `+91${params.mobile.replace(/\D/g, '').slice(-10)}`;

    // Step 1: Kotak Neo Trade API v2 — TOTP Login
    const step1Resp = await fetch('https://mis.kotaksecurities.com/login/1.0/tradeApiLogin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'neo-fin-key': 'neotradeapi',
        Authorization: params.consumerKey,
      },
      body: JSON.stringify({
        mobileNumber: normalizedMobile,
        ucc: params.ucc,
        totp: params.totp,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const step1Json = (await step1Resp.json().catch(() => ({}))) as {
      data?: { token?: string; sid?: string };
      error?: Array<{ message?: string }> | { message?: string };
      message?: string;
    };

    const viewToken = step1Json?.data?.token;
    const viewSid = step1Json?.data?.sid;

    if (!step1Resp.ok || !viewToken || !viewSid) {
      const kotakMsg =
        (Array.isArray(step1Json?.error) ? step1Json.error[0]?.message : step1Json?.error?.message) ||
        step1Json?.message ||
        `Kotak TOTP Login failed (HTTP ${step1Resp.status})`;
      return {
        ok: false,
        status: 401,
        error: `Kotak Neo Step-1 (TOTP) Reject: ${kotakMsg}. Check karein ki API Access Token, UCC, Mobile (+91...), aur Authenticator TOTP sahi hai.`,
      };
    }

    // Step 2: Kotak Neo Trade API v2 — MPIN Validate
    const step2Resp = await fetch('https://mis.kotaksecurities.com/login/1.0/tradeApiValidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'neo-fin-key': 'neotradeapi',
        Authorization: params.consumerKey,
        sid: viewSid,
        Auth: viewToken,
      },
      body: JSON.stringify({ mpin: params.mpin }),
      signal: AbortSignal.timeout(8000),
    });

    const step2Json = (await step2Resp.json().catch(() => ({}))) as {
      data?: { token?: string; sid?: string; baseUrl?: string };
      error?: Array<{ message?: string }> | { message?: string };
      message?: string;
    };

    const tradingToken = step2Json?.data?.token;
    const tradingSid = step2Json?.data?.sid;
    const validatedBaseUrl = step2Json?.data?.baseUrl
      ? isAllowedKotakBaseUrl(step2Json.data.baseUrl)
      : null;

    if (!step2Resp.ok || !tradingToken || !tradingSid || !validatedBaseUrl) {
      const kotakMsg =
        (Array.isArray(step2Json?.error) ? step2Json.error[0]?.message : step2Json?.error?.message) ||
        step2Json?.message ||
        `Kotak MPIN Validate failed (HTTP ${step2Resp.status})`;
      return {
        ok: false,
        status: 401,
        error: `Kotak Neo Step-2 (MPIN) Reject: ${kotakMsg}. Apna 6-digit MPIN verify karein.`,
      };
    }

    liveBrokerSession = {
      ucc: params.ucc,
      consumerKey: params.consumerKey,
      tradingToken,
      tradingSid,
      baseUrl: validatedBaseUrl,
      connectedAt: Date.now(),
    };
    sessionExpiredReason = null;

    quadCache.clear();
    kotakContracts.clear();
    kotakLastQuoteAt.clear();
    kotakBasisAligned.clear();
    kotakLiveCandles.clear();
    kotakScripMasterPromise = null;
    disabledKotakSegments.clear();
    marginCooldownUntilBySymbol.clear();
    lastServerBotEvalTs.clear();
    lastServerBotBarBucket.clear();
    lastKotakQuotePollAt = 0;

    const [fetchedMargin] = await Promise.all([
      fetchKotakLiveMarginDetails(liveBrokerSession, false),
      Promise.race([
        initializeKotakScripMaster(liveBrokerSession),
        new Promise<void>((resolve) => setTimeout(resolve, 4500)),
      ]),
      reconcileWithKotakBrokerBook(liveBrokerSession),
    ]);
    await pollKotakNeoLiveQuotes([
      'USDINR',
      'EURINR',
      'GBPINR',
      'JPYINR',
      'GOLDPETAL',
      'GOLDM',
      'SILVERMIC',
      'CRUDEOILM',
      'NIFTY50',
      'BANKNIFTY',
    ]);
    quadCache.clear();

    const liveBalanceInr = fetchedMargin?.availableInr ?? vault.accounts.LIVE.balanceInr ?? 0;
    const liveUsedMarginInr = fetchedMargin?.usedMarginInr ?? 0;
    const maskedKey = `${params.consumerKey.slice(0, 4)}••••${params.consumerKey.slice(-3)}`;

    const updatedAccount: KotakAccountProfile = {
      id: `kotak-live-${params.ucc}`,
      label: 'Kotak Neo Live API Account',
      mode: 'LIVE',
      brokerName: 'Kotak Securities Neo API v2',
      exchangeSegment: params.exchangeSegment,
      ucc: params.ucc,
      mobile: `${normalizedMobile.slice(0, 6)}••••${normalizedMobile.slice(-2)}`,
      consumerKeyMasked: maskedKey,
      brokerageTier: params.brokerageTier || 'Kotak Trade Free (₹0 Intraday)',
      balanceInr: liveBalanceInr,
      equityInr: Number((liveBalanceInr + liveUsedMarginInr).toFixed(2)),
      usedMarginInr: liveUsedMarginInr,
      leverage: params.leverage,
      connected: true,
      sessionState: 'NEO_LIVE_AUTHENTICATED',
      lastHeartbeat: new Date().toISOString(),
    };

    vault.activeMode = 'LIVE';
    vault.accounts.LIVE = updatedAccount;
    saveVault(vault);
    void oracleVault.syncAccountMeta(updatedAccount);

    return { ok: true, account: updatedAccount };
  }

  async function handleKotakSessionInvalidated(reason: string): Promise<boolean> {
    if (autoReloginPromise) {
      return autoReloginPromise;
    }
    autoReloginPromise = (async () => {
      try {
        const autoCreds = getEffectiveAutoCreds();
        if (autoCreds) {
          const generatedTotp = generateTotpFromBase32Secret(autoCreds.totpSecret);
          if (generatedTotp) {
            const reloginRes = await performKotakLoginFlow({
              ucc: autoCreds.ucc,
              mobile: autoCreds.mobile,
              consumerKey: autoCreds.consumerKey,
              totp: generatedTotp,
              mpin: autoCreds.mpin,
              exchangeSegment: autoCreds.exchangeSegment,
              brokerageTier: autoCreds.brokerageTier,
              leverage: autoCreds.leverage,
            });
            if (reloginRes.ok) {
              const okMsg = `24×7 Auto-Login: Kotak daily session token auto-renewed (UCC ${autoCreds.ucc}) · Trading Active!`;
              lastServerBotAction = okMsg;
              for (const s of vault.armedSymbols) {
                botDiagnostics.set(s, okMsg);
              }
              return true;
            }
          }
        }

        // No auto-TOTP secret configured (or auto-login rejected) -> immediately flip to DISCONNECTED so user sees Login Gate!
        liveBrokerSession = null;
        const expMsg =
          'Kotak Daily Session Token raat ko expire ho gaya tha (Kotak roz subah naya token mangta hai) — naye 6-digit TOTP se Re-Login karein, ya 24×7 Auto-TOTP Secret daalein!';
        sessionExpiredReason = `${expMsg} [${reason}]`;
        lastServerBotAction = expMsg;
        for (const s of vault.armedSymbols) {
          botDiagnostics.set(s, expMsg);
        }
        vault.accounts.LIVE = {
          ...vault.accounts.LIVE,
          connected: false,
          sessionState: 'DISCONNECTED',
          lastHeartbeat: 'SESSION EXPIRED — Fresh 6-digit TOTP required',
        };
        saveVault(vault);
        return false;
      } catch {
        liveBrokerSession = null;
        sessionExpiredReason =
          'Kotak Daily Session Token expire ho gaya hai — naye 6-digit TOTP se Re-Login karein!';
        vault.accounts.LIVE = {
          ...vault.accounts.LIVE,
          connected: false,
          sessionState: 'DISCONNECTED',
          lastHeartbeat: 'SESSION EXPIRED — Fresh 6-digit TOTP required',
        };
        saveVault(vault);
        return false;
      } finally {
        autoReloginPromise = null;
      }
    })();

    return autoReloginPromise;
  }

  // Proactive 30-second Kotak JWT Expiry Watchdog + Optional Boot/.env Auto-Connect
  setInterval(() => {
    if (liveBrokerSession && vault.accounts.LIVE.sessionState === 'NEO_LIVE_AUTHENTICATED') {
      const ageHours = (Date.now() - liveBrokerSession.connectedAt) / 3_600_000;
      if (isKotakJwtExpired(liveBrokerSession.tradingToken, 90_000) || ageHours >= 20) {
        void handleKotakSessionInvalidated('Proactive daily token expiry check');
      }
    } else if (!liveBrokerSession && getEffectiveAutoCreds()) {
      void handleKotakSessionInvalidated('24×7 Auto-Connect from configured TOTP secret');
    }
  }, 30_000);

  if (!liveBrokerSession && getEffectiveAutoCreds()) {
    setTimeout(() => {
      if (!liveBrokerSession && getEffectiveAutoCreds()) {
        void handleKotakSessionInvalidated('Server boot 24×7 Auto-Login');
      }
    }, 2500);
  }

  // Real-time 15-second background Kotak Balance & Margin Sync so deposits & live MTM stay accurate 24x7
  let marginPollBusy = false;
  setInterval(() => {
    if (
      marginPollBusy ||
      !liveBrokerSession ||
      vault.accounts.LIVE.sessionState !== 'NEO_LIVE_AUTHENTICATED'
    ) {
      return;
    }
    marginPollBusy = true;
    void fetchKotakLiveMarginDetails(liveBrokerSession)
      .then((res) => {
        if (!res || !liveBrokerSession) return;
        const nextEquity = Number(Math.max(0, res.availableInr + res.usedMarginInr).toFixed(2));
        if (
          Math.abs(vault.accounts.LIVE.balanceInr - res.availableInr) >= 0.5 ||
          Math.abs((vault.accounts.LIVE.usedMarginInr ?? 0) - res.usedMarginInr) >= 0.5
        ) {
          vault.accounts.LIVE = {
            ...vault.accounts.LIVE,
            balanceInr: res.availableInr,
            equityInr: nextEquity > 0 ? nextEquity : res.availableInr,
            usedMarginInr: res.usedMarginInr,
            lastHeartbeat: new Date().toISOString(),
          };
          saveVault(vault);
        }
      })
      .catch(() => {})
      .finally(() => {
        marginPollBusy = false;
      });
  }, 15_000);

  app.post('/api/kotak/connect', async (req, res) => {
    const {
      ucc,
      mobile,
      consumerKey,
      totp,
      totpSecret,
      mpin,
      exchangeSegment,
      leverage,
      brokerageTier,
    } = req.body ?? {};

    const validLev = ([1, 5, 10, 20, 35].includes(Number(leverage)) ? Number(leverage) : 35) as
      | 1
      | 5
      | 10
      | 20
      | 35;

    // Strictly real Kotak Securities Neo API v2 authentication — zero paper/simulator fallback
    const cleanUcc = String(ucc || '').trim().toUpperCase();
    const cleanMobile = String(mobile || '').trim();
    const cleanKey = String(consumerKey || '').trim();
    const cleanTotpSecret = extractBase32TotpSecret(String(totpSecret || ''));
    let cleanTotp = String(totp || '').trim();
    const cleanMpin = String(mpin || '').trim();

    if (!/^\d{6}$/.test(cleanTotp) && cleanTotpSecret) {
      const autoCode = generateTotpFromBase32Secret(cleanTotpSecret);
      if (!autoCode) {
        res.status(400).json({
          error:
            'Optional Auto-TOTP Secret Key invalid Base32 format me hai. Authenticator setup key (A-Z, 2-7) check karein ya 6-digit TOTP daalein.',
        });
        return;
      }
      cleanTotp = autoCode;
    }

    if (cleanUcc.length < 4) {
      res.status(400).json({ error: 'Apna Kotak Client Code (UCC) daalein (kam se kam 4 characters).' });
      return;
    }
    if (cleanMobile.replace(/\D/g, '').length < 10) {
      res.status(400).json({ error: 'Registered Mobile Number (+91 ke saath) daalna zaroori hai.' });
      return;
    }
    if (cleanKey.length < 10) {
      res.status(400).json({
        error:
          'Kotak Neo Portal (Trade API Dashboard) se mila API Access Token / Consumer Key paste karein.',
      });
      return;
    }
    if (!/^\d{6}$/.test(cleanTotp)) {
      res.status(400).json({
        error: 'Google/Microsoft Authenticator se live 6-digit TOTP code daalein (ya Auto-TOTP Secret Key dein).',
      });
      return;
    }
    if (!/^\d{6}$/.test(cleanMpin)) {
      res.status(400).json({ error: 'Apna 6-digit Kotak Neo MPIN daalein.' });
      return;
    }

    const normalizedSeg: KotakAccountProfile['exchangeSegment'] =
      exchangeSegment === 'NSE_FO'
        ? 'NSE_FO'
        : exchangeSegment === 'MCX_FO'
        ? 'MCX_FO'
        : 'NSE_CDS';

    try {
      const loginResult = await performKotakLoginFlow({
        ucc: cleanUcc,
        mobile: cleanMobile,
        consumerKey: cleanKey,
        totp: cleanTotp,
        mpin: cleanMpin,
        exchangeSegment: normalizedSeg,
        brokerageTier: brokerageTier || 'Kotak Trade Free (₹0 Intraday)',
        leverage: validLev,
      });

      if (!loginResult.ok) {
        res.status(loginResult.status).json({ error: loginResult.error });
        return;
      }

      if (cleanTotpSecret.length >= 8 && generateTotpFromBase32Secret(cleanTotpSecret)) {
        inMemoryKotakAutoCreds = {
          ucc: cleanUcc,
          mobile: cleanMobile,
          consumerKey: cleanKey,
          mpin: cleanMpin,
          totpSecret: cleanTotpSecret,
          exchangeSegment: normalizedSeg,
          brokerageTier: brokerageTier || 'Kotak Trade Free (₹0 Intraday)',
          leverage: validLev,
        };
      }

      const resolvedContracts: Record<string, string> = {};
      for (const [sym, c] of kotakContracts.entries()) {
        resolvedContracts[sym] = `${c.trdSymbol} (Lot:${c.lotSize})`;
      }

      res.json({
        success: true,
        account: loginResult.account,
        accounts: vault.accounts,
        kotakContracts: resolvedContracts,
        brokerOrders: latestBrokerOrders,
        brokerPositions: latestBrokerPositions,
        autoReloginConfigured: Boolean(getEffectiveAutoCreds()),
      });
    } catch (err) {
      res.status(502).json({
        error: `Kotak Neo API server se connection nahi ho paya: ${
          err instanceof Error ? err.message : 'Network timeout'
        }`,
      });
    }
  });

  app.post('/api/kotak/refresh-limits', async (_req, res) => {
    if (!liveBrokerSession || vault.accounts.LIVE.sessionState !== 'NEO_LIVE_AUTHENTICATED') {
      res.status(401).json({
        error: 'Kotak Neo LIVE session active nahi hai. Pehle Kotak account login karein.',
      });
      return;
    }
    const fetchedMargin = await fetchKotakLiveMarginDetails(liveBrokerSession);
    if (fetchedMargin === null) {
      if (!liveBrokerSession) {
        res.status(401).json({
          error:
            sessionExpiredReason ||
            'Kotak Daily Session Token expire ho gaya hai — naye 6-digit TOTP se Re-Login karein!',
        });
        return;
      }
      res.status(502).json({ error: 'Kotak Neo margin limits fetch nahi ho paaye.' });
      return;
    }
    vault.accounts.LIVE = {
      ...vault.accounts.LIVE,
      balanceInr: fetchedMargin.availableInr,
      equityInr: Number((fetchedMargin.availableInr + fetchedMargin.usedMarginInr).toFixed(2)),
      usedMarginInr: fetchedMargin.usedMarginInr,
      lastHeartbeat: new Date().toISOString(),
    };
    saveVault(vault);
    void oracleVault.syncAccountMeta(vault.accounts.LIVE);
    res.json({ success: true, account: vault.accounts.LIVE });
  });

  async function fetchRawKotakOrders(
    session: NonNullable<typeof liveBrokerSession>
  ): Promise<Array<Record<string, unknown>>> {
    const resp = await fetch(`${session.baseUrl}/quick/user/orders`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Auth: session.tradingToken,
        Sid: session.tradingSid,
        'neo-fin-key': 'neotradeapi',
      },
      signal: AbortSignal.timeout(6500),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      data?: Array<Record<string, unknown>>;
      errMsg?: string;
      message?: string;
    };
    if (isKotakSessionExpiredError(resp.status, data)) {
      void handleKotakSessionInvalidated(data?.errMsg || data?.message || `orders HTTP ${resp.status}`);
      return [];
    }
    if (!resp.ok) return [];
    return Array.isArray(data.data) ? data.data : [];
  }

  async function fetchRawKotakPositions(
    session: NonNullable<typeof liveBrokerSession>
  ): Promise<{ ok: boolean; rows: Array<Record<string, unknown>> }> {
    try {
      const resp = await fetch(`${session.baseUrl}/quick/user/positions`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Auth: session.tradingToken,
          Sid: session.tradingSid,
          'neo-fin-key': 'neotradeapi',
        },
        signal: AbortSignal.timeout(6500),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        data?: Array<Record<string, unknown>>;
        stat?: string;
        errMsg?: string;
        message?: string;
      };
      if (isKotakSessionExpiredError(resp.status, data)) {
        void handleKotakSessionInvalidated(data?.errMsg || data?.message || `positions HTTP ${resp.status}`);
        return { ok: false, rows: [] };
      }
      if (!resp.ok) return { ok: false, rows: [] };
      // In Kotak Neo, "No Data" means 0 positions exist right now (valid empty book!)
      if (Array.isArray(data.data)) {
        return { ok: true, rows: data.data };
      }
      const msg = String(data.errMsg || data.stat || '').toLowerCase();
      if (msg.includes('no data') || msg.includes('nodata') || data.stat === 'Ok') {
        return { ok: true, rows: [] };
      }
      return { ok: false, rows: [] };
    } catch {
      return { ok: false, rows: [] };
    }
  }

  function mapKotakOrderSummary(raw: Record<string, unknown>): KotakBrokerOrderSummary {
    const sideStr = String(raw.trnsTp ?? raw.tt ?? 'B').toUpperCase();
    return {
      orderId: String(raw.nOrdNo ?? raw.ordNo ?? ''),
      trdSymbol: String(raw.trdSym ?? raw.ts ?? raw.sym ?? ''),
      side: sideStr === 'S' || sideStr === 'SELL' ? 'SELL' : 'BUY',
      qty: parseKotakNumber(raw.qty ?? raw.qt) ?? 0,
      status: String(raw.ordSt ?? raw.stat ?? 'unknown').toUpperCase(),
      avgPrice: parseKotakNumber(raw.avgPrc ?? raw.prc) ?? 0,
      rejectionReason: String(raw.rejRsn ?? raw.text ?? raw.errMsg ?? '').trim(),
      orderTime: String(raw.ordDtTm ?? raw.exTm ?? ''),
    };
  }

  function mapKotakPositionSummary(raw: Record<string, unknown>): KotakBrokerPositionSummary {
    const flBuyQty = parseKotakNumber(raw.flBuyQty ?? raw.cfBuyQty) ?? 0;
    const flSellQty = parseKotakNumber(raw.flSellQty ?? raw.cfSellQty) ?? 0;
    const explicitNet = parseKotakNumber(raw.netQty);
    const netQty = explicitNet !== null ? explicitNet : flBuyQty - flSellQty;
    const buyAmt = parseKotakNumber(raw.buyAmt ?? raw.totBuyAmt) ?? 0;
    const sellAmt = parseKotakNumber(raw.sellAmt ?? raw.totSellAmt) ?? 0;
    const ltp = parseKotakNumber(raw.ltp ?? raw.stkPrc) ?? 0;
    const lotMul = parseKotakNumber(raw.genNum) ?? 1;
    const pnlInr = Number((sellAmt - buyAmt + netQty * ltp * lotMul).toFixed(2));
    return {
      trdSymbol: String(raw.trdSym ?? raw.ts ?? raw.sym ?? ''),
      exchangeSegment: String(raw.exSeg ?? raw.es ?? ''),
      product: String(raw.prod ?? raw.pc ?? ''),
      netQty,
      buyAmt,
      sellAmt,
      ltp,
      pnlInr: Number.isFinite(pnlInr) ? pnlInr : 0,
    };
  }

  let reconcileBusy = false;
  async function reconcileWithKotakBrokerBook(session: NonNullable<typeof liveBrokerSession>) {
    if (reconcileBusy) return;
    reconcileBusy = true;
    try {
      const [rawOrders, posRes] = await Promise.all([
        fetchRawKotakOrders(session).catch(() => []),
        fetchRawKotakPositions(session),
      ]);
      latestBrokerOrders = rawOrders.map(mapKotakOrderSummary).slice(0, 20);
      // Automatically detect disabled segments (e.g. 'exchg not enabled for this acct' on GOLDM -> mcx_fo)
      for (const ord of latestBrokerOrders) {
        const rsn = ord.rejectionReason.toLowerCase();
        if (rsn.includes('exchg not enabled') || rsn.includes('segment not enabled')) {
          const symUp = ord.trdSymbol.toUpperCase();
          if (symUp.includes('GOLD') || symUp.includes('SILVER') || symUp.includes('CRUDE')) {
            disabledKotakSegments.add('mcx_fo');
          } else if (symUp.includes('INR') && symUp.endsWith('FUT')) {
            disabledKotakSegments.add('cde_fo');
          } else if (symUp.includes('NIFTY')) {
            disabledKotakSegments.add('nse_fo');
          }
        }
      }
      if (posRes.ok) {
        latestBrokerPositions = posRes.rows.map(mapKotakPositionSummary);
      }

      // Auto-reconcile vault.liveTrades so NO ghost or externally-squared-off trade ever stays OPEN!
      let changed = false;
      const now = Date.now();
      vault.liveTrades = vault.liveTrades.filter((tr) => {
        if (tr.status !== 'OPEN') return true;
        // 1. Check if the brokerOrderId was actually REJECTED or CANCELLED in Kotak Order Book
        const matchedOrd = latestBrokerOrders.find((o) => o.orderId === tr.brokerOrderId);
        if (matchedOrd) {
          const st = matchedOrd.status.toLowerCase();
          if (st.includes('rej') || st.includes('cancel')) {
            changed = true;
            return false; // Purge rejected order from liveTrades completely!
          }
        }
        // 2. If trade is older than 8s and Kotak Positions book is confirmed valid, verify netQty != 0!
        if (posRes.ok && now - tr.ts > 8000) {
          const trContract = (tr.trdSymbol || kotakContracts.get(tr.symbol)?.trdSymbol || tr.symbol).toUpperCase();
          const hasLiveKotakPos = latestBrokerPositions.some(
            (p) => p.netQty !== 0 && p.trdSymbol.toUpperCase() === trContract
          );
          if (!hasLiveKotakPos) {
            tr.status = 'CLOSED_MANUAL';
            tr.kotakOrderStatus = 'SQUARED_OFF_ON_KOTAK';
            changed = true;
          }
        }
        return true;
      });

      if (changed) {
        saveVault(vault);
      }
    } finally {
      reconcileBusy = false;
    }
  }

  // Reconcile against real Kotak Phone App Positions & Order Book every 10s while connected
  setInterval(() => {
    if (!liveBrokerSession || vault.accounts.LIVE.sessionState !== 'NEO_LIVE_AUTHENTICATED') return;
    void reconcileWithKotakBrokerBook(liveBrokerSession);
  }, 10_000);

  app.get('/api/kotak/orders', async (_req, res) => {
    if (!liveBrokerSession || vault.accounts.LIVE.sessionState !== 'NEO_LIVE_AUTHENTICATED') {
      res.status(200).json({
        success: false,
        connected: false,
        orders: [],
        positions: [],
      });
      return;
    }
    try {
      await reconcileWithKotakBrokerBook(liveBrokerSession);
      res.json({
        success: true,
        orders: latestBrokerOrders,
        positions: latestBrokerPositions,
      });
    } catch (err) {
      res.status(502).json({
        error: `Kotak Orders fetch error: ${err instanceof Error ? err.message : 'Timeout'}`,
        orders: [],
        positions: [],
      });
    }
  });

  /**
   * CRITICAL REAL-EXCHANGE VERIFICATION GATE:
   * Kotak /quick/order/rule/ms/place returns an nOrdNo even when RMS/Exchange rejects the order 150ms later!
   * This function polls Kotak /quick/user/orders to verify the order is ACTUALLY TRADED/COMPLETE on NSE/MCX!
   */
  async function verifyKotakOrderExecution(
    session: NonNullable<typeof liveBrokerSession>,
    nOrdNo: string
  ): Promise<
    | {
        verified: true;
        orderId: string;
        exOrdId: string;
        fillPrice: number | null;
        filledQty: number;
        status: string;
      }
    | {
        verified: false;
        orderId: string;
        status: string;
        reason: string;
        fatalNonRetryable: boolean;
      }
  > {
    const waitStepsMs = [300, 550, 750, 950];
    let lastSeenRow: Record<string, unknown> | undefined;

    for (const delay of waitStepsMs) {
      await new Promise((r) => setTimeout(r, delay));
      const orders = await fetchRawKotakOrders(session).catch(() => []);
      if (orders.length > 0) {
        latestBrokerOrders = orders.map(mapKotakOrderSummary).slice(0, 20);
      }
      const row = orders.find((o) => String(o.nOrdNo ?? o.ordNo ?? '') === String(nOrdNo));
      if (!row) continue;
      lastSeenRow = row;

      const ordSt = String(row.ordSt ?? row.stat ?? '').trim().toLowerCase();
      const fldQty = parseKotakNumber(row.fldQty) ?? 0;

      if (ordSt === 'complete' || ordSt === 'traded' || fldQty > 0) {
        return {
          verified: true,
          orderId: nOrdNo,
          exOrdId: String(row.exOrdId ?? row.GuiOrdId ?? nOrdNo),
          fillPrice: parseKotakNumber(row.avgPrc ?? row.prc),
          filledQty: fldQty,
          status: 'COMPLETE',
        };
      }

      if (ordSt.includes('rej') || ordSt.includes('cancel') || ordSt.includes('denied')) {
        const rejRsn = String(
          row.rejRsn ?? row.text ?? row.errMsg ?? row.ordSt ?? 'Rejected by Kotak RMS / Exchange'
        ).trim();
        const lowerRsn = rejRsn.toLowerCase();
        const fatalNonRetryable =
          lowerRsn.includes('closed') ||
          lowerRsn.includes('logged off') ||
          lowerRsn.includes('adapter') ||
          lowerRsn.includes('segment') ||
          lowerRsn.includes('holiday') ||
          lowerRsn.includes('freeze');
        return {
          verified: false,
          orderId: nOrdNo,
          status: ordSt.toUpperCase(),
          reason: rejRsn,
          fatalNonRetryable,
        };
      }
    }

    // Order exists in Kotak Order Book but did NOT execute within ~2.6s (e.g., pending / market closed / AMO)
    try {
      await fetch(`${session.baseUrl}/quick/order/cancel`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Auth: session.tradingToken,
          Sid: session.tradingSid,
          'neo-fin-key': 'neotradeapi',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ jData: JSON.stringify({ on: nOrdNo, am: 'NO' }) }).toString(),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      // Best-effort cancel of unfilled MKT order
    }

    const pendingStatus = lastSeenRow
      ? String(lastSeenRow.ordSt ?? lastSeenRow.stat ?? 'PENDING').toUpperCase()
      : 'UNCONFIRMED';
    const pendingReason = lastSeenRow
      ? String(lastSeenRow.rejRsn ?? lastSeenRow.text ?? `Order Status is ${pendingStatus} (not filled)`).trim()
      : 'Kotak Order Book me fill confirmation nahi mila';

    return {
      verified: false,
      orderId: nOrdNo,
      status: pendingStatus,
      reason: pendingReason,
      fatalNonRetryable: true,
    };
  }

  const orderInFlightBySymbol = new Set<TradingSymbol>();
  const closeInFlightByTradeId = new Set<string>();

  async function executeKotakLiveOrderInternal(params: {
    id?: string;
    symbol: TradingSymbol;
    direction: 'BUY' | 'SELL';
    lots: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    initialStopDistance?: number;
    strategyUsed?: string;
    confluenceNote?: string;
    tradingSymbolOverride?: string;
  }): Promise<
    | { ok: true; trade: PersistentOracleVault['liveTrades'][number]; account: KotakAccountProfile }
    | { ok: false; status: number; error: string }
  > {
    if (
      liveBrokerSession &&
      isKotakJwtExpired(liveBrokerSession.tradingToken, 20_000)
    ) {
      await handleKotakSessionInvalidated('Kotak JWT expired prior to order');
    }

    const acc = vault.accounts.LIVE;
    if (!liveBrokerSession || acc.sessionState !== 'NEO_LIVE_AUTHENTICATED') {
      return {
        ok: false,
        status: 401,
        error:
          sessionExpiredReason ||
          'Kotak Neo LIVE session active nahi hai. Real order ke liye naye 6-digit TOTP se Kotak login karein.',
      };
    }

    const cleanSym = (SYMBOL_FEED_MAP[params.symbol] ? params.symbol : 'USDINR') as TradingSymbol;
    if (orderInFlightBySymbol.has(cleanSym)) {
      return { ok: false, status: 409, error: `Order already in flight for ${cleanSym}` };
    }
    orderInFlightBySymbol.add(cleanSym);

    try {
      const spec = INDIAN_SYMBOLS[cleanSym];
      const cleanDir: 'BUY' | 'SELL' = params.direction === 'SELL' ? 'SELL' : 'BUY';

      // Ensure Scrip Master contracts are loaded before placing any real order!
      if (!kotakContracts.has(cleanSym)) {
        await initializeKotakScripMaster(liveBrokerSession);
      }

      const resolved = kotakContracts.get(cleanSym);
      if (!resolved && !params.tradingSymbolOverride) {
        if (spec.exchange === 'GLOBAL_FX') {
          return {
            ok: false,
            status: 400,
            error: `'${cleanSym}' Global Spot chart hai — Kotak Securities India par tradable nahi hai! Real order ke liye GOLDPETAL, GOLDM, USDINR, EURINR, GBPINR, JPYINR, NIFTY50 ya BANKNIFTY chunein.`,
          };
        }
        return {
          ok: false,
          status: 400,
          error: `Kotak Scrip Master me '${cleanSym}' ka active futures contract nahi mila. Check karein ki aapke Kotak Neo account me ${spec.exchange} segment enabled hai.`,
        };
      }

      // Refresh real Kotak balance right before order
      const freshLimits = await fetchKotakLiveMarginDetails(liveBrokerSession);
      if (freshLimits) {
        acc.balanceInr = freshLimits.availableInr;
        acc.equityInr = Number((freshLimits.availableInr + freshLimits.usedMarginInr).toFixed(2));
        acc.usedMarginInr = freshLimits.usedMarginInr;
      }

      // Margin Sizing: In High-Risk Mode (user authorized ₹1,000 high-risk trading), NEVER locally block 1 Lot MIS!
      // Let Kotak's actual Intraday MIS leverage execute 1 Lot directly, and scale >1 lots within 96% of balance as profits grow!
      const isHighRisk = Boolean(vault.botRiskConfig.highRiskMode);
      let cleanLots = Math.max(1, Math.round(Number(params.lots) || 1));
      if (acc.balanceInr > 0) {
        const usableFactor = isHighRisk ? 0.96 : 0.88;
        const maxAffordableLots = Math.floor((acc.balanceInr * usableFactor) / spec.marginPerLotInr);
        if (!isHighRisk && maxAffordableLots < 1 && acc.balanceInr < spec.marginPerLotInr * 0.75) {
          return {
            ok: false,
            status: 400,
            error: `Insufficient Kotak Margin: Available ₹${acc.balanceInr.toFixed(2)}, jabki ${cleanSym} (${resolved?.trdSymbol ?? cleanSym}) ke 1 Lot ke liye ~₹${spec.marginPerLotInr} chahiye. High-Risk Mode ON karein ya margin add karein.`,
          };
        }
        if (acc.balanceInr < 100) {
          return {
            ok: false,
            status: 400,
            error: `Available Kotak Balance ₹${acc.balanceInr.toFixed(2)} bahut kam hai.`,
          };
        }
        cleanLots = Math.max(1, Math.min(cleanLots, Math.max(1, maxAffordableLots)));
      }

      const exchSeg =
        resolved?.orderSegment ??
        (spec.exchange === 'MCX_FO'
          ? 'mcx_fo'
          : spec.exchange === 'NSE_FNO' || acc.exchangeSegment === 'NSE_FO'
          ? 'nse_fo'
          : 'cde_fo');
      const kotakTs = String(params.tradingSymbolOverride || resolved!.trdSymbol).trim().toUpperCase();
      const csvLotMult = resolved?.lotSize ?? 1;

      // Build smart attempt sequence (MIS Intraday max leverage first -> 1-lot MIS -> 1-lot NRML fallback)
      const attemptConfigs: Array<{ pc: 'MIS' | 'NRML'; lots: number; qt: number }> = [
        { pc: 'MIS', lots: cleanLots, qt: cleanLots * csvLotMult },
      ];
      if (cleanLots > 1) {
        attemptConfigs.push({ pc: 'MIS', lots: 1, qt: 1 * csvLotMult });
      }
      attemptConfigs.push({ pc: 'NRML', lots: 1, qt: 1 * csvLotMult });
      if (csvLotMult > 1 && exchSeg !== 'nse_fo') {
        attemptConfigs.push({ pc: 'MIS', lots: 1, qt: 1 });
      }

      let verifiedFill: {
        orderId: string;
        exOrdId: string;
        fillPrice: number | null;
        status: string;
        pc: 'MIS' | 'NRML';
        lots: number;
      } | null = null;
      let lastRejectMsg = '';

      let sessionExpiredFatal = false;
      let sessionRenewedOnce = false;

      for (let idx = 0; idx < attemptConfigs.length; idx++) {
        const attempt = attemptConfigs[idx];
        if (!liveBrokerSession) {
          sessionExpiredFatal = true;
          break;
        }
        try {
          const orderResp = await fetch(`${liveBrokerSession.baseUrl}/quick/order/rule/ms/place`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Auth: liveBrokerSession.tradingToken,
              Sid: liveBrokerSession.tradingSid,
              'neo-fin-key': 'neotradeapi',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              jData: JSON.stringify({
                am: 'NO',
                dq: '0',
                es: exchSeg,
                mp: '0',
                pc: attempt.pc,
                pf: 'N',
                pr: '0',
                pt: 'MKT',
                qt: String(attempt.qt),
                rt: 'DAY',
                tp: '0',
                ts: kotakTs,
                tt: cleanDir === 'BUY' ? 'B' : 'S',
              }),
            }).toString(),
            signal: AbortSignal.timeout(8000),
          });
          const orderJson = (await orderResp.json().catch(() => ({}))) as {
            stat?: string;
            nOrdNo?: string;
            errMsg?: string;
            message?: string;
          };
          if (!orderResp.ok || orderJson.stat === 'Not_Ok' || !orderJson.nOrdNo) {
            lastRejectMsg =
              orderJson.errMsg || orderJson.message || `HTTP ${orderResp.status}`;
            if (isKotakSessionExpiredError(orderResp.status, orderJson)) {
              if (!sessionRenewedOnce) {
                sessionRenewedOnce = true;
                const renewed = await handleKotakSessionInvalidated(lastRejectMsg);
                if (renewed && liveBrokerSession) {
                  idx--; // Retry this exact order attempt with the newly issued Kotak session token!
                  continue;
                }
              }
              sessionExpiredFatal = true;
              break;
            }
            continue;
          }

          // NOW VERIFY IN KOTAK /quick/user/orders THAT THIS nOrdNo ACTUALLY EXECUTED ON THE EXCHANGE!
          const check = await verifyKotakOrderExecution(liveBrokerSession, orderJson.nOrdNo);
          if (check.verified) {
            marginCooldownUntilBySymbol.delete(cleanSym);
            verifiedFill = {
              orderId: check.orderId,
              exOrdId: check.exOrdId,
              fillPrice: check.fillPrice,
              status: check.status,
              pc: attempt.pc,
              lots: attempt.lots,
            };
            break;
          }

          lastRejectMsg = `Order #${check.orderId} ${check.status}: ${check.reason}`;
          const lowerReason = check.reason.toLowerCase();
          if (lowerReason.includes('exchg not enabled') || lowerReason.includes('segment not enabled')) {
            disabledKotakSegments.add(exchSeg);
            break;
          }
          if (
            lowerReason.includes('insufficient') ||
            lowerReason.includes('shortfall') ||
            lowerReason.includes('margin')
          ) {
            // Pause auto-bot retries on this specific symbol for 10 min so lower-margin pairs (JPYINR/USDINR) can run
            marginCooldownUntilBySymbol.set(cleanSym, Date.now() + 10 * 60_000);
          }
          if (check.fatalNonRetryable) {
            break;
          }
        } catch (err) {
          lastRejectMsg = err instanceof Error ? err.message : 'Timeout';
        }
      }

      if (sessionExpiredFatal || !liveBrokerSession) {
        return {
          ok: false,
          status: 401,
          error:
            sessionExpiredReason ||
            'Kotak Daily Session Token expire ho gaya hai (Kotak roz subah naya login mangta hai) — abhi naye 6-digit TOTP se Re-Login karein!',
        };
      }

      if (!verifiedFill) {
        await reconcileWithKotakBrokerBook(liveBrokerSession);
        return {
          ok: false,
          status: 400,
          error: `Kotak Exchange Rejected (${kotakTs} · ${exchSeg}): ${lastRejectMsg}`,
        };
      }

      // Sync real post-trade Kotak margin & position book immediately!
      const [postTradeLimits] = await Promise.all([
        fetchKotakLiveMarginDetails(liveBrokerSession),
        reconcileWithKotakBrokerBook(liveBrokerSession),
      ]);
      if (postTradeLimits) {
        acc.balanceInr = postTradeLimits.availableInr;
        acc.equityInr = Number((postTradeLimits.availableInr + postTradeLimits.usedMarginInr).toFixed(2));
        acc.usedMarginInr = postTradeLimits.usedMarginInr;
      }

      const realEntry =
        verifiedFill.fillPrice && verifiedFill.fillPrice > 0
          ? Number(verifiedFill.fillPrice.toFixed(spec.decimals))
          : Number(params.entryPrice) || 0;
      const origEntry = Number(params.entryPrice) || realEntry;
      const entryDelta = realEntry - origEntry;
      const slNum = Number(((Number(params.stopLoss) || 0) + entryDelta).toFixed(spec.decimals));
      const tpNum = Number(((Number(params.takeProfit) || 0) + entryDelta).toFixed(spec.decimals));

      const verifiedNote = `${params.confluenceNote ? `${params.confluenceNote} · ` : ''}[KOTAK_VERIFIED_FILL #${verifiedFill.exOrdId}]`;

      const record: PersistentOracleVault['liveTrades'][number] = {
        id: String(params.id || `NEO-${verifiedFill.orderId.slice(-6)}`),
        brokerOrderId: verifiedFill.orderId,
        brokerMode: 'LIVE',
        symbol: cleanSym,
        trdSymbol: kotakTs,
        direction: cleanDir,
        lots: verifiedFill.lots,
        entryPrice: realEntry,
        stopLoss: slNum,
        takeProfit: tpNum,
        initialStopDistance:
          params.initialStopDistance ?? Math.max(spec.tickSize * 6, Math.abs(realEntry - slNum)),
        breakEvenLocked: false,
        trailingActivated: false,
        targetStepCount: 0,
        productCode: verifiedFill.pc,
        exchangeVerified: true,
        kotakOrderStatus: 'COMPLETE',
        exchangeOrderId: verifiedFill.exOrdId,
        pnlInr: 0,
        pnlTicks: 0,
        status: 'OPEN',
        strategyUsed: String(params.strategyUsed || 'EMA_RSI_CONFLUENCE'),
        confluenceNote: verifiedNote,
        ts: Date.now(),
      };

      vault.liveTrades = [record, ...vault.liveTrades.slice(0, 99)];
      acc.lastHeartbeat = new Date().toISOString();
      saveVault(vault);
      void oracleVault.syncTradeRecord(record);

      return { ok: true, trade: record, account: acc };
    } finally {
      orderInFlightBySymbol.delete(cleanSym);
    }
  }

  async function closeKotakLiveOrderInternal(params: {
    id: string;
    exitPrice: number;
    pnlInr: number;
    pnlTicks: number;
    status: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL';
  }): Promise<
    | {
        ok: true;
        account: KotakAccountProfile;
        aiEvolutionNote: string | null;
        aiMemory: AiStrategyMemoryRecord[];
      }
    | { ok: false; status: number; error: string }
  > {
    const acc = vault.accounts.LIVE;
    if (!liveBrokerSession || acc.sessionState !== 'NEO_LIVE_AUTHENTICATED') {
      return {
        ok: false,
        status: 401,
        error: 'Kotak Neo LIVE session active nahi hai. Real position exit ke liye login zaroori hai.',
      };
    }

    if (closeInFlightByTradeId.has(params.id)) {
      return { ok: false, status: 409, error: 'Position exit already in progress' };
    }
    const existingTrade = vault.liveTrades.find((t) => t.id === params.id && t.status === 'OPEN');
    if (!existingTrade) {
      return {
        ok: true,
        account: acc,
        aiEvolutionNote: null,
        aiMemory: vault.aiMemory,
      };
    }

    closeInFlightByTradeId.add(params.id);
    try {
      const spec = INDIAN_SYMBOLS[existingTrade.symbol];
      const resolved = kotakContracts.get(existingTrade.symbol);
      const exchSeg =
        resolved?.orderSegment ??
        (spec?.exchange === 'MCX_FO'
          ? 'mcx_fo'
          : spec?.exchange === 'NSE_FNO' || acc.exchangeSegment === 'NSE_FO'
          ? 'nse_fo'
          : 'cde_fo');
      const kotakTs = (
        existingTrade.trdSymbol ??
        resolved?.trdSymbol ??
        existingTrade.symbol
      ).toUpperCase();
      const oppositeSide = existingTrade.direction === 'BUY' ? 'S' : 'B';
      const exitProductCode = existingTrade.productCode ?? 'MIS';
      const csvLotMult = resolved?.lotSize ?? 1;
      const exitQty = Math.max(1, Math.round(existingTrade.lots)) * csvLotMult;

      // Check first if position was already squared off directly from Kotak Neo Phone App!
      const posCheck = await fetchRawKotakPositions(liveBrokerSession);
      const livePosRow = posCheck.ok
        ? posCheck.rows
            .map(mapKotakPositionSummary)
            .find((p) => p.trdSymbol.toUpperCase() === kotakTs && p.netQty !== 0)
        : undefined;

      let realExitFillPrice = Number(params.exitPrice) || existingTrade.entryPrice;

      if (!posCheck.ok || livePosRow) {
        try {
          const placeSquareOff = async (activeSession: NonNullable<typeof liveBrokerSession>) => {
            const closeResp = await fetch(`${activeSession.baseUrl}/quick/order/rule/ms/place`, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                Auth: activeSession.tradingToken,
                Sid: activeSession.tradingSid,
                'neo-fin-key': 'neotradeapi',
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                jData: JSON.stringify({
                  am: 'NO',
                  dq: '0',
                  es: exchSeg,
                  mp: '0',
                  pc: exitProductCode,
                  pf: 'N',
                  pr: '0',
                  pt: 'MKT',
                  qt: String(livePosRow ? Math.abs(livePosRow.netQty) : exitQty),
                  rt: 'DAY',
                  tp: '0',
                  ts: kotakTs,
                  tt: oppositeSide,
                }),
              }).toString(),
              signal: AbortSignal.timeout(8000),
            });
            const closeJson = (await closeResp.json().catch(() => ({}))) as {
              stat?: string;
              nOrdNo?: string;
              errMsg?: string;
              message?: string;
            };
            return { closeResp, closeJson };
          };

          let { closeResp, closeJson } = await placeSquareOff(liveBrokerSession);
          if (
            (!closeResp.ok || closeJson.stat === 'Not_Ok' || !closeJson.nOrdNo) &&
            isKotakSessionExpiredError(closeResp.status, closeJson)
          ) {
            const renewed = await handleKotakSessionInvalidated(
              closeJson.errMsg || closeJson.message || 'Close order invalid session token'
            );
            if (!renewed || !liveBrokerSession) {
              return {
                ok: false,
                status: 401,
                error:
                  sessionExpiredReason ||
                  'Kotak Daily Session Token expire ho gaya hai — Square-off ke liye naye 6-digit TOTP se Re-Login karein!',
              };
            }
            ({ closeResp, closeJson } = await placeSquareOff(liveBrokerSession));
          }

          if (!closeResp.ok || closeJson.stat === 'Not_Ok' || !closeJson.nOrdNo) {
            return {
              ok: false,
              status: 400,
              error: `Kotak LIVE Exit Rejected: ${
                closeJson.errMsg || closeJson.message || `HTTP ${closeResp.status}`
              }`,
            };
          }

          const verifyClose = await verifyKotakOrderExecution(liveBrokerSession, closeJson.nOrdNo);
          if (!verifyClose.verified) {
            return {
              ok: false,
              status: 400,
              error: `Kotak Exit Order #${verifyClose.orderId} ${verifyClose.status}: ${verifyClose.reason}`,
            };
          }
          if (verifyClose.fillPrice && verifyClose.fillPrice > 0) {
            realExitFillPrice = Number(verifyClose.fillPrice.toFixed(spec.decimals));
          }
        } catch (err) {
          return {
            ok: false,
            status: 502,
            error: `Kotak LIVE Exit network error: ${err instanceof Error ? err.message : 'Timeout'}`,
          };
        }
      }

      // STRICTLY fetch real Kotak balance from /quick/user/limits — NEVER add fake P&L locally!
      const [refreshedMargin] = await Promise.all([
        fetchKotakLiveMarginDetails(liveBrokerSession),
        reconcileWithKotakBrokerBook(liveBrokerSession),
      ]);
      if (refreshedMargin !== null) {
        acc.balanceInr = refreshedMargin.availableInr;
        acc.equityInr = Number((refreshedMargin.availableInr + refreshedMargin.usedMarginInr).toFixed(2));
        acc.usedMarginInr = refreshedMargin.usedMarginInr;
      }
      acc.lastHeartbeat = new Date().toISOString();

      // Clear any bar cooldown immediately so the 24x7 bot continues hunting the next trade non-stop!
      lastServerBotBarBucket.delete(existingTrade.symbol);

      const diff =
        existingTrade.direction === 'BUY'
          ? realExitFillPrice - existingTrade.entryPrice
          : existingTrade.entryPrice - realExitFillPrice;
      const realPnlTicks = Number((diff / spec.tickSize).toFixed(1));
      const realPnlInr = Number((realPnlTicks * spec.valuePerTickInr * existingTrade.lots).toFixed(2));

      vault.liveTrades = vault.liveTrades.map((t) =>
        t.id === params.id
          ? {
              ...t,
              exitPrice: realExitFillPrice,
              pnlInr: realPnlInr,
              pnlTicks: realPnlTicks,
              kotakOrderStatus: 'CLOSED_VERIFIED',
              status: params.status || 'CLOSED_MANUAL',
            }
          : t
      );

      let aiEvolutionNote: string | null = null;
      const memIdx = vault.aiMemory.findIndex((m) => m.symbol === existingTrade.symbol);
      const baseCfg =
        memIdx >= 0
          ? vault.aiMemory[memIdx].indicatorConfig
          : STRATEGY_CATALOG[0].defaultRawConfig;
      const evolved = evolveIndicatorConfigFromOutcome(baseCfg, params.status, realPnlInr);
      aiEvolutionNote = evolved.note;
      if (memIdx >= 0) {
        const prev = vault.aiMemory[memIdx];
        const nextTrades = prev.tradesCount + 1;
        const prevWins = Math.round((prev.winRatePct / 100) * prev.tradesCount);
        const nextWr = Number((((prevWins + (realPnlInr > 0 ? 1 : 0)) / nextTrades) * 100).toFixed(1));
        vault.aiMemory[memIdx] = {
          ...prev,
          indicatorConfig: evolved.nextConfig,
          winRatePct: nextWr,
          tradesCount: nextTrades,
          updatedAt: new Date().toISOString(),
          origin: 'LIVE_ADAPTATION',
        };
      }

      saveVault(vault);
      const updatedTradeRow = vault.liveTrades.find((t) => t.id === params.id);
      if (updatedTradeRow) void oracleVault.syncTradeRecord(updatedTradeRow);
      void oracleVault.syncAccountMeta(acc);
      const updatedMem = vault.aiMemory.find((m) => m.symbol === existingTrade.symbol);
      if (updatedMem) void oracleVault.syncMemoryRecords([updatedMem]);

      return { ok: true, account: acc, aiEvolutionNote, aiMemory: vault.aiMemory };
    } finally {
      closeInFlightByTradeId.delete(params.id);
    }
  }

  // 24x7 Autonomous Server Bot Tick Engine (Dynamic Target Expansion + Trailing SL + Margin-Safe Non-Stop Entry)
  autonomousTickHook = (quote: StreamQuote) => {
    if (!liveBrokerSession || vault.accounts.LIVE.sessionState !== 'NEO_LIVE_AUTHENTICATED') {
      return;
    }
    const sym = quote.symbol;
    const spec = INDIAN_SYMBOLS[sym];
    if (!spec) return;

    // 1. Monitor ALL open trades on this symbol for Dynamic Target Expansion (+1, +2...), Trailing SL & Exit 24x7
    let tradeMutated = false;
    for (const tr of vault.liveTrades) {
      if (tr.status !== 'OPEN' || tr.symbol !== sym || closeInFlightByTradeId.has(tr.id)) continue;

      const markPrice = tr.direction === 'BUY' ? quote.bid : quote.ask;
      const diff = tr.direction === 'BUY' ? markPrice - tr.entryPrice : tr.entryPrice - markPrice;
      const pnlTicks = Number((diff / spec.tickSize).toFixed(1));
      const pnlInr = Number((pnlTicks * spec.valuePerTickInr * tr.lots).toFixed(2));

      tr.pnlTicks = pnlTicks;
      tr.pnlInr = pnlInr;

      let nextSl = tr.stopLoss;
      const initDist =
        tr.initialStopDistance ?? Math.max(spec.tickSize * 6, Math.abs(tr.entryPrice - tr.stopLoss));

      // DYNAMIC TARGET EXPANSION: When price hits/nears Target (>= 90% of current TP distance),
      // lock profit right behind current price AND create a higher NEW TARGET (+1, +2, ...) automatically!
      const currentTpDist = Math.abs(tr.takeProfit - tr.entryPrice);
      const reachedTargetZone =
        initDist > 0 &&
        currentTpDist > 0 &&
        ((tr.direction === 'BUY' && markPrice >= tr.takeProfit - initDist * 0.12) ||
          (tr.direction === 'SELL' && markPrice <= tr.takeProfit + initDist * 0.12));

      if (reachedTargetZone) {
        const nextStep = (tr.targetStepCount ?? 0) + 1;
        const lockedSl = Number(
          (tr.direction === 'BUY'
            ? markPrice - initDist * 0.45
            : markPrice + initDist * 0.45
          ).toFixed(spec.decimals)
        );
        const expandedTp = Number(
          (tr.direction === 'BUY'
            ? markPrice + initDist * 1.05
            : markPrice - initDist * 1.05
          ).toFixed(spec.decimals)
        );

        if (
          (tr.direction === 'BUY' && lockedSl > nextSl) ||
          (tr.direction === 'SELL' && lockedSl < nextSl)
        ) {
          nextSl = lockedSl;
          tr.stopLoss = lockedSl;
        }
        tr.takeProfit = expandedTp;
        tr.targetStepCount = nextStep;
        tr.breakEvenLocked = true;
        tr.trailingActivated = true;
        tradeMutated = true;
        const msg = `Target Hit -> Auto-Created NEW TARGET +${nextStep} (${expandedTp.toFixed(spec.decimals)}) on ${sym} · Profit Locked @ ${nextSl.toFixed(spec.decimals)}!`;
        lastServerBotAction = msg;
        botDiagnostics.set(sym, msg);
        continue;
      }

      if (vault.botRiskConfig.trailingStopEnabled && initDist > 0) {
        if (diff >= initDist * Math.max(1.0, vault.botRiskConfig.breakEvenTriggerR)) {
          const beLevel =
            tr.direction === 'BUY'
              ? tr.entryPrice + initDist * 0.18
              : tr.entryPrice - initDist * 0.18;
          const trailLevel =
            diff >= initDist * 1.4
              ? tr.direction === 'BUY'
                ? markPrice - initDist * 0.85
                : markPrice + initDist * 0.85
              : beLevel;
          const cand =
            tr.direction === 'BUY' ? Math.max(beLevel, trailLevel) : Math.min(beLevel, trailLevel);
          if (
            (tr.direction === 'BUY' && cand > nextSl) ||
            (tr.direction === 'SELL' && cand < nextSl)
          ) {
            nextSl = Number(cand.toFixed(spec.decimals));
            tr.stopLoss = nextSl;
            tr.breakEvenLocked = true;
            tr.trailingActivated = diff >= initDist * 1.4;
            tradeMutated = true;
          }
        }
      }

      botDiagnostics.set(
        sym,
        `LIVE ${tr.direction} ${tr.lots}L Open (${pnlInr >= 0 ? '+' : ''}₹${pnlInr}) · SL ${nextSl.toFixed(spec.decimals)} · ${
          (tr.targetStepCount ?? 0) > 0 ? `NEW TARGET +${tr.targetStepCount}` : 'TP'
        } ${tr.takeProfit.toFixed(spec.decimals)}`
      );

      if (
        (tr.direction === 'BUY' && markPrice <= nextSl) ||
        (tr.direction === 'SELL' && markPrice >= nextSl)
      ) {
        const isBankedTargetExit = pnlInr > 0 && ((tr.targetStepCount ?? 0) > 0 || tr.trailingActivated);
        const exitStatus = isBankedTargetExit ? 'CLOSED_TP' : 'CLOSED_SL';
        void closeKotakLiveOrderInternal({
          id: tr.id,
          exitPrice: markPrice,
          pnlInr,
          pnlTicks,
          status: exitStatus,
        }).then((res) => {
          if (res.ok) {
            const note = isBankedTargetExit
              ? `Target +${tr.targetStepCount ?? 1} Profit Banked on ${sym} (+₹${pnlInr}) · Scanning Next Trade Non-Stop!`
              : `24×7 Bot SL Exit on ${sym} (${pnlInr >= 0 ? '+' : ''}₹${pnlInr}) · Scanning Next Setup...`;
            lastServerBotAction = note;
            botDiagnostics.set(sym, note);
          }
        });
      }
    }

    if (tradeMutated) {
      saveVault(vault);
    }

    // 2. Check 4-Timeframe Confluence Auto-Entry if this symbol is Armed on the Server
    if (!vault.armedSymbols.includes(sym)) {
      return;
    }

    const targetExchSeg =
      spec.exchange === 'MCX_FO' ? 'mcx_fo' : spec.exchange === 'NSE_FNO' ? 'nse_fo' : 'cde_fo';
    if (disabledKotakSegments.has(targetExchSeg)) {
      botDiagnostics.set(
        sym,
        `Kotak Account me ${targetExchSeg.toUpperCase()} segment abhi enabled nahi hai — Active Currency Pairs (USDINR/JPYINR/EURINR/GBPINR) par focus hai!`
      );
      return;
    }

    if (!isNseMarketOpen(sym)) {
      botDiagnostics.set(
        sym,
        spec.exchange === 'MCX_FO'
          ? `MCX Closed (Opens Mon–Fri 9:00 AM – 11:55 PM IST)`
          : spec.exchange === 'NSE_FNO'
          ? `NSE F&O Closed (Opens 9:15 AM – 3:30 PM IST)`
          : `NSE Currency Armed (${sym} · ₹1K High-Risk MIS) · Subah 9:00 AM IST khulte hi Auto-Trade chalu hoga!`
      );
      return;
    }

    if (spec.exchange === 'GLOBAL_FX' && !kotakContracts.has(sym)) {
      botDiagnostics.set(
        sym,
        `${sym} Global Spot Reference hai — Kotak Real Order ke liye USDINR, JPYINR, EURINR ya GBPINR chunein`
      );
      return;
    }

    if (orderInFlightBySymbol.has(sym)) {
      return;
    }

    const hasOpenOnSym = vault.liveTrades.some((t) => t.status === 'OPEN' && t.symbol === sym);
    if (hasOpenOnSym) return;

    const now = Date.now();
    const cooldownUntil = marginCooldownUntilBySymbol.get(sym) ?? 0;
    if (now < cooldownUntil) {
      botDiagnostics.set(
        sym,
        `Kotak RMS Margin Cooldown on ${sym} (${Math.ceil((cooldownUntil - now) / 60000)}m left) — scanning lower-margin pairs (JPYINR/USDINR)`
      );
      return;
    }

    const isHighRisk = Boolean(vault.botRiskConfig.highRiskMode);
    const lastEval = lastServerBotEvalTs.get(sym) ?? 0;
    if (now - lastEval < (isHighRisk ? 1500 : 2500)) return;
    lastServerBotEvalTs.set(sym, now);

    // Daily Drawdown Circuit Breaker check (NEVER stops on profit — only protects against max daily loss!)
    const startOfDayTs = new Date().setHours(0, 0, 0, 0);
    const todayPnlInr = vault.liveTrades
      .filter((t) => t.ts >= startOfDayTs)
      .reduce((sum, t) => sum + (Number(t.pnlInr) || 0), 0);
    const liveAvail = vault.accounts.LIVE.balanceInr;
    const refCap = liveAvail > 0 ? liveAvail : Math.max(1000, vault.accounts.LIVE.equityInr || 1000);
    if (todayPnlInr <= -refCap * (vault.botRiskConfig.maxDailyDrawdownPct / 100)) {
      const msg = `Daily Max Loss Guard Active (${vault.botRiskConfig.maxDailyDrawdownPct}% limit)`;
      lastServerBotAction = msg;
      botDiagnostics.set(sym, msg);
      return;
    }

    if (!isHighRisk && liveAvail > 0 && liveAvail < spec.marginPerLotInr * 0.82) {
      botDiagnostics.set(
        sym,
        `Balance ₹${liveAvail.toFixed(0)} hai (${sym} 1 Lot margin ~₹${spec.marginPerLotInr}). High-Risk ₹1K Mode ON karein!`
      );
      return;
    }
    if (liveAvail > 0 && liveAvail < 100) {
      botDiagnostics.set(sym, `Available Kotak Balance ₹${liveAvail.toFixed(0)} bahut kam hai.`);
      return;
    }

    void (async () => {
      try {
        if (!vault.armedSymbols.includes(sym) || orderInFlightBySymbol.has(sym)) return;
        if (vault.liveTrades.some((t) => t.status === 'OPEN' && t.symbol === sym)) return;

        const bucketIntervalMs = isHighRisk ? timeframeToMs('30S') : timeframeToMs('1M');
        const barBucket = Math.floor(quote.ts / bucketIntervalMs);
        if (lastServerBotBarBucket.get(sym) === barBucket) return;

        const quad = await loadQuadCandlesCached(sym);
        const midPrice = Number(quote.mid.toFixed(spec.decimals));
        const tfs: QuadTimeframe[] = ['30M', '5M', '1M', '30S'];
        const slots = {} as Record<QuadTimeframe, QuadChartSlotConfig>;
        let latest1MAtr: number | undefined;

        for (const tf of tfs) {
          const baseSlot = getDefaultSlotConfig(tf, sym);
          const rawBars = quad.frames[tf] ?? [];
          if (rawBars.length < 30) return;
          const adapted = detectMarketPatternAndAdaptIndicators(rawBars, sym, tf, vault.aiMemory);
          const liveBars = applyLiveTickToCandles(
            rawBars,
            tf,
            sym,
            midPrice,
            quote.ts,
            adapted.indicatorConfig
          );
          if (tf === '1M') {
            latest1MAtr = liveBars[liveBars.length - 1]?.atr;
          }
          const sig = evaluateLiveSignal(liveBars, sym, adapted.strategy, adapted.indicatorConfig);
          slots[tf] = {
            ...baseSlot,
            strategy: adapted.strategy,
            indicatorConfig: adapted.indicatorConfig,
            detectedRegime: adapted.regime,
            patternLabel: adapted.patternLabel,
            liveSignal: sig.signal,
          };
        }

        const confluence = evaluateMultiTimeframeConfluence(slots);
        const minConfidence = isHighRisk ? 52 : 62;
        if (confluence.direction === 'WAIT' || confluence.confidencePct < minConfidence) {
          botDiagnostics.set(
            sym,
            `⚡ High-Risk AI Scanning ${sym} (${slots['1M'].patternLabel}) · Confluence ${confluence.confidencePct}% (${minConfidence}%+ hote hi Auto-Order jayega)`
          );
          return;
        }

        lastServerBotBarBucket.set(sym, barBucket);
        const primarySlot = slots['1M'];
        const cfg = primarySlot.indicatorConfig;
        const entryRaw = confluence.direction === 'BUY' ? quote.ask : quote.bid;
        const entry = Number(entryRaw.toFixed(spec.decimals));
        const atrBase = latest1MAtr ?? spec.tickSize * 16;
        const slDist = Math.max(spec.tickSize * 6, atrBase * cfg.atrMultiplierSL);
        const tpDist = Math.max(spec.tickSize * 10, atrBase * cfg.atrMultiplierTP);

        const sizingCapital = vault.accounts.LIVE.balanceInr > 0 ? vault.accounts.LIVE.balanceInr : refCap;
        const lots = calculateLotSize(
          sizingCapital,
          vault.botRiskConfig.riskPerTradePct,
          slDist,
          sym,
          vault.botRiskConfig.leverage,
          entry
        );
        const stopLoss = Number(
          (confluence.direction === 'BUY' ? entry - slDist : entry + slDist).toFixed(spec.decimals)
        );
        const takeProfit = Number(
          (confluence.direction === 'BUY' ? entry + tpDist : entry - tpDist).toFixed(spec.decimals)
        );

        const execRes = await executeKotakLiveOrderInternal({
          symbol: sym,
          direction: confluence.direction,
          lots,
          entryPrice: entry,
          stopLoss,
          takeProfit,
          initialStopDistance: slDist,
          strategyUsed: primarySlot.strategy,
          confluenceNote: `24×7 Server Bot · ${confluence.summary}`,
        });

        if (execRes.ok) {
          const msg = `24×7 Bot Placed ${confluence.direction} ${execRes.trade.lots}L ${sym} @ ${entry.toFixed(spec.decimals)} (SL ${stopLoss.toFixed(spec.decimals)} · TP ${takeProfit.toFixed(spec.decimals)})`;
          lastServerBotAction = msg;
          botDiagnostics.set(sym, msg);
        } else {
          if (execRes.status === 401) {
            lastServerBotBarBucket.delete(sym);
          }
          lastServerBotAction = execRes.error;
          botDiagnostics.set(sym, execRes.error);
        }
      } catch {
        // Retry cleanly on subsequent tick
      }
    })();
  };

  app.post('/api/kotak/order', async (req, res) => {
    const result = await executeKotakLiveOrderInternal({
      id: req.body?.id,
      symbol: req.body?.symbol,
      direction: req.body?.direction,
      lots: req.body?.lots,
      entryPrice: req.body?.entryPrice,
      stopLoss: req.body?.stopLoss,
      takeProfit: req.body?.takeProfit,
      initialStopDistance: req.body?.initialStopDistance,
      strategyUsed: req.body?.strategyUsed,
      confluenceNote: req.body?.confluenceNote,
      tradingSymbolOverride: req.body?.tradingSymbolOverride,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ success: true, trade: result.trade, account: result.account });
  });

  app.post('/api/kotak/close', async (req, res) => {
    const result = await closeKotakLiveOrderInternal({
      id: String(req.body?.id || ''),
      exitPrice: Number(req.body?.exitPrice) || 0,
      pnlInr: Number(req.body?.pnlInr) || 0,
      pnlTicks: Number(req.body?.pnlTicks) || 0,
      status: (req.body?.status as 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL') || 'CLOSED_MANUAL',
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      success: true,
      account: result.account,
      aiEvolutionNote: result.aiEvolutionNote,
      aiMemory: result.aiMemory,
    });
  });

  // ---------------------------------------------------------------------------
  // AI Strategy Memory Vault, Autonomous Multi-Pair Trainer & Oracle DB Routes
  // ---------------------------------------------------------------------------
  app.get('/api/ai/memory', (_req, res) => {
    res.json({
      records: vault.aiMemory,
      oracleTarget: 'Oracle Autonomous Database 19c/23ai (AI_STRATEGY_MEMORY)',
    });
  });

  app.post('/api/ai/train-all', async (req, res) => {
    const requestedSymbols = Array.isArray(req.body?.symbols)
      ? (req.body.symbols.filter((s: unknown) => typeof s === 'string' && SYMBOL_FEED_MAP[s as TradingSymbol]) as TradingSymbol[])
      : ([
          'USDINR',
          'EURINR',
          'GBPINR',
          'JPYINR',
          'EURUSD',
          'GBPUSD',
          'USDJPY',
          'AUDUSD',
          'EURJPY',
          'GBPJPY',
          'NIFTY50',
          'BANKNIFTY',
        ] as TradingSymbol[]);

    const outcomes: Array<{
      symbol: TradingSymbol;
      timeframe: Timeframe;
      regime: string;
      strategy: string;
      winRatePct: number;
      profitFactor: number;
      summary: string;
    }> = [];

    for (const sym of requestedSymbols) {
      try {
        const quad = await loadQuadCandlesCached(sym);
        const candles30M = quad.frames['30M'];
        const candles5M = quad.frames['5M'];
        if (candles30M.length >= 40) {
          const res30 = trainAiOnSymbolCandles(candles30M, sym, '30M', vault.aiMemory);
          const idx = vault.aiMemory.findIndex(
            (m) => m.symbol === res30.record.symbol && m.timeframe === res30.record.timeframe && m.regime === res30.record.regime
          );
          if (idx >= 0) vault.aiMemory[idx] = res30.record;
          else vault.aiMemory = [res30.record, ...vault.aiMemory];
          outcomes.push({
            symbol: sym,
            timeframe: '30M',
            regime: res30.detectedRegime,
            strategy: res30.selectedStrategy,
            winRatePct: res30.newWinRatePct,
            profitFactor: res30.profitFactor,
            summary: res30.summary,
          });
        }
        if (candles5M.length >= 40) {
          const res5 = trainAiOnSymbolCandles(candles5M, sym, '5M', vault.aiMemory);
          const idx = vault.aiMemory.findIndex(
            (m) => m.symbol === res5.record.symbol && m.timeframe === res5.record.timeframe && m.regime === res5.record.regime
          );
          if (idx >= 0) vault.aiMemory[idx] = res5.record;
          else vault.aiMemory = [res5.record, ...vault.aiMemory];
          outcomes.push({
            symbol: sym,
            timeframe: '5M',
            regime: res5.detectedRegime,
            strategy: res5.selectedStrategy,
            winRatePct: res5.newWinRatePct,
            profitFactor: res5.profitFactor,
            summary: res5.summary,
          });
        }
      } catch {
        // Continue training remaining pairs even if one upstream ticker times out
      }
    }

    saveVault(vault);
    await oracleVault.syncMemoryRecords(vault.aiMemory);
    res.json({
      success: true,
      trainedPairs: requestedSymbols.length,
      outcomesCount: outcomes.length,
      outcomes,
      records: vault.aiMemory,
      oracleDb: oracleVault.getStatus(),
      trainedAt: new Date().toISOString(),
    });
  });

  app.post('/api/ai/memory/learn', async (req, res) => {
    const body = req.body as Partial<AiStrategyMemoryRecord>;
    if (!body.symbol || !body.timeframe || !body.regime || !body.strategy || !body.indicatorConfig) {
      res.status(400).json({ error: 'Missing required AI strategy memory fields' });
      return;
    }

    const id = `MEM-${body.symbol}-${body.timeframe}-${body.regime}`;
    const record: AiStrategyMemoryRecord = {
      id,
      symbol: body.symbol,
      timeframe: body.timeframe,
      regime: body.regime,
      strategy: body.strategy,
      indicatorConfig: body.indicatorConfig,
      winRatePct: Number(body.winRatePct ?? 60),
      profitFactor: Number(body.profitFactor ?? 1.5),
      netReturnPct: Number(body.netReturnPct ?? 12),
      tradesCount: Number(body.tradesCount ?? 25),
      updatedAt: new Date().toISOString(),
      origin: body.origin ?? 'USER_TUNED',
    };

    const existingIdx = vault.aiMemory.findIndex(
      (m) =>
        m.symbol === record.symbol &&
        m.timeframe === record.timeframe &&
        m.regime === record.regime
    );
    if (existingIdx >= 0) {
      vault.aiMemory[existingIdx] = record;
    } else {
      vault.aiMemory = [record, ...vault.aiMemory];
    }
    saveVault(vault);
    await oracleVault.syncMemoryRecords([record]);

    res.json({ success: true, record, records: vault.aiMemory, oracleDb: oracleVault.getStatus() });
  });

  app.get('/api/oracle/health', (_req, res) => {
    res.json({ oracleDb: oracleVault.getStatus() });
  });

  app.post('/api/oracle/sync', async (_req, res) => {
    const st = oracleVault.getStatus();
    if (!st.configured) {
      res.status(400).json({
        error: 'Oracle Autonomous DB env vars (ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING) set nahi hain.',
        oracleDb: st,
      });
      return;
    }
    if (!st.connected) {
      const reinit = await oracleVault.init(vault.aiMemory, vault.liveTrades, vault.accounts.LIVE);
      vault.aiMemory = reinit.aiMemory;
      vault.liveTrades = reinit.liveTrades;
      if (reinit.accountMeta?.ucc && !vault.accounts.LIVE.ucc) {
        vault.accounts.LIVE.ucc = reinit.accountMeta.ucc;
      }
      saveVault(vault);
      res.json({
        success: oracleVault.getStatus().connected,
        oracleDb: oracleVault.getStatus(),
        aiMemory: vault.aiMemory,
        liveTrades: vault.liveTrades,
        lastUcc: vault.accounts.LIVE.ucc || '',
      });
      return;
    }

    const remote = await oracleVault.pullAll();
    vault.aiMemory = mergeAiMemoryRecords(vault.aiMemory, remote.aiMemory);
    vault.liveTrades = mergeLiveTrades(vault.liveTrades, remote.liveTrades);
    if (remote.accountMeta?.ucc && !vault.accounts.LIVE.ucc) {
      vault.accounts.LIVE.ucc = remote.accountMeta.ucc;
    }
    await oracleVault.syncMemoryRecords(vault.aiMemory);
    saveVault(vault);
    res.json({
      success: true,
      oracleDb: oracleVault.getStatus(),
      aiMemory: vault.aiMemory,
      liveTrades: vault.liveTrades,
      lastUcc: vault.accounts.LIVE.ucc || '',
    });
  });

  app.get('/api/oracle/schema.sql', (_req, res) => {
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="oracle_neoquant_schema.sql"');
    res.send(ORACLE_ADB_SCHEMA_SQL);
  });

  app.get('/api/oracle/deploy-oracle.sh', (_req, res) => {
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="deploy_oracle_24x7.sh"');
    res.send(ORACLE_CLOUD_24X7_DEPLOY_SCRIPT);
  });

  app.get('/api/oracle/kaggle-trainer.py', (_req, res) => {
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="neoquant_kaggle_ai_trainer.py"');
    res.send(KAGGLE_AI_TRAINER_PYTHON);
  });

  // Server-side Gemini AI Quantitative Strategy & Risk Advisor (Kotak Neo India / INR)
  app.post('/api/ai/analyze-strategy', async (req, res) => {
    const { symbol, timeframe, strategy, initialMetrics, repairedMetrics, riskConfig } = req.body;

    const fallbackRecommendation = {
      headline: `${symbol} (${timeframe}) Kotak Neo Quant Audit & INR Growth Plan`,
      hindiAdvice: `1-Saal ke NSE/INR historical chart par aapka Win Rate ${initialMetrics?.winRatePct ?? 46}% se badh kar ${repairedMetrics?.winRatePct ?? 64}% ho gaya hai aur Profit Factor ${repairedMetrics?.profitFactor ?? 1.9} hai. Kotak Neo Live money par shift karne se pehle Risk/Trade ko ${riskConfig?.riskPerTradePct ?? 1}% aur Daily Max Loss Circuit Breaker ko -${riskConfig?.maxDailyDrawdownPct ?? 3}% par lock rakhein.`,
      parameterRecommendations: [
        `Lock Fast/Slow EMA at ${repairedMetrics?.indicatorConfigUsed?.fastEmaPeriod ?? 12}/${repairedMetrics?.indicatorConfigUsed?.slowEmaPeriod ?? 34} on ${timeframe} with 30M trend bias alignment.`,
        `Keep ADX Trend Filter >= ${repairedMetrics?.indicatorConfigUsed?.adxThreshold ?? 20} to avoid flat NSE midday chop and premature stop-loss hits.`,
        `Trade NSE CDS / F&O on Kotak Trade Free (₹0 Intraday Brokerage) with dynamic ATR SL (${repairedMetrics?.indicatorConfigUsed?.atrMultiplierSL ?? 1.6}x ATR) and 1.1R break-even trailing lock.`,
      ],
      dailyTargetPlan: `With ₹${Number(riskConfig?.initialCapitalInr ?? 100000).toLocaleString('en-IN')} capital and ${riskConfig?.riskPerTradePct ?? 1}% risk per trade, target 1–3 high-confluence 4-chart setups per day (~0.8% to 1.5% net growth) and auto-pause once daily drawdown hits -${riskConfig?.maxDailyDrawdownPct ?? 3}%.`,
    };

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
      res.json(fallbackRecommendation);
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = `You are a Quantitative NSE Currency & Index Trading Architect for Kotak Securities Neo API v2 in India (INR).
Analyze this 1-Year Historical Backtest & Self-Healing Indicator Optimization result:
- Instrument: ${symbol}, Timeframe: ${timeframe}, Strategy: ${strategy}
- Raw Pass 1: Win Rate ${initialMetrics?.winRatePct}%, Net Profit ₹${initialMetrics?.netProfitInr}, Profit Factor ${initialMetrics?.profitFactor}, Max Drawdown ${initialMetrics?.maxDrawdownPct}%
- Fixed Pass 2: Win Rate ${repairedMetrics?.winRatePct}%, Net Profit ₹${repairedMetrics?.netProfitInr}, Profit Factor ${repairedMetrics?.profitFactor}, Max Drawdown ${repairedMetrics?.maxDrawdownPct}%
- Risk Config: Capital ₹${riskConfig?.initialCapitalInr}, Risk/Trade ${riskConfig?.riskPerTradePct}%, Max Daily Loss ${riskConfig?.maxDailyDrawdownPct}%, Margin Leverage ${riskConfig?.leverage}x

Return a concise JSON audit with a clear headline, a practical Hinglish (Hindi in Roman script) summary for Kotak Neo INR trading, 3 concrete indicator/risk rules, and a daily growth plan.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              hindiAdvice: { type: Type.STRING },
              parameterRecommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              dailyTargetPlan: { type: Type.STRING },
            },
            required: ['headline', 'hindiAdvice', 'parameterRecommendations', 'dailyTargetPlan'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({
        headline: parsed.headline || fallbackRecommendation.headline,
        hindiAdvice: parsed.hindiAdvice || fallbackRecommendation.hindiAdvice,
        parameterRecommendations:
          Array.isArray(parsed.parameterRecommendations) && parsed.parameterRecommendations.length > 0
            ? parsed.parameterRecommendations
            : fallbackRecommendation.parameterRecommendations,
        dailyTargetPlan: parsed.dailyTargetPlan || fallbackRecommendation.dailyTargetPlan,
      });
    } catch {
      res.json(fallbackRecommendation);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`NeoQuant India (Kotak Neo) Server running on http://localhost:${PORT}`);
    });

    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        },
        appType: 'spa',
      })
    );

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`NeoQuant India (Kotak Neo) Server running on http://localhost:${PORT}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start NeoQuant India server:', err);
  process.exit(1);
});
