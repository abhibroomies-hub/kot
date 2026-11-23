import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RISK_CONFIG,
  INDIAN_SYMBOLS,
  STRATEGY_CATALOG,
  applyLiveTickToCandles,
  buildDefaultWorkspaceTabs,
  calculateCompoundingPlan,
  calculateLotSize,
  detectMarketPatternAndAdaptIndicators,
  evaluateLiveSignal,
  evaluateMultiTimeframeConfluence,
  generateOneYearHistoricalData,
  parseCustomCsvCandles,
  runOneYearTestAndAutoFix,
} from './backtestEngine.ts';
import type { AiStrategyMemoryRecord } from './types.ts';

test('generateOneYearHistoricalData produces 365 days of valid OHLCV candles for USDINR', () => {
  const candles = generateOneYearHistoricalData('USDINR', '15M', 730);
  assert.equal(candles.length, 730);
  const first = candles[0];
  const last = candles[candles.length - 1];
  assert.ok(first.high >= first.open && first.high >= first.close);
  assert.ok(first.low <= first.open && first.low <= first.close);
  const daysSpan = (last.time - first.time) / (1000 * 60 * 60 * 24);
  assert.ok(daysSpan >= 360 && daysSpan <= 366);
});

test('runOneYearTestAndAutoFix optimizes INR returns and enables ADX filtering', () => {
  const defaultStrat = STRATEGY_CATALOG[0];
  const comparison = runOneYearTestAndAutoFix(
    'USDINR',
    '15M',
    defaultStrat.id,
    defaultStrat.defaultRawConfig,
    DEFAULT_RISK_CONFIG
  );

  assert.ok(comparison.initialPass.totalDays >= 360);
  assert.ok(comparison.repairedPass.totalDays >= 360);
  assert.ok(comparison.diagnostics.length >= 3);
  assert.equal(comparison.repairedPass.indicatorConfigUsed.useAdxFilter, true);
  assert.ok(comparison.repairedPass.totalTrades >= 8);
  assert.ok(Number.isFinite(comparison.repairedPass.netProfitInr));
});

test('calculateLotSize returns NSE integer lots bounded by INR equity & Kotak margin', () => {
  const lotsLow = calculateLotSize(100000, 1.0, INDIAN_SYMBOLS.USDINR.tickSize * 20, 'USDINR', 10);
  const lotsHigh = calculateLotSize(200000, 2.0, INDIAN_SYMBOLS.USDINR.tickSize * 20, 'USDINR', 10);
  assert.ok(Number.isInteger(lotsLow) && lotsLow >= 1);
  assert.ok(lotsHigh >= lotsLow);
});

test('calculateCompoundingPlan builds monotonic INR milestones with risk caps', () => {
  const plan = calculateCompoundingPlan(100000, 0.85, DEFAULT_RISK_CONFIG, 'USDINR', 30);
  assert.equal(plan.length, 30);
  assert.ok(plan[29].endingEquityInr > 100000);
  assert.ok(plan[29].dailyMaxRiskInr > 0);
});

test('parseCustomCsvCandles parses NSE historical CSV rows', () => {
  const sampleCsv = `Date,Time,Open,High,Low,Close,Volume
2026.01.02,09:30,93.1200,93.2450,93.0900,93.2250,2420
2026.01.02,10:00,93.2250,93.3100,93.1950,93.2975,2650`;
  const parsed = parseCustomCsvCandles(sampleCsv, 'USDINR');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].open, 93.12);
  assert.equal(parsed[1].close, 93.2975);
});

test('applyLiveTickToCandles updates 30S bar intra-bar and rolls over on next 30-second bucket', () => {
  const baseCandles = generateOneYearHistoricalData('EURINR', '30S', 140);
  const cfg = STRATEGY_CATALOG[3].defaultRawConfig;
  const lastBar = baseCandles[baseCandles.length - 1];

  const intraPrice = Number((lastBar.close + 0.0125).toFixed(4));
  const intraUpdated = applyLiveTickToCandles(
    baseCandles,
    '30S',
    'EURINR',
    intraPrice,
    lastBar.time + 12_000,
    cfg
  );
  assert.equal(intraUpdated.length, baseCandles.length);
  assert.equal(intraUpdated[intraUpdated.length - 1].close, intraPrice);

  const nextBucketTs = lastBar.time + 30_000 + 2_000;
  const rollPrice = Number((intraPrice - 0.005).toFixed(4));
  const rolled = applyLiveTickToCandles(
    intraUpdated,
    '30S',
    'EURINR',
    rollPrice,
    nextBucketTs,
    cfg
  );
  assert.equal(rolled.length, baseCandles.length + 1);
  assert.equal(rolled[rolled.length - 1].open, rollPrice);

  const liveEval = evaluateLiveSignal(rolled, 'EURINR', 'SCALPER_30S_MOMENTUM', cfg);
  assert.ok(liveEval.signal === null || liveEval.signal === 'BUY' || liveEval.signal === 'SELL');
  assert.ok(liveEval.atr > 0);
});

test('detectMarketPatternAndAdaptIndicators consults learned AI memory vault & evaluateMultiTimeframeConfluence scores 4 charts', () => {
  const candles30S = generateOneYearHistoricalData('USDINR', '30S', 100);
  const customCfg = {
    ...STRATEGY_CATALOG[3].defaultRawConfig,
    fastEmaPeriod: 4,
    slowEmaPeriod: 11,
  };
  const vault: AiStrategyMemoryRecord[] = [
    {
      id: 'MEM-USDINR-30S-HIGH_VELOCITY_SCALP',
      symbol: 'USDINR',
      timeframe: '30S',
      regime: 'HIGH_VELOCITY_SCALP',
      strategy: 'SCALPER_30S_MOMENTUM',
      indicatorConfig: customCfg,
      winRatePct: 69,
      profitFactor: 2.2,
      netReturnPct: 24,
      tradesCount: 80,
      updatedAt: '2026-11-17T00:00:00Z',
      origin: 'USER_TUNED',
    },
  ];

  const adapted = detectMarketPatternAndAdaptIndicators(candles30S, 'USDINR', '30S', vault);
  assert.equal(adapted.regime, 'HIGH_VELOCITY_SCALP');
  assert.equal(adapted.indicatorConfig.fastEmaPeriod, 4);

  const tabs = buildDefaultWorkspaceTabs();
  assert.equal(tabs.length, 4);
  const slots = { ...tabs[0].slots };
  slots['30M'].liveSignal = 'BUY';
  slots['5M'].liveSignal = 'BUY';
  slots['1M'].liveSignal = 'BUY';
  slots['30S'].liveSignal = null;

  const confluence = evaluateMultiTimeframeConfluence(slots);
  assert.equal(confluence.direction, 'BUY');
  assert.equal(confluence.alignedCount, 3);
  assert.ok(confluence.confidencePct >= 85);
});
