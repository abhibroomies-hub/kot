import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  Candle,
  IndicatorConfig,
  LiveMarketQuote,
  QuadChartSlotConfig,
  StrategyArchetype,
  TradingSymbol,
} from '../engine/types';
import { INDIAN_SYMBOLS, STRATEGY_CATALOG, computeIndicators } from '../engine/backtestEngine';
import { Sliders, Sparkles, BookmarkCheck } from 'lucide-react';

interface QuadChartCellProps {
  symbol: TradingSymbol;
  slot: QuadChartSlotConfig;
  rawCandles: Candle[];
  liveQuote: LiveMarketQuote | null;
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

export const QuadChartCell: React.FC<QuadChartCellProps> = React.memo(
  ({
    symbol,
    slot,
    rawCandles,
    liveQuote,
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

    const lastConfigKeyRef = useRef<string>('');
    const lastSeriesSeedKeyRef = useRef<string>('');
    const lastPlottedTimeRef = useRef<number>(0);
    const candleLookupRef = useRef<Map<number, Candle>>(new Map());

    const [hoverBar, setHoverBar] = useState<Candle | null>(null);
    const [showIndDrawer, setShowIndDrawer] = useState(false);

    const spec = INDIAN_SYMBOLS[symbol];
    const configKey = `${slot.indicatorConfig.fastEmaPeriod}-${slot.indicatorConfig.slowEmaPeriod}-${slot.indicatorConfig.rsiPeriod}-${slot.indicatorConfig.bollingerPeriod}-${slot.indicatorConfig.bollingerStdDev}`;

    const enrichedCandles = useMemo(() => {
      const slice = rawCandles.slice(-160);
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

    // Strictly ascending deduplicated candle list in Unix seconds for TradingView Lightweight Charts
    const tvBars = useMemo(() => {
      const out: Array<{ sec: UTCTimestamp; candle: Candle }> = [];
      let prevSec = -1;
      for (const c of enrichedCandles) {
        const sec = Math.floor(c.time / 1000);
        if (!Number.isFinite(sec) || sec <= 0) continue;
        if (sec <= prevSec) {
          if (out.length > 0 && sec === prevSec) {
            out[out.length - 1] = { sec: sec as UTCTimestamp, candle: c };
          }
          continue;
        }
        prevSec = sec;
        out.push({ sec: sec as UTCTimestamp, candle: c });
      }
      return out;
    }, [enrichedCandles]);

    // Initialize Official TradingView Lightweight Chart instance once per cell
    useEffect(() => {
      if (chartEngine !== 'TV_QUANT') return;
      const el = containerRef.current;
      if (!el) return;

      const chart = createChart(el, {
        width: Math.max(240, el.clientWidth),
        height: Math.max(210, el.clientHeight),
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
          setHoverBar(null);
          return;
        }
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
      lastPlottedTimeRef.current = 0;

      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || !chartRef.current) return;
        const { width, height } = entry.contentRect;
        if (width > 20 && height > 20) {
          chartRef.current.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
        }
      });
      ro.observe(el);

      return () => {
        ro.disconnect();
        chart.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        fastEmaSeriesRef.current = null;
        slowEmaSeriesRef.current = null;
        bbUpperSeriesRef.current = null;
        bbLowerSeriesRef.current = null;
        lastSeriesSeedKeyRef.current = '';
      };
    }, [chartEngine, symbol, slot.timeframe, spec.decimals, spec.tickSize]);

    // Sync real candles & indicators into TradingView Lightweight Charts (O(1) .update() on live ticks!)
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

      const firstSec = tvBars[0].sec;
      const lastItem = tvBars[tvBars.length - 1];
      const seedKey = `${symbol}|${slot.timeframe}|${configKey}|${firstSec}`;

      // Fast incremental path for live intra-bar or single-bar rollover ticks
      if (
        lastSeriesSeedKeyRef.current === seedKey &&
        lastItem.sec >= lastPlottedTimeRef.current &&
        tvBars.length > 2
      ) {
        const c = lastItem.candle;
        cSeries.update({
          time: lastItem.sec,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        });
        if (c.fastEma !== undefined) fSeries.update({ time: lastItem.sec, value: c.fastEma });
        if (c.slowEma !== undefined) sSeries.update({ time: lastItem.sec, value: c.slowEma });
        if (c.bbUpper !== undefined) uSeries.update({ time: lastItem.sec, value: c.bbUpper });
        if (c.bbLower !== undefined) lSeries.update({ time: lastItem.sec, value: c.bbLower });
        lastPlottedTimeRef.current = lastItem.sec;
        return;
      }

      // Full seed on mount, symbol change, or indicator parameter edit
      cSeries.setData(
        tvBars.map(({ sec, candle }) => ({
          time: sec,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }))
      );
      fSeries.setData(
        tvBars
          .filter(({ candle }) => candle.fastEma !== undefined)
          .map(({ sec, candle }) => ({ time: sec, value: candle.fastEma! }))
      );
      sSeries.setData(
        tvBars
          .filter(({ candle }) => candle.slowEma !== undefined)
          .map(({ sec, candle }) => ({ time: sec, value: candle.slowEma! }))
      );
      uSeries.setData(
        tvBars
          .filter(({ candle }) => candle.bbUpper !== undefined)
          .map(({ sec, candle }) => ({ time: sec, value: candle.bbUpper! }))
      );
      lSeries.setData(
        tvBars
          .filter(({ candle }) => candle.bbLower !== undefined)
          .map(({ sec, candle }) => ({ time: sec, value: candle.bbLower! }))
      );

      const visibleCount = Math.min(72, tvBars.length);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, tvBars.length - visibleCount),
        to: tvBars.length + 3,
      });

      lastSeriesSeedKeyRef.current = seedKey;
      lastPlottedTimeRef.current = lastItem.sec;
    }, [chartEngine, tvBars, symbol, slot.timeframe, configKey]);

    const activeBar = hoverBar ?? enrichedCandles[enrichedCandles.length - 1];
    const rsiVal = activeBar?.rsi ?? 50;

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
        {/* Top Compact Control Bar */}
        <div className="px-2.5 py-2 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-2 bg-slate-950/60">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-white font-mono text-xs font-bold shrink-0">
              {slot.timeframe}
            </span>
            <span className="text-xs font-semibold text-slate-200 truncate">{slot.patternLabel}</span>
            <span
              className={`px-1.5 py-0.5 rounded border text-[11px] font-mono font-semibold shrink-0 ${signalBadgeCls}`}
            >
              {slot.liveSignal ?? 'WAIT'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <select
              aria-label={`${slot.timeframe} Strategy`}
              value={slot.strategy}
              onChange={(e) => onChangeStrategy(e.target.value as StrategyArchetype)}
              className="bg-slate-900 border border-slate-700/80 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500 max-w-[138px] truncate"
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

        {/* Live OHLC + Active Indicator Telemetry Row (IST) */}
        {activeBar && (
          <div className="px-2.5 py-1 bg-slate-950/40 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-400">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
