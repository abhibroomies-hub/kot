import React, { useState } from 'react';
import {
  KAGGLE_AI_TRAINER_PYTHON,
  ORACLE_ADB_SCHEMA_SQL,
  ORACLE_CLOUD_24X7_DEPLOY_SCRIPT,
  ORACLE_NODE_ADAPTER_SNIPPET,
} from '../engine/oracleSchema';
import {
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Database,
  Download,
  Server,
  Terminal,
  X,
} from 'lucide-react';

interface DeployGuideContentProps {
  compact?: boolean;
  kotakScript?: string;
}

type CodeTab = 'ORACLE_24X7' | 'KAGGLE_AI' | 'ORACLE_SQL' | 'ORACLE_NODE' | 'KOTAK_SCRIPT';

export const DeployGuideContent: React.FC<DeployGuideContentProps> = ({
  compact = false,
  kotakScript,
}) => {
  const [platformTab, setPlatformTab] = useState<'ORACLE' | 'KAGGLE'>('ORACLE');
  const [codeTab, setCodeTab] = useState<CodeTab>('ORACLE_24X7');
  const [copied, setCopied] = useState(false);

  const activeCode =
    codeTab === 'ORACLE_24X7'
      ? ORACLE_CLOUD_24X7_DEPLOY_SCRIPT
      : codeTab === 'KAGGLE_AI'
      ? KAGGLE_AI_TRAINER_PYTHON
      : codeTab === 'ORACLE_SQL'
      ? ORACLE_ADB_SCHEMA_SQL
      : codeTab === 'ORACLE_NODE'
      ? ORACLE_NODE_ADAPTER_SNIPPET
      : kotakScript ?? '';

  const downloadMeta: Record<CodeTab, { href: string; filename: string; label: string }> = {
    ORACLE_24X7: {
      href: '/api/oracle/deploy-oracle.sh',
      filename: 'deploy_oracle_24x7.sh',
      label: 'Download .sh',
    },
    KAGGLE_AI: {
      href: '/api/oracle/kaggle-trainer.py',
      filename: 'neoquant_kaggle_ai_trainer.py',
      label: 'Download .py',
    },
    ORACLE_SQL: {
      href: '/api/oracle/schema.sql',
      filename: 'oracle_neoquant_schema.sql',
      label: 'Download .sql',
    },
    ORACLE_NODE: {
      href: '/api/oracle/schema.sql',
      filename: 'oracle_neoquant_schema.sql',
      label: 'Download SQL',
    },
    KOTAK_SCRIPT: {
      href: '/api/oracle/deploy-oracle.sh',
      filename: 'deploy_oracle_24x7.sh',
      label: 'Download Deploy',
    },
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Architecture Truth Banner: Oracle Cloud vs Kaggle */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="p-3.5 rounded-lg bg-emerald-950/35 border border-emerald-500/40 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
              <Server className="w-4 h-4 shrink-0" />
              Oracle Cloud Always-Free (RECOMMENDED 24×7 LIVE BOT)
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            <strong className="text-white">4 OCPU ARM VM + 24 GB RAM + Oracle Autonomous DB 23ai</strong> hamesha free milta hai. Is par aapka NeoQuant bot <strong className="text-emerald-300">24×7 non-stop</strong> chalta hai, Kotak Neo live orders place karta hai, aur har trade + market shift se khud seekh kar indicators aur strategy update karta hai.
          </p>
        </div>

        <div className="p-3.5 rounded-lg bg-sky-950/35 border border-sky-500/40 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sky-300 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 shrink-0" />
              Kaggle Scheduled Notebook (FREE DAILY AI RE-TRAINER)
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            Kaggle notebooks maximum <strong className="text-amber-300">12 hours</strong> ke baad auto-stop ho jaate hain aur live trading port host nahi karte — isliye live bot <strong className="text-white">Oracle Cloud</strong> par chalayein aur <strong className="text-sky-300">Kaggle Daily Schedule</strong> ko AI heavy training ke liye use karein jo naye rules Oracle API par push karega.
          </p>
        </div>
      </div>

      {/* Step-by-Step Interactive Walkthrough Switcher */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Cloud className="w-4 h-4 text-emerald-400" />
            Step-by-Step Deployment Guide (Zero Cost · 24×7 Self-Learning)
          </div>
          <div className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <button
              type="button"
              data-testid="guide-tab-oracle"
              onClick={() => {
                setPlatformTab('ORACLE');
                setCodeTab('ORACLE_24X7');
              }}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                platformTab === 'ORACLE'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              1. Oracle Cloud 24×7 Setup
            </button>
            <button
              type="button"
              data-testid="guide-tab-kaggle"
              onClick={() => {
                setPlatformTab('KAGGLE');
                setCodeTab('KAGGLE_AI');
              }}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                platformTab === 'KAGGLE'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              2. Kaggle AI Auto-Trainer
            </button>
          </div>
        </div>

        {platformTab === 'ORACLE' ? (
          <ol className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-emerald-300">Step 1 · Oracle Cloud Free Account + Mumbai/Hyderabad Region</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                <span className="font-mono text-slate-200">cloud.oracle.com</span> par free tier account banayein aur region <strong className="text-white">India West (Mumbai)</strong> ya <strong className="text-white">Hyderabad</strong> choose karein (Kotak NSE servers se lowest latency ke liye).
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-emerald-300">Step 2 · Always-Free Ampere ARM VM Banayein</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                Compute → Instances → <strong className="text-white">VM.Standard.A1.Flex</strong> (2–4 OCPU, 12–24 GB RAM, Ubuntu 22.04). Security List me TCP Port <span className="font-mono text-slate-200">80, 443, 3000</span> allow karein.
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-emerald-300">Step 3 · Oracle Autonomous DB 23ai (Free) + Wallet</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                Oracle Database → Autonomous Database → <strong className="text-white">Always Free</strong> create karein. Wallet zip download karke VM ke <span className="font-mono text-slate-200">/opt/oracle/wallet</span> me unzip karein aur niche diya <span className="font-mono text-slate-200">Oracle DDL (.sql)</span> run karein.
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-emerald-300">Step 4 · NeoQuant Deploy + PM2 24×7 Daemon</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                VM par SSH karke niche diya <span className="font-mono text-slate-200">deploy_oracle_24x7.sh</span> chalayein. Yeh Node 20, <span className="font-mono text-slate-200">npm run build</span>, aur <span className="font-mono text-slate-200">pm2 startup</span> setup kar dega taaki reboot ke baad bhi bot 24×7 chalta rahe.
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-emerald-300">Step 5 · Daily 08:30 IST Self-Learning Cron</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                Deploy script apne aap cron job add karta hai jo roz subah 08:30 IST (NSE open se pehle) <span className="font-mono text-slate-200">POST /api/ai/train-all</span> call karke sabhi 19 currency pairs par AI ko retrain karta hai.
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-emerald-300">Step 6 · Live Trade Feedback Loop + HTTPS</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                Har closed trade ke baad AI automatically Win/SL record karke ADX filter aur ATR SL/TP evolve karta hai, aur har naye live candle bar par market structure ke hisab se Strategy + Indicator switch karta hai.
              </p>
            </li>
          </ol>
        ) : (
          <ol className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-sky-300">Step 1 · Kaggle Par New Notebook Banayein</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                <span className="font-mono text-slate-200">kaggle.com/code</span> → <strong className="text-white">New Notebook</strong> open karein. Right sidebar me <strong className="text-white">Internet = ON</strong> toggle zaroor on karein.
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-sky-300">Step 2 · Oracle Server URL Secret Add Karein</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                Add-ons → <strong className="text-white">Secrets</strong> → Naya secret add karein: Label <span className="font-mono text-slate-200">NEOQUANT_ORACLE_URL</span> aur value aapke Oracle VM ka URL (<span className="font-mono text-slate-200">https://your-oracle-ip</span>).
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-sky-300">Step 3 · Python Self-Learning Script Paste Karein</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                Niche diye <span className="font-mono text-slate-200">Kaggle AI Trainer (.py)</span> code ko cell me paste karein. Yeh sabhi 19 FX/INR pairs par real historical candles download karke EMA/RSI/ATR optimize karta hai.
              </p>
            </li>
            <li className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="font-semibold text-sky-300">Step 4 · Daily Schedule Set Karein (Auto-Enhance)</div>
              <p className="text-slate-400 mt-1 leading-relaxed">
                Kaggle Notebook ke <strong className="text-white">Schedule → Daily</strong> enable karein. Roz Kaggle free CPU/GPU par AI ko upgrade karega aur naye learned parameters <span className="font-mono text-slate-200">/api/ai/memory/learn</span> par push kar dega!
              </p>
            </li>
          </ol>
        )}
      </div>

      {/* Production Scripts & Code Blueprint Viewer */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Terminal className="w-4 h-4 text-emerald-400" />
            Ready-to-Run Scripts & Oracle DB Schema
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg text-[11px]">
              <button
                type="button"
                data-testid="code-tab-oracle-sh"
                onClick={() => setCodeTab('ORACLE_24X7')}
                className={`px-2 py-1 rounded ${
                  codeTab === 'ORACLE_24X7' ? 'bg-slate-800 text-emerald-300 font-semibold' : 'text-slate-400'
                }`}
              >
                Oracle 24×7 (.sh)
              </button>
              <button
                type="button"
                data-testid="code-tab-kaggle-py"
                onClick={() => setCodeTab('KAGGLE_AI')}
                className={`px-2 py-1 rounded ${
                  codeTab === 'KAGGLE_AI' ? 'bg-slate-800 text-sky-300 font-semibold' : 'text-slate-400'
                }`}
              >
                Kaggle AI (.py)
              </button>
              <button
                type="button"
                data-testid="code-tab-oracle-sql"
                onClick={() => setCodeTab('ORACLE_SQL')}
                className={`px-2 py-1 rounded ${
                  codeTab === 'ORACLE_SQL' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                Oracle DDL (.sql)
              </button>
              <button
                type="button"
                onClick={() => setCodeTab('ORACLE_NODE')}
                className={`px-2 py-1 rounded ${
                  codeTab === 'ORACLE_NODE' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                oracledb Adapter
              </button>
              {kotakScript && (
                <button
                  type="button"
                  onClick={() => setCodeTab('KOTAK_SCRIPT')}
                  className={`px-2 py-1 rounded ${
                    codeTab === 'KOTAK_SCRIPT' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'
                  }`}
                >
                  Kotak API Script
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg"
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              href={downloadMeta[codeTab].href}
              download={downloadMeta[codeTab].filename}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadMeta[codeTab].label}
            </a>
          </div>
        </div>

        <pre
          className={`bg-[#05080F] border border-slate-800/90 rounded-lg p-3.5 text-[11px] font-mono text-emerald-300 overflow-x-auto leading-relaxed ${
            compact ? 'max-h-56' : 'max-h-72'
          }`}
        >
          {activeCode}
        </pre>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-sky-400" />
            Oracle Autonomous DB stores <strong className="text-slate-200">AI_STRATEGY_MEMORY</strong> + <strong className="text-slate-200">KOTAK_TRADE_LOG</strong> permanently.
          </span>
          <span className="font-mono text-slate-500">Zero Simulator · Live 24×7 Ready</span>
        </div>
      </div>
    </div>
  );
};

interface DeployGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export const DeployGuideModal: React.FC<DeployGuideModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="24x7 Oracle Cloud and Kaggle Deployment Guide"
      data-testid="deploy-guide-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
    >
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-800 bg-slate-950/90">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">
                24×7 Oracle Cloud (Free VM + ADB) & Kaggle AI Trainer Guide
              </h2>
              <p className="text-[11px] text-slate-400">
                Bot ko 24×7 live chalane aur market ke hisab se self-enhance karne ka complete blueprint
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Deployment Guide"
            data-testid="close-deploy-guide"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto">
          <DeployGuideContent compact />
        </div>
      </div>
    </div>
  );
};
