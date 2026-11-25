import oracledb from 'oracledb';
import {
  AiStrategyMemoryRecord,
  BrokerMode,
  IndicatorConfig,
  KotakAccountProfile,
  MarketPatternRegime,
  StrategyArchetype,
  Timeframe,
  TradingSymbol,
} from '../engine/types.ts';

export interface StoredLiveTrade {
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
  pnlInr: number;
  pnlTicks: number;
  status: 'OPEN' | 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL';
  strategyUsed: string;
  confluenceNote?: string;
  exchangeVerified?: boolean;
  kotakOrderStatus?: string;
  exchangeOrderId?: string;
  ts: number;
}

export interface OracleAccountSyncMeta {
  ucc: string;
  exchangeSegment: 'NSE_CDS' | 'NSE_FO' | 'MCX_FO';
  brokerageTier: string;
  balanceInr: number;
  equityInr: number;
  lastHeartbeat: string;
}

export interface OracleDbStatus {
  configured: boolean;
  connected: boolean;
  mode: 'ONE_WAY_TLS' | 'MTLS_WALLET' | 'LOCAL_FALLBACK';
  lastSyncAt: string | null;
  rulesCount: number;
  tradesCount: number;
  error: string | null;
  hostHint: string | null;
}

export interface ParsedOracleEnv {
  configured: boolean;
  mode: 'ONE_WAY_TLS' | 'MTLS_WALLET' | 'LOCAL_FALLBACK';
  user: string;
  password: string;
  connectString: string;
  walletDir?: string;
  walletPassword?: string;
  hostHint: string | null;
}

export function parseOracleEnvConfig(
  env: Record<string, string | undefined>
): ParsedOracleEnv {
  const user = (env.ORACLE_USER || '').trim();
  const password = (env.ORACLE_PASSWORD || '').trim();
  const connectString = (env.ORACLE_CONNECT_STRING || '').trim();
  const walletDir = (env.ORACLE_WALLET_DIR || '').trim() || undefined;
  const walletPassword = (env.ORACLE_WALLET_PASSWORD || '').trim() || undefined;

  if (!user || !password || !connectString) {
    return {
      configured: false,
      mode: 'LOCAL_FALLBACK',
      user: '',
      password: '',
      connectString: '',
      hostHint: null,
    };
  }

  // Extract safe host hint for UI diagnostics (never exposes password)
  const hostMatch = connectString.match(/host=([^)\s]+)/i);
  const serviceMatch = connectString.match(/service_name=([^)\s]+)/i);
  const hostHint = hostMatch
    ? `${hostMatch[1]}${serviceMatch ? ` / ${serviceMatch[1]}` : ''}`
    : connectString.slice(0, 48);

  const mode = walletDir ? 'MTLS_WALLET' : 'ONE_WAY_TLS';
  return {
    configured: true,
    mode,
    user,
    password,
    connectString,
    walletDir,
    walletPassword,
    hostHint,
  };
}

/**
 * Pure bidirectional merge for AI_STRATEGY_MEMORY across AI Studio & Oracle VM.
 * Keeps the newest updatedAt record for each (symbol, timeframe, regime) tuple.
 */
export function mergeAiMemoryRecords(
  local: AiStrategyMemoryRecord[],
  remote: AiStrategyMemoryRecord[]
): AiStrategyMemoryRecord[] {
  const byKey = new Map<string, AiStrategyMemoryRecord>();
  const keyOf = (r: AiStrategyMemoryRecord) => `${r.symbol}::${r.timeframe}::${r.regime}`;
  const tsOf = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };

  for (const r of local) {
    byKey.set(keyOf(r), r);
  }
  for (const r of remote) {
    const k = keyOf(r);
    const existing = byKey.get(k);
    if (!existing || tsOf(r.updatedAt) >= tsOf(existing.updatedAt)) {
      byKey.set(k, r);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => tsOf(b.updatedAt) - tsOf(a.updatedAt));
}

/**
 * Pure bidirectional merge for KOTAK_TRADE_LOG across AI Studio & Oracle VM.
 * Closed trade status takes precedence over stale OPEN status for the same trade ID.
 */
export function mergeLiveTrades(
  local: StoredLiveTrade[],
  remote: StoredLiveTrade[]
): StoredLiveTrade[] {
  const byId = new Map<string, StoredLiveTrade>();
  const rank = (s: StoredLiveTrade['status']) => (s === 'OPEN' ? 0 : 1);

  for (const t of local) {
    byId.set(t.id, t);
  }
  for (const t of remote) {
    const existing = byId.get(t.id);
    if (!existing) {
      byId.set(t.id, t);
    } else if (rank(t.status) > rank(existing.status) || (rank(t.status) === rank(existing.status) && t.ts >= existing.ts)) {
      byId.set(t.id, t);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 200);
}

const CREATE_TABLE_STATEMENTS = [
  `BEGIN
     EXECUTE IMMEDIATE '
       CREATE TABLE AI_STRATEGY_MEMORY (
         RECORD_ID        VARCHAR2(96) PRIMARY KEY,
         SYMBOL           VARCHAR2(24) NOT NULL,
         TIMEFRAME        VARCHAR2(8)  NOT NULL,
         MARKET_REGIME    VARCHAR2(48) NOT NULL,
         STRATEGY_NAME    VARCHAR2(64) NOT NULL,
         INDICATOR_JSON   CLOB         NOT NULL,
         WIN_RATE_PCT     NUMBER(6,2)  DEFAULT 0,
         PROFIT_FACTOR    NUMBER(6,2)  DEFAULT 0,
         NET_RETURN_PCT   NUMBER(8,2)  DEFAULT 0,
         TRADES_COUNT     NUMBER(10)   DEFAULT 0,
         ORIGIN           VARCHAR2(32) DEFAULT ''LIVE_ADAPTATION'',
         UPDATED_AT       VARCHAR2(48) NOT NULL
       )';
   EXCEPTION
     WHEN OTHERS THEN
       IF SQLCODE != -955 THEN RAISE; END IF;
   END;`,
  `BEGIN
     EXECUTE IMMEDIATE '
       CREATE TABLE KOTAK_TRADE_LOG (
         TRADE_ID         VARCHAR2(64) PRIMARY KEY,
         BROKER_ORDER_ID  VARCHAR2(64),
         BROKER_MODE      VARCHAR2(16) DEFAULT ''LIVE'',
         SYMBOL           VARCHAR2(24) NOT NULL,
         DIRECTION        VARCHAR2(8)  NOT NULL,
         LOTS             NUMBER(10)   NOT NULL,
         ENTRY_PRICE      NUMBER(14,5) NOT NULL,
         EXIT_PRICE       NUMBER(14,5),
         STOP_LOSS        NUMBER(14,5) NOT NULL,
         TAKE_PROFIT      NUMBER(14,5) NOT NULL,
         PNL_INR          NUMBER(14,2) DEFAULT 0,
         PNL_TICKS        NUMBER(10,2) DEFAULT 0,
         STATUS           VARCHAR2(24) NOT NULL,
         STRATEGY_USED    VARCHAR2(64),
         CONFLUENCE_NOTE  VARCHAR2(256),
         CREATED_TS       NUMBER(18)   NOT NULL
       )';
   EXCEPTION
     WHEN OTHERS THEN
       IF SQLCODE != -955 THEN RAISE; END IF;
   END;`,
  `BEGIN
     EXECUTE IMMEDIATE '
       CREATE TABLE NEOQUANT_ACCOUNT_SYNC (
         PROFILE_KEY      VARCHAR2(32) PRIMARY KEY,
         KOTAK_UCC        VARCHAR2(32),
         EXCHANGE_SEGMENT VARCHAR2(16) DEFAULT ''NSE_CDS'',
         BROKERAGE_TIER   VARCHAR2(80),
         BALANCE_INR      NUMBER(14,2) DEFAULT 0,
         EQUITY_INR       NUMBER(14,2) DEFAULT 0,
         LAST_HEARTBEAT   VARCHAR2(64),
         UPDATED_AT       VARCHAR2(48) NOT NULL
       )';
   EXCEPTION
     WHEN OTHERS THEN
       IF SQLCODE != -955 THEN RAISE; END IF;
   END;`,
];

export class OracleVaultClient {
  private pool: oracledb.Pool | null = null;
  private status: OracleDbStatus = {
    configured: false,
    connected: false,
    mode: 'LOCAL_FALLBACK',
    lastSyncAt: null,
    rulesCount: 0,
    tradesCount: 0,
    error: null,
    hostHint: null,
  };

  getStatus(): OracleDbStatus {
    return { ...this.status };
  }

  async init(
    seedMemory: AiStrategyMemoryRecord[],
    seedTrades: StoredLiveTrade[],
    seedAccount?: KotakAccountProfile
  ): Promise<{
    aiMemory: AiStrategyMemoryRecord[];
    liveTrades: StoredLiveTrade[];
    accountMeta: OracleAccountSyncMeta | null;
  }> {
    const cfg = parseOracleEnvConfig(process.env);
    this.status.configured = cfg.configured;
    this.status.mode = cfg.mode;
    this.status.hostHint = cfg.hostHint;

    if (!cfg.configured) {
      this.status.connected = false;
      this.status.error = null;
      return { aiMemory: seedMemory, liveTrades: seedTrades, accountMeta: null };
    }

    try {
      oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
      oracledb.fetchAsString = [oracledb.CLOB];

      const poolAttrs: oracledb.PoolAttributes = {
        user: cfg.user,
        password: cfg.password,
        connectString: cfg.connectString,
        poolMin: 1,
        poolMax: 4,
        poolIncrement: 1,
        connectTimeout: 12,
      };
      if (cfg.walletDir) {
        poolAttrs.configDir = cfg.walletDir;
        poolAttrs.walletLocation = cfg.walletDir;
        if (cfg.walletPassword) {
          poolAttrs.walletPassword = cfg.walletPassword;
        }
      }

      this.pool = await oracledb.createPool(poolAttrs);
      await this.ensureSchema();

      this.status.connected = true;
      this.status.error = null;

      const remote = await this.pullAll();
      const mergedMemory = mergeAiMemoryRecords(seedMemory, remote.aiMemory);
      const mergedTrades = mergeLiveTrades(seedTrades, remote.liveTrades);

      // Push initial seed/local rules if Oracle DB had fewer or older records
      if (remote.aiMemory.length === 0 && mergedMemory.length > 0) {
        await this.syncMemoryRecords(mergedMemory);
      }
      if (seedAccount?.ucc && !remote.accountMeta?.ucc) {
        await this.syncAccountMeta(seedAccount);
      }

      this.status.rulesCount = mergedMemory.length;
      this.status.tradesCount = mergedTrades.length;
      this.status.lastSyncAt = new Date().toISOString();

      return {
        aiMemory: mergedMemory,
        liveTrades: mergedTrades,
        accountMeta: remote.accountMeta,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status.connected = false;
      this.status.error = msg.slice(0, 220);
      return { aiMemory: seedMemory, liveTrades: seedTrades, accountMeta: null };
    }
  }

  private async ensureSchema(): Promise<void> {
    if (!this.pool) return;
    let conn: oracledb.Connection | null = null;
    try {
      conn = await this.pool.getConnection();
      for (const plsql of CREATE_TABLE_STATEMENTS) {
        await conn.execute(plsql);
      }
      await conn.commit();
    } finally {
      if (conn) await conn.close();
    }
  }

  async pullAll(): Promise<{
    aiMemory: AiStrategyMemoryRecord[];
    liveTrades: StoredLiveTrade[];
    accountMeta: OracleAccountSyncMeta | null;
  }> {
    if (!this.pool) {
      return { aiMemory: [], liveTrades: [], accountMeta: null };
    }
    let conn: oracledb.Connection | null = null;
    try {
      conn = await this.pool.getConnection();

      const memRes = await conn.execute<Record<string, unknown>>(
        `SELECT RECORD_ID, SYMBOL, TIMEFRAME, MARKET_REGIME, STRATEGY_NAME, INDICATOR_JSON,
                WIN_RATE_PCT, PROFIT_FACTOR, NET_RETURN_PCT, TRADES_COUNT, ORIGIN, UPDATED_AT
         FROM AI_STRATEGY_MEMORY`
      );
      const aiMemory: AiStrategyMemoryRecord[] = [];
      for (const row of memRes.rows ?? []) {
        try {
          const parsedCfg = JSON.parse(String(row.INDICATOR_JSON || '{}')) as IndicatorConfig;
          aiMemory.push({
            id: String(row.RECORD_ID),
            symbol: String(row.SYMBOL) as TradingSymbol,
            timeframe: String(row.TIMEFRAME) as Timeframe,
            regime: String(row.MARKET_REGIME) as MarketPatternRegime,
            strategy: String(row.STRATEGY_NAME) as StrategyArchetype,
            indicatorConfig: parsedCfg,
            winRatePct: Number(row.WIN_RATE_PCT ?? 0),
            profitFactor: Number(row.PROFIT_FACTOR ?? 0),
            netReturnPct: Number(row.NET_RETURN_PCT ?? 0),
            tradesCount: Number(row.TRADES_COUNT ?? 0),
            origin: (String(row.ORIGIN || 'LIVE_ADAPTATION') as AiStrategyMemoryRecord['origin']),
            updatedAt: String(row.UPDATED_AT || new Date().toISOString()),
          });
        } catch {
          // Skip malformed JSON row
        }
      }

      const trRes = await conn.execute<Record<string, unknown>>(
        `SELECT TRADE_ID, BROKER_ORDER_ID, BROKER_MODE, SYMBOL, DIRECTION, LOTS,
                ENTRY_PRICE, EXIT_PRICE, STOP_LOSS, TAKE_PROFIT, PNL_INR, PNL_TICKS,
                STATUS, STRATEGY_USED, CONFLUENCE_NOTE, CREATED_TS
         FROM KOTAK_TRADE_LOG
         ORDER BY CREATED_TS DESC
         FETCH FIRST 200 ROWS ONLY`
      );
      const liveTrades: StoredLiveTrade[] = (trRes.rows ?? []).map((row) => ({
        id: String(row.TRADE_ID),
        brokerOrderId: String(row.BROKER_ORDER_ID || row.TRADE_ID),
        brokerMode: 'LIVE',
        symbol: String(row.SYMBOL) as TradingSymbol,
        direction: String(row.DIRECTION) === 'SELL' ? 'SELL' : 'BUY',
        lots: Number(row.LOTS ?? 1),
        entryPrice: Number(row.ENTRY_PRICE ?? 0),
        exitPrice: row.EXIT_PRICE != null ? Number(row.EXIT_PRICE) : undefined,
        stopLoss: Number(row.STOP_LOSS ?? 0),
        takeProfit: Number(row.TAKE_PROFIT ?? 0),
        pnlInr: Number(row.PNL_INR ?? 0),
        pnlTicks: Number(row.PNL_TICKS ?? 0),
        status: (String(row.STATUS || 'OPEN') as StoredLiveTrade['status']),
        strategyUsed: String(row.STRATEGY_USED || 'EMA_RSI_CONFLUENCE'),
        confluenceNote: row.CONFLUENCE_NOTE ? String(row.CONFLUENCE_NOTE) : undefined,
        ts: Number(row.CREATED_TS ?? Date.now()),
      }));

      const accRes = await conn.execute<Record<string, unknown>>(
        `SELECT KOTAK_UCC, EXCHANGE_SEGMENT, BROKERAGE_TIER, BALANCE_INR, EQUITY_INR, LAST_HEARTBEAT
         FROM NEOQUANT_ACCOUNT_SYNC
         WHERE PROFILE_KEY = 'PRIMARY_LIVE'`
      );
      const accRow = accRes.rows?.[0];
      const accountMeta: OracleAccountSyncMeta | null = accRow
        ? {
            ucc: String(accRow.KOTAK_UCC || ''),
            exchangeSegment:
              String(accRow.EXCHANGE_SEGMENT) === 'NSE_FO'
                ? 'NSE_FO'
                : String(accRow.EXCHANGE_SEGMENT) === 'MCX_FO'
                ? 'MCX_FO'
                : 'NSE_CDS',
            brokerageTier: String(accRow.BROKERAGE_TIER || 'Kotak Trade Free (₹0 Intraday)'),
            balanceInr: Number(accRow.BALANCE_INR ?? 0),
            equityInr: Number(accRow.EQUITY_INR ?? 0),
            lastHeartbeat: String(accRow.LAST_HEARTBEAT || ''),
          }
        : null;

      this.status.connected = true;
      this.status.error = null;
      this.status.rulesCount = aiMemory.length;
      this.status.tradesCount = liveTrades.length;
      this.status.lastSyncAt = new Date().toISOString();

      return { aiMemory, liveTrades, accountMeta };
    } catch (err) {
      this.status.error = err instanceof Error ? err.message.slice(0, 220) : String(err);
      return { aiMemory: [], liveTrades: [], accountMeta: null };
    } finally {
      if (conn) await conn.close();
    }
  }

  async syncMemoryRecords(records: AiStrategyMemoryRecord[]): Promise<void> {
    if (!this.pool || records.length === 0) return;
    let conn: oracledb.Connection | null = null;
    try {
      conn = await this.pool.getConnection();
      for (const rec of records) {
        const recordId = `MEM-${rec.symbol}-${rec.timeframe}-${rec.regime}`;
        await conn.execute(
          `MERGE INTO AI_STRATEGY_MEMORY dst
           USING (SELECT :recordId AS RECORD_ID FROM DUAL) src
           ON (dst.RECORD_ID = src.RECORD_ID)
           WHEN MATCHED THEN UPDATE SET
             STRATEGY_NAME  = :strategy,
             INDICATOR_JSON = :indicatorJson,
             WIN_RATE_PCT   = :winRate,
             PROFIT_FACTOR  = :pf,
             NET_RETURN_PCT = :netRet,
             TRADES_COUNT   = :tradesCount,
             ORIGIN         = :origin,
             UPDATED_AT     = :updatedAt
           WHEN NOT MATCHED THEN INSERT (
             RECORD_ID, SYMBOL, TIMEFRAME, MARKET_REGIME, STRATEGY_NAME, INDICATOR_JSON,
             WIN_RATE_PCT, PROFIT_FACTOR, NET_RETURN_PCT, TRADES_COUNT, ORIGIN, UPDATED_AT
           ) VALUES (
             :recordId, :symbol, :timeframe, :regime, :strategy, :indicatorJson,
             :winRate, :pf, :netRet, :tradesCount, :origin, :updatedAt
           )`,
          {
            recordId,
            symbol: rec.symbol,
            timeframe: rec.timeframe,
            regime: rec.regime,
            strategy: rec.strategy,
            indicatorJson: JSON.stringify(rec.indicatorConfig),
            winRate: rec.winRatePct,
            pf: rec.profitFactor,
            netRet: rec.netReturnPct,
            tradesCount: rec.tradesCount,
            origin: rec.origin,
            updatedAt: rec.updatedAt,
          }
        );
      }
      await conn.commit();
      this.status.lastSyncAt = new Date().toISOString();
      this.status.error = null;
    } catch (err) {
      this.status.error = err instanceof Error ? err.message.slice(0, 220) : String(err);
    } finally {
      if (conn) await conn.close();
    }
  }

  async syncTradeRecord(trade: StoredLiveTrade): Promise<void> {
    if (!this.pool) return;
    let conn: oracledb.Connection | null = null;
    try {
      conn = await this.pool.getConnection();
      await conn.execute(
        `MERGE INTO KOTAK_TRADE_LOG dst
         USING (SELECT :tradeId AS TRADE_ID FROM DUAL) src
         ON (dst.TRADE_ID = src.TRADE_ID)
         WHEN MATCHED THEN UPDATE SET
           EXIT_PRICE      = :exitPrice,
           PNL_INR         = :pnlInr,
           PNL_TICKS       = :pnlTicks,
           STATUS          = :status,
           BROKER_ORDER_ID = :brokerOrderId
         WHEN NOT MATCHED THEN INSERT (
           TRADE_ID, BROKER_ORDER_ID, BROKER_MODE, SYMBOL, DIRECTION, LOTS,
           ENTRY_PRICE, EXIT_PRICE, STOP_LOSS, TAKE_PROFIT, PNL_INR, PNL_TICKS,
           STATUS, STRATEGY_USED, CONFLUENCE_NOTE, CREATED_TS
         ) VALUES (
           :tradeId, :brokerOrderId, :brokerMode, :symbol, :direction, :lots,
           :entryPrice, :exitPrice, :stopLoss, :takeProfit, :pnlInr, :pnlTicks,
           :status, :strategyUsed, :confluenceNote, :createdTs
         )`,
        {
          tradeId: trade.id,
          brokerOrderId: trade.brokerOrderId,
          brokerMode: trade.brokerMode,
          symbol: trade.symbol,
          direction: trade.direction,
          lots: trade.lots,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice ?? null,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          pnlInr: trade.pnlInr,
          pnlTicks: trade.pnlTicks,
          status: trade.status,
          strategyUsed: trade.strategyUsed,
          confluenceNote: trade.confluenceNote ? trade.confluenceNote.slice(0, 250) : null,
          createdTs: trade.ts,
        }
      );
      await conn.commit();
      this.status.lastSyncAt = new Date().toISOString();
      this.status.error = null;
    } catch (err) {
      this.status.error = err instanceof Error ? err.message.slice(0, 220) : String(err);
    } finally {
      if (conn) await conn.close();
    }
  }

  async syncAccountMeta(acc: KotakAccountProfile): Promise<void> {
    if (!this.pool || !acc.ucc) return;
    let conn: oracledb.Connection | null = null;
    try {
      conn = await this.pool.getConnection();
      await conn.execute(
        `MERGE INTO NEOQUANT_ACCOUNT_SYNC dst
         USING (SELECT 'PRIMARY_LIVE' AS PROFILE_KEY FROM DUAL) src
         ON (dst.PROFILE_KEY = src.PROFILE_KEY)
         WHEN MATCHED THEN UPDATE SET
           KOTAK_UCC        = :ucc,
           EXCHANGE_SEGMENT = :segment,
           BROKERAGE_TIER   = :tier,
           BALANCE_INR      = :balanceInr,
           EQUITY_INR       = :equityInr,
           LAST_HEARTBEAT   = :heartbeat,
           UPDATED_AT       = :updatedAt
         WHEN NOT MATCHED THEN INSERT (
           PROFILE_KEY, KOTAK_UCC, EXCHANGE_SEGMENT, BROKERAGE_TIER,
           BALANCE_INR, EQUITY_INR, LAST_HEARTBEAT, UPDATED_AT
         ) VALUES (
           'PRIMARY_LIVE', :ucc, :segment, :tier,
           :balanceInr, :equityInr, :heartbeat, :updatedAt
         )`,
        {
          ucc: acc.ucc,
          segment: acc.exchangeSegment,
          tier: acc.brokerageTier,
          balanceInr: acc.balanceInr,
          equityInr: acc.equityInr,
          heartbeat: acc.lastHeartbeat.slice(0, 60),
          updatedAt: new Date().toISOString(),
        }
      );
      await conn.commit();
      this.status.lastSyncAt = new Date().toISOString();
      this.status.error = null;
    } catch (err) {
      this.status.error = err instanceof Error ? err.message.slice(0, 220) : String(err);
    } finally {
      if (conn) await conn.close();
    }
  }
}

export const oracleVault = new OracleVaultClient();
