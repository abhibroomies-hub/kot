import React, { useState } from 'react';
import {
  BacktestResult,
  RiskConfig,
  TradingSymbol,
} from '../engine/types';
import {
  INDIAN_SYMBOLS,
  calculateCompoundingPlan,
  calculateLotSize,
  formatInr,
} from '../engine/backtestEngine';
import { ShieldCheck, Calculator, TrendingUp } from 'lucide-react';

interface RiskAndGrowthPlannerProps {
  riskConfig: RiskConfig;
  onChangeRiskConfig: (cfg: RiskConfig) => void;
  verifiedResult: BacktestResult;
  symbol: TradingSymbol;
}

export const RiskAndGrowthPlanner: React.FC<RiskAndGrowthPlannerProps> = ({
  riskConfig,
  onChangeRiskConfig,
  verifiedResult,
  symbol,
}) => {
  const [horizonDays, setHorizonDays] = useState<30 | 60 | 90>(30);
  const [stopLossTicksInput, setStopLossTicksInput] = useState<number>(24);

  const spec = INDIAN_SYMBOLS[symbol];
  const milestones = calculateCompoundingPlan(
    riskConfig.initialCapitalInr,
    Math.max(0.65, verifiedResult.avgDailyReturnPct * 1.25),
    riskConfig,
    symbol,
    horizonDays
  );

  const computedLots = calculateLotSize(
    riskConfig.initialCapitalInr,
    riskConfig.riskPerTradePct,
    stopLossTicksInput * spec.tickSize,
    symbol,
    riskConfig.leverage
  );

  const riskInrPerTrade = Number(
    ((riskConfig.initialCapitalInr * riskConfig.riskPerTradePct) / 100).toFixed(2)
  );
  const dailyStopLossInr = Number(
    ((riskConfig.initialCapitalInr * riskConfig.maxDailyDrawdownPct) / 100).toFixed(2)
  );
  const dailyTargetInr = Number(
    ((riskConfig.initialCapitalInr * riskConfig.maxDailyProfitTargetPct) / 100).toFixed(2)
  );

  const updateRiskField = <K extends keyof RiskConfig>(key: K, value: RiskConfig[K]) => {
    onChangeRiskConfig({
      ...riskConfig,
      [key]: value,
    });
  };

  const finalMilestone = milestones[milestones.length - 1];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-base font-semibold text-white">
                Strict Risk Management & Kotak Neo Margin Guardrails
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Circuit Breaker Saved {verifiedResult.circuitBreakerSaves} Days
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3.5 rounded-lg border border-slate-800">
            <strong className="text-emerald-400">Risk Hai To Ishq Hai — Capital First:</strong>{' '}
            Kotak Neo par har trade aapke live ₹ INR equity ke hisab se exact NSE Lot Size calculate karta hai. Agar kisi din Daily Loss Limit (-{riskConfig.maxDailyDrawdownPct}%) hit ho jaye, toh bot automatically trading pause kar deta hai.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="risk-capital" className="block text-slate-400 mb-1">
                Account Capital (₹ INR)
              </label>
              <input
                id="risk-capital"
                type="number"
                min={5000}
                max={25000000}
                step={5000}
                value={riskConfig.initialCapitalInr}
                onChange={(e) =>
                  updateRiskField('initialCapitalInr', Math.max(5000, Number(e.target.value)))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>

            <div>
              <label htmlFor="risk-leverage" className="block text-slate-400 mb-1">
                Kotak Margin Leverage (Intraday MIS)
              </label>
              <select
                id="risk-leverage"
                value={riskConfig.leverage}
                onChange={(e) =>
                  updateRiskField('leverage', Number(e.target.value) as RiskConfig['leverage'])
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              >
                <option value={1}>1x (NRML Overnight Cash Margin)</option>
                <option value={5}>5x (Conservative Intraday)</option>
                <option value={10}>10x (NSE CDS Currency Standard)</option>
                <option value={20}>20x (High Margin Efficiency)</option>
                <option value={35}>35x (Max Permitted CDS)</option>
              </select>
            </div>

            <div>
              <label htmlFor="risk-per-trade" className="block text-slate-400 mb-1">
                Risk Per Trade: <span className="text-emerald-400 font-mono">{riskConfig.riskPerTradePct}% ({formatInr(riskInrPerTrade)})</span>
              </label>
              <input
                id="risk-per-trade"
                type="range"
                min={0.25}
                max={3.0}
                step={0.25}
                value={riskConfig.riskPerTradePct}
                onChange={(e) => updateRiskField('riskPerTradePct', Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            <div>
              <label htmlFor="risk-daily-dd" className="block text-slate-400 mb-1">
                Daily Loss Circuit Breaker: <span className="text-rose-400 font-mono">-{riskConfig.maxDailyDrawdownPct}% (-{formatInr(dailyStopLossInr)})</span>
              </label>
              <input
                id="risk-daily-dd"
                type="range"
                min={1.5}
                max={8.0}
                step={0.5}
                value={riskConfig.maxDailyDrawdownPct}
                onChange={(e) => updateRiskField('maxDailyDrawdownPct', Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>

            <div>
              <label htmlFor="risk-daily-tp" className="block text-slate-400 mb-1">
                Daily Profit Lock: <span className="text-emerald-400 font-mono">+{riskConfig.maxDailyProfitTargetPct}% (+{formatInr(dailyTargetInr)})</span>
              </label>
              <input
                id="risk-daily-tp"
                type="range"
                min={2.0}
                max={12.0}
                step={0.5}
                value={riskConfig.maxDailyProfitTargetPct}
                onChange={(e) => updateRiskField('maxDailyProfitTargetPct', Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            <div>
              <label htmlFor="risk-account-type" className="block text-slate-400 mb-1">
                Kotak Neo Brokerage Plan
              </label>
              <select
                id="risk-account-type"
                value={riskConfig.brokerageTier}
                onChange={(e) =>
                  updateRiskField('brokerageTier', e.target.value as RiskConfig['brokerageTier'])
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
              >
                <option value="Kotak Trade Free (₹0 Intraday)">Kotak Trade Free (₹0 Intraday)</option>
                <option value="Kotak Trade Free Pro (₹10/order)">Kotak Trade Free Pro (₹10/order)</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs cursor-pointer">
              <span className="text-slate-200">
                Auto Break-Even & Dynamic ATR Trailing Stop (Locks profit once trade hits +{riskConfig.breakEvenTriggerR}R)
              </span>
              <input
                type="checkbox"
                checked={riskConfig.trailingStopEnabled}
                onChange={(e) => updateRiskField('trailingStopEnabled', e.target.checked)}
                className="accent-emerald-500 w-4 h-4"
              />
            </label>
          </div>
        </div>

        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  Automatic NSE Lot & Margin Sizer ({symbol})
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-400">{spec.exchange}</span>
            </div>

            <div className="text-xs">
              <label htmlFor="calc-sl-ticks" className="block text-slate-400 mb-1">
                Stop-Loss Distance (Ticks @ ₹{spec.valuePerTickInr}/tick for {symbol})
              </label>
              <input
                id="calc-sl-ticks"
                type="number"
                min={4}
                max={400}
                value={stopLossTicksInput}
                onChange={(e) => setStopLossTicksInput(Math.max(4, Number(e.target.value)))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-xs font-sans text-slate-400">Exact Auto Lots</div>
                <div className="text-xl font-bold text-emerald-400 mt-1">{computedLots} Lots</div>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-xs font-sans text-slate-400">Max Risk on SL Hit</div>
                <div className="text-xl font-bold text-white mt-1">{formatInr(riskInrPerTrade)}</div>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-xs font-sans text-slate-400">Target (1:2.2 R:R)</div>
                <div className="text-lg font-semibold text-emerald-400 mt-1">
                  {formatInr(riskInrPerTrade * 2.2, true)}
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-xs font-sans text-slate-400">Daily Loss Cap</div>
                <div className="text-lg font-semibold text-rose-400 mt-1">
                  -{formatInr(dailyStopLossInr)}
                </div>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 leading-relaxed">
            Har Kotak Neo API order se pehle quantity automatically <strong className="text-white">{spec.lotUnits} units/lot</strong> ke multiplier se calculate hoti hai.
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Consistent Daily Compounding Plan ({formatInr(riskConfig.initialCapitalInr)} Capital)
              </h3>
              <p className="text-xs text-slate-400">
                Projected from 1-Year Verified NSE/INR Return with automatic lot scaling
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            {([30, 60, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setHorizonDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  horizonDays === d ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {d} Days
              </button>
            ))}
          </div>
        </div>

        {finalMilestone && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono tabular-nums">
            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-xs font-sans text-slate-400">Day 1 Starting Balance</div>
              <div className="text-lg font-bold text-white mt-1">
                {formatInr(riskConfig.initialCapitalInr)}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-xs font-sans text-slate-400">Projected Day {horizonDays} Equity</div>
              <div className="text-lg font-bold text-emerald-400 mt-1">
                {formatInr(finalMilestone.endingEquityInr)} (+{finalMilestone.totalReturnPct}%)
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-xs font-sans text-slate-400">Day {horizonDays} Lot Size</div>
              <div className="text-lg font-bold text-sky-400 mt-1">
                {finalMilestone.recommendedLots} Lots (Cap {formatInr(finalMilestone.dailyMaxRiskInr)})
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto max-h-72 border border-slate-800 rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3 font-medium">Day</th>
                <th className="py-2.5 px-3 font-medium text-right">Start Equity</th>
                <th className="py-2.5 px-3 font-medium text-right">Est. Daily Profit</th>
                <th className="py-2.5 px-3 font-medium text-right">Ending Equity</th>
                <th className="py-2.5 px-3 font-medium text-right">Auto Lots</th>
                <th className="py-2.5 px-3 font-medium text-right">Daily Loss Cap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {milestones
                .filter((m) => m.day === 1 || m.day % 5 === 0 || m.day === horizonDays)
                .map((m) => (
                  <tr key={m.day} className="hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-sans text-slate-200 font-medium">{m.dateLabel}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{formatInr(m.startingEquityInr)}</td>
                    <td className="py-2 px-3 text-right text-emerald-400">{formatInr(m.dailyProfitInr, true)}</td>
                    <td className="py-2 px-3 text-right text-white font-semibold">
                      {formatInr(m.endingEquityInr)} (+{m.totalReturnPct}%)
                    </td>
                    <td className="py-2 px-3 text-right text-sky-400">{m.recommendedLots} Lots</td>
                    <td className="py-2 px-3 text-right text-rose-400">-{formatInr(m.dailyMaxRiskInr)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
