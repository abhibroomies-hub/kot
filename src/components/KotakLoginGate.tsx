import React, { useEffect, useState } from 'react';
import { OracleDbStatusInfo, RiskConfig } from '../engine/types';
import {
  AlertCircle,
  ArrowRight,
  Cloud,
  Database,
  KeyRound,
  Lock,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { DeployGuideModal } from './DeployGuideModal';

interface KotakLoginGateProps {
  lastUcc: string;
  oracleDb?: OracleDbStatusInfo | null;
  defaultExchangeSegment: 'NSE_CDS' | 'NSE_FO' | 'MCX_FO';
  defaultBrokerageTier: RiskConfig['brokerageTier'];
  defaultLeverage: RiskConfig['leverage'];
  onLoginSuccess: (payload: {
    ucc: string;
    mobile: string;
    consumerKey: string;
    totp: string;
    mpin: string;
    exchangeSegment: 'NSE_CDS' | 'NSE_FO' | 'MCX_FO';
    brokerageTier: RiskConfig['brokerageTier'];
    leverage: RiskConfig['leverage'];
  }) => Promise<string | null>;
}

export const KotakLoginGate: React.FC<KotakLoginGateProps> = ({
  lastUcc,
  oracleDb,
  defaultExchangeSegment,
  defaultBrokerageTier,
  defaultLeverage,
  onLoginSuccess,
}) => {
  const [ucc, setUcc] = useState(lastUcc || '');
  const [mobile, setMobile] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [totp, setTotp] = useState('');
  const [mpin, setMpin] = useState('');
  const [exchangeSegment, setExchangeSegment] = useState<'NSE_CDS' | 'NSE_FO' | 'MCX_FO'>(
    defaultExchangeSegment
  );
  const [brokerageTier, setBrokerageTier] =
    useState<RiskConfig['brokerageTier']>(defaultBrokerageTier);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deployGuideOpen, setDeployGuideOpen] = useState(false);

  useEffect(() => {
    if (lastUcc && !ucc) {
      setUcc(lastUcc);
    }
  }, [lastUcc, ucc]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);

    const err = await onLoginSuccess({
      ucc: ucc.trim().toUpperCase(),
      mobile: mobile.trim(),
      consumerKey: consumerKey.trim(),
      totp: totp.trim(),
      mpin: mpin.trim(),
      exchangeSegment,
      brokerageTier,
      leverage: defaultLeverage,
    });

    setSubmitting(false);
    if (err) {
      setErrorMsg(err);
    } else {
      setTotp('');
      setMpin('');
    }
  };

  return (
    <div
      data-testid="kotak-login-gate"
      className="min-h-screen bg-[#05080F] text-slate-100 flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
        {/* Compact Brand Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                NeoQuant · Kotak Securities Neo API v2
              </h1>
              <p className="text-xs text-slate-400">
                19 Currency & NSE Pairs · Self-Learning Market-Adaptive AI · Zero Simulator · Login Karte Hi 4 Live Charts Auto-Load Honge
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="oracle-db-status-pill"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono ${
                oracleDb?.connected
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-900 border-amber-500/40 text-amber-300'
              }`}
            >
              <Database className="w-3.5 h-3.5 shrink-0" />
              {oracleDb?.connected
                ? `ORACLE DB LIVE · ${oracleDb.rulesCount} AI Rules`
                : 'ORACLE DB: READY TO LINK'}
            </div>
            <button
              type="button"
              data-testid="open-deploy-guide"
              onClick={() => setDeployGuideOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-sky-500/50 text-xs font-medium text-sky-300 transition-colors"
            >
              <Cloud className="w-3.5 h-3.5 text-sky-400" />
              24×7 Oracle Cloud Guide
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-emerald-300">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              LIVE BROKER AUTH REQUIRED
            </div>
          </div>
        </div>

        {/* Main 2-Column Login Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Real Kotak Neo API v2 Login Form */}
          <form
            onSubmit={handleSubmit}
            aria-label="Kotak Neo Live Login Form"
            className="lg:col-span-7 bg-slate-900/95 border border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Kotak Neo Live Account Login
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Verify hote hi real 4-timeframe TradingView charts (30M · 5M · 1M · 30S), NSE quotes, aur real margin auto-load ho jayenge.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div>
                <label htmlFor="gate-kotak-ucc" className="block text-slate-300 font-medium mb-1.5">
                  Kotak Client Code (UCC) *
                </label>
                <input
                  id="gate-kotak-ucc"
                  name="ucc"
                  type="text"
                  autoComplete="username"
                  value={ucc}
                  onChange={(e) => setUcc(e.target.value.toUpperCase())}
                  placeholder="e.g. 18DJD"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-2.5 font-mono text-sm text-white placeholder:text-slate-600"
                  required
                />
              </div>

              <div>
                <label htmlFor="gate-kotak-mobile" className="block text-slate-300 font-medium mb-1.5">
                  Registered Mobile (+91...) *
                </label>
                <input
                  id="gate-kotak-mobile"
                  name="mobile"
                  type="tel"
                  autoComplete="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="+9198XXXXXXXX"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-2.5 font-mono text-sm text-white placeholder:text-slate-600"
                  required
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="gate-kotak-key" className="block text-slate-300 font-medium mb-1.5">
                  Neo Trade API Access Token / Consumer Key *
                </label>
                <input
                  id="gate-kotak-key"
                  name="consumerKey"
                  type="password"
                  autoComplete="new-password"
                  value={consumerKey}
                  onChange={(e) => setConsumerKey(e.target.value)}
                  placeholder="Kotak Neo Trade API Dashboard se mila Access Token paste karein"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-2.5 font-mono text-sm text-white placeholder:text-slate-600"
                  required
                />
              </div>

              <div>
                <label htmlFor="gate-kotak-totp" className="block text-slate-300 font-medium mb-1.5">
                  Live 6-Digit TOTP (Authenticator) *
                </label>
                <input
                  id="gate-kotak-totp"
                  name="totp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit TOTP"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-2.5 font-mono text-sm tracking-widest text-white placeholder:text-slate-600 placeholder:tracking-normal"
                  required
                />
              </div>

              <div>
                <label htmlFor="gate-kotak-mpin" className="block text-slate-300 font-medium mb-1.5">
                  Kotak 6-Digit MPIN *
                </label>
                <input
                  id="gate-kotak-mpin"
                  name="mpin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="current-password"
                  value={mpin}
                  onChange={(e) => setMpin(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit MPIN"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-2.5 font-mono text-sm tracking-widest text-white placeholder:text-slate-600 placeholder:tracking-normal"
                  required
                />
              </div>

              <div>
                <label htmlFor="gate-kotak-segment" className="block text-slate-300 font-medium mb-1.5">
                  Primary NSE Segment
                </label>
                <select
                  id="gate-kotak-segment"
                  value={exchangeSegment}
                  onChange={(e) =>
                    setExchangeSegment(e.target.value as 'NSE_CDS' | 'NSE_FO' | 'MCX_FO')
                  }
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-2.5 text-xs text-white"
                >
                  <option value="NSE_CDS">NSE CDS (7 Legal Pairs: USDINR, EURINR, GBPINR, JPYINR... · 9 AM–5 PM)</option>
                  <option value="MCX_FO">MCX Commodities (GOLDPETAL, GOLDM, GOLD, SILVERMIC, CRUDEOILM · 9 AM–11:55 PM)</option>
                  <option value="NSE_FO">NSE F&O (NIFTY50, BANKNIFTY, FINNIFTY · 9:15 AM–3:30 PM)</option>
                </select>
              </div>

              <div>
                <label htmlFor="gate-kotak-plan" className="block text-slate-300 font-medium mb-1.5">
                  Kotak Brokerage Plan
                </label>
                <select
                  id="gate-kotak-plan"
                  value={brokerageTier}
                  onChange={(e) =>
                    setBrokerageTier(e.target.value as RiskConfig['brokerageTier'])
                  }
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-2.5 text-xs text-white"
                >
                  <option value="Kotak Trade Free (₹0 Intraday)">
                    Kotak Trade Free (₹0 Intraday)
                  </option>
                  <option value="Kotak Trade Free Pro (₹10/order)">
                    Kotak Trade Free Pro (₹10/order)
                  </option>
                </select>
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                data-testid="kotak-login-error"
                className="p-3 rounded-lg bg-rose-950/70 border border-rose-700/80 text-rose-200 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              data-testid="kotak-login-submit"
              className="w-full py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800/70 disabled:cursor-wait text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? (
                'Verifying TOTP + MPIN with Kotak Neo API v2...'
              ) : (
                <>
                  Login to Kotak Neo & Auto-Load Live Charts
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Credentials seedhe Kotak Securities official servers (
              <span className="font-mono text-slate-400">mis.kotaksecurities.com</span>) par verify hote hain. TOTP, MPIN, aur API token kabhi disk par save nahi kiye jaate.
            </p>
          </form>

          {/* Right: 4-Step Real Kotak Neo Setup Guide */}
          <div className="lg:col-span-5 bg-slate-900/75 border border-slate-800 rounded-xl p-5 flex flex-col gap-3.5">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wide border-b border-slate-800 pb-2.5">
              <KeyRound className="w-4 h-4 shrink-0" />
              Kotak Neo API Connect Karne Ke 4 Steps
            </div>

            <ol className="flex flex-col gap-2.5 text-xs">
              <li className="p-3 rounded-lg bg-slate-950/90 border border-slate-800">
                <div className="font-semibold text-white">1. Kotak Trade API Activate Karein</div>
                <p className="text-slate-400 mt-1 leading-relaxed">
                  Kotak Neo App ya{' '}
                  <span className="font-mono text-slate-300">neo.kotaksecurities.com</span> me login karke{' '}
                  <strong className="text-slate-200">Invest / More → Trade API</strong> open karein.
                </p>
              </li>

              <li className="p-3 rounded-lg bg-slate-950/90 border border-slate-800">
                <div className="font-semibold text-white">2. API Access Token & UCC Copy Karein</div>
                <p className="text-slate-400 mt-1 leading-relaxed">
                  Trade API Dashboard se apna{' '}
                  <strong className="text-slate-200">API Access Token (Consumer Key)</strong> aur{' '}
                  <strong className="text-slate-200">Client Code (UCC)</strong> copy karein.
                </p>
              </li>

              <li className="p-3 rounded-lg bg-slate-950/90 border border-slate-800">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                  3. Authenticator TOTP & MPIN Ready Rakhein
                </div>
                <p className="text-slate-400 mt-1 leading-relaxed">
                  Google/Microsoft Authenticator ka fresh <strong className="text-slate-200">6-digit TOTP</strong> aur apna{' '}
                  <strong className="text-slate-200">6-digit MPIN</strong> form me enter karein.
                </p>
              </li>

              <li className="p-3 rounded-lg bg-slate-950/90 border border-slate-800">
                <div className="font-semibold text-emerald-300">
                  4. Instant Auto-Load Live Desk
                </div>
                <p className="text-slate-400 mt-1 leading-relaxed">
                  Login pass hote hi Kotak Scrip Master (<span className="font-mono text-slate-300">cde_fo / nse_fo</span>), asli margin limits, aur 4 real-time charts (30M, 5M, 1M, 30S) apne aap khul jayenge.
                </p>
              </li>
            </ol>
          </div>
        </div>
      </div>

      <DeployGuideModal open={deployGuideOpen} onClose={() => setDeployGuideOpen(false)} />
    </div>
  );
};
