import React, { useEffect, useRef, useState } from 'react';
import {
  BacktestResult,
  Candle,
  LiveMarketQuote,
  OptimizationComparison,
  TradingSymbol,
} from '../engine/types';
import { INDIAN_SYMBOLS } from '../engine/backtestEngine';
import { Play, Pause, RotateCcw, Upload, TrendingUp, CandlestickChart } from 'lucide-react';

interface HistoricalChartCanvasProps {
  comparison: OptimizationComparison;
  activePassView: 'REPAIRED' | 'INITIAL';
  onSelectPassView: (view: 'REPAIRED' | 'INITIAL') => void;
  onImportCustomCsv: (csvText: string) => void;
  isReplaying: boolean;
  replayProgressPct: number;
  onStartReplay: () => void;
  onStopReplay: () => void;
  onResetReplay: () => void;
  isLoadingMarketData?: boolean;
  marketError?: string | null;
  onRetryMarketFetch?: () => void;
  liveQuote?: LiveMarketQuote | null;
}

export const HistoricalChartCanvas: React.FC<HistoricalChartCanvasProps> = ({
  comparison,
  activePassView,
  onSelectPassView,
  onImportCustomCsv,
  isReplaying,
  replayProgressPct,
  onStartReplay,
  onStopReplay,
  onResetReplay,
  isLoadingMarketData = false,
  marketError = null,
  onRetryMarketFetch,
  liveQuote = null,
}) => {
  const [chartTab, setChartTab] = useState<'CANDLES' | 'EQUITY'>('CANDLES');
  const [windowSize, setWindowSize] = useState<number>(96);
  const [scrollOffset, setScrollOffset] = useState<number>(100);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showOverlays, setShowOverlays] = useState<boolean>(true);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvInput, setCsvInput] = useState('');
  const [csvError, setCsvError] = useState('');
  const dragStateRef = useRef<{ active: boolean; startX: number; startOffset: number }>({
    active: false,
    startX: 0,
    startOffset: 100,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSizeTick, setCanvasSizeTick] = useState(0);
  const activeResult: BacktestResult =
    activePassView === 'REPAIRED' ? comparison.repairedPass : comparison.initialPass;
  const spec = INDIAN_SYMBOLS[activeResult.symbol as TradingSymbol] || INDIAN_SYMBOLS.USDINR;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCanvasSizeTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalCandles = activeResult.candles.length;
  const effectiveMaxIndex = isReplaying
    ? Math.max(60, Math.floor((replayProgressPct / 100) * totalCandles))
    : totalCandles;

  const maxStart = Math.max(0, effectiveMaxIndex - windowSize);
  const startIndex = isReplaying
    ? maxStart
    : Math.min(maxStart, Math.floor((scrollOffset / 100) * maxStart));
  const visibleCandles = activeResult.candles.slice(startIndex, startIndex + windowSize);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    const height = Math.max(260, rect.height);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, width, height);

    const padLeft = 14;
    const padRight = spec.decimals >= 4 || (visibleCandles[0]?.close ?? 0) > 10000 ? 74 : 66;
    const padTop = 18;
    const padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let r = 0; r <= 5; r++) {
      const y = Math.round(padTop + (plotH / 5) * r) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    }

    for (let c = 0; c <= 6; c++) {
      const x = Math.round(padLeft + (plotW / 6) * c) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.stroke();
    }

    const formatLocalTime = (ms: number, withDate = true): string => {
      const d = new Date(ms);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (!withDate) return `${hh}:${mm}`;
      return `${d.getDate()} ${months[d.getMonth()]} ${hh}:${mm}`;
    };

    if (chartTab === 'CANDLES' && visibleCandles.length > 0) {
      const mainH = showOverlays ? plotH * 0.78 : plotH;
      const rsiTop = padTop + mainH + 10;
      const rsiH = plotH * 0.22 - 10;

      let minP = Infinity;
      let maxP = -Infinity;
      for (const c of visibleCandles) {
        if (c.low < minP) minP = c.low;
        if (c.high > maxP) maxP = c.high;
      }
      const rawSpan = Math.max(spec.tickSize * 8, maxP - minP);
      minP -= rawSpan * 0.07;
      maxP += rawSpan * 0.07;

      const priceToY = (p: number) =>
        padTop + mainH - ((p - minP) / Math.max(1e-8, maxP - minP)) * mainH;

      const stepX = plotW / visibleCandles.length;
      const candleW = Math.max(2, Math.min(13, stepX * 0.66));

      let maxVol = 0;
      let minVol = Infinity;
      for (const c of visibleCandles) {
        if (c.volume > maxVol) maxVol = c.volume;
        if (c.volume < minVol) minVol = c.volume;
      }
      if (maxVol > 0 && maxVol !== minVol) {
        const volMaxH = mainH * 0.14;
        visibleCandles.forEach((c, idx) => {
          if (c.volume <= 0) return;
          const xCenter = padLeft + idx * stepX + stepX / 2;
          const barH = Math.max(1, (c.volume / maxVol) * volMaxH);
          ctx.fillStyle = c.close >= c.open ? 'rgba(16, 185, 129, 0.18)' : 'rgba(244, 63, 94, 0.18)';
          ctx.fillRect(xCenter - candleW / 2, padTop + mainH - barH, candleW, barH);
        });
      }

      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      for (let r = 0; r <= 4; r++) {
        const val = maxP - ((maxP - minP) / 4) * r;
        const y = padTop + (mainH / 4) * r;
        ctx.fillText(val.toFixed(spec.decimals), width - padRight + 6, y + 4);
      }

      visibleCandles.forEach((c, idx) => {
        const xCenter = padLeft + idx * stepX + stepX / 2;
        const xWick = Math.round(xCenter) + 0.5;
        const color = c.close >= c.open ? '#10B981' : '#F43F5E';

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xWick, priceToY(c.high));
        ctx.lineTo(xWick, priceToY(c.low));
        ctx.stroke();

        const yOpen = priceToY(c.open);
        const yClose = priceToY(c.close);
        ctx.fillStyle = color;
        ctx.fillRect(xCenter - candleW / 2, Math.min(yOpen, yClose), candleW, Math.max(1.5, Math.abs(yClose - yOpen)));
      });

      const latestBar = visibleCandles[visibleCandles.length - 1];
      if (latestBar) {
        const yLive = Math.round(priceToY(latestBar.close)) + 0.5;
        const isBullLive = latestBar.close >= latestBar.open;
        ctx.strokeStyle = isBullLive ? 'rgba(16, 185, 129, 0.7)' : 'rgba(244, 63, 94, 0.7)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yLive);
        ctx.lineTo(width - padRight, yLive);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = isBullLive ? '#059669' : '#E11D48';
        ctx.fillRect(width - padRight + 2, yLive - 9, padRight - 4, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText(latestBar.close.toFixed(spec.decimals), width - padRight + 6, yLive + 3.5);
      }

      if (showOverlays) {
        const drawIndicatorLine = (getter: (c: Candle) => number | undefined, stroke: string) => {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          let started = false;
          visibleCandles.forEach((c, idx) => {
            const val = getter(c);
            if (val === undefined) return;
            const x = padLeft + idx * stepX + stepX / 2;
            const y = priceToY(val);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          });
          ctx.stroke();
        };

        drawIndicatorLine((c) => c.fastEma, 'rgba(56, 189, 248, 0.85)');
        drawIndicatorLine((c) => c.slowEma, 'rgba(245, 158, 11, 0.85)');

        const endWindowIndex = startIndex + visibleCandles.length - 1;
        const visibleTrades = activeResult.trades.filter(
          (t) =>
            (t.candleIndex >= startIndex && t.candleIndex <= endWindowIndex) ||
            (t.exitCandleIndex >= startIndex && t.exitCandleIndex <= endWindowIndex)
        );

        for (const t of visibleTrades) {
          if (t.candleIndex >= startIndex && t.candleIndex <= endWindowIndex) {
            const localIdx = t.candleIndex - startIndex;
            const x = padLeft + localIdx * stepX + stepX / 2;
            const y = priceToY(t.entryPrice);
            ctx.fillStyle = t.direction === 'BUY' ? '#22C55E' : '#EF4444';
            ctx.beginPath();
            if (t.direction === 'BUY') {
              ctx.moveTo(x, y + 6);
              ctx.lineTo(x - 4.5, y + 14);
              ctx.lineTo(x + 4.5, y + 14);
            } else {
              ctx.moveTo(x, y - 6);
              ctx.lineTo(x - 4.5, y - 14);
              ctx.lineTo(x + 4.5, y - 14);
            }
            ctx.closePath();
            ctx.fill();
          }

          if (t.exitCandleIndex >= startIndex && t.exitCandleIndex <= endWindowIndex) {
            const localExitIdx = t.exitCandleIndex - startIndex;
            const xExit = padLeft + localExitIdx * stepX + stepX / 2;
            const yExit = priceToY(t.exitPrice);
            ctx.beginPath();
            ctx.arc(xExit, yExit, 3.4, 0, Math.PI * 2);
            ctx.fillStyle = t.profitInr >= 0 ? '#10B981' : '#F43F5E';
            ctx.fill();
            ctx.strokeStyle = '#0F172A';
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.beginPath();
        ctx.moveTo(padLeft, rsiTop - 4);
        ctx.lineTo(width - padRight, rsiTop - 4);
        ctx.stroke();

        const rsiToY = (r: number) => rsiTop + rsiH - (Math.min(100, Math.max(0, r)) / 100) * rsiH;
        ctx.strokeStyle = '#A855F7';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        visibleCandles.forEach((c, idx) => {
          const x = padLeft + idx * stepX + stepX / 2;
          const y = rsiToY(c.rsi ?? 50);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = '#94A3B8';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(`RSI(${activeResult.indicatorConfigUsed.rsiPeriod})`, width - padRight + 6, rsiTop + 12);
      }

      ctx.fillStyle = '#64748B';
      ctx.font = '10px "JetBrains Mono", monospace';
      const maxLabels = width < 500 ? 4 : 7;
      const labelStep = Math.max(1, Math.floor(visibleCandles.length / maxLabels));
      const spanHours =
        (visibleCandles[visibleCandles.length - 1].time - visibleCandles[0].time) / 3_600_000;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      let prevLabelDay = -1;
      for (let i = 0; i < visibleCandles.length; i += labelStep) {
        const x = padLeft + i * stepX;
        if (x > width - padRight - 44) continue;
        const d = new Date(visibleCandles[i].time);
        const dayKey = d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
        let label: string;
        if (spanHours > 120) label = `${d.getDate()} ${months[d.getMonth()]}`;
        else if (dayKey !== prevLabelDay) {
          label = `${d.getDate()} ${months[d.getMonth()]}`;
          prevLabelDay = dayKey;
        } else {
          label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
        ctx.fillText(label, x, height - 8);
      }

      if (hoverIndex !== null && visibleCandles[hoverIndex]) {
        const hc = visibleCandles[hoverIndex];
        const hx = Math.round(padLeft + hoverIndex * stepX + stepX / 2) + 0.5;
        const hy = Math.round(priceToY(hc.close)) + 0.5;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, height - padBottom);
        ctx.moveTo(padLeft, hy);
        ctx.lineTo(width - padRight, hy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#334155';
        ctx.fillRect(width - padRight + 2, hy - 9, padRight - 4, 18);
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(hc.close.toFixed(spec.decimals), width - padRight + 6, hy + 3.5);

        const timeTag = formatLocalTime(hc.time, true);
        const tagW = Math.max(82, timeTag.length * 6.5 + 10);
        const tagX = Math.max(padLeft, Math.min(width - padRight - tagW, hx - tagW / 2));
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(tagX, height - padBottom + 2, tagW, 18);
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(timeTag, tagX + 5, height - padBottom + 14);
      }
    } else {
      const repCurve = comparison.repairedPass.equityCurve;
      const initCurve = comparison.initialPass.equityCurve;
      const maxPts = Math.max(2, Math.floor((effectiveMaxIndex / Math.max(1, totalCandles)) * repCurve.length));
      const repSlice = repCurve.slice(0, maxPts);
      const initSlice = initCurve.slice(0, maxPts);

      let minEq = comparison.repairedPass.initialCapitalInr * 0.7;
      let maxEq = comparison.repairedPass.initialCapitalInr * 1.2;
      for (const p of repSlice) {
        if (p.equity < minEq) minEq = p.equity;
        if (p.equity > maxEq) maxEq = p.equity;
      }
      for (const p of initSlice) {
        if (p.equity < minEq) minEq = p.equity;
        if (p.equity > maxEq) maxEq = p.equity;
      }
      minEq *= 0.96;
      maxEq *= 1.04;

      const eqToY = (eq: number) =>
        padTop + plotH - ((eq - minEq) / Math.max(1, maxEq - minEq)) * plotH;

      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px "JetBrains Mono", monospace';
      for (let r = 0; r <= 4; r++) {
        const val = maxEq - ((maxEq - minEq) / 4) * r;
        const y = padTop + (plotH / 4) * r;
        ctx.fillText(`₹${Math.round(val).toLocaleString('en-IN')}`, width - padRight + 4, y + 4);
      }

      if (initSlice.length > 1) {
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.75)';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        initSlice.forEach((pt, idx) => {
          const x = padLeft + (idx / Math.max(1, initSlice.length - 1)) * plotW;
          const y = eqToY(pt.equity);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      if (repSlice.length > 1) {
        ctx.beginPath();
        repSlice.forEach((pt, idx) => {
          const x = padLeft + (idx / Math.max(1, repSlice.length - 1)) * plotW;
          const y = eqToY(pt.equity);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 2.4;
        ctx.stroke();

        ctx.lineTo(padLeft + plotW, padTop + plotH);
        ctx.lineTo(padLeft, padTop + plotH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.fillStyle = '#64748B';
      const maxEqLabels = width < 500 ? 3 : 5;
      const step = Math.max(1, Math.floor(repSlice.length / maxEqLabels));
      for (let i = 0; i < repSlice.length; i += step) {
        const x = padLeft + (i / Math.max(1, repSlice.length - 1)) * plotW;
        if (x > width - padRight - 42) continue;
        ctx.fillText(repSlice[i].dateStr, x, height - 8);
      }
    }

    ctx.restore();
  }, [
    chartTab,
    visibleCandles,
    activeResult,
    comparison,
    effectiveMaxIndex,
    totalCandles,
    spec.decimals,
    spec.tickSize,
    startIndex,
    hoverIndex,
    showOverlays,
    canvasSizeTick,
  ]);

  const inspectedCandle: Candle | undefined =
    hoverIndex !== null && visibleCandles[hoverIndex]
      ? visibleCandles[hoverIndex]
      : visibleCandles[visibleCandles.length - 1];

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvInput.trim()) {
      setCsvError('Please paste valid OHLCV rows (Date,Open,High,Low,Close,Volume).');
      return;
    }
    setCsvError('');
    onImportCustomCsv(csvInput);
    setShowCsvModal(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 min-w-0 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg max-w-full">
            <button
              type="button"
              onClick={() => setChartTab('CANDLES')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartTab === 'CANDLES' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CandlestickChart className="w-3.5 h-3.5" />
              1-Year NSE/INR Price
            </button>
            <button
              type="button"
              onClick={() => setChartTab('EQUITY')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartTab === 'EQUITY' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              1-Year INR Equity Curve
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg max-w-full">
            <button
              type="button"
              onClick={() => onSelectPassView('REPAIRED')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activePassView === 'REPAIRED' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pass 2: Fixed ({comparison.repairedPass.winRatePct}% Win)
            </button>
            <button
              type="button"
              onClick={() => onSelectPassView('INITIAL')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activePassView === 'INITIAL' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pass 1: Raw ({comparison.initialPass.winRatePct}% Win)
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 max-w-full">
          {!isReplaying ? (
            <button
              type="button"
              onClick={onStartReplay}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              Replay 1Y Chart
            </button>
          ) : (
            <button
              type="button"
              onClick={onStopReplay}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause ({replayProgressPct}%)
            </button>
          )}
          <button
            type="button"
            onClick={onResetReplay}
            aria-label="Reset 1-Year Chart Replay"
            className="p-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowOverlays((v) => !v)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              showOverlays ? 'bg-slate-800 border-slate-700 text-sky-300' : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            {showOverlays ? 'Indicators: ON' : 'Clean Price'}
          </button>
          <button
            type="button"
            onClick={() => setShowCsvModal((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-950 border border-slate-700 hover:border-slate-500 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            Load NSE CSV
          </button>
        </div>
      </div>

      {showCsvModal && (
        <form onSubmit={handleImportSubmit} className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-200">
              Paste Historical OHLCV CSV Rows (Date, Open, High, Low, Close, Volume)
            </span>
            <button
              type="button"
              onClick={() =>
                setCsvInput(
                  `Date,Time,Open,High,Low,Close,Volume\n2026.01.05,09:30,93.1200,93.2450,93.0900,93.2250,2450\n2026.01.05,10:00,93.2250,93.3100,93.1950,93.2975,2890`
                )
              }
              className="text-xs text-emerald-400 hover:underline"
            >
              Insert Sample NSE Format
            </button>
          </div>
          <textarea
            rows={3}
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
            placeholder="2026.01.05,09:30,93.1200,93.2450,93.0900,93.2250,2450..."
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
          />
          {csvError && <p className="text-xs text-rose-400">{csvError}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setShowCsvModal(false)} className="px-3 py-1 text-xs text-slate-400">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1 text-xs font-medium bg-emerald-600 text-white rounded">
              Run 1-Year Backtest
            </button>
          </div>
        </form>
      )}

      {inspectedCandle && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums px-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-200 font-semibold">
              {activeResult.symbol} · {activeResult.timeframe}
            </span>
            <span className="text-emerald-400 font-sans font-medium">
              {activeResult.dataSource === 'CUSTOM_CSV'
                ? 'Custom NSE CSV'
                : `Real Market · ${activeResult.tickerLabel ?? activeResult.symbol}`}
            </span>
            <span>O: {inspectedCandle.open.toFixed(spec.decimals)}</span>
            <span>H: {inspectedCandle.high.toFixed(spec.decimals)}</span>
            <span>L: {inspectedCandle.low.toFixed(spec.decimals)}</span>
            <span className="text-slate-100">C: {inspectedCandle.close.toFixed(spec.decimals)}</span>
            {liveQuote && liveQuote.symbol === activeResult.symbol && (
              <span className="inline-flex items-center gap-1.5 text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                BID {liveQuote.bid.toFixed(spec.decimals)} / ASK {liveQuote.ask.toFixed(spec.decimals)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sky-400">
              EMA({activeResult.indicatorConfigUsed.fastEmaPeriod}): {(inspectedCandle.fastEma ?? inspectedCandle.close).toFixed(spec.decimals)}
            </span>
            <span className="text-amber-400">
              EMA({activeResult.indicatorConfigUsed.slowEmaPeriod}): {(inspectedCandle.slowEma ?? inspectedCandle.close).toFixed(spec.decimals)}
            </span>
            <span className="text-purple-400">RSI: {(inspectedCandle.rsi ?? 50).toFixed(1)}</span>
            <span className="text-emerald-400">ADX: {(inspectedCandle.adx ?? 20).toFixed(1)}</span>
          </div>
        </div>
      )}

      <div className="relative w-full h-72 sm:h-80 rounded-lg overflow-hidden border border-slate-800/90 bg-slate-950">
        <canvas
          ref={canvasRef}
          data-testid="historical-chart-canvas"
          onMouseDown={(e) => {
            if (chartTab !== 'CANDLES') return;
            dragStateRef.current = { active: true, startX: e.clientX, startOffset: scrollOffset };
          }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (dragStateRef.current.active && chartTab === 'CANDLES' && maxStart > 0) {
              const dx = e.clientX - dragStateRef.current.startX;
              const barsShifted = (dx / Math.max(1, rect.width)) * windowSize;
              const pctDelta = (barsShifted / maxStart) * 100;
              setScrollOffset(Math.max(0, Math.min(100, dragStateRef.current.startOffset - pctDelta)));
              return;
            }
            const relX = e.clientX - rect.left - 14;
            const plotW = Math.max(1, rect.width - 88);
            const idx = Math.floor((relX / plotW) * visibleCandles.length);
            if (idx >= 0 && idx < visibleCandles.length) setHoverIndex(idx);
          }}
          onMouseUp={() => {
            dragStateRef.current.active = false;
          }}
          onMouseLeave={() => {
            dragStateRef.current.active = false;
            setHoverIndex(null);
          }}
          onWheel={(e) => {
            if (chartTab !== 'CANDLES') return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? 12 : -12;
            setWindowSize((prev) => Math.max(36, Math.min(240, prev + delta)));
          }}
          className="w-full h-full block cursor-crosshair select-none"
        />

        {isLoadingMarketData && (
          <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-[1px] flex items-center justify-center z-10">
            <div className="px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 font-medium">
              Loading Real 1-Year NSE/INR OHLCV Candles ({activeResult.symbol} · {activeResult.timeframe})...
            </div>
          </div>
        )}

        {marketError && !isLoadingMarketData && (
          <div className="absolute top-2 left-2 right-2 bg-rose-950/90 border border-rose-800 rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs text-rose-200 z-10">
            <span>Market feed warning: {marketError}</span>
            {onRetryMarketFetch && (
              <button type="button" onClick={onRetryMarketFetch} className="px-2.5 py-1 bg-rose-700 text-white rounded text-xs shrink-0">
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {chartTab === 'CANDLES' && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1 text-xs text-slate-400">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <label htmlFor="year-scrubber" className="whitespace-nowrap shrink-0">
              1-Year Timeline ({activeResult.periodStart} to {activeResult.periodEnd}):
            </label>
            <input
              id="year-scrubber"
              type="range"
              min={0}
              max={100}
              value={scrollOffset}
              onChange={(e) => setScrollOffset(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-2">
            <span>Zoom Bars:</span>
            {[60, 96, 160].map((bars) => (
              <button
                key={bars}
                type="button"
                onClick={() => setWindowSize(bars)}
                className={`px-2 py-1 rounded text-xs font-mono ${
                  windowSize === bars ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {bars}b
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
