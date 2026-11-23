import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDIAN_SYMBOLS,
  STRATEGY_CATALOG,
  SYMBOL_GROUPS,
  generateOneYearHistoricalData,
} from './backtestEngine';
import {
  evolveIndicatorConfigFromOutcome,
  trainAiOnSymbolCandles,
} from './aiTrainer';
import { TradingSymbol } from './types';

test('all 19 currency and NSE index pairs are registered in INDIAN_SYMBOLS and SYMBOL_GROUPS', () => {
  const allKeys = Object.keys(INDIAN_SYMBOLS) as TradingSymbol[];
  assert.equal(allKeys.length, 19);

  const groupedSymbols = SYMBOL_GROUPS.flatMap((g) => g.symbols);
  assert.equal(groupedSymbols.length, 19);
  assert.equal(new Set(groupedSymbols).size, 19);

  for (const sym of allKeys) {
    const spec = INDIAN_SYMBOLS[sym];
    assert.ok(spec.basePrice > 0, `${sym} basePrice > 0`);
    assert.ok(spec.tickSize > 0, `${sym} tickSize > 0`);
    assert.ok(spec.lotUnits > 0, `${sym} lotUnits > 0`);
    assert.ok(spec.decimals >= 2 && spec.decimals <= 5, `${sym} decimals valid`);
  }
});

test('trainAiOnSymbolCandles evaluates strategies and returns upgraded Oracle memory record', () => {
  const candles = generateOneYearHistoricalData('EURUSD', '5M', 10);
  const outcome = trainAiOnSymbolCandles(candles.slice(-180), 'EURUSD', '5M', []);

  assert.equal(outcome.symbol, 'EURUSD');
  assert.equal(outcome.timeframe, '5M');
  assert.ok(Number.isFinite(outcome.newWinRatePct) && outcome.newWinRatePct > 0);
  assert.ok(Number.isFinite(outcome.profitFactor) && outcome.profitFactor >= 0);
  assert.ok(outcome.selectedConfig.fastEmaPeriod < outcome.selectedConfig.slowEmaPeriod);
  assert.equal(outcome.record.symbol, 'EURUSD');
  assert.equal(outcome.record.origin, 'LIVE_ADAPTATION');
});

test('evolveIndicatorConfigFromOutcome tightens filters on SL and expands TP on win', () => {
  const base = STRATEGY_CATALOG[0].defaultRawConfig;

  const afterLoss = evolveIndicatorConfigFromOutcome(base, 'CLOSED_SL', -1450);
  assert.equal(afterLoss.nextConfig.useAdxFilter, true);
  assert.ok(afterLoss.nextConfig.adxThreshold > base.adxThreshold);
  assert.ok(afterLoss.nextConfig.atrMultiplierSL > base.atrMultiplierSL);
  assert.match(afterLoss.note, /Loss-Recovery Adaptation/);

  const afterWin = evolveIndicatorConfigFromOutcome(base, 'CLOSED_TP', 2800);
  assert.ok(afterWin.nextConfig.atrMultiplierTP > base.atrMultiplierTP);
  assert.match(afterWin.note, /Winning Reinforcement/);
});
