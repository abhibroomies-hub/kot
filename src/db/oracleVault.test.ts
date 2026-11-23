import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAiMemoryRecords,
  mergeLiveTrades,
  parseOracleEnvConfig,
  StoredLiveTrade,
} from './oracleVault';
import { STRATEGY_CATALOG } from '../engine/backtestEngine';
import { AiStrategyMemoryRecord } from '../engine/types';

test('parseOracleEnvConfig detects LOCAL_FALLBACK, ONE_WAY_TLS, and MTLS_WALLET modes cleanly', () => {
  const empty = parseOracleEnvConfig({});
  assert.equal(empty.configured, false);
  assert.equal(empty.mode, 'LOCAL_FALLBACK');

  const tls = parseOracleEnvConfig({
    ORACLE_USER: 'ADMIN',
    ORACLE_PASSWORD: 'SecretPassword123#',
    ORACLE_CONNECT_STRING: '(description=(retry_count=20)(address=(protocol=tcps)(port=1521)(host=adb.ap-mumbai-1.oraclecloud.com))(connect_data=(service_name=g123_neoquantdb_high.adb.oraclecloud.com)))',
  });
  assert.equal(tls.configured, true);
  assert.equal(tls.mode, 'ONE_WAY_TLS');
  assert.match(tls.hostHint ?? '', /adb\.ap-mumbai-1\.oraclecloud\.com/);

  const wallet = parseOracleEnvConfig({
    ORACLE_USER: 'ADMIN',
    ORACLE_PASSWORD: 'SecretPassword123#',
    ORACLE_CONNECT_STRING: 'neoquantdb_high',
    ORACLE_WALLET_DIR: '/opt/oracle/wallet',
    ORACLE_WALLET_PASSWORD: 'WalletPass123#',
  });
  assert.equal(wallet.configured, true);
  assert.equal(wallet.mode, 'MTLS_WALLET');
});

test('mergeAiMemoryRecords keeps newest updatedAt rule across AI Studio and Oracle VM', () => {
  const baseCfg = STRATEGY_CATALOG[0].defaultRawConfig;
  const local: AiStrategyMemoryRecord[] = [
    {
      id: 'MEM-USDINR-5M-TRENDING_CHANNEL',
      symbol: 'USDINR',
      timeframe: '5M',
      regime: 'TRENDING_CHANNEL',
      strategy: 'EMA_RSI_CONFLUENCE',
      indicatorConfig: baseCfg,
      winRatePct: 60.0,
      profitFactor: 1.7,
      netReturnPct: 12.0,
      tradesCount: 20,
      updatedAt: '2026-11-19T08:00:00.000Z',
      origin: 'BACKTEST_AUTOFIX',
    },
  ];
  const remote: AiStrategyMemoryRecord[] = [
    {
      ...local[0],
      winRatePct: 71.5,
      profitFactor: 2.35,
      updatedAt: '2026-11-19T09:30:00.000Z',
      origin: 'LIVE_ADAPTATION',
    },
    {
      id: 'MEM-EURUSD-30M-BREAKOUT_SQUEEZE',
      symbol: 'EURUSD',
      timeframe: '30M',
      regime: 'BREAKOUT_SQUEEZE',
      strategy: 'SMART_MONEY_BREAKOUT',
      indicatorConfig: baseCfg,
      winRatePct: 66.2,
      profitFactor: 2.01,
      netReturnPct: 18.4,
      tradesCount: 44,
      updatedAt: '2026-11-19T09:15:00.000Z',
      origin: 'LIVE_ADAPTATION',
    },
  ];

  const merged = mergeAiMemoryRecords(local, remote);
  assert.equal(merged.length, 2);
  const usdinr = merged.find((m) => m.symbol === 'USDINR');
  assert.equal(usdinr?.winRatePct, 71.5);
  assert.equal(usdinr?.origin, 'LIVE_ADAPTATION');
});

test('mergeLiveTrades prioritizes closed trade record over stale open record', () => {
  const openLocal: StoredLiveTrade = {
    id: 'NEO-1001',
    brokerOrderId: 'KTK-991',
    brokerMode: 'LIVE',
    symbol: 'USDINR',
    direction: 'BUY',
    lots: 2,
    entryPrice: 84.42,
    stopLoss: 84.35,
    takeProfit: 84.55,
    pnlInr: 0,
    pnlTicks: 0,
    status: 'OPEN',
    strategyUsed: 'EMA_RSI_CONFLUENCE',
    ts: 1700000000000,
  };
  const closedRemote: StoredLiveTrade = {
    ...openLocal,
    exitPrice: 84.55,
    pnlInr: 260,
    pnlTicks: 52,
    status: 'CLOSED_TP',
  };

  const merged = mergeLiveTrades([openLocal], [closedRemote]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'CLOSED_TP');
  assert.equal(merged[0].pnlInr, 260);
});
