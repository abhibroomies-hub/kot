import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  Candle,
  IndicatorConfig,
  LiveBotTrade,
  LiveMarketQuote,
  QuadChartSlotConfig,
  StrategyArchetype,
  TradingSymbol,
} from '../engine/types';
import { INDIAN_SYMBOLS, STRATEGY_CATALOG, computeIndicators, formatInr } from '../engine/backtestEngine';
import { Sliders, Sparkles, BookmarkCheck, Clock } from 'lucide-react';

interface QuadChartCellProps {
  symbol: TradingSymbol;
  slot: QuadChartSlotConfig;
  rawCandles: Candle[];
  liveQuote: LiveMarketQuote | null;
  openTrade?: LiveBotTrade | null;
  chartEngine?: 'TV_QUANT' | 'TRADINGVIEW_DIRECT';
  onChangeStrategy: (strategy: StrategyArchetype) => void;
  onToggleAutoAdapt: () => void;
  onUpdateIndicators: (cfg: IndicatorConfig) => void;
  onSaveToVault: () => void;
}

const IST_TIME_FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const IST_TIME_SEC_FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const IST_DATE_TIME_FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const TV_DIRECT_SYMBOLS: Record<TradingSymbol, string> = {
  USDINR: 'FX_IDC:USDINR',
  EURINR: 'FX_IDC:EURINR',
  GBPINR: 'FX_IDC:GBPINR',
  JPYINR: 'FX_IDC:JPYINR',
  EURUSD: 'FX:EURUSD',
  GBPUSD: 'FX:GBPUSD',
  USDJPY: 'FX:USDJPY',
  AUDUSD: 'FX:AUDUSD',
  USDCAD: 'FX:USDCAD',
  USDCHF: 'FX:USDCHF',
  EURGBP: 'FX:EURGBP',
  EURJPY: 'FX:EURJPY',
  GBPJPY: 'FX:GBPJPY',
  AUDINR: 'FX_IDC:AUDINR',
  CADINR: 'FX_IDC:CADINR',
  CHFINR: 'FX_IDC:CHFINR',
  NIFTY50: 'NSE:NIFTY',
  BANKNIFTY: 'NSE:BANKNIFTY',
  FINNIFTY: 'NSE:CNXFINANCE',
  GOLDPETAL: 'MCX:GOLDPETAL1!',
  GOLDM: 'MCX:GOLDM1!',
  GOLD: 'MCX:GOLD1!',
  SILVERMIC: 'MCX:SILVERMIC1!',
  CRUDEOILM: 'MCX:CRUDEOILM1!',
  XAUUSD: 'OANDA:XAUUSD',
};

const TV_DIRECT_INTERVALS: Record<QuadChartSlotConfig['timeframe'], string> = {
  '30M': '30',
  '5M': '5',
  '1M': '1',
  '30S': '1',
};

function buildTradingViewEmbedUrl(sym: TradingSymbol, tf: QuadChartSlotConfig['timeframe']): string {
  const tvSym = TV_DIRECT_SYMBOLS[sym];
  const interval = TV_DIRECT_INTERVALS[tf];
  const params = new URLSearchParams({
    frameElementId: `tv_${sym}_${tf}`,
    symbol: tvSym,
    interval,
    hidesidetoolbar: '1',
    hidetopbar: '1',
    symboledit: '0',
    saveimage: '0',
    toolbarbg: '0b101a',
    theme: 'dark',
    style: '1',
    timezone: 'Asia/Kolkata',
    withdateranges: '0',
    hideideas: '1',
    locale: 'en',
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

function computeCountdown(timeframe: QuadChartSlotConfig['timeframe'], nowMs: number) {
  const bucketMs =
    timeframe === '30S'
      ? 30_000
      : timeframe === '1M'
      ? 60_000
      : timeframe === '5M'
      ? 5 * 60_000
      : 30 * 60_000;
  const remMs = bucketMs - (nowMs % bucketMs);
  const totalSec = Math.max(0, Math.ceil(remMs / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return {
    label: `${mm}:${ss}`,
    urgent: totalSec <= 5,
  };
}

/**
 * Isolated 1-second countdown badge so the parent TradingView chart cell never re-renders every second.
 */
const CandleExpiryBadge: React.FC<{
  timeframe: QuadChartSlotConfig['timeframe'];
  isClosed: boolean;
  variant: 'header' | 'overlay';
}> = React.memo(({ timeframe, isClosed, variant }) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (isClosed) return;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [isClosed]);

  const countdown = computeCountdown(timeframe, nowMs);

  if (variant === 'overlay') {
    return (
      <div className="absolute bottom-7 left-2 z-10 pointer-events-none flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950/85 border border-slate-800 text-[10px] font-mono tabular-nums text-slate-300">
        <span className="text-slate-400">Candle Close:</span>
        <span
          className={
            isClosed
              ? 'text-slate-400'
              : countdown.urgent
              ? 'text-amber-300 font-bold'
              : 'text-sky-300 font-semibold'
          }
        >
          {isClosed ? 'MKT CLOSED' : countdown.label}
        </span>
      </div>
    );
  }

  return (
    <span
      data-testid={`candle-expiry-${timeframe}`}
      title={isClosed ? `${timeframe} Market Closed` : `Current ${timeframe} candle closes in ${countdown.label}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono tabular-nums font-semibold shrink-0 ${
        isClosed
          ? 'bg-slate-900 border-slate-700 text-slate-400'
          : countdown.urgent
          ? 'bg-amber-500/20 border-amber-400/60 text-amber-300 animate-pulse'
          : 'bg-sky-500/10 border-sky-500/35 text-sky-300'
      }`}
    >
      <Clock className="w-3 h-3" />
      {isClosed ? 'CLOSED' : countdown.label}
    </span>
  );
});

export const QuadChartCell: React.FC<QuadChartCellProps> = React.memo(
  ({
    symbol,
    slot,
    rawCandles,
    liveQuote,
    openTrade = null,
    chartEngine = 'TV_QUANT',
    onChangeStrategy,
    onToggleAutoAdapt,
    onUpdateIndicators,
    onSaveToVault,
  }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const fastEmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const slowEmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const tradePriceLinesRef = useRef<IPriceLine[]>([]);

    const lastConfigKeyRef = useRef<string>('');
    const lastSeriesSeedKeyRef = useRef<string>('');
    const lastViewportKeyRef = useRef<string>('');
    const seriesLastSecRef = useRef<{
      candle: number;
      fast: number;
      slow: number;
      bbUp: number;
      bbLo: number;
    }>({ candle: 0, fast: 0, slow: 0, bbUp: 0, bbLo: 0 });
    const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
    const candleLookupRef = useRef<Map<number, Candle>>(new Map());
    const hoveredSecRef = useRef<number | null>(null);

    const [hoverBar, setHoverBar] = useState<Candle | null>(null);
    const [showIndDrawer, setShowIndDrawer] = useState(false);

    const spec = INDIAN_SYMBOLS[symbol];
    const configKey = `${slot.indicatorConfig.fastEmaPeriod}-${slot.indicatorConfig.slowEmaPeriod}-${slot.indicatorConfig.rsiPeriod}-${slot.indicatorConfig.bollingerPeriod}-${slot.indicatorConfig.bollingerStdDev}`;

    const enrichedCandles = useMemo(() => {
      const slice = rawCandles.slice(-220);
      if (slice.length === 0) return slice;
      const last = slice[slice.length - 1];
      const hasPrecomputed =
        last.fastEma !== undefined &&
        last.slowEma !== undefined &&
        last.rsi !== undefined &&
        lastConfigKeyRef.current === configKey;
      if (hasPrecomputed) {
        return slice;
      }
      lastConfigKeyRef.current = configKey;
      return computeIndicators(slice, slot.indicatorConfig);
    }, [rawCandles, slot.indicatorConfig, configKey]);

    // Strictly ascending finite candle list in Unix seconds for TradingView Lightweight Charts v5
    const tvBars = useMemo(() => {
      const out: Array<{ sec: UTCTimestamp; candle: Candle }> = [];
      let prevSec = -1;
      for (const c of enrichedCandles) {
        const sec = Math.floor(c.time / 1000);
        if (
          !Number.isFinite(sec) ||
          sec <= 0 ||
          !Number.isFinite(c.open) ||
          !Number.isFinite(c.high) ||
          !Number.isFinite(c.low) ||
          !Number.isFinite(c.close) ||
          c.open <= 0 ||
          c.close <= 0
        ) {
          continue;
        }
        const cleanCandle: Candle = {
          ...c,
          high: Math.max(c.high, c.open, c.close),
          low: Math.min(c.low, c.open, c.close),
        };
        if (sec <= prevSec) {
          if (out.length > 0 && sec === prevSec) {
            out[out.length - 1] = { sec: sec as UTCTimestamp, candle: cleanCandle };
          }
          continue;
        }
        prevSec = sec;
        out.push({ sec: sec as UTCTimestamp, candle: cleanCandle });
      }
      return out;
    }, [enrichedCandles]);

    // Initialize Official TradingView Lightweight Chart instance once per cell
    useEffect(() => {
      if (chartEngine !== 'TV_QUANT') return;
      const el = containerRef.current;
      if (!el) return;

      const initW = Math.max(240, Math.floor(el.clientWidth));
      const initH = Math.max(210, Math.floor(el.clientHeight));
      lastSizeRef.current = { w: initW, h: initH };

      const chart = createChart(el, {
        width: initW,
        height: initH,
        layout: {
          background: { type: ColorType.Solid, color: '#070B12' },
          textColor: '#94A3B8',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: 'rgba(148, 163, 184, 0.06)' },
          horzLines: { color: 'rgba(148, 163, 184, 0.06)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: 'rgba(148, 163, 184, 0.45)',
            width: 1,
            style: LineStyle.Dashed,
            labelBackgroundColor: '#1E293B',
          },
          horzLine: {
            color: 'rgba(148, 163, 184, 0.45)',
            width: 1,
            style: LineStyle.Dashed,
            labelBackgroundColor: '#1E293B',
          },
        },
        rightPriceScale: {
          borderColor: 'rgba(51, 65, 85, 0.5)',
          scaleMargins: { top: 0.08, bottom: 0.08 },
          autoScale: true,
        },
        timeScale: {
          borderColor: 'rgba(51, 65, 85, 0.5)',
          timeVisible: true,
          secondsVisible: slot.timeframe === '30S',
          rightOffset: 4,
          barSpacing: 7,
          minBarSpacing: 2.5,
          tickMarkFormatter: (time: number) => {
            const d = new Date(time * 1000);
            return slot.timeframe === '30S' ? IST_TIME_SEC_FMT.format(d) : IST_TIME_FMT.format(d);
          },
        },
        localization: {
          timeFormatter: (time: number) => `${IST_DATE_TIME_FMT.format(new Date(time * 1000))} IST`,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      });

      const priceFormat = {
        type: 'price' as const,
        precision: spec.decimals,
        minMove: spec.tickSize,
      };

      const bbUpperSeries = chart.addSeries(LineSeries, {
        color: 'rgba(56, 189, 248, 0.28)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      });

      const bbLowerSeries = chart.addSeries(LineSeries, {
        color: 'rgba(56, 189, 248, 0.28)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#26A69A',
        downColor: '#EF5350',
        borderVisible: false,
        wickUpColor: '#26A69A',
        wickDownColor: '#EF5350',
        priceLineVisible: true,
        priceLineWidth: 1,
        priceLineStyle: LineStyle.Dashed,
        lastValueVisible: true,
        priceFormat,
      });

      const fastEmaSeries = chart.addSeries(LineSeries, {
        color: '#38BDF8',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      });

      const slowEmaSeries = chart.addSeries(LineSeries, {
        color: '#F59E0B',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      });

      chart.subscribeCrosshairMove((param) => {
        if (!param.time || typeof param.time !== 'number') {
          if (hoveredSecRef.current !== null) {
            hoveredSecRef.current = null;
            setHoverBar(null);
          }
          return;
        }
        if (hoveredSecRef.current === param.time) return;
        hoveredSecRef.current = param.time;
        const matched = candleLookupRef.current.get(param.time) ?? null;
        setHoverBar(matched);
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      fastEmaSeriesRef.current = fastEmaSeries;
      slowEmaSeriesRef.current = slowEmaSeries;
      bbUpperSeriesRef.current = bbUpperSeries;
      bbLowerSeriesRef.current = bbLowerSeries;
      lastSeriesSeedKeyRef.current = '';
      lastViewportKeyRef.current = '';
      seriesLastSecRef.current = { candle: 0, fast: 0, slow: 0, bbUp: 0, bbLo: 0 };

      let rafId = 0;
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w <= 20 || h <= 20) return;
        const prev = lastSizeRef.current;
        if (Math.abs(w - prev.w) < 2 && Math.abs(h - prev.h) < 2) return;
        lastSizeRef.current = { w, h };
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          chartRef.current?.applyOptions({ width: w, height: h });
        });
      });
      ro.observe(el);

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        ro.disconnect();
        chart.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        fastEmaSeriesRef.current = null;
        slowEmaSeriesRef.current = null;
        bbUpperSeriesRef.current = null;
        bbLowerSeriesRef.current = null;
        lastSeriesSeedKeyRef.current = '';
        lastViewportKeyRef.current = '';
      };
    }, [chartEngine, symbol, slot.timeframe, spec.decimals, spec.tickSize]);

    // Sync real candles & indicators into TradingView Lightweight Charts (O(1) .update() without resetting zoom!)
    useEffect(() => {
      if (chartEngine !== 'TV_QUANT') return;
      const cSeries = candleSeriesRef.current;
      const fSeries = fastEmaSeriesRef.current;
      const sSeries = slowEmaSeriesRef.current;
      const uSeries = bbUpperSeriesRef.current;
      const lSeries = bbLowerSeriesRef.current;
      const chart = chartRef.current;
      if (!cSeries || !fSeries || !sSeries || !uSeries || !lSeries || !chart || tvBars.length === 0) {
        return;
      }

      const lookup = new Map<number, Candle>();
      for (const item of tvBars) lookup.set(item.sec, item.candle);
      candleLookupRef.current = lookup;

      const viewportKey = `${symbol}|${slot.timeframe}`;
      const seedKey = `${symbol}|${slot.timeframe}|${configKey}`;
      const lastItem = tvBars[tvBars.length - 1];
      const tracker = seriesLastSecRef.current;

      // Fast O(1) incremental path for live intra-bar updates & bar rollovers (NEVER resets zoom/scroll!)
      if (
        lastSeriesSeedKeyRef.current === seedKey &&
        tracker.candle > 0 &&
        lastItem.sec >= tracker.candle &&
        tvBars.length > 2
      ) {
        try {
          const tail = tvBars.slice(-2);
          for (const { sec, candle: c } of tail) {
            if (sec >= tracker.candle) {
              cSeries.update({
                time: sec,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
              });
              tracker.candle = sec;
            }
            if (c.fastEma !== undefined && Number.isFinite(c.fastEma) && sec >= tracker.fast) {
              fSeries.update({ time: sec, value: c.fastEma });
              tracker.fast = sec;
            }
            if (c.slowEma !== undefined && Number.isFinite(c.slowEma) && sec >= tracker.slow) {
              sSeries.update({ time: sec, value: c.slowEma });
              tracker.slow = sec;
            }
            if (c.bbUpper !== undefined && Number.isFinite(c.bbUpper) && sec >= tracker.bbUp) {
              uSeries.update({ time: sec, value: c.bbUpper });
              tracker.bbUp = sec;
            }
            if (c.bbLower !== undefined && Number.isFinite(c.bbLower) && sec >= tracker.bbLo) {
              lSeries.update({ time: sec, value: c.bbLower });
              tracker.bbLo = sec;
            }
          }
          return;
        } catch {
          // If historical alignment replaced older timestamps, fall through cleanly to full setData
        }
      }

      // Full seed on mount, symbol switch, or indicator config change
      const candleData = tvBars.map(({ sec, candle }) => ({
        time: sec,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));
      const fastData = tvBars
        .filter(({ candle }) => candle.fastEma !== undefined && Number.isFinite(candle.fastEma))
        .map(({ sec, candle }) => ({ time: sec, value: candle.fastEma! }));
      const slowData = tvBars
        .filter(({ candle }) => candle.slowEma !== undefined && Number.isFinite(candle.slowEma))
        .map(({ sec, candle }) => ({ time: sec, value: candle.slowEma! }));
      const bbUpData = tvBars
        .filter(({ candle }) => candle.bbUpper !== undefined && Number.isFinite(candle.bbUpper))
        .map(({ sec, candle }) => ({ time: sec, value: candle.bbUpper! }));
      const bbLoData = tvBars
        .filter(({ candle }) => candle.bbLower !== undefined && Number.isFinite(candle.bbLower))
        .map(({ sec, candle }) => ({ time: sec, value: candle.bbLower! }));

      cSeries.setData(candleData);
      fSeries.setData(fastData);
      sSeries.setData(slowData);
      uSeries.setData(bbUpData);
      lSeries.setData(bbLoData);

      // Only initialize visible range when symbol or timeframe changes (preserve user zoom/pan on AI adaptation!)
      if (lastViewportKeyRef.current !== viewportKey) {
        const visibleCount = Math.min(72, tvBars.length);
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, tvBars.length - visibleCount),
          to: tvBars.length + 3,
        });
        lastViewportKeyRef.current = viewportKey;
      }

      lastSeriesSeedKeyRef.current = seedKey;
      seriesLastSecRef.current = {
        candle: candleData[candleData.length - 1]?.time ?? 0,
        fast: fastData[fastData.length - 1]?.time ?? 0,
        slow: slowData[slowData.length - 1]?.time ?? 0,
        bbUp: bbUpData[bbUpData.length - 1]?.time ?? 0,
        bbLo: bbLoData[bbLoData.length - 1]?.time ?? 0,
      };
    }, [chartEngine, tvBars, symbol, slot.timeframe, configKey]);

    // Draw Live Position Entry, Trailing SL & Auto-Expanding TP Price Lines directly on candles!
    useEffect(() => {
      const cSeries = candleSeriesRef.current;
      if (!cSeries || chartEngine !== 'TV_QUANT') return;

      for (const line of tradePriceLinesRef.current) {
        try {
          cSeries.removePriceLine(line);
        } catch {
          // ignore
        }
      }
      tradePriceLinesRef.current = [];

      if (!openTrade || openTrade.status !== 'OPEN' || openTrade.symbol !== symbol) {
        return;
      }

      const entryLine = cSeries.createPriceLine({
        price: openTrade.entryPrice,
        color: openTrade.direction === 'BUY' ? '#38BDF8' : '#C084FC',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${openTrade.direction} ${openTrade.lots}L (${formatInr(openTrade.pnlInr, true)})`,
      });

      const slLabel = openTrade.trailingActivated
        ? 'TRAIL SL'
        : openTrade.breakEvenLocked
        ? 'BE LOCK SL'
        : 'STOP LOSS';
      const slLine = cSeries.createPriceLine({
        price: openTrade.stopLoss,
        color: '#F43F5E',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: slLabel,
      });

      const tpStep = openTrade.targetStepCount ?? 0;
      const tpLine = cSeries.createPriceLine({
        price: openTrade.takeProfit,
        color: '#10B981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: tpStep > 0 ? `NEW TARGET +${tpStep}` : 'TARGET TP',
      });

      tradePriceLinesRef.current = [entryLine, slLine, tpLine];
    }, [
      chartEngine,
      symbol,
      openTrade?.id,
      openTrade?.status,
      openTrade?.entryPrice,
      openTrade?.stopLoss,
      openTrade?.takeProfit,
      openTrade?.pnlInr,
      openTrade?.trailingActivated,
      openTrade?.breakEvenLocked,
      openTrade?.targetStepCount,
      openTrade?.direction,
      openTrade?.lots,
      openTrade?.symbol,
    ]);

    const activeBar = hoverBar ?? enrichedCandles[enrichedCandles.length - 1];
    const rsiVal = activeBar?.rsi ?? 50;
    const isMarketClosed = liveQuote?.marketStatus === 'NSE_CLOSED';

    const signalBadgeCls =
      slot.liveSignal === 'BUY'
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
        : slot.liveSignal === 'SELL'
        ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
        : 'bg-slate-800/80 text-slate-400 border-slate-700/70';

    const tvDirectUrl = useMemo(
      () => (chartEngine === 'TRADINGVIEW_DIRECT' ? buildTradingViewEmbedUrl(symbol, slot.timeframe) : ''),
      [chartEngine, symbol, slot.timeframe]
    );

    return (
      <div
        data-testid={`quad-chart-${slot.timeframe}`}
        className="bg-slate-900/95 border border-slate-800 rounded-lg flex flex-col overflow-hidden min-w-0 relative"
      >
        {/* Top Fixed-Height Single-Row Control Bar */}
        <div className="px-2.5 py-2 border-b border-slate-800/90 flex items-center justify-between gap-2 bg-slate-950/60 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-white font-mono text-xs font-bold shrink-0">
              {slot.timeframe}
            </span>
            <span className="text-xs font-semibold text-slate-200 truncate">{slot.patternLabel}</span>
            <span
              className={`px-1.5 py-0.5 rounded border text-[11px] font-mono font-semibold shrink-0 ${signalBadgeCls}`}
            >
              {slot.liveSignal ?? 'WAIT'}
            </span>
            <CandleExpiryBadge timeframe={slot.timeframe} isClosed={isMarketClosed} variant="header" />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <select
              aria-label={`${slot.timeframe} Strategy`}
              value={slot.strategy}
              onChange={(e) => onChangeStrategy(e.target.value as StrategyArchetype)}
              className="bg-slate-900 border border-slate-700/80 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500 max-w-[132px] truncate"
            >
              {STRATEGY_CATALOG.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name.split(' ')[0]} {s.name.split(' ')[1]}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onToggleAutoAdapt}
              title="AI auto-adapts strategy & indicators when market structure shifts"
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 ${
                slot.autoAdapt
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              AI
            </button>

            <button
              type="button"
              onClick={() => setShowIndDrawer((v) => !v)}
              aria-label={`Configure ${slot.timeframe} indicators`}
              className={`p-1 rounded border transition-colors shrink-0 ${
                showIndDrawer
                  ? 'bg-slate-800 border-sky-500/50 text-sky-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Fixed Single-Line OHLC + Active Indicator Telemetry Row (zero vertical wrapping bounce!) */}
        {activeBar && (
          <div className="px-2.5 py-1 bg-slate-950/40 border-b border-slate-800/60 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar whitespace-nowrap text-[11px] font-mono tabular-nums text-slate-400">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-200 font-semibold">
                {liveQuote?.contractSymbol ?? symbol}
              </span>
              <span>O:{activeBar.open.toFixed(spec.decimals)}</span>
              <span>H:{activeBar.high.toFixed(spec.decimals)}</span>
              <span>L:{activeBar.low.toFixed(spec.decimals)}</span>
              <span
                className={
                  activeBar.close >= activeBar.open ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'
                }
              >
                C:{activeBar.close.toFixed(spec.decimals)}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sky-400">
                E({slot.indicatorConfig.fastEmaPeriod}):
                {(activeBar.fastEma ?? activeBar.close).toFixed(spec.decimals)}
              </span>
              <span className="text-amber-400">
                E({slot.indicatorConfig.slowEmaPeriod}):
                {(activeBar.slowEma ?? activeBar.close).toFixed(spec.decimals)}
              </span>
              <span
                className={
                  rsiVal >= 70
                    ? 'text-rose-400 font-semibold'
                    : rsiVal <= 30
                    ? 'text-emerald-400 font-semibold'
                    : 'text-purple-400'
                }
              >
                RSI:{rsiVal.toFixed(0)}
              </span>
            </div>
          </div>
        )}

        {/* Optional Quick Inline Indicator Editor Overlay */}
        {showIndDrawer && (
          <div className="p-2.5 bg-slate-950/95 border-b border-slate-800 flex flex-wrap items-end justify-between gap-2 text-[11px]">
            <div className="grid grid-cols-5 gap-1.5 flex-1 min-w-[240px]">
              <div>
                <label className="block text-slate-400 mb-0.5">Fast EMA</label>
                <input
                  type="number"
                  min={2}
                  max={40}
                  value={slot.indicatorConfig.fastEmaPeriod}
                  onChange={(e) =>
                    onUpdateIndicators({
                      ...slot.indicatorConfig,
                      fastEmaPeriod: Math.max(2, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">Slow EMA</label>
                <input
                  type="number"
                  min={6}
                  max={120}
                  value={slot.indicatorConfig.slowEmaPeriod}
                  onChange={(e) =>
                    onUpdateIndicators({
                      ...slot.indicatorConfig,
                      slowEmaPeriod: Math.max(6, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">RSI</label>
                <input
                  type="number"
                  min={4}
                  max={28}
                  value={slot.indicatorConfig.rsiPeriod}
                  onChange={(e) =>
                    onUpdateIndicators({
                      ...slot.indicatorConfig,
                      rsiPeriod: Math.max(4, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">SL ATR</label>
                <input
                  type="number"
                  step="0.1"
                  min={0.5}
                  max={4}
                  value={slot.indicatorConfig.atrMultiplierSL}
                  onChange={(e) =>
                    onUpdateIndicators({
                      ...slot.indicatorConfig,
                      atrMultiplierSL: Math.max(0.5, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">TP ATR</label>
                <input
                  type="number"
                  step="0.1"
                  min={1}
                  max={6}
                  value={slot.indicatorConfig.atrMultiplierTP}
                  onChange={(e) =>
                    onUpdateIndicators({
                      ...slot.indicatorConfig,
                      atrMultiplierTP: Math.max(1, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onSaveToVault();
                setShowIndDrawer(false);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium whitespace-nowrap shrink-0"
            >
              <BookmarkCheck className="w-3.5 h-3.5" />
              Save to AI Vault
            </button>
          </div>
        )}

        {/* Official TradingView Lightweight Charts v5 OR Direct TradingView Widget */}
        <div className="relative w-full h-[230px] sm:h-[255px] lg:h-[270px] bg-[#070B12]">
          {openTrade && openTrade.status === 'OPEN' && openTrade.symbol !== undefined && openTrade.symbol === symbol && (
            <div className="absolute top-2 left-2 z-10 pointer-events-none flex flex-wrap items-center gap-1.5 px-2 py-1 rounded bg-slate-950/90 border border-sky-500/50 text-[10px] font-mono shadow-lg">
              <span
                className={
                  openTrade.direction === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                }
              >
                LIVE {openTrade.direction} {openTrade.lots}L @ {openTrade.entryPrice.toFixed(spec.decimals)}
              </span>
              <span className="text-rose-300">
                SL:{openTrade.stopLoss.toFixed(spec.decimals)}
                {openTrade.trailingActivated ? '(TRAIL)' : openTrade.breakEvenLocked ? '(BE)' : ''}
              </span>
              <span className="text-emerald-300">
                TP{openTrade.targetStepCount ? `+${openTrade.targetStepCount}` : ''}:
                {openTrade.takeProfit.toFixed(spec.decimals)}
              </span>
              <span
                className={
                  openTrade.pnlInr >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                }
              >
                {formatInr(openTrade.pnlInr, true)}
              </span>
            </div>
          )}
          <CandleExpiryBadge timeframe={slot.timeframe} isClosed={isMarketClosed} variant="overlay" />
          {chartEngine === 'TRADINGVIEW_DIRECT' ? (
            <iframe
              title={`${symbol} ${slot.timeframe} TradingView Direct`}
              src={tvDirectUrl}
              className="w-full h-full border-0"
              loading="lazy"
            />
          ) : (
            <>
              <div ref={containerRef} className="w-full h-full" />
              {tvBars.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 font-mono pointer-events-none">
                  Loading live {symbol} {slot.timeframe} candles (IST)...
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
);
