export type TradingSymbol =
  | 'USDINR'
  | 'EURINR'
  | 'GBPINR'
  | 'JPYINR'
  | 'EURUSD'
  | 'GBPUSD'
  | 'USDJPY'
  | 'AUDUSD'
  | 'USDCAD'
  | 'USDCHF'
  | 'EURGBP'
  | 'EURJPY'
  | 'GBPJPY'
  | 'AUDINR'
  | 'CADINR'
  | 'CHFINR'
  | 'NIFTY50'
  | 'BANKNIFTY'
  | 'FINNIFTY'
  | 'GOLDPETAL'
  | 'GOLDM'
  | 'GOLD'
  | 'SILVERMIC'
  | 'CRUDEOILM'
  | 'XAUUSD';

export type Timeframe = '30S' | '1M' | '5M' | '15M' | '30M' | '1H';

export type QuadTimeframe = '30M' | '5M' | '1M' | '30S';

export type StrategyArchetype =
  | 'EMA_RSI_CONFLUENCE'
  | 'SMART_MONEY_BREAKOUT'
  | 'BOLLINGER_MEAN_REVERSION'
  | 'SCALPER_30S_MOMENTUM';

export type MarketPatternRegime =
  | 'TRENDING_CHANNEL'
  | 'BREAKOUT_SQUEEZE'
  | 'MEAN_REVERTING_RANGE'
  | 'HIGH_VELOCITY_SCALP';

export type BrokerMode = 'LIVE';

export type SymbolGroup =
  | 'MCX_COMMODITY'
  | 'NSE_CDS_INR'
  | 'NSE_CDS_CROSS'
  | 'GLOBAL_FX'
  | 'INR_CROSS'
  | 'NSE_INDEX';

export interface SymbolSpec {
  symbol: TradingSymbol;
  name: string;
  exchange: 'NSE_CDS' | 'NSE_FNO' | 'MCX_FO' | 'GLOBAL_FX';
  group: SymbolGroup;
  category: 'Currency' | 'Index' | 'Commodity';
  tickSize: number;
  lotUnits: number; // e.g. 1000 USD for USDINR, 75 qty for NIFTY50
  valuePerTickInr: number; // INR P&L per 1 tick on 1 Lot
  inrPerPointPerLot: number; // INR P&L per 1.00 price move on 1 Lot
  typicalSpreadTicks: number;
  basePrice: number;
  marginPerLotInr: number;
  annualDrift: number;
  volatility: number;
  decimals: number;
}

export interface Candle {
  time: number; // Unix timestamp ms
  dateStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  fastEma?: number;
  slowEma?: number;
  rsi?: number;
  atr?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  adx?: number;
}

export interface IndicatorConfig {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  atrPeriod: number;
  atrMultiplierSL: number;
  atrMultiplierTP: number;
  bollingerPeriod: number;
  bollingerStdDev: number;
  adxPeriod: number;
  adxThreshold: number;
  useAdxFilter: boolean;
  useSessionFilter: boolean;
  useHigherTimeframeTrend: boolean;
}

export interface RiskConfig {
  initialCapitalInr: number;
  riskPerTradePct: number;
  maxDailyDrawdownPct: number;
  maxDailyProfitTargetPct: number;
  leverage: 1 | 5 | 10 | 20 | 35;
  trailingStopEnabled: boolean;
  breakEvenTriggerR: number;
  brokerageTier: 'Kotak Trade Free (₹0 Intraday)' | 'Kotak Trade Free Pro (₹10/order)';
}

export interface BacktestTrade {
  id: string;
  candleIndex: number;
  exitCandleIndex: number;
  entryTime: number;
  exitTime: number;
  entryDate: string;
  exitDate: string;
  symbol: TradingSymbol;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  lots: number;
  profitInr: number;
  profitTicks: number;
  returnPct: number;
  rMultiple: number;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'SIGNAL_EXIT';
  marketRegime: 'TRENDING' | 'VOLATILE_BREAKOUT' | 'RANGING_CHOP';
}

export interface EquityPoint {
  time: number;
  dateStr: string;
  equity: number;
  balance: number;
  drawdownPct: number;
  benchmarkEquity: number;
}

export interface MonthlyPerformance {
  month: string;
  label: string;
  profitInr: number;
  returnPct: number;
  winRatePct: number;
  tradesCount: number;
  maxDdPct: number;
}

export interface IndicatorFixDiagnostic {
  id: string;
  indicatorName: string;
  problemDetected: string;
  hindiExplanation: string;
  oldValue: string;
  newValue: string;
  impactMetric: string;
}

export interface BacktestResult {
  symbol: TradingSymbol;
  timeframe: Timeframe;
  strategy: StrategyArchetype;
  periodStart: string;
  periodEnd: string;
  totalDays: number;
  totalCandlesSimulated: number;
  initialCapitalInr: number;
  finalEquityInr: number;
  netProfitInr: number;
  netReturnPct: number;
  grossProfitInr: number;
  grossLossInr: number;
  profitFactor: number;
  winRatePct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdownInr: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  expectancyInr: number;
  avgWinInr: number;
  avgLossInr: number;
  avgDailyReturnPct: number;
  estimatedMonthlyReturnPct: number;
  circuitBreakerSaves: number;
  passedSafetyGate: boolean;
  safetyReasons: string[];
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  monthlyBreakdown: MonthlyPerformance[];
  candles: Candle[];
  indicatorConfigUsed: IndicatorConfig;
  dataSource?:
    | 'KOTAK_NEO_LIVE'
    | 'YAHOO_REAL'
    | 'KRAKEN_DERIVED'
    | 'SWISSQUOTE_DERIVED'
    | 'CUSTOM_CSV'
    | 'OFFLINE_FALLBACK';
  tickerLabel?: string;
}

export interface OptimizationComparison {
  initialPass: BacktestResult;
  repairedPass: BacktestResult;
  diagnostics: IndicatorFixDiagnostic[];
  improvementSummary: {
    winRateDeltaPct: number;
    profitFactorDelta: number;
    drawdownReductionPct: number;
    netProfitDeltaInr: number;
    verdictText: string;
    verdictHindi: string;
  };
}

export interface KotakAccountProfile {
  id: string;
  label: string;
  mode: BrokerMode;
  brokerName: 'Kotak Securities Neo API v2';
  exchangeSegment: 'NSE_CDS' | 'NSE_FO' | 'MCX_FO';
  ucc: string;
  mobile: string;
  consumerKeyMasked: string;
  brokerageTier: 'Kotak Trade Free (₹0 Intraday)' | 'Kotak Trade Free Pro (₹10/order)';
  balanceInr: number;
  equityInr: number;
  usedMarginInr?: number;
  leverage: 1 | 5 | 10 | 20 | 35;
  connected: boolean;
  sessionState: 'DISCONNECTED' | 'NEO_LIVE_AUTHENTICATED';
  lastHeartbeat: string;
}

export interface LiveMarketQuote {
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

export interface LiveBotTrade {
  id: string;
  symbol: TradingSymbol;
  direction: 'BUY' | 'SELL';
  lots: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  initialStopDistance?: number;
  breakEvenLocked?: boolean;
  trailingActivated?: boolean;
  targetStepCount?: number;
  pnlInr: number;
  pnlTicks: number;
  openedAt: string;
  status: 'OPEN' | 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL';
  brokerMode: BrokerMode;
  strategyUsed: StrategyArchetype;
  confluenceNote?: string;
  brokerOrderId?: string;
}

export interface CompoundingMilestone {
  day: number;
  dateLabel: string;
  startingEquityInr: number;
  dailyProfitInr: number;
  endingEquityInr: number;
  totalReturnPct: number;
  recommendedLots: number;
  dailyMaxRiskInr: number;
}

export interface QuadChartSlotConfig {
  timeframe: QuadTimeframe;
  strategy: StrategyArchetype;
  indicatorConfig: IndicatorConfig;
  autoAdapt: boolean;
  detectedRegime: MarketPatternRegime;
  patternLabel: string;
  liveSignal: 'BUY' | 'SELL' | null;
}

export interface WorkspaceTabState {
  tabId: string;
  title: string;
  symbol: TradingSymbol;
  autoBotActive: boolean;
  aiAutoAdaptAll: boolean;
  slots: Record<QuadTimeframe, QuadChartSlotConfig>;
}

export interface AiStrategyMemoryRecord {
  id: string;
  symbol: TradingSymbol;
  timeframe: Timeframe;
  regime: MarketPatternRegime;
  strategy: StrategyArchetype;
  indicatorConfig: IndicatorConfig;
  winRatePct: number;
  profitFactor: number;
  netReturnPct: number;
  tradesCount: number;
  updatedAt: string;
  origin: 'BACKTEST_AUTOFIX' | 'LIVE_ADAPTATION' | 'USER_TUNED';
}

export interface ScannerOpportunity {
  symbol: TradingSymbol;
  price: number;
  bid: number;
  ask: number;
  changePct: number;
  source: string;
  direction: 'BUY' | 'SELL' | 'WAIT';
  confidencePct: number;
  alignedTimeframes: number;
  patternLabel: string;
  regime: MarketPatternRegime;
  recommendedStrategy: StrategyArchetype;
  recommendedConfig: IndicatorConfig;
  reason: string;
  updatedAt: number;
}

export interface OracleDbStatusInfo {
  configured: boolean;
  connected: boolean;
  mode: 'ONE_WAY_TLS' | 'MTLS_WALLET' | 'LOCAL_FALLBACK';
  lastSyncAt: string | null;
  rulesCount: number;
  tradesCount: number;
  error: string | null;
  hostHint: string | null;
}

