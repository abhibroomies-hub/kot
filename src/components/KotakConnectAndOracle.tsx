import React, { useState } from 'react';
import {
  AiStrategyMemoryRecord,
  BacktestResult,
  IndicatorConfig,
  KotakAccountProfile,
  OracleDbStatusInfo,
  RiskConfig,
  StrategyArchetype,
  Timeframe,
  TradingSymbol,
} from '../engine/types';
import { formatInr, generateKotakNeoScript } from '../engine/backtestEngine';
import { DeployGuideContent } from './DeployGuideModal';
import {
  Brain,
  CheckCircle2,
  Database,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unlock,
} from 'lucide-react';

interface AiTrainingOutcomeSummary {
  symbol: TradingSymbol;
  timeframe: '30M' | '5M' | '1M';
  regime: string;
  strategy: StrategyArchetype;
  winRatePct: number;
  profitFactor: number;
  netReturnPct: number;
  note: string;
}

interface KotakConnectAndOracleProps {
  liveAccount: KotakAccountProfile;
  kotakContracts: Record<string, string>;
  isStrategyVerified: boolean;
  verifiedResult: BacktestResult;
  strategy: StrategyArchetype;
  indicatorConfig: IndicatorConfig;
  riskConfig: RiskConfig;
  symbol: TradingSymbol;
  timeframe: Timeframe;
  aiMemory: AiStrategyMemoryRecord[];
  oracleDb: OracleDbStatusInfo | null;
  onRefreshLimits: () => Promise<string | null>;
  onDisconnectLive: () => Promise<void>;
  onApplyMemoryRecord: (rec: AiStrategyMemoryRecord) => void;
  onAiMemoryUpdated: (records: AiStrategyMemoryRecord[]) => void;
  onSyncOracleDb: () => Promise<string | null>;
}

export const KotakConnectAndOracle: React.FC<KotakConnectAndOracleProps> = ({
  liveAccount,
  kotakContracts,
  isStrategyVerified,
  verifiedResult,
  strategy,
  indicatorConfig,
  riskConfig,
  symbol,
  timeframe,
  aiMemory,
  oracleDb,
  onRefreshLimits,
  onDisconnectLive,
  onApplyMemoryRecord,
  onAiMemoryUpdated,
  onSyncOracleDb,
}) => {
  const [refreshingMargin, setRefreshingMargin] = useState(false);
  const [marginNotice, setMarginNotice] = useState<string | null>(null);
  const [syncingOracle, setSyncingOracle] = useState(false);
  const [oracleSyncMsg, setOracleSyncMsg] = useState<string | null>(null);
  const [trainingAi, setTrainingAi] = useState(false);
  const [trainingSummary, setTrainingSummary] = useState<string | null>(null);
  const [trainingOutcomes, setTrainingOutcomes] = useState<AiTrainingOutcomeSummary[]>([]);

  const kotakScript = generateKotakNeoScript(
    symbol,
    timeframe,
    strategy,
    indicatorConfig,
    riskConfig,
    liveAccount.ucc || '<YOUR_KOTAK_UCC>'
  );

  const handleRefreshMargin = async () => {
    setRefreshingMargin(true);
    setMarginNotice(null);
    const err = await onRefreshLimits();
    setRefreshingMargin(false);
    setMarginNotice(err ?? 'Kotak Neo Live Margin synced cleanly.');
  };

  const handleManualOracleSync = async () => {
    setSyncingOracle(true);
    setOracleSyncMsg(null);
    const msg = await onSyncOracleDb();
    setSyncingOracle(false);
    setOracleSyncMsg(msg ?? 'Oracle Autonomous DB synced cleanly.');
  };

  const handleTrainAiAllPairs = async () => {
    setTrainingAi(true);
    setTrainingSummary(null);
    try {
      const resp = await fetch('/api/ai/train-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: [
            'USDINR',
            'EURINR',
            'GBPINR',
            'JPYINR',
            'EURUSD',
            'GBPUSD',
            'USDJPY',
            'GBPJPY',
            'AUDINR',
            'NIFTY50',
          ],
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data) {
        setTrainingSummary(data?.error || 'AI training failed to reach live candles.');
      } else {
        if (Array.isArray(data.records)) {
          onAiMemoryUpdated(data.records);
        }
        if (Array.isArray(data.outcomes)) {
          setTrainingOutcomes(data.outcomes.slice(0, 12));
        }
        setTrainingSummary(
          `AI Self-Learning Complete: ${data.trainedPairs} currency/index pairs par ${data.outcomesCount} market regimes evaluate karke Oracle AI Vault update kar diya gaya.`
        );
      }
    } catch {
      setTrainingSummary('Network error while running multi-pair AI training.');
    } finally {
      setTrainingAi(false);
    }
  };

  const contractEntries = Object.entries(kotakContracts);

  return (
    <div className="flex flex-col gap-5">
      {/* Connected Real Kotak Neo LIVE Account & Resolved Scrip Master Contracts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-white">
                  Kotak Securities Neo API v2 · LIVE Session
                </h2>
              </div>
              <span className="px-2.5 py-1 rounded text-xs font-mono font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                AUTHENTICATED · {liveAccount.ucc}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono tabular-nums">
              <div className="p-3.5 rounded-lg border bg-slate-950 border-emerald-500/60">
                <div className="text-xs font-sans text-slate-400">Real Kotak Net Margin</div>
                <div className="text-xl font-bold text-emerald-400 mt-1">
                  {formatInr(liveAccount.balanceInr)}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Source: Kotak /quick/user/limits
                </div>
              </div>

              <div className="p-3.5 rounded-lg border bg-slate-950 border-slate-800">
                <div className="text-xs font-sans text-slate-400">Account Details</div>
                <div className="text-sm font-semibold text-white mt-1.5">
                  UCC: {liveAccount.ucc} · {liveAccount.exchangeSegment}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 truncate">
                  {liveAccount.mobile || 'Verified Mobile'} · Key {liveAccount.consumerKeyMasked}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  {isStrategyVerified ? (
                    <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  1-Year Strategy Audit Gate
                </span>
                <span
                  className={
                    isStrategyVerified ? 'text-emerald-400 font-mono' : 'text-amber-400 font-mono'
                  }
                >
                  {isStrategyVerified ? 'PASSED · LIVE READY' : 'REVIEW RECOMMENDED'}
                </span>
              </div>
              <p className="text-slate-400">
                1-Year Win Rate <strong className="text-white">{verifiedResult.winRatePct}%</strong> · PF{' '}
                <strong className="text-white">{verifiedResult.profitFactor}</strong> · Net{' '}
                <strong className="text-emerald-400">
                  {formatInr(verifiedResult.netProfitInr, true)}
                </strong>
              </p>
            </div>

            {marginNotice && (
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{marginNotice}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => void handleRefreshMargin()}
              disabled={refreshingMargin}
              className="py-2.5 px-3 text-xs font-semibold rounded-lg border bg-slate-950 border-slate-700 hover:border-emerald-500/60 text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingMargin ? 'animate-spin' : ''}`} />
              {refreshingMargin ? 'Syncing Margin...' : 'Sync Kotak Margin'}
            </button>
            <button
              type="button"
              onClick={() => void onDisconnectLive()}
              className="py-2.5 px-3 text-xs font-semibold rounded-lg border bg-rose-950/50 border-rose-700/70 hover:bg-rose-900/60 text-rose-200 flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout Kotak Session
            </button>
          </div>
        </div>

        {/* Active NSE Scrip Master Contracts Resolved from Kotak Neo */}
        <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Kotak Neo Active NSE Scrip Master Contracts (7 Legal CDS + 3 Indices)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Live contracts resolved automatically from Kotak Neo{' '}
                <span className="font-mono text-slate-300">cde_fo.csv</span> &{' '}
                <span className="font-mono text-slate-300">nse_fo.csv</span>
              </p>
            </div>
            <span className="text-[11px] font-mono text-emerald-400">
              {contractEntries.length} Resolved
            </span>
          </div>

          {contractEntries.length === 0 ? (
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 leading-relaxed">
              Scrip Master contracts sync ho rahe hain. SEBI/NSE CDS me 7 currency pairs legal hain (USDINR, EURINR, GBPINR, JPYINR, EURUSD, GBPUSD, USDJPY) + 9 global FX pairs live AI analysis & scanning ke liye active hain.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono text-xs">
              {contractEntries.map(([sym, trdSym]) => (
                <div
                  key={sym}
                  className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-0.5"
                >
                  <span className="text-[11px] text-slate-400">{sym}</span>
                  <span className="font-semibold text-emerald-300 truncate">{trdSym}</span>
                </div>
              ))}
            </div>
          )}

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 leading-relaxed mt-auto">
            <strong className="text-slate-200">Zero Simulator Architecture:</strong> Har Buy/Sell aur Auto-Bot signal seedhe aapke connected Kotak Neo API cluster (<span className="font-mono text-slate-300">/quick/order/rule/ms/place</span>) par execute hota hai.
          </div>
        </div>
      </div>

      {/* Autonomous Self-Learning AI Strategy & Indicator Memory Vault */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Brain className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Autonomous AI Self-Learning Vault ({aiMemory.length} Market-Adaptive Rules)
              </h3>
              <p className="text-xs text-slate-400">
                AI har currency pair ke live market regime par sabhi strategies & indicators test karta hai, closed trades (TP/SL) se ADX/ATR parameters evolve karta hai, aur Oracle ADB me store karta hai.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[11px] font-mono px-2 py-1 rounded border flex items-center gap-1 ${
                oracleDb?.connected
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-950 border-amber-500/40 text-amber-300'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              {oracleDb?.connected
                ? `Oracle ADB Live (${oracleDb.mode})`
                : oracleDb?.configured
                ? 'Oracle ADB Reconnecting'
                : 'Local Cache · Set Oracle Env'}
            </span>
            <button
              type="button"
              data-testid="sync-oracle-db-btn"
              onClick={() => void handleManualOracleSync()}
              disabled={syncingOracle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingOracle ? 'animate-spin' : ''}`} />
              {syncingOracle ? 'Syncing DB...' : 'Sync Oracle DB'}
            </button>
            <button
              type="button"
              data-testid="train-ai-all-pairs"
              onClick={() => void handleTrainAiAllPairs()}
              disabled={trainingAi}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800/70 text-white text-xs font-semibold transition-colors"
            >
              <Sparkles className={`w-3.5 h-3.5 ${trainingAi ? 'animate-spin' : ''}`} />
              {trainingAi ? 'Training AI on Live Pairs...' : 'Train AI on All Pairs Now'}
            </button>
          </div>
        </div>

        {(oracleSyncMsg || oracleDb?.error) && (
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
            <span>{oracleSyncMsg ?? `Oracle DB Notice: ${oracleDb?.error}`}</span>
            {oracleDb?.hostHint && (
              <span className="font-mono text-[11px] text-sky-400">{oracleDb.hostHint}</span>
            )}
          </div>
        )}

        {trainingSummary && (
          <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 flex flex-col gap-2">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{trainingSummary}</span>
            </div>
            {trainingOutcomes.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                {trainingOutcomes.slice(0, 6).map((o, idx) => (
                  <div
                    key={`${o.symbol}-${o.timeframe}-${idx}`}
                    className="p-2 rounded bg-slate-950/80 border border-slate-800 text-slate-300"
                  >
                    <div className="text-white font-semibold">
                      {o.symbol} · {o.timeframe} ({o.regime})
                    </div>
                    <div className="text-sky-300">{o.strategy}</div>
                    <div className="text-emerald-400">
                      WR {o.winRatePct}% · PF {o.profitFactor}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3 font-medium">Pair · TF</th>
                <th className="py-2 px-3 font-medium">Market Regime</th>
                <th className="py-2 px-3 font-medium">Learned Strategy</th>
                <th className="py-2 px-3 font-medium">Indicators</th>
                <th className="py-2 px-3 font-medium text-right">Win Rate</th>
                <th className="py-2 px-3 font-medium text-right">PF</th>
                <th className="py-2 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {aiMemory.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-semibold text-white">
                    {rec.symbol} · {rec.timeframe}
                  </td>
                  <td className="py-2 px-3 text-slate-300">{rec.regime}</td>
                  <td className="py-2 px-3 text-sky-300">{rec.strategy}</td>
                  <td className="py-2 px-3 text-slate-400">
                    EMA {rec.indicatorConfig.fastEmaPeriod}/{rec.indicatorConfig.slowEmaPeriod} · RSI{' '}
                    {rec.indicatorConfig.rsiPeriod} · ADX {rec.indicatorConfig.adxThreshold} · SL{' '}
                    {rec.indicatorConfig.atrMultiplierSL}x
                  </td>
                  <td className="py-2 px-3 text-right text-emerald-400">{rec.winRatePct}%</td>
                  <td className="py-2 px-3 text-right text-slate-200">{rec.profitFactor}</td>
                  <td className="py-2 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => onApplyMemoryRecord(rec)}
                      className="px-2 py-1 text-[11px] font-sans font-medium bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded transition-colors"
                    >
                      Apply to Desk
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 24×7 Oracle Cloud (Free VM + ADB) & Kaggle AI Trainer Blueprint */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
        <DeployGuideContent kotakScript={kotakScript} />
      </div>
    </div>
  );
};
