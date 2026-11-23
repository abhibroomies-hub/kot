import React from 'react';
import {
  IndicatorConfig,
  OptimizationComparison,
  StrategyArchetype,
} from '../engine/types';
import { STRATEGY_CATALOG, formatInr } from '../engine/backtestEngine';
import { Sliders, Sparkles, CheckCircle2, Wrench, Database } from 'lucide-react';

interface StrategyIndicatorFixerProps {
  selectedStrategy: StrategyArchetype;
  onSelectStrategy: (s: StrategyArchetype) => void;
  customIndicatorConfig: IndicatorConfig;
  onChangeIndicatorConfig: (cfg: IndicatorConfig) => void;
  onRunAutoFixPipeline: () => void;
  onRunManualBacktest: () => void;
  onSaveToAiVault: () => void;
  comparison: OptimizationComparison;
  aiAudit: {
    headline: string;
    hindiAdvice: string;
    parameterRecommendations: string[];
    dailyTargetPlan: string;
  } | null;
  aiLoading: boolean;
  onRequestAiAudit: () => void;
}

export const StrategyIndicatorFixer: React.FC<StrategyIndicatorFixerProps> = ({
  selectedStrategy,
  onSelectStrategy,
  customIndicatorConfig,
  onChangeIndicatorConfig,
  onRunAutoFixPipeline,
  onRunManualBacktest,
  onSaveToAiVault,
  comparison,
  aiAudit,
  aiLoading,
  onRequestAiAudit,
}) => {
  const { initialPass, repairedPass, diagnostics, improvementSummary } = comparison;

  const updateField = <K extends keyof IndicatorConfig>(key: K, value: IndicatorConfig[K]) => {
    onChangeIndicatorConfig({
      ...customIndicatorConfig,
      [key]: value,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Strategy Catalog */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              Strategy Architecture & 1-Year Self-Healing Lab
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pehle 1-saal ke NSE/INR purane chart par strategy test hoti hai, fir loss dene wale indicators automatically fix hote hain.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSaveToAiVault}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              Save to AI & Oracle Vault
            </button>
            <button
              type="button"
              onClick={onRunAutoFixPipeline}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Wrench className="w-3.5 h-3.5" />
              Auto-Test & Fix Indicators
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {STRATEGY_CATALOG.map((item) => {
            const active = item.id === selectedStrategy;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectStrategy(item.id)}
                className={`text-left p-3.5 rounded-lg border transition-colors flex flex-col justify-between gap-2 ${
                  active
                    ? 'bg-slate-950 border-emerald-500 text-white'
                    : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400 mb-1">
                    <span>{item.badge}</span>
                    <span className="font-mono">{item.recommendedPair}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{item.hindiSummary}</p>
                </div>
                <div className="text-xs font-mono text-emerald-400 pt-1">
                  {active ? 'Active Strategy' : 'Select Strategy'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Audit & Tuning Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Automatic Indicator Diagnostics (1-Year Audit)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Inspected {repairedPass.totalCandlesSimulated.toLocaleString()} candles ({repairedPass.periodStart} to {repairedPass.periodEnd})
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-400">
              {improvementSummary.winRateDeltaPct >= 0 ? '+' : ''}
              {improvementSummary.winRateDeltaPct}% Win Rate
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 leading-relaxed">
            <p className="font-medium text-emerald-400 mb-1">Verification Report:</p>
            <p>{improvementSummary.verdictHindi}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {diagnostics.map((d) => (
              <div
                key={d.id}
                className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col justify-between gap-2"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{d.indicatorName}</span>
                    <span className="font-mono text-emerald-400 shrink-0">{d.impactMetric}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{d.hindiExplanation}</p>
                </div>
                <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-rose-400 line-through">{d.oldValue}</span>
                  <span className="text-emerald-400 font-semibold">{d.newValue}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <th className="py-2.5 px-3 font-medium">1-Year Metric</th>
                  <th className="py-2.5 px-3 font-medium text-right">Pass 1 (Raw)</th>
                  <th className="py-2.5 px-3 font-medium text-right text-emerald-400">Pass 2 (Fixed)</th>
                  <th className="py-2.5 px-3 font-medium text-right">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                <tr>
                  <td className="py-2.5 px-3 font-sans text-slate-300">Net Profit (₹ INR)</td>
                  <td className="py-2.5 px-3 text-right text-slate-400">
                    {formatInr(initialPass.netProfitInr, true)} ({initialPass.netReturnPct}%)
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold">
                    {formatInr(repairedPass.netProfitInr, true)} ({repairedPass.netReturnPct}%)
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">
                    {formatInr(improvementSummary.netProfitDeltaInr, true)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans text-slate-300">Win Rate (%)</td>
                  <td className="py-2.5 px-3 text-right text-slate-400">
                    {initialPass.winRatePct}% ({initialPass.winningTrades}/{initialPass.totalTrades})
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold">
                    {repairedPass.winRatePct}% ({repairedPass.winningTrades}/{repairedPass.totalTrades})
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">
                    {improvementSummary.winRateDeltaPct >= 0 ? '+' : ''}
                    {improvementSummary.winRateDeltaPct}%
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans text-slate-300">Profit Factor</td>
                  <td className="py-2.5 px-3 text-right text-slate-400">{initialPass.profitFactor}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold">
                    {repairedPass.profitFactor}
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">
                    {improvementSummary.profitFactorDelta >= 0 ? '+' : ''}
                    {improvementSummary.profitFactorDelta}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-sans text-slate-300">Max Drawdown</td>
                  <td className="py-2.5 px-3 text-right text-rose-400">
                    {initialPass.maxDrawdownPct}% ({formatInr(initialPass.maxDrawdownInr)})
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold">
                    {repairedPass.maxDrawdownPct}% ({formatInr(repairedPass.maxDrawdownInr)})
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">
                    -{improvementSummary.drawdownReductionPct}% DD
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Indicator Parameters Calibration</h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">NSE Tune</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label htmlFor="ind-fast-ema" className="block text-slate-400 mb-1">Fast EMA Period</label>
                <input
                  id="ind-fast-ema"
                  type="number"
                  min={3}
                  max={50}
                  value={customIndicatorConfig.fastEmaPeriod}
                  onChange={(e) => updateField('fastEmaPeriod', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label htmlFor="ind-slow-ema" className="block text-slate-400 mb-1">Slow EMA Period</label>
                <input
                  id="ind-slow-ema"
                  type="number"
                  min={10}
                  max={200}
                  value={customIndicatorConfig.slowEmaPeriod}
                  onChange={(e) => updateField('slowEmaPeriod', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label htmlFor="ind-rsi-period" className="block text-slate-400 mb-1">RSI Period</label>
                <input
                  id="ind-rsi-period"
                  type="number"
                  min={5}
                  max={30}
                  value={customIndicatorConfig.rsiPeriod}
                  onChange={(e) => updateField('rsiPeriod', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label htmlFor="ind-adx-thresh" className="block text-slate-400 mb-1">ADX Chop Threshold</label>
                <input
                  id="ind-adx-thresh"
                  type="number"
                  min={10}
                  max={35}
                  value={customIndicatorConfig.adxThreshold}
                  onChange={(e) => updateField('adxThreshold', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label htmlFor="ind-atr-sl" className="block text-slate-400 mb-1">Stop-Loss (ATR Mult)</label>
                <input
                  id="ind-atr-sl"
                  type="number"
                  step="0.1"
                  min={0.5}
                  max={4.0}
                  value={customIndicatorConfig.atrMultiplierSL}
                  onChange={(e) => updateField('atrMultiplierSL', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label htmlFor="ind-atr-tp" className="block text-slate-400 mb-1">Take-Profit (ATR Mult)</label>
                <input
                  id="ind-atr-tp"
                  type="number"
                  step="0.1"
                  min={1.0}
                  max={8.0}
                  value={customIndicatorConfig.atrMultiplierTP}
                  onChange={(e) => updateField('atrMultiplierTP', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1 text-xs">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                <span className="text-slate-300">ADX Sideways Market Filter</span>
                <input
                  type="checkbox"
                  checked={customIndicatorConfig.useAdxFilter}
                  onChange={(e) => updateField('useAdxFilter', e.target.checked)}
                  className="accent-emerald-500 w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                <span className="text-slate-300">NSE Market Hours Filter (09:00–17:00 IST)</span>
                <input
                  type="checkbox"
                  checked={customIndicatorConfig.useSessionFilter}
                  onChange={(e) => updateField('useSessionFilter', e.target.checked)}
                  className="accent-emerald-500 w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                <span className="text-slate-300">Higher-Timeframe EMA Slope Confirmation</span>
                <input
                  type="checkbox"
                  checked={customIndicatorConfig.useHigherTimeframeTrend}
                  onChange={(e) => updateField('useHigherTimeframeTrend', e.target.checked)}
                  className="accent-emerald-500 w-4 h-4"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={onRunManualBacktest}
              className="w-full py-2.5 px-4 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Simulate Custom Parameters on 1-Year Chart
            </button>
            <button
              type="button"
              onClick={onRequestAiAudit}
              disabled={aiLoading}
              className="w-full py-2.5 px-4 text-xs font-semibold bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-300 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {aiLoading ? 'Running AI Quantitative Audit...' : 'Generate AI Strategy & INR Growth Plan'}
            </button>
          </div>
        </div>
      </div>

      {aiAudit && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-emerald-400">{aiAudit.headline}</h3>
            <span className="text-xs text-slate-400">Kotak Neo Quantitative Blueprint</span>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed bg-slate-950 p-3.5 rounded-lg border border-slate-800">
            {aiAudit.hindiAdvice}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {aiAudit.parameterRecommendations.map((rec, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 flex items-start gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{rec}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-400 pt-1">
            <strong className="text-slate-200">Daily Execution Plan:</strong> {aiAudit.dailyTargetPlan}
          </div>
        </div>
      )}
    </div>
  );
};
