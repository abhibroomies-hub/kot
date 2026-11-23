import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AiStrategyMemoryRecord,
  BacktestResult,
  BrokerMode,
  Candle,
  IndicatorConfig,
  KotakAccountProfile,
  LiveBotTrade,
  LiveMarketQuote,
  OptimizationComparison,
  OracleDbStatusInfo,
  QuadTimeframe,
  RiskConfig,
  ScannerOpportunity,
  StrategyArchetype,
  Timeframe,
  TradingSymbol,
  WorkspaceTabState,
} from './engine/types';
import {
  DEFAULT_RISK_CONFIG,
  INDIAN_SYMBOLS,
  STRATEGY_CATALOG,
  SYMBOL_GROUPS,
  applyLiveTickToCandles,
  buildDefaultWorkspaceTabs,
  calculateLotSize,
  detectMarketPatternAndAdaptIndicators,
  evaluateLiveSignal,
  evaluateMultiTimeframeConfluence,
  formatInr,
  generateOneYearHistoricalData,
  parseCustomCsvCandles,
  runBacktestOnCandles,
  runOneYearTestAndAutoFix,
  timeframeToMs,
} from './engine/backtestEngine';
import { QuadChartCell } from './components/QuadChartCell';
import { HistoricalChartCanvas } from './components/HistoricalChartCanvas';
import { StrategyIndicatorFixer } from './components/StrategyIndicatorFixer';
import { RiskAndGrowthPlanner } from './components/RiskAndGrowthPlanner';
import { KotakConnectAndOracle } from './components/KotakConnectAndOracle';
import { KotakLoginGate } from './components/KotakLoginGate';
import {
  AlertCircle,
  Bot,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  Database,
  LayoutGrid,
  LogOut,
  Pin,
  PinOff,
  Play,
  Plus,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';

type ActiveView = 'QUAD_DESK' | 'BACKTEST_FIXER' | 'RISK_MARGIN' | 'KOTAK_ORACLE';

const QUAD_FRAMES: QuadTimeframe[] = ['30M', '5M', '1M', '30S'];
const EXTRA_TAB_CANDIDATES: TradingSymbol[] = [
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'GBPJPY',
  'AUDINR',
  'NIFTY50',
  'BANKNIFTY',
  'USDINR',
  'EURINR',
  'GBPINR',
  'JPYINR',
];

export default function App() {
  // Navigation & Edge Auto-Hide Rails
  const [activeView, setActiveView] = useState<ActiveView>('QUAD_DESK');
  const [leftHover, setLeftHover] = useState(false);
  const [leftPinned, setLeftPinned] = useState(false);
  const [rightHover, setRightHover] = useState(false);
  const [rightPinned, setRightPinned] = useState(false);
  const [mobileScannerOpen, setMobileScannerOpen] = useState(false);

  const leftExpanded = leftPinned || leftHover;
  const rightExpanded = rightPinned || rightHover;

  // 4 Concurrent Multi-Currency Workspace Tabs
  const [tabs, setTabs] = useState<WorkspaceTabState[]>(() => buildDefaultWorkspaceTabs());
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const activeTab = useMemo(
    () => tabs.find((t) => t.tabId === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );
  const activeSymbol = activeTab.symbol;

  // Real-Time 4-Timeframe Candles Cache per Symbol
  const [quadCandlesBySymbol, setQuadCandlesBySymbol] = useState<
    Partial<Record<TradingSymbol, Record<QuadTimeframe, Candle[]>>>
  >({});
  const quadCandlesRef = useRef<Partial<Record<TradingSymbol, Record<QuadTimeframe, Candle[]>>>>({});

  // Kotak Neo LIVE Authentication, AI Memory Vault, Risk & Orders (Zero Paper Simulator)
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [lastUcc, setLastUcc] = useState<string>('');
  const [liveAccount, setLiveAccount] = useState<KotakAccountProfile>({
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
  });

  const isKotakLoggedIn =
    liveAccount.connected && liveAccount.sessionState === 'NEO_LIVE_AUTHENTICATED';

  const [riskConfig, setRiskConfig] = useState<RiskConfig>(DEFAULT_RISK_CONFIG);
  const [aiMemory, setAiMemory] = useState<AiStrategyMemoryRecord[]>([]);
  const aiMemoryRef = useRef<AiStrategyMemoryRecord[]>([]);
  const [oracleDb, setOracleDb] = useState<OracleDbStatusInfo | null>(null);
  const [liveTrades, setLiveTrades] = useState<LiveBotTrade[]>([]);
  const liveTradesRef = useRef<LiveBotTrade[]>([]);
  const [kotakOrderBookCount, setKotakOrderBookCount] = useState<number>(0);

  // Live Quotes & SSE Stream State
  const [quotesBySymbol, setQuotesBySymbol] = useState<Partial<Record<TradingSymbol, LiveMarketQuote>>>({});
  const [kotakContracts, setKotakContracts] = useState<Record<string, string>>({});
  const [quadRefreshNonce, setQuadRefreshNonce] = useState<number>(0);
  const [quadFetchError, setQuadFetchError] = useState<string | null>(null);
  const [chartEngine, setChartEngine] = useState<'TV_QUANT' | 'TRADINGVIEW_DIRECT'>('TV_QUANT');
  const [streamStatus, setStreamStatus] = useState<'CONNECTING' | 'LIVE' | 'RECONNECTING'>('CONNECTING');
  const [statusNotice, setStatusNotice] = useState<string>(
    'Kotak Neo LIVE · Syncing Real Market Feed (IST)'
  );

  // Right Edge Background AI Scanner State
  const [scannerOpportunities, setScannerOpportunities] = useState<ScannerOpportunity[]>([]);
  const [autoPromoteScanner, setAutoPromoteScanner] = useState<boolean>(false);
  const lastAutoPromotedRef = useRef<string>('');

  // 1-Year Backtest & Fixer Lab State
  const [btTimeframe, setBtTimeframe] = useState<Timeframe>('15M');
  const [btStrategy, setBtStrategy] = useState<StrategyArchetype>('EMA_RSI_CONFLUENCE');
  const [customCsvCandles, setCustomCsvCandles] = useState<Candle[] | undefined>(undefined);
  const [btHistoryCandles, setBtHistoryCandles] = useState<Candle[] | undefined>(undefined);
  const [btMarketMeta, setBtMarketMeta] = useState<{
    dataSource: BacktestResult['dataSource'];
    tickerLabel?: string;
  }>({ dataSource: 'OFFLINE_FALLBACK' });
  const [isLoadingBtData, setIsLoadingBtData] = useState<boolean>(false);
  const [btMarketError, setBtMarketError] = useState<string | null>(null);
  const [btFetchNonce, setBtFetchNonce] = useState<number>(0);

  const initialComparison = useMemo(
    () =>
      runOneYearTestAndAutoFix(
        'USDINR',
        '15M',
        'EMA_RSI_CONFLUENCE',
        STRATEGY_CATALOG[0].defaultRawConfig,
        DEFAULT_RISK_CONFIG,
        generateOneYearHistoricalData('USDINR', '15M', 60),
        { dataSource: 'OFFLINE_FALLBACK' }
      ),
    []
  );
  const [comparison, setComparison] = useState<OptimizationComparison>(initialComparison);
  const [customIndicatorConfig, setCustomIndicatorConfig] = useState<IndicatorConfig>(
    initialComparison.repairedPass.indicatorConfigUsed
  );
  const [activePassView, setActivePassView] = useState<'REPAIRED' | 'INITIAL'>('REPAIRED');
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgressPct, setReplayProgressPct] = useState(100);
  const [aiAudit, setAiAudit] = useState<{
    headline: string;
    hindiAdvice: string;
    parameterRecommendations: string[];
    dailyTargetPlan: string;
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Operational Refs for zero-delay tick loop
  const tabsRef = useRef<WorkspaceTabState[]>(tabs);
  const activeTabIdRef = useRef<string>(activeTabId);
  const riskConfigRef = useRef<RiskConfig>(riskConfig);
  const quotesRef = useRef<Partial<Record<TradingSymbol, LiveMarketQuote>>>(quotesBySymbol);
  const equityRef = useRef<number>(liveAccount.equityInr);
  const lastBotBarBucketRef = useRef<Record<string, number>>({});

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => {
    equityRef.current = liveAccount.equityInr;
  }, [liveAccount.equityInr]);
  useEffect(() => {
    riskConfigRef.current = riskConfig;
  }, [riskConfig]);
  useEffect(() => {
    aiMemoryRef.current = aiMemory;
  }, [aiMemory]);

  const isStrategyVerified = comparison.repairedPass.passedSafetyGate;
  const activeSpec = INDIAN_SYMBOLS[activeSymbol];
  const activeQuote = quotesBySymbol[activeSymbol] ?? null;

  const syncKotakOrderBook = useCallback(() => {
    fetch('/api/kotak/orders')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.orders)) {
          setKotakOrderBookCount(data.orders.length);
        }
      })
      .catch(() => {});
  }, []);

  // Load Kotak Neo Live Session Status + AI Strategy Memory Vault on Mount
  useEffect(() => {
    fetch('/api/kotak/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (typeof data.lastUcc === 'string') {
          setLastUcc(data.lastUcc);
        }
        if (data.accounts?.LIVE) {
          setLiveAccount(data.accounts.LIVE);
          if (
            data.accounts.LIVE.connected &&
            data.accounts.LIVE.sessionState === 'NEO_LIVE_AUTHENTICATED'
          ) {
            setStatusNotice(
              `Kotak Neo LIVE Connected (UCC ${data.accounts.LIVE.ucc}) · Live NSE Feed Active`
            );
            syncKotakOrderBook();
          }
        }
        if (data.kotakContracts && typeof data.kotakContracts === 'object') {
          setKotakContracts(data.kotakContracts);
        }
        if (Array.isArray(data.aiMemory)) {
          setAiMemory(data.aiMemory);
          aiMemoryRef.current = data.aiMemory;
        }
        if (data.oracleDb && typeof data.oracleDb === 'object') {
          setOracleDb(data.oracleDb);
        }
        if (Array.isArray(data.liveTrades)) {
          const mapped: LiveBotTrade[] = data.liveTrades
            .filter((t: Record<string, unknown>) => t.brokerMode === 'LIVE')
            .map((t: Record<string, unknown>) => ({
              id: String(t.id),
              symbol: t.symbol as TradingSymbol,
              direction: (t.direction === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
              lots: Number(t.lots) || 1,
              entryPrice: Number(t.entryPrice) || 0,
              currentPrice: Number(t.exitPrice ?? t.entryPrice) || 0,
              stopLoss: Number(t.stopLoss) || 0,
              takeProfit: Number(t.takeProfit) || 0,
              pnlInr: Number(t.pnlInr) || 0,
              pnlTicks: Number(t.pnlTicks) || 0,
              openedAt: new Date(Number(t.ts) || Date.now()).toLocaleTimeString(),
              status: (t.status as LiveBotTrade['status']) || 'OPEN',
              brokerMode: 'LIVE' as BrokerMode,
              strategyUsed: (t.strategyUsed as StrategyArchetype) || 'EMA_RSI_CONFLUENCE',
              confluenceNote: t.confluenceNote ? String(t.confluenceNote) : undefined,
              brokerOrderId: t.brokerOrderId ? String(t.brokerOrderId) : undefined,
            }));
          liveTradesRef.current = mapped;
          setLiveTrades(mapped);
        }
      })
      .catch(() => {})
      .finally(() => {
        setAuthChecked(true);
      });
  }, [syncKotakOrderBook]);

  // Load 4-Timeframe Real Quad Candles (30M, 5M, 1M, 30S) ONLY AFTER Kotak Neo LIVE Login
  const openSymbolsKey = useMemo(
    () => Array.from(new Set(tabs.map((t) => t.symbol))).sort().join(','),
    [tabs]
  );

  useEffect(() => {
    if (!isKotakLoggedIn) return;
    const uniqueSymbols = openSymbolsKey.split(',').filter(Boolean) as TradingSymbol[];
    const prioritized = [
      activeSymbol,
      ...uniqueSymbols.filter((s) => s !== activeSymbol),
    ].filter((s) => uniqueSymbols.includes(s));

    prioritized.forEach((sym) => {
      if (quadCandlesRef.current[sym]) return;

      fetch(`/api/market/quad?symbol=${encodeURIComponent(sym)}`)
        .then(async (r) => {
          const data = await r.json().catch(() => null);
          if (!r.ok || !data?.frames) {
            throw new Error(data?.error || `Real market feed unavailable for ${sym}`);
          }
          return data;
        })
        .then((data) => {
          setQuadFetchError(null);
          const baseFrames: Record<QuadTimeframe, Candle[]> = {
            '30M': data.frames['30M'] ?? [],
            '5M': data.frames['5M'] ?? [],
            '1M': data.frames['1M'] ?? [],
            '30S': data.frames['30S'] ?? [],
          };

          const tabForSym =
            tabsRef.current.find((t) => t.tabId === activeTabIdRef.current && t.symbol === sym) ??
            tabsRef.current.find((t) => t.symbol === sym);

          const adaptedByTf: Partial<Record<QuadTimeframe, {
            strategy: StrategyArchetype;
            indicatorConfig: IndicatorConfig;
            regime: ReturnType<typeof detectMarketPatternAndAdaptIndicators>['regime'];
            patternLabel: string;
            liveSignal: 'BUY' | 'SELL' | null;
          }>> = {};

          const enrichedFrames: Record<QuadTimeframe, Candle[]> = { ...baseFrames };
          QUAD_FRAMES.forEach((tf) => {
            const raw = baseFrames[tf];
            const slot = tabForSym?.slots[tf];
            if (raw.length >= 30 && slot) {
              const adapted = slot.autoAdapt
                ? detectMarketPatternAndAdaptIndicators(raw, sym, tf, aiMemoryRef.current)
                : {
                    regime: slot.detectedRegime,
                    patternLabel: slot.patternLabel,
                    strategy: slot.strategy,
                    indicatorConfig: slot.indicatorConfig,
                  };
              const enriched = applyLiveTickToCandles(
                raw,
                tf,
                sym,
                raw[raw.length - 1].close,
                raw[raw.length - 1].time,
                adapted.indicatorConfig
              );
              enrichedFrames[tf] = enriched;
              const sig = evaluateLiveSignal(enriched, sym, adapted.strategy, adapted.indicatorConfig);
              adaptedByTf[tf] = {
                strategy: adapted.strategy,
                indicatorConfig: adapted.indicatorConfig,
                regime: adapted.regime,
                patternLabel: adapted.patternLabel,
                liveSignal: sig.signal,
              };
            }
          });

          quadCandlesRef.current = { ...quadCandlesRef.current, [sym]: enrichedFrames };
          setQuadCandlesBySymbol({ ...quadCandlesRef.current });

          setTabs((prevTabs) =>
            prevTabs.map((tab) => {
              if (tab.symbol !== sym) return tab;
              const nextSlots = { ...tab.slots };
              QUAD_FRAMES.forEach((tf) => {
                const a = adaptedByTf[tf];
                if (a && tab.slots[tf].autoAdapt) {
                  nextSlots[tf] = {
                    ...tab.slots[tf],
                    strategy: a.strategy,
                    indicatorConfig: a.indicatorConfig,
                    detectedRegime: a.regime,
                    patternLabel: a.patternLabel,
                    liveSignal: a.liveSignal,
                  };
                }
              });
              return { ...tab, slots: nextSlots };
            })
          );
        })
        .catch((err) => {
          if (sym === activeSymbol) {
            setQuadFetchError(
              err instanceof Error
                ? err.message
                : `Unable to load real market candles for ${sym}`
            );
          }
        });
    });
  }, [isKotakLoggedIn, openSymbolsKey, activeSymbol, quadRefreshNonce]);

  const settleBalanceInr = useCallback((_mode: BrokerMode, pnlInr: number) => {
    setLiveAccount((acc) => {
      const nextBal = Number(Math.max(0, acc.balanceInr + pnlInr).toFixed(2));
      return {
        ...acc,
        balanceInr: nextBal,
        equityInr: nextBal,
        lastHeartbeat: new Date().toLocaleTimeString(),
      };
    });
  }, []);

  const placeKotakOrder = useCallback(
    (
      sym: TradingSymbol,
      direction: 'BUY' | 'SELL',
      quoteOverride?: LiveMarketQuote | null,
      confluenceNote?: string,
      atrOverride?: number
    ) => {
      const spec = INDIAN_SYMBOLS[sym];
      const tabForSym =
        tabsRef.current.find((t) => t.tabId === activeTabIdRef.current && t.symbol === sym) ??
        tabsRef.current.find((t) => t.symbol === sym) ??
        tabsRef.current[0];

      const primarySlot = tabForSym.slots['1M'];
      const cfg = primarySlot.indicatorConfig;
      const frames = quadCandlesRef.current[sym];
      const latestBar = frames?.['1M']?.[frames['1M'].length - 1];
      const q = quoteOverride ?? quotesRef.current[sym];

      const entryRaw =
        q != null ? (direction === 'BUY' ? q.ask : q.bid) : latestBar?.close ?? spec.basePrice;
      const entry = Number(entryRaw.toFixed(spec.decimals));
      const atrBase = atrOverride ?? latestBar?.atr ?? spec.tickSize * 16;
      const slDist = Math.max(spec.tickSize * 6, atrBase * cfg.atrMultiplierSL);
      const tpDist = Math.max(spec.tickSize * 10, atrBase * cfg.atrMultiplierTP);
      const mode: BrokerMode = 'LIVE';

      const lots = calculateLotSize(
        Math.max(5000, equityRef.current),
        riskConfigRef.current.riskPerTradePct,
        slDist,
        sym,
        riskConfigRef.current.leverage,
        entry
      );

      const stopLoss = Number(
        (direction === 'BUY' ? entry - slDist : entry + slDist).toFixed(spec.decimals)
      );
      const takeProfit = Number(
        (direction === 'BUY' ? entry + tpDist : entry - tpDist).toFixed(spec.decimals)
      );

      const tradeId = `NEO-${Date.now().toString().slice(-6)}`;
      const newTrade: LiveBotTrade = {
        id: tradeId,
        symbol: sym,
        direction,
        lots,
        entryPrice: entry,
        currentPrice: entry,
        stopLoss,
        takeProfit,
        initialStopDistance: slDist,
        breakEvenLocked: false,
        trailingActivated: false,
        pnlInr: 0,
        pnlTicks: 0,
        openedAt: new Date().toLocaleTimeString(),
        status: 'OPEN',
        brokerMode: mode,
        strategyUsed: primarySlot.strategy,
        confluenceNote,
      };

      const nextList = [newTrade, ...liveTradesRef.current];
      liveTradesRef.current = nextList;
      setLiveTrades(nextList);

      fetch('/api/kotak/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tradeId,
          symbol: sym,
          direction,
          lots,
          entryPrice: entry,
          stopLoss,
          takeProfit,
          brokerMode: mode,
          strategyUsed: primarySlot.strategy,
          confluenceNote,
        }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            throw new Error(data.error || 'Kotak Order failed');
          }
          return data;
        })
        .then((resp) => {
          if (resp?.trade?.brokerOrderId) {
            const updated = liveTradesRef.current.map((tr) =>
              tr.id === tradeId ? { ...tr, brokerOrderId: resp.trade.brokerOrderId } : tr
            );
            liveTradesRef.current = updated;
            setLiveTrades(updated);
          }
          syncKotakOrderBook();
        })
        .catch((err) => {
          const reverted = liveTradesRef.current.filter((tr) => tr.id !== tradeId);
          liveTradesRef.current = reverted;
          setLiveTrades(reverted);
          setStatusNotice(err instanceof Error ? err.message : 'Kotak Order rejected');
        });

      setStatusNotice(
        `Kotak Neo LIVE ${direction} ${lots} Lots ${sym} @ ${entry.toFixed(spec.decimals)} (${confluenceNote ?? 'Manual'})`
      );
    },
    [syncKotakOrderBook]
  );

  const handleCloseLiveTrade = useCallback(
    (tradeId: string) => {
      let closurePayload: {
        id: string;
        exitPrice: number;
        pnlInr: number;
        pnlTicks: number;
        status: 'CLOSED_MANUAL';
        brokerMode: BrokerMode;
      } | null = null;

      const updated = liveTradesRef.current.map((t) => {
        if (t.id !== tradeId || t.status !== 'OPEN') return t;
        const spec = INDIAN_SYMBOLS[t.symbol];
        const q = quotesRef.current[t.symbol];
        const exitRaw = q ? (t.direction === 'BUY' ? q.bid : q.ask) : t.currentPrice;
        const exitPrice = Number(exitRaw.toFixed(spec.decimals));
        const diff = t.direction === 'BUY' ? exitPrice - t.entryPrice : t.entryPrice - exitPrice;
        const pnlTicks = Number((diff / spec.tickSize).toFixed(1));
        const pnlInr = Number((pnlTicks * spec.valuePerTickInr * t.lots).toFixed(2));
        closurePayload = {
          id: t.id,
          exitPrice,
          pnlInr,
          pnlTicks,
          status: 'CLOSED_MANUAL',
          brokerMode: t.brokerMode,
        };
        return {
          ...t,
          currentPrice: exitPrice,
          pnlTicks,
          pnlInr,
          status: 'CLOSED_MANUAL' as const,
        };
      });

      liveTradesRef.current = updated;
      setLiveTrades(updated);

      if (closurePayload) {
        const p = closurePayload as {
          id: string;
          exitPrice: number;
          pnlInr: number;
          pnlTicks: number;
          status: 'CLOSED_MANUAL';
          brokerMode: BrokerMode;
        };
        settleBalanceInr(p.brokerMode, p.pnlInr);
        fetch('/api/kotak/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (Array.isArray(data?.aiMemory)) {
              setAiMemory(data.aiMemory);
              aiMemoryRef.current = data.aiMemory;
            }
            if (data?.aiEvolutionNote) {
              setStatusNotice(`AI Self-Learned: ${data.aiEvolutionNote}`);
            }
          })
          .catch(() => {});
      }
    },
    [settleBalanceInr]
  );

  // Zero-Delay Multi-Tab SSE Stream Hub (Strictly gated on Kotak Neo LIVE Login)
  useEffect(() => {
    if (!isKotakLoggedIn) return;
    const uniqueSymbols = openSymbolsKey.split(',').filter(Boolean) as TradingSymbol[];
    const sources: EventSource[] = [];
    let quotesDirty = false;
    let framesDirty = false;
    let pendingSignalsBySym: Partial<
      Record<TradingSymbol, Partial<Record<QuadTimeframe, 'BUY' | 'SELL' | null>>>
    > = {};
    let pendingAdaptationsBySym: Partial<
      Record<
        TradingSymbol,
        Partial<
          Record<
            QuadTimeframe,
            {
              strategy: StrategyArchetype;
              indicatorConfig: IndicatorConfig;
              regime: ReturnType<typeof detectMarketPatternAndAdaptIndicators>['regime'];
              patternLabel: string;
            }
          >
        >
      >
    > = {};
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function activeTabRefValue(): TradingSymbol {
      return (tabsRef.current.find((t) => t.tabId === activeTabIdRef.current) ?? tabsRef.current[0]).symbol;
    }

    function scheduleUiFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (quotesDirty) {
          quotesDirty = false;
          setQuotesBySymbol({ ...quotesRef.current });
        }
        if (framesDirty) {
          framesDirty = false;
          setQuadCandlesBySymbol({ ...quadCandlesRef.current });
        }
        const sigEntries = Object.entries(pendingSignalsBySym) as Array<
          [TradingSymbol, Partial<Record<QuadTimeframe, 'BUY' | 'SELL' | null>>]
        >;
        const adaptEntries = Object.entries(pendingAdaptationsBySym);
        if (sigEntries.length > 0 || adaptEntries.length > 0) {
          pendingSignalsBySym = {};
          const adaptSnapshot = pendingAdaptationsBySym;
          pendingAdaptationsBySym = {};
          let anyChanged = false;
          const updatedTabs = tabsRef.current.map((t) => {
            const sigMatch = sigEntries.find(([s]) => s === t.symbol);
            const adaptMap = adaptSnapshot[t.symbol];
            if (!sigMatch && !adaptMap) return t;
            const sigMap = sigMatch?.[1];
            let slotChanged = false;
            const nextSlots = { ...t.slots };
            QUAD_FRAMES.forEach((tf) => {
              const nextSig = sigMap?.[tf];
              const nextAdapt = adaptMap?.[tf];
              if (nextAdapt && nextSlots[tf].autoAdapt) {
                if (
                  nextAdapt.strategy !== nextSlots[tf].strategy ||
                  nextAdapt.regime !== nextSlots[tf].detectedRegime ||
                  nextAdapt.patternLabel !== nextSlots[tf].patternLabel
                ) {
                  nextSlots[tf] = {
                    ...nextSlots[tf],
                    strategy: nextAdapt.strategy,
                    indicatorConfig: nextAdapt.indicatorConfig,
                    detectedRegime: nextAdapt.regime,
                    patternLabel: nextAdapt.patternLabel,
                  };
                  slotChanged = true;
                }
              }
              if (nextSig !== undefined && nextSig !== nextSlots[tf].liveSignal) {
                nextSlots[tf] = { ...nextSlots[tf], liveSignal: nextSig };
                slotChanged = true;
              }
            });
            if (!slotChanged) return t;
            anyChanged = true;
            return { ...t, slots: nextSlots };
          });
          if (anyChanged) setTabs(updatedTabs);
        }
      }, 90);
    }

    uniqueSymbols.forEach((sym) => {
      const es = new EventSource(`/api/market/stream?symbol=${encodeURIComponent(sym)}`);
      es.onopen = () => {
        if (sym === activeTabRefValue()) setStreamStatus('LIVE');
      };
      es.onerror = () => {
        if (sym === activeTabRefValue()) setStreamStatus('RECONNECTING');
      };
      es.onmessage = (event) => {
        try {
          const quote = JSON.parse(event.data) as LiveMarketQuote;
          if (!quote || typeof quote.mid !== 'number' || quote.mid <= 0) return;

          if (sym === activeTabRefValue()) setStreamStatus('LIVE');
          quotesRef.current = { ...quotesRef.current, [sym]: quote };
          quotesDirty = true;

          const spec = INDIAN_SYMBOLS[sym];
          const midPrice = Number(quote.mid.toFixed(spec.decimals));
          const isVisibleSymbol = sym === activeTabRefValue();
          const anyBotArmed = tabsRef.current.some((t) => t.symbol === sym && t.autoBotActive);

          // Update 4-TF candles in O(1) for the visible symbol or any symbol with an active Auto-Bot
          const curFrames = quadCandlesRef.current[sym];
          const matchingTab =
            tabsRef.current.find((t) => t.tabId === activeTabIdRef.current && t.symbol === sym) ??
            tabsRef.current.find((t) => t.symbol === sym);

          const isAfterHoursFrozen =
            quote.marketStatus === 'NSE_CLOSED' &&
            curFrames?.['1M']?.length &&
            Math.abs(curFrames['1M'][curFrames['1M'].length - 1].close - midPrice) < spec.tickSize * 0.5;

          if (curFrames && matchingTab && (isVisibleSymbol || anyBotArmed) && !isAfterHoursFrozen) {
            const nextFrames: Record<QuadTimeframe, Candle[]> = { ...curFrames };
            const updatedSignals: Partial<Record<QuadTimeframe, 'BUY' | 'SELL' | null>> = {};

            QUAD_FRAMES.forEach((tf) => {
              const slot = matchingTab.slots[tf];
              const prevArr = curFrames[tf] ?? [];
              const prevLastTime = prevArr[prevArr.length - 1]?.time ?? 0;
              let effectiveStrategy = slot.strategy;
              let effectiveConfig = slot.indicatorConfig;

              const updatedBars = applyLiveTickToCandles(
                prevArr,
                tf,
                sym,
                midPrice,
                quote.ts,
                effectiveConfig
              );

              // Auto-switch strategy & indicators live whenever a new bar forms and AI Auto-Adapt is ON
              const newLastTime = updatedBars[updatedBars.length - 1]?.time ?? 0;
              if (slot.autoAdapt && newLastTime > prevLastTime && updatedBars.length >= 30) {
                const adapted = detectMarketPatternAndAdaptIndicators(
                  updatedBars,
                  sym,
                  tf,
                  aiMemoryRef.current
                );
                effectiveStrategy = adapted.strategy;
                effectiveConfig = adapted.indicatorConfig;
                pendingAdaptationsBySym[sym] = {
                  ...(pendingAdaptationsBySym[sym] ?? {}),
                  [tf]: {
                    strategy: adapted.strategy,
                    indicatorConfig: adapted.indicatorConfig,
                    regime: adapted.regime,
                    patternLabel: adapted.patternLabel,
                  },
                };
              }

              nextFrames[tf] = updatedBars;
              const sigRes = evaluateLiveSignal(updatedBars, sym, effectiveStrategy, effectiveConfig);
              updatedSignals[tf] = sigRes.signal;
            });

            quadCandlesRef.current = { ...quadCandlesRef.current, [sym]: nextFrames };
            if (isVisibleSymbol) framesDirty = true;
            pendingSignalsBySym[sym] = updatedSignals;

            // Check Multi-Timeframe Confluence Auto-Execution if Bot is armed on any tab using this symbol
            if (anyBotArmed) {
              tabsRef.current.forEach((t) => {
                if (!t.autoBotActive || t.symbol !== sym) return;
                const nextSlots = { ...t.slots };
                QUAD_FRAMES.forEach((tf) => {
                  nextSlots[tf] = {
                    ...nextSlots[tf],
                    liveSignal: updatedSignals[tf] ?? nextSlots[tf].liveSignal,
                  };
                });
                const confluence = evaluateMultiTimeframeConfluence(nextSlots);
                const hasOpenTrade = liveTradesRef.current.some(
                  (tr) => tr.status === 'OPEN' && tr.symbol === sym
                );
                const barBucket = Math.floor(quote.ts / timeframeToMs('1M'));
                if (
                  confluence.direction !== 'WAIT' &&
                  confluence.confidencePct >= 62 &&
                  !hasOpenTrade &&
                  lastBotBarBucketRef.current[t.tabId] !== barBucket
                ) {
                  lastBotBarBucketRef.current[t.tabId] = barBucket;
                  placeKotakOrder(sym, confluence.direction, quote, confluence.summary);
                }
              });
            }
          }

          scheduleUiFlush();

          // Mark-to-Market Open Trades + Break-Even + Trailing SL + Auto TP/SL Exit
          const closures: Array<{
            id: string;
            exitPrice: number;
            pnlInr: number;
            pnlTicks: number;
            status: 'CLOSED_TP' | 'CLOSED_SL';
            brokerMode: BrokerMode;
          }> = [];

          let touchedOpen = false;
          const nextTrades = liveTradesRef.current.map((tr) => {
            if (tr.status !== 'OPEN' || tr.symbol !== sym) return tr;
            touchedOpen = true;
            const markPrice = tr.direction === 'BUY' ? quote.bid : quote.ask;
            const diff = tr.direction === 'BUY' ? markPrice - tr.entryPrice : tr.entryPrice - markPrice;
            const pnlTicks = Number((diff / spec.tickSize).toFixed(1));
            const pnlInr = Number((pnlTicks * spec.valuePerTickInr * tr.lots).toFixed(2));

            let nextSl = tr.stopLoss;
            let nextBe = Boolean(tr.breakEvenLocked);
            let nextTrail = Boolean(tr.trailingActivated);
            const initDist = tr.initialStopDistance ?? Math.abs(tr.entryPrice - tr.stopLoss);

            if (riskConfigRef.current.trailingStopEnabled && initDist > 0) {
              if (diff >= initDist * Math.max(1.1, riskConfigRef.current.breakEvenTriggerR)) {
                const beLevel =
                  tr.direction === 'BUY'
                    ? tr.entryPrice + initDist * 0.15
                    : tr.entryPrice - initDist * 0.15;
                const trailLevel =
                  diff >= initDist * 1.5
                    ? tr.direction === 'BUY'
                      ? markPrice - initDist * 1.1
                      : markPrice + initDist * 1.1
                    : beLevel;
                const cand =
                  tr.direction === 'BUY'
                    ? Math.max(beLevel, trailLevel)
                    : Math.min(beLevel, trailLevel);
                if (
                  (tr.direction === 'BUY' && cand > nextSl) ||
                  (tr.direction === 'SELL' && cand < nextSl)
                ) {
                  nextSl = Number(cand.toFixed(spec.decimals));
                  nextBe = true;
                  nextTrail = diff >= initDist * 1.5;
                }
              }
            }

            if (
              (tr.direction === 'BUY' && markPrice >= tr.takeProfit) ||
              (tr.direction === 'SELL' && markPrice <= tr.takeProfit)
            ) {
              closures.push({
                id: tr.id,
                exitPrice: markPrice,
                pnlInr,
                pnlTicks,
                status: 'CLOSED_TP',
                brokerMode: tr.brokerMode,
              });
              return {
                ...tr,
                stopLoss: nextSl,
                breakEvenLocked: nextBe,
                trailingActivated: nextTrail,
                currentPrice: markPrice,
                pnlTicks,
                pnlInr,
                status: 'CLOSED_TP' as const,
              };
            }

            if (
              (tr.direction === 'BUY' && markPrice <= nextSl) ||
              (tr.direction === 'SELL' && markPrice >= nextSl)
            ) {
              closures.push({
                id: tr.id,
                exitPrice: markPrice,
                pnlInr,
                pnlTicks,
                status: 'CLOSED_SL',
                brokerMode: tr.brokerMode,
              });
              return {
                ...tr,
                stopLoss: nextSl,
                breakEvenLocked: nextBe,
                trailingActivated: nextTrail,
                currentPrice: markPrice,
                pnlTicks,
                pnlInr,
                status: 'CLOSED_SL' as const,
              };
            }

            return {
              ...tr,
              stopLoss: nextSl,
              breakEvenLocked: nextBe,
              trailingActivated: nextTrail,
              currentPrice: markPrice,
              pnlTicks,
              pnlInr,
            };
          });

          if (touchedOpen) {
            liveTradesRef.current = nextTrades;
            setLiveTrades(nextTrades);
            for (const c of closures) {
              settleBalanceInr(c.brokerMode, c.pnlInr);
              fetch('/api/kotak/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(c),
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                  if (Array.isArray(data?.aiMemory)) {
                    setAiMemory(data.aiMemory);
                    aiMemoryRef.current = data.aiMemory;
                  }
                  if (data?.aiEvolutionNote) {
                    setStatusNotice(`AI Self-Learned: ${data.aiEvolutionNote}`);
                  }
                })
                .catch(() => {});
            }
          }
        } catch {
          // ignore frame parse issues
        }
      };
      sources.push(es);
    });

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      sources.forEach((es) => es.close());
    };
  }, [isKotakLoggedIn, openSymbolsKey, placeKotakOrder, settleBalanceInr]);

  // Background AI Market Scanner Poll (feeds Right Auto-Hide Edge Widget)
  const handlePromoteScannerOpportunity = useCallback(
    (opp: ScannerOpportunity, autoStartBot = false) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.tabId !== activeTabIdRef.current) return t;
          const nextSlots = { ...t.slots };
          QUAD_FRAMES.forEach((tf) => {
            nextSlots[tf] = {
              ...nextSlots[tf],
              strategy: tf === '30S' ? 'SCALPER_30S_MOMENTUM' : opp.recommendedStrategy,
              indicatorConfig: opp.recommendedConfig,
              detectedRegime: opp.regime,
              patternLabel: opp.patternLabel,
              liveSignal: opp.direction === 'WAIT' ? null : opp.direction,
            };
          });
          return {
            ...t,
            title: opp.symbol,
            symbol: opp.symbol,
            autoBotActive: autoStartBot ? true : t.autoBotActive,
            slots: nextSlots,
          };
        })
      );
      setActiveView('QUAD_DESK');
      setStatusNotice(
        `AI Scanner Loaded ${opp.symbol} (${opp.confidencePct}% · ${opp.patternLabel}) onto active 4-chart tab`
      );
    },
    []
  );

  useEffect(() => {
    if (!isKotakLoggedIn) return;
    let active = true;
    const poll = () => {
      fetch('/api/market/scanner')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!active || !Array.isArray(data?.opportunities)) return;
          setScannerOpportunities(data.opportunities);

          if (autoPromoteScanner && data.opportunities.length > 0) {
            const top = data.opportunities[0] as ScannerOpportunity;
            const promoKey = `${top.symbol}_${top.direction}_${Math.floor(top.updatedAt / 60000)}`;
            if (
              top.direction !== 'WAIT' &&
              top.confidencePct >= 82 &&
              top.symbol !== activeSymbol &&
              lastAutoPromotedRef.current !== promoKey
            ) {
              lastAutoPromotedRef.current = promoKey;
              handlePromoteScannerOpportunity(top, true);
            }
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 18_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isKotakLoggedIn, autoPromoteScanner, activeSymbol, handlePromoteScannerOpportunity]);

  // 1-Year Backtest & Fixer Pipeline
  const executeFullOneYearPipeline = useCallback(
    (
      sym: TradingSymbol,
      tf: Timeframe,
      strat: StrategyArchetype,
      risk: RiskConfig,
      overrideCandles?: Candle[],
      overrideMeta?: { dataSource: BacktestResult['dataSource']; tickerLabel?: string }
    ) => {
      const stratDef = STRATEGY_CATALOG.find((s) => s.id === strat) ?? STRATEGY_CATALOG[0];
      const candlesToUse = overrideCandles ?? customCsvCandles ?? btHistoryCandles;
      const metaToUse = overrideMeta ?? (customCsvCandles ? { dataSource: 'CUSTOM_CSV' as const } : btMarketMeta);
      const res = runOneYearTestAndAutoFix(
        sym,
        tf,
        strat,
        stratDef.defaultRawConfig,
        risk,
        candlesToUse,
        metaToUse
      );
      setComparison(res);
      setCustomIndicatorConfig(res.repairedPass.indicatorConfigUsed);
      setActivePassView('REPAIRED');
    },
    [btHistoryCandles, btMarketMeta, customCsvCandles]
  );

  useEffect(() => {
    if (!isKotakLoggedIn) return;
    if (activeView !== 'BACKTEST_FIXER' && btHistoryCandles) return;
    if (customCsvCandles) return;
    const controller = new AbortController();
    setIsLoadingBtData(true);
    setBtMarketError(null);

    fetch(
      `/api/market/history?symbol=${encodeURIComponent(activeSymbol)}&timeframe=${encodeURIComponent(btTimeframe)}`,
      { signal: controller.signal }
    )
      .then(async (resp) => {
        const data = await resp.json();
        if (!resp.ok || !Array.isArray(data.candles)) {
          throw new Error(data.error || 'Failed to load 1-year history');
        }
        const meta = {
          dataSource: (data.source || 'YAHOO_REAL') as BacktestResult['dataSource'],
          tickerLabel: data.ticker as string | undefined,
        };
        setBtHistoryCandles(data.candles);
        setBtMarketMeta(meta);
        executeFullOneYearPipeline(activeSymbol, btTimeframe, btStrategy, riskConfig, data.candles, meta);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setBtMarketError(err instanceof Error ? err.message : 'Unable to reach live market feed');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingBtData(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKotakLoggedIn, activeSymbol, btTimeframe, btFetchNonce, activeView]);

  useEffect(() => {
    if (!isReplaying) return;
    const timer = setInterval(() => {
      setReplayProgressPct((prev) => {
        if (prev >= 100) {
          setIsReplaying(false);
          return 100;
        }
        return Math.min(100, prev + 4);
      });
    }, 180);
    return () => clearInterval(timer);
  }, [isReplaying]);

  // Tab Mutation Helpers
  const handleChangeTabSymbol = (tabId: string, nextSym: TradingSymbol) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.tabId !== tabId) return t;
        const frames = quadCandlesRef.current[nextSym];
        const nextSlots = { ...t.slots };
        QUAD_FRAMES.forEach((tf) => {
          if (frames?.[tf]?.length) {
            const adapted = detectMarketPatternAndAdaptIndicators(
              frames[tf],
              nextSym,
              tf,
              aiMemoryRef.current
            );
            nextSlots[tf] = {
              ...nextSlots[tf],
              strategy: adapted.strategy,
              indicatorConfig: adapted.indicatorConfig,
              detectedRegime: adapted.regime,
              patternLabel: adapted.patternLabel,
            };
          } else {
            nextSlots[tf] = {
              ...nextSlots[tf],
              patternLabel: `${nextSym} ${tf}`,
            };
          }
        });
        return { ...t, symbol: nextSym, title: nextSym, slots: nextSlots };
      })
    );
  };

  const handleAddWorkspaceTab = () => {
    if (tabs.length >= 6) return;
    const used = new Set(tabs.map((t) => t.symbol));
    const nextSym = EXTRA_TAB_CANDIDATES.find((s) => !used.has(s)) ?? 'EURUSD';
    const template = buildDefaultWorkspaceTabs()[0];
    const newId = `tab-${Date.now().toString().slice(-4)}`;
    const newTab: WorkspaceTabState = {
      ...template,
      tabId: newId,
      title: nextSym,
      symbol: nextSym,
      autoBotActive: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
    setActiveView('QUAD_DESK');
  };

  const handleCloseWorkspaceTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const remaining = tabs.filter((t) => t.tabId !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId && remaining[0]) {
      setActiveTabId(remaining[0].tabId);
    }
  };

  const handleToggleTabBot = (tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.tabId === tabId ? { ...t, autoBotActive: !t.autoBotActive } : t))
    );
  };

  const handleToggleAllAutoAdapt = () => {
    const nextVal = !activeTab.aiAutoAdaptAll;
    const frames = quadCandlesRef.current[activeSymbol];
    setTabs((prev) =>
      prev.map((t) => {
        if (t.tabId !== activeTab.tabId) return t;
        const nextSlots = { ...t.slots };
        QUAD_FRAMES.forEach((tf) => {
          let updatedSlot = { ...nextSlots[tf], autoAdapt: nextVal };
          if (nextVal && frames?.[tf]?.length) {
            const adapted = detectMarketPatternAndAdaptIndicators(
              frames[tf],
              activeSymbol,
              tf,
              aiMemoryRef.current
            );
            updatedSlot = {
              ...updatedSlot,
              strategy: adapted.strategy,
              indicatorConfig: adapted.indicatorConfig,
              detectedRegime: adapted.regime,
              patternLabel: adapted.patternLabel,
            };
          }
          nextSlots[tf] = updatedSlot;
        });
        return { ...t, aiAutoAdaptAll: nextVal, slots: nextSlots };
      })
    );
  };

  const handleSaveSlotToVault = async (tf: QuadTimeframe) => {
    const slot = activeTab.slots[tf];
    try {
      const resp = await fetch('/api/ai/memory/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activeSymbol,
          timeframe: tf,
          regime: slot.detectedRegime,
          strategy: slot.strategy,
          indicatorConfig: slot.indicatorConfig,
          winRatePct: comparison.repairedPass.winRatePct,
          profitFactor: comparison.repairedPass.profitFactor,
          netReturnPct: comparison.repairedPass.netReturnPct,
          tradesCount: comparison.repairedPass.totalTrades,
          origin: 'USER_TUNED',
        }),
      });
      const data = await resp.json();
      if (Array.isArray(data?.records)) {
        setAiMemory(data.records);
        aiMemoryRef.current = data.records;
      }
      setStatusNotice(`Saved ${activeSymbol} (${tf} · ${slot.detectedRegime}) setup to AI & Oracle Vault`);
    } catch {
      // Non-fatal
    }
  };

  const handleSaveKotakCredentials = async (payload: {
    ucc: string;
    mobile: string;
    consumerKey: string;
    totp: string;
    mpin: string;
    exchangeSegment: 'NSE_CDS' | 'NSE_FO';
    brokerageTier: RiskConfig['brokerageTier'];
    leverage: RiskConfig['leverage'];
  }): Promise<string | null> => {
    try {
      const resp = await fetch('/api/kotak/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) return data.error || 'Could not connect Kotak Neo account';
      if (data.account) {
        setLastUcc(data.account.ucc || payload.ucc);
        setLiveAccount(data.account);
        if (data.kotakContracts && typeof data.kotakContracts === 'object') {
          setKotakContracts(data.kotakContracts);
        }
        // Immediately auto-load all 4 real TradingView charts + live NSE quotes + Kotak orders
        quadCandlesRef.current = {};
        setQuadCandlesBySymbol({});
        setQuadFetchError(null);
        setQuadRefreshNonce((n) => n + 1);
        setActiveView('QUAD_DESK');
        syncKotakOrderBook();
        setStatusNotice(
          `Kotak Neo LIVE Connected (UCC ${data.account.ucc}) · Auto-Loading Real 4-TF Charts`
        );
        setRiskConfig((prev) => ({
          ...prev,
          initialCapitalInr:
            Number(data.account.balanceInr) > 0 ? Number(data.account.balanceInr) : prev.initialCapitalInr,
          leverage: payload.leverage,
          brokerageTier: payload.brokerageTier,
        }));
      }
    } catch {
      return 'Network error contacting Kotak Neo server bridge';
    }
    return null;
  };

  const handleRefreshKotakLimits = async (): Promise<string | null> => {
    try {
      const resp = await fetch('/api/kotak/refresh-limits', { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return data.error || 'Unable to sync Kotak Neo margin';
      if (data.account) {
        setLiveAccount(data.account);
        if (Number(data.account.balanceInr) > 0) {
          setRiskConfig((prev) => ({
            ...prev,
            initialCapitalInr: Number(data.account.balanceInr),
          }));
        }
      }
      return null;
    } catch {
      return 'Network error while refreshing Kotak margin';
    }
  };

  const handleSyncOracleDb = async (): Promise<string | null> => {
    try {
      const resp = await fetch('/api/oracle/sync', { method: 'POST' });
      const data = await resp.json().catch(() => null);
      if (data?.oracleDb) setOracleDb(data.oracleDb);
      if (Array.isArray(data?.aiMemory)) {
        setAiMemory(data.aiMemory);
        aiMemoryRef.current = data.aiMemory;
      }
      if (!resp.ok) {
        return data?.error || 'Oracle Autonomous DB env vars abhi configure nahi hain.';
      }
      return `Oracle ADB Synced (${data.aiMemory?.length ?? aiMemory.length} AI Rules · ${data.liveTrades?.length ?? liveTrades.length} Trades)`;
    } catch {
      return 'Network error while syncing Oracle Autonomous DB';
    }
  };

  const handleDisconnectKotakLive = async () => {
    try {
      const resp = await fetch('/api/kotak/disconnect', { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (data?.accounts?.LIVE) {
        setLiveAccount(data.accounts.LIVE);
      } else {
        setLiveAccount((prev) => ({
          ...prev,
          connected: false,
          sessionState: 'DISCONNECTED',
          balanceInr: 0,
          equityInr: 0,
        }));
      }
      quadCandlesRef.current = {};
      quotesRef.current = {};
      setQuadCandlesBySymbol({});
      setQuotesBySymbol({});
      setScannerOpportunities([]);
      setKotakOrderBookCount(0);
      setActiveView('QUAD_DESK');
    } catch {
      // ignore
    }
  };

  const handleRequestAiAudit = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/analyze-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activeSymbol,
          timeframe: btTimeframe,
          strategy: btStrategy,
          initialMetrics: {
            winRatePct: comparison.initialPass.winRatePct,
            netProfitInr: comparison.initialPass.netProfitInr,
            profitFactor: comparison.initialPass.profitFactor,
            maxDrawdownPct: comparison.initialPass.maxDrawdownPct,
          },
          repairedMetrics: {
            winRatePct: comparison.repairedPass.winRatePct,
            netProfitInr: comparison.repairedPass.netProfitInr,
            profitFactor: comparison.repairedPass.profitFactor,
            maxDrawdownPct: comparison.repairedPass.maxDrawdownPct,
            indicatorConfigUsed: comparison.repairedPass.indicatorConfigUsed,
          },
          riskConfig,
        }),
      });
      const data = await res.json();
      setAiAudit(data);
    } catch {
      setAiAudit(null);
    } finally {
      setAiLoading(false);
    }
  };

  const confluence = evaluateMultiTimeframeConfluence(activeTab.slots);
  const currentFrames = quadCandlesBySymbol[activeSymbol];
  const latestPriceDisplay =
    activeQuote?.mid ??
    currentFrames?.['30S']?.[currentFrames['30S'].length - 1]?.close ??
    activeSpec.basePrice;

  const openPositions = liveTrades.filter((t) => t.status === 'OPEN');

  const navItems: Array<{ id: ActiveView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'QUAD_DESK', label: '4-Chart Live Desk', icon: LayoutGrid },
    { id: 'BACKTEST_FIXER', label: '1-Year Backtest & Fix', icon: CandlestickChart },
    { id: 'RISK_MARGIN', label: 'Risk & Margin (INR)', icon: ShieldCheck },
    { id: 'KOTAK_ORACLE', label: 'Kotak Neo & Oracle DB', icon: Database },
  ];

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#05080F] text-slate-300 flex items-center justify-center text-xs font-mono">
        Checking Kotak Neo API v2 session...
      </div>
    );
  }

  if (!isKotakLoggedIn) {
    return (
      <KotakLoginGate
        lastUcc={lastUcc}
        oracleDb={oracleDb}
        defaultExchangeSegment={liveAccount.exchangeSegment}
        defaultBrokerageTier={liveAccount.brokerageTier}
        defaultLeverage={liveAccount.leverage}
        onLoginSuccess={handleSaveKotakCredentials}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#05080F] text-slate-100 flex flex-col overflow-x-clip">
      {/* ===================================================================== */}
      {/* TOP BROWSER-STYLE WORKSPACE TABS BAR (No heavy marketing header)      */}
      {/* ===================================================================== */}
      <div className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-2 sm:px-3 py-1.5 flex flex-wrap md:flex-nowrap items-center justify-between gap-2 min-w-0">
        {/* Left: Compact Brand + 4 Concurrent Pair Workspace Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 w-full md:w-auto md:flex-1">
          <button
            type="button"
            onClick={() => setActiveView('QUAD_DESK')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            NeoQuant
          </button>

          <div
            role="tablist"
            aria-label="Multi-Pair Trading Workspaces"
            className="flex items-center gap-1"
          >
            {tabs.map((tab, idx) => {
              const isSelected = tab.tabId === activeTabId;
              const tabQuote = quotesBySymbol[tab.symbol];
              return (
                <div
                  key={tab.tabId}
                  className={`flex items-center rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-slate-800 border-emerald-500/60 text-white'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <button
                    role="tab"
                    aria-selected={isSelected}
                    data-testid={`workspace-tab-${idx + 1}`}
                    type="button"
                    onClick={() => {
                      setActiveTabId(tab.tabId);
                      setActiveView('QUAD_DESK');
                    }}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        tab.autoBotActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                      }`}
                    />
                    <span className="font-mono font-semibold">{tab.symbol}</span>
                    {tabQuote && (
                      <span className="hidden lg:inline font-mono text-[11px] text-slate-400 tabular-nums">
                        {tabQuote.mid.toFixed(INDIAN_SYMBOLS[tab.symbol].decimals)}
                      </span>
                    )}
                  </button>
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Close ${tab.symbol} tab`}
                      onClick={() => handleCloseWorkspaceTab(tab.tabId)}
                      className="pr-1.5 pl-0.5 py-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
            {tabs.length < 6 && (
              <button
                type="button"
                data-testid="add-workspace-tab"
                onClick={handleAddWorkspaceTab}
                title="Add another currency pair tab (up to 6 simultaneous pairs)"
                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-300 text-xs font-medium shrink-0 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Pair</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Active Tab 19-Pair Picker + Kotak LIVE + Bot Start/Stop */}
        <div className="flex items-center justify-between md:justify-end gap-1.5 w-full md:w-auto shrink-0">
          <select
            aria-label="Change Active Tab Currency Pair"
            data-testid="pair-picker-select"
            value={activeSymbol}
            onChange={(e) => handleChangeTabSymbol(activeTab.tabId, e.target.value as TradingSymbol)}
            className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 max-w-[185px]"
          >
            {SYMBOL_GROUPS.map((grp) => (
              <optgroup key={grp.label} label={grp.label}>
                {grp.symbols.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym} · {INDIAN_SYMBOLS[sym].exchange}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setActiveView('KOTAK_ORACLE')}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold border bg-emerald-600/20 border-emerald-500/70 text-emerald-300 hover:bg-emerald-600/30 transition-colors whitespace-nowrap shrink-0"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Kotak LIVE · {liveAccount.ucc}
          </button>

          <button
            type="button"
            onClick={() => void handleDisconnectKotakLive()}
            aria-label="Logout Kotak Neo Session"
            title="Logout Kotak Neo Session"
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium border bg-slate-900 border-slate-700 hover:border-rose-500/70 text-slate-300 hover:text-rose-300 transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>

          <button
            type="button"
            data-testid="toggle-tab-autobot"
            onClick={() => handleToggleTabBot(activeTab.tabId)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab.autoBotActive
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {activeTab.autoBotActive ? (
              <>
                <Square className="w-3 h-3" />
                Stop Bot
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                Start {activeSymbol} Bot
              </>
            )}
          </button>

          {/* Mobile AI Scanner Trigger */}
          <button
            type="button"
            onClick={() => setMobileScannerOpen((v) => !v)}
            className="md:hidden flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-900 border border-slate-700 text-emerald-300 text-xs font-medium shrink-0"
          >
            <Radar className="w-3.5 h-3.5" />
            AI
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SHELL BODY: AUTO-HIDE LEFT RAIL + FLUID CENTER WORKSPACE + RIGHT AI   */}
      {/* ===================================================================== */}
      <div className="flex-1 flex relative min-w-0">
        {/* LEFT AUTO-HIDE SIDEBAR (Desktop) */}
        <aside
          data-testid="left-autohide-sidebar"
          onMouseEnter={() => setLeftHover(true)}
          onMouseLeave={() => setLeftHover(false)}
          className={`hidden md:flex flex-col justify-between bg-slate-950 border-r border-slate-800/90 transition-all duration-200 shrink-0 z-30 ${
            leftExpanded ? 'w-[220px]' : 'w-[48px]'
          }`}
        >
          <div className="flex flex-col gap-1 p-1.5 pt-2.5">
            <div className="flex items-center justify-between px-1.5 pb-2 border-b border-slate-800/70 mb-1">
              {leftExpanded ? (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Terminal Desk
                </span>
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500 mx-auto" />
              )}
              {leftExpanded && (
                <button
                  type="button"
                  onClick={() => setLeftPinned((p) => !p)}
                  aria-label="Pin Left Sidebar"
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  {leftPinned ? <PinOff className="w-3.5 h-3.5 text-emerald-400" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>

            {navItems.map((item) => {
              const Icon = item.icon;
              const isAct = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  title={item.label}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap overflow-hidden ${
                    isAct
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {leftExpanded && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>

          {/* Expanded Footer Telemetry */}
          <div className="p-2 border-t border-slate-800/80 text-xs">
            {leftExpanded ? (
              <div className="flex flex-col gap-1.5 bg-slate-900/70 rounded-lg p-2.5 border border-slate-800">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Kotak LIVE · {liveAccount.ucc}</span>
                  <span className="font-mono text-emerald-400">{liveAccount.exchangeSegment}</span>
                </div>
                <div className="font-mono font-bold text-sm text-white tabular-nums">
                  {formatInr(liveAccount.balanceInr)}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  AI Vault: {aiMemory.length} rules
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 py-1 text-[10px] font-mono text-emerald-400">
                <span>₹</span>
                <span>{(liveAccount.balanceInr / 1000).toFixed(0)}K</span>
              </div>
            )}
          </div>
        </aside>

        {/* CENTER WORKSPACE */}
        <main className="flex-1 min-w-0 p-3 sm:p-4 pb-20 md:pb-5 flex flex-col gap-3">
          {/* Compact Operational Telemetry & Order Strip */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-white">
                <span
                  className={`w-2 h-2 rounded-full ${
                    streamStatus === 'LIVE' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                {activeQuote?.contractSymbol ?? kotakContracts[activeSymbol] ?? activeSymbol}
              </span>
              <span className="font-mono font-bold text-emerald-300 tabular-nums">
                {latestPriceDisplay.toFixed(activeSpec.decimals)}
              </span>
              {activeQuote && (
                <span className="font-mono text-[11px] text-slate-400 tabular-nums hidden sm:inline">
                  BID {activeQuote.bid.toFixed(activeSpec.decimals)} · ASK {activeQuote.ask.toFixed(activeSpec.decimals)} ·{' '}
                  <span
                    className={
                      activeQuote.source === 'KOTAK_NEO_LIVE' ? 'text-emerald-400 font-semibold' : 'text-slate-300'
                    }
                  >
                    {activeQuote.source}
                  </span>{' '}
                  ({activeQuote.latencyMs}ms)
                </span>
              )}
              {activeQuote?.marketStatus && (
                <span
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] border hidden md:inline ${
                    activeQuote.marketStatus === 'NSE_LIVE'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : activeQuote.marketStatus === 'NSE_CLOSED_GLOBAL_LIVE'
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                      : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  }`}
                >
                  {activeQuote.marketStatus === 'NSE_LIVE'
                    ? 'NSE LIVE (IST)'
                    : activeQuote.marketStatus === 'NSE_CLOSED_GLOBAL_LIVE'
                    ? 'NSE Closed · Global 24×5 Live'
                    : 'NSE Closed (Last Close)'}
                </span>
              )}
              <span className="hidden xl:inline text-slate-500">·</span>
              <span className="hidden xl:inline text-slate-300 truncate max-w-[300px]">
                {statusNotice}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex items-center rounded border border-slate-700/90 bg-slate-950 p-0.5 text-[11px] font-medium"
                role="group"
                aria-label="Chart Engine Switcher"
              >
                <button
                  type="button"
                  data-testid="chart-engine-tv-quant"
                  onClick={() => setChartEngine('TV_QUANT')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    chartEngine === 'TV_QUANT'
                      ? 'bg-emerald-600/25 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  TV Quant (AI)
                </button>
                <button
                  type="button"
                  data-testid="chart-engine-tv-direct"
                  onClick={() => setChartEngine('TRADINGVIEW_DIRECT')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    chartEngine === 'TRADINGVIEW_DIRECT'
                      ? 'bg-sky-600/25 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  TradingView Live
                </button>
              </div>

              <span
                className={`px-2 py-0.5 rounded border font-mono text-[11px] font-semibold ${
                  confluence.direction === 'BUY'
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : confluence.direction === 'SELL'
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                4-TF: {confluence.direction} ({confluence.confidencePct}%)
              </span>

              <button
                type="button"
                onClick={handleToggleAllAutoAdapt}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                  activeTab.aiAutoAdaptAll
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-950 border-slate-700 text-slate-400'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                AI Auto-Adapt: {activeTab.aiAutoAdaptAll ? 'ON' : 'OFF'}
              </button>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    placeKotakOrder(activeSymbol, 'BUY', activeQuote, 'Manual 4-TF Instant Buy')
                  }
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                >
                  <TrendingUp className="w-3 h-3" />
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() =>
                    placeKotakOrder(activeSymbol, 'SELL', activeQuote, 'Manual 4-TF Instant Sell')
                  }
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                >
                  <TrendingDown className="w-3 h-3" />
                  Sell
                </button>
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* VIEW 1: 4-CHART HOME DESK (30M, 5M, 1M, 30S)                    */}
          {/* =============================================================== */}
          {activeView === 'QUAD_DESK' && (
            <>
              {quadFetchError && (
                <div
                  role="alert"
                  className="bg-rose-950/60 border border-rose-700/80 rounded-lg px-3 py-2 text-xs text-rose-200 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    {quadFetchError}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      delete quadCandlesRef.current[activeSymbol];
                      setQuadFetchError(null);
                      setQuadRefreshNonce((n) => n + 1);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-medium shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry Feed
                  </button>
                </div>
              )}

              <section
                aria-label="4-Timeframe Simultaneous Trading Workspace"
                className="grid grid-cols-1 lg:grid-cols-2 gap-3"
              >
                {QUAD_FRAMES.map((tf) => {
                  const slot = activeTab.slots[tf];
                  const rawCandles = currentFrames?.[tf] ?? [];
                  return (
                    <QuadChartCell
                      key={`${activeTab.tabId}-${activeSymbol}-${tf}`}
                      symbol={activeSymbol}
                      slot={slot}
                      rawCandles={rawCandles}
                      liveQuote={activeQuote}
                      chartEngine={chartEngine}
                      onChangeStrategy={(nextStrat) => {
                        const preset =
                          STRATEGY_CATALOG.find((s) => s.id === nextStrat)?.defaultRawConfig ??
                          slot.indicatorConfig;
                        setTabs((prev) =>
                          prev.map((t) =>
                            t.tabId !== activeTab.tabId
                              ? t
                              : {
                                  ...t,
                                  slots: {
                                    ...t.slots,
                                    [tf]: {
                                      ...slot,
                                      strategy: nextStrat,
                                      indicatorConfig: preset,
                                      autoAdapt: false,
                                    },
                                  },
                                }
                          )
                        );
                      }}
                      onToggleAutoAdapt={() => {
                        setTabs((prev) =>
                          prev.map((t) =>
                            t.tabId !== activeTab.tabId
                              ? t
                              : {
                                  ...t,
                                  slots: {
                                    ...t.slots,
                                    [tf]: { ...slot, autoAdapt: !slot.autoAdapt },
                                  },
                                }
                          )
                        );
                      }}
                      onUpdateIndicators={(nextCfg) => {
                        setTabs((prev) =>
                          prev.map((t) =>
                            t.tabId !== activeTab.tabId
                              ? t
                              : {
                                  ...t,
                                  slots: {
                                    ...t.slots,
                                    [tf]: { ...slot, indicatorConfig: nextCfg, autoAdapt: false },
                                  },
                                }
                          )
                        );
                      }}
                      onSaveToVault={() => handleSaveSlotToVault(tf)}
                    />
                  );
                })}
              </section>

              {/* Active Real Kotak Neo LIVE Order Book Strip */}
              <section
                aria-label="Kotak Neo Open & Recent Orders"
                className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 flex flex-col gap-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-slate-200">
                    <Bot className="w-4 h-4 text-emerald-400" />
                    Kotak Neo LIVE Order Book ({openPositions.length} Open · {liveTrades.length} Session · {kotakOrderBookCount} Exchange)
                  </div>
                  <div className="font-mono text-slate-400 tabular-nums">
                    Kotak Real Margin: <strong className="text-emerald-400">{formatInr(liveAccount.equityInr)}</strong>
                  </div>
                </div>

                {liveTrades.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No active LIVE trades placed yet in this session. Arm <strong className="text-slate-200">Start {activeSymbol} Bot</strong> or click <strong className="text-emerald-400">Buy / Sell</strong> to execute directly on Kotak Neo LIVE API.
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-slate-800 rounded-md">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                          <th className="py-1.5 px-2.5 font-medium">Order</th>
                          <th className="py-1.5 px-2.5 font-medium">Symbol</th>
                          <th className="py-1.5 px-2.5 font-medium">Side</th>
                          <th className="py-1.5 px-2.5 font-medium text-right">Lots</th>
                          <th className="py-1.5 px-2.5 font-medium text-right">Entry</th>
                          <th className="py-1.5 px-2.5 font-medium text-right">SL / TP</th>
                          <th className="py-1.5 px-2.5 font-medium text-right">P&L (₹ INR)</th>
                          <th className="py-1.5 px-2.5 font-medium text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                        {liveTrades.slice(0, 8).map((tr) => {
                          const sp = INDIAN_SYMBOLS[tr.symbol];
                          return (
                            <tr key={tr.id} className="hover:bg-slate-800/40">
                              <td className="py-1.5 px-2.5 text-slate-300">
                                {tr.brokerOrderId ?? tr.id}
                              </td>
                              <td className="py-1.5 px-2.5 text-white font-semibold">{tr.symbol}</td>
                              <td
                                className={`py-1.5 px-2.5 font-semibold ${
                                  tr.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {tr.direction}
                              </td>
                              <td className="py-1.5 px-2.5 text-right text-slate-200">{tr.lots}</td>
                              <td className="py-1.5 px-2.5 text-right text-slate-300">
                                {tr.entryPrice.toFixed(sp.decimals)}
                              </td>
                              <td className="py-1.5 px-2.5 text-right text-slate-400">
                                {tr.stopLoss.toFixed(sp.decimals)} / {tr.takeProfit.toFixed(sp.decimals)}
                              </td>
                              <td
                                className={`py-1.5 px-2.5 text-right font-semibold ${
                                  tr.pnlInr >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {formatInr(tr.pnlInr, true)}
                              </td>
                              <td className="py-1.5 px-2.5 text-right">
                                {tr.status === 'OPEN' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleCloseLiveTrade(tr.id)}
                                    className="px-2 py-0.5 bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white rounded text-[11px] font-sans"
                                  >
                                    Exit
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-400">{tr.status}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {/* =============================================================== */}
          {/* VIEW 2: 1-YEAR HISTORICAL BACKTEST & INDICATOR SELF-HEALING LAB */}
          {/* =============================================================== */}
          {activeView === 'BACKTEST_FIXER' && (
            <div className="flex flex-col gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">1-Year Optimizer Timeframe:</span>
                  {(['30S', '1M', '5M', '15M', '30M', '1H'] as Timeframe[]).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setBtTimeframe(tf)}
                      className={`px-2.5 py-1 rounded font-mono ${
                        btTimeframe === tf ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-4 font-mono tabular-nums">
                  <span>
                    Net: <strong className="text-emerald-400">{formatInr(comparison.repairedPass.netProfitInr, true)}</strong>
                  </span>
                  <span>
                    Win Rate: <strong className="text-white">{comparison.repairedPass.winRatePct}%</strong>
                  </span>
                  <span>
                    PF: <strong className="text-sky-400">{comparison.repairedPass.profitFactor}</strong>
                  </span>
                </div>
              </div>

              <HistoricalChartCanvas
                comparison={comparison}
                activePassView={activePassView}
                onSelectPassView={setActivePassView}
                onImportCustomCsv={(csvText) => {
                  const parsed = parseCustomCsvCandles(csvText, activeSymbol);
                  if (parsed.length >= 40) {
                    setCustomCsvCandles(parsed);
                    executeFullOneYearPipeline(activeSymbol, btTimeframe, btStrategy, riskConfig, parsed, {
                      dataSource: 'CUSTOM_CSV',
                    });
                  }
                }}
                isReplaying={isReplaying}
                replayProgressPct={replayProgressPct}
                onStartReplay={() => {
                  if (replayProgressPct >= 100) setReplayProgressPct(15);
                  setIsReplaying(true);
                }}
                onStopReplay={() => setIsReplaying(false)}
                onResetReplay={() => {
                  setIsReplaying(false);
                  setReplayProgressPct(100);
                }}
                isLoadingMarketData={isLoadingBtData}
                marketError={btMarketError}
                onRetryMarketFetch={() => setBtFetchNonce((n) => n + 1)}
                liveQuote={activeQuote}
              />

              <StrategyIndicatorFixer
                selectedStrategy={btStrategy}
                onSelectStrategy={(s) => {
                  setBtStrategy(s);
                  executeFullOneYearPipeline(activeSymbol, btTimeframe, s, riskConfig);
                }}
                customIndicatorConfig={customIndicatorConfig}
                onChangeIndicatorConfig={setCustomIndicatorConfig}
                onRunAutoFixPipeline={() =>
                  executeFullOneYearPipeline(activeSymbol, btTimeframe, btStrategy, riskConfig)
                }
                onRunManualBacktest={() => {
                  const manual = runBacktestOnCandles(
                    comparison.repairedPass.candles,
                    activeSymbol,
                    btTimeframe,
                    btStrategy,
                    customIndicatorConfig,
                    riskConfig,
                    btMarketMeta
                  );
                  setComparison((prev) => ({ ...prev, repairedPass: manual }));
                }}
                onSaveToAiVault={async () => {
                  await fetch('/api/ai/memory/learn', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      symbol: activeSymbol,
                      timeframe: btTimeframe,
                      regime: 'TRENDING_CHANNEL',
                      strategy: btStrategy,
                      indicatorConfig: comparison.repairedPass.indicatorConfigUsed,
                      winRatePct: comparison.repairedPass.winRatePct,
                      profitFactor: comparison.repairedPass.profitFactor,
                      netReturnPct: comparison.repairedPass.netReturnPct,
                      tradesCount: comparison.repairedPass.totalTrades,
                      origin: 'BACKTEST_AUTOFIX',
                    }),
                  })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                      if (Array.isArray(data?.records)) {
                        setAiMemory(data.records);
                        aiMemoryRef.current = data.records;
                      }
                    })
                    .catch(() => {});
                  setStatusNotice(`Saved 1-Year Optimized ${activeSymbol} (${btTimeframe}) to Oracle AI Vault`);
                }}
                comparison={comparison}
                aiAudit={aiAudit}
                aiLoading={aiLoading}
                onRequestAiAudit={handleRequestAiAudit}
              />
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 3: RISK & MARGIN PLANNER (₹ INR)                           */}
          {/* =============================================================== */}
          {activeView === 'RISK_MARGIN' && (
            <RiskAndGrowthPlanner
              riskConfig={riskConfig}
              onChangeRiskConfig={setRiskConfig}
              verifiedResult={comparison.repairedPass}
              symbol={activeSymbol}
            />
          )}

          {/* =============================================================== */}
          {/* VIEW 4: KOTAK NEO API & ORACLE AUTONOMOUS DB                  */}
          {/* =============================================================== */}
          {activeView === 'KOTAK_ORACLE' && (
            <KotakConnectAndOracle
              liveAccount={liveAccount}
              kotakContracts={kotakContracts}
              isStrategyVerified={isStrategyVerified}
              verifiedResult={comparison.repairedPass}
              strategy={btStrategy}
              indicatorConfig={comparison.repairedPass.indicatorConfigUsed}
              riskConfig={riskConfig}
              symbol={activeSymbol}
              timeframe={btTimeframe}
              aiMemory={aiMemory}
              oracleDb={oracleDb}
              onRefreshLimits={handleRefreshKotakLimits}
              onDisconnectLive={handleDisconnectKotakLive}
              onSyncOracleDb={handleSyncOracleDb}
              onApplyMemoryRecord={(rec) => {
                handleChangeTabSymbol(activeTab.tabId, rec.symbol);
                setActiveView('QUAD_DESK');
                setStatusNotice(`Applied Oracle Vault rule (${rec.symbol} · ${rec.regime}) to Workspace`);
              }}
              onAiMemoryUpdated={(records) => {
                setAiMemory(records);
                aiMemoryRef.current = records;
              }}
            />
          )}
        </main>

        {/* =================================================================== */}
        {/* RIGHT AUTO-HIDE AI BACKGROUND SCANNER EDGE WIDGET (Desktop)         */}
        {/* =================================================================== */}
        <aside
          data-testid="right-ai-scanner-widget"
          onMouseEnter={() => setRightHover(true)}
          onMouseLeave={() => setRightHover(false)}
          className={`hidden md:flex flex-col bg-slate-950 border-l border-slate-800/90 transition-all duration-200 shrink-0 z-30 ${
            rightExpanded ? 'w-[310px]' : 'w-[36px]'
          }`}
        >
          {!rightExpanded ? (
            <button
              type="button"
              onClick={() => setRightPinned(true)}
              aria-label="Open AI Background Scanner"
              className="h-full flex flex-col items-center justify-center gap-3 py-4 text-slate-400 hover:text-emerald-300 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span
                className="text-[11px] font-mono font-semibold tracking-widest uppercase"
                style={{ writingMode: 'vertical-rl' }}
              >
                AI SCANNER ({scannerOpportunities.filter((o) => o.direction !== 'WAIT').length})
              </span>
              <Radar className="w-4 h-4 text-emerald-400" />
            </button>
          ) : (
            <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Radar className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-white">AI Market Scanner</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRightPinned((p) => !p);
                    if (rightPinned) setRightHover(false);
                  }}
                  aria-label="Pin AI Scanner Panel"
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  {rightPinned ? (
                    <PinOff className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Pin className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] cursor-pointer">
                <span className="text-slate-300">Auto-load & trade top setup (82%+)</span>
                <input
                  type="checkbox"
                  checked={autoPromoteScanner}
                  onChange={(e) => setAutoPromoteScanner(e.target.checked)}
                  className="accent-emerald-500 w-3.5 h-3.5"
                />
              </label>

              <div className="flex flex-col gap-2">
                {scannerOpportunities.map((opp) => {
                  const spec = INDIAN_SYMBOLS[opp.symbol];
                  const isActiveSym = opp.symbol === activeSymbol;
                  return (
                    <div
                      key={opp.symbol}
                      className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                        isActiveSym
                          ? 'bg-slate-900 border-emerald-500/50'
                          : 'bg-slate-900/50 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-bold text-white">{opp.symbol}</span>
                        <span className="text-slate-300 tabular-nums">
                          {opp.price.toFixed(spec.decimals)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            opp.direction === 'BUY'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : opp.direction === 'SELL'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {opp.direction} {opp.confidencePct}%
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 leading-snug">{opp.reason}</div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] font-mono text-sky-400">
                          {opp.recommendedStrategy.split('_')[0]} · {opp.alignedTimeframes}/4 TF
                        </span>
                        <button
                          type="button"
                          onClick={() => handlePromoteScannerOpportunity(opp, false)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-600 text-[11px] font-medium text-slate-200 hover:text-white transition-colors"
                        >
                          Load to Tab
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ===================================================================== */}
      {/* MOBILE AI SCANNER DRAWER OVERLAY & MOBILE BOTTOM NAV BAR              */}
      {/* ===================================================================== */}
      {mobileScannerOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-slate-950/95 p-4 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 font-semibold text-sm text-white">
              <Radar className="w-4 h-4 text-emerald-400" />
              AI Background Scanner
            </div>
            <button
              type="button"
              onClick={() => setMobileScannerOpen(false)}
              className="p-1.5 rounded bg-slate-800 text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {scannerOpportunities.map((opp) => (
              <div
                key={opp.symbol}
                className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-bold text-white">{opp.symbol}</span>
                  <span className="text-slate-300">{opp.price.toFixed(INDIAN_SYMBOLS[opp.symbol].decimals)}</span>
                  <span className="text-emerald-300 font-bold">
                    {opp.direction} {opp.confidencePct}%
                  </span>
                </div>
                <p className="text-xs text-slate-400">{opp.reason}</p>
                <button
                  type="button"
                  onClick={() => {
                    handlePromoteScannerOpportunity(opp, false);
                    setMobileScannerOpen(false);
                  }}
                  className="py-1.5 px-3 rounded bg-emerald-600 text-white text-xs font-semibold"
                >
                  Load {opp.symbol} to Active Tab
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950 border-t border-slate-800 grid grid-cols-4 gap-1 p-1.5 text-[11px]"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const act = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`flex flex-col items-center gap-0.5 py-1.5 rounded-md ${
                act ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-full px-1">{item.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
