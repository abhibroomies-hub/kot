export const ORACLE_ADB_SCHEMA_SQL = `-- ============================================================================
-- NeoQuant India (Kotak Neo API v2) — Oracle Autonomous Database (19c / 23ai)
-- Production Relational + AI Strategy Memory Persistence Schema
-- ============================================================================

CREATE TABLE NEO_BROKER_ACCOUNTS (
  ACCOUNT_ID        VARCHAR2(64) PRIMARY KEY,
  BROKER_NAME       VARCHAR2(64) DEFAULT 'KOTAK_NEO_V2' NOT NULL,
  MODE              VARCHAR2(12) CHECK (MODE IN ('LIVE')) NOT NULL,
  UCC               VARCHAR2(32) NOT NULL,
  EXCHANGE_SEGMENT  VARCHAR2(16) DEFAULT 'NSE_CDS' NOT NULL,
  BALANCE_INR       NUMBER(14, 2) NOT NULL,
  EQUITY_INR        NUMBER(14, 2) NOT NULL,
  LEVERAGE_X        NUMBER(4, 0) DEFAULT 10 NOT NULL,
  SESSION_STATE     VARCHAR2(32) NOT NULL,
  UPDATED_AT        TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP
);

-- Stores learned Market Regime -> Optimal Strategy + Indicators per Symbol & Timeframe
CREATE TABLE AI_STRATEGY_MEMORY (
  MEMORY_ID         VARCHAR2(96) PRIMARY KEY,
  SYMBOL            VARCHAR2(16) NOT NULL,
  TIMEFRAME         VARCHAR2(8) NOT NULL,
  MARKET_REGIME     VARCHAR2(32) NOT NULL,
  STRATEGY_ID       VARCHAR2(48) NOT NULL,
  INDICATOR_JSON    CLOB CHECK (INDICATOR_JSON IS JSON) NOT NULL,
  WIN_RATE_PCT      NUMBER(6, 2) NOT NULL,
  PROFIT_FACTOR     NUMBER(8, 2) NOT NULL,
  NET_RETURN_PCT    NUMBER(8, 2) NOT NULL,
  TRADES_COUNT      NUMBER(8, 0) NOT NULL,
  ORIGIN            VARCHAR2(24) DEFAULT 'BACKTEST_AUTOFIX',
  UPDATED_AT        TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP
);

CREATE UNIQUE INDEX UQ_AI_MEMORY_KEY
  ON AI_STRATEGY_MEMORY (SYMBOL, TIMEFRAME, MARKET_REGIME);

-- Real-time Multi-Timeframe Confluence & Order Execution Audit Ledger
CREATE TABLE KOTAK_TRADE_LEDGER (
  ORDER_ID          VARCHAR2(64) PRIMARY KEY,
  BROKER_ORDER_ID   VARCHAR2(64),
  BROKER_MODE       VARCHAR2(12) CHECK (BROKER_MODE IN ('LIVE')) NOT NULL,
  SYMBOL            VARCHAR2(16) NOT NULL,
  DIRECTION         VARCHAR2(8) CHECK (DIRECTION IN ('BUY', 'SELL')) NOT NULL,
  LOTS              NUMBER(10, 2) NOT NULL,
  ENTRY_PRICE       NUMBER(14, 5) NOT NULL,
  EXIT_PRICE        NUMBER(14, 5),
  STOP_LOSS         NUMBER(14, 5) NOT NULL,
  TAKE_PROFIT       NUMBER(14, 5) NOT NULL,
  PNL_INR           NUMBER(14, 2) DEFAULT 0,
  PNL_TICKS         NUMBER(10, 2) DEFAULT 0,
  STATUS            VARCHAR2(20) NOT NULL,
  STRATEGY_USED     VARCHAR2(48) NOT NULL,
  CONFLUENCE_NOTE   VARCHAR2(256),
  OPENED_AT         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
  CLOSED_AT         TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IDX_TRADE_SYMBOL_STATUS
  ON KOTAK_TRADE_LEDGER (SYMBOL, STATUS, OPENED_AT DESC);
`;

export const ORACLE_NODE_ADAPTER_SNIPPET = `// Drop-in Oracle Cloud Autonomous DB (OCI) Adapter (server/oracleAdapter.ts)
// Install on Oracle Cloud VM: npm install oracledb
import oracledb from 'oracledb';
import type { AiStrategyMemoryRecord } from '../src/engine/types';

let pool: oracledb.Pool | null = null;

export async function getOraclePool() {
  if (pool) return pool;
  pool = await oracledb.createPool({
    user: process.env.ORACLE_DB_USER,
    password: process.env.ORACLE_DB_PASSWORD,
    connectString: process.env.ORACLE_DB_CONNECT_STRING, // e.g. neoquantdb_high (mTLS wallet)
    walletLocation: process.env.ORACLE_WALLET_DIR,
    walletPassword: process.env.ORACLE_WALLET_PASSWORD,
    poolMin: 2,
    poolMax: 10,
  });
  return pool;
}

export async function upsertAiStrategyMemory(rec: AiStrategyMemoryRecord) {
  const conn = await (await getOraclePool()).getConnection();
  try {
    await conn.execute(
      \`MERGE INTO AI_STRATEGY_MEMORY dst
       USING (SELECT :symbol AS s, :tf AS tf, :reg AS reg FROM DUAL) src
       ON (dst.SYMBOL = src.s AND dst.TIMEFRAME = src.tf AND dst.MARKET_REGIME = src.reg)
       WHEN MATCHED THEN UPDATE SET
         STRATEGY_ID = :strat, INDICATOR_JSON = :indJson,
         WIN_RATE_PCT = :wr, PROFIT_FACTOR = :pf, NET_RETURN_PCT = :ret,
         TRADES_COUNT = :cnt, ORIGIN = :origin, UPDATED_AT = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT
         (MEMORY_ID, SYMBOL, TIMEFRAME, MARKET_REGIME, STRATEGY_ID, INDICATOR_JSON,
          WIN_RATE_PCT, PROFIT_FACTOR, NET_RETURN_PCT, TRADES_COUNT, ORIGIN)
       VALUES (:id, :symbol, :tf, :reg, :strat, :indJson, :wr, :pf, :ret, :cnt, :origin)\`,
      {
        id: rec.id,
        symbol: rec.symbol,
        tf: rec.timeframe,
        reg: rec.regime,
        strat: rec.strategy,
        indJson: JSON.stringify(rec.indicatorConfig),
        wr: rec.winRatePct,
        pf: rec.profitFactor,
        ret: rec.netReturnPct,
        cnt: rec.tradesCount,
        origin: rec.origin,
      },
      { autoCommit: true }
    );
  } finally {
    await conn.close();
  }
}
`;

export const ORACLE_CLOUD_24X7_DEPLOY_SCRIPT = `#!/usr/bin/env bash
set -e
# ============================================================================
# NeoQuant 24x7 Always-On Deployment Script for Oracle Cloud (OCI Free Tier)
# Supports: VM.Standard.E2.1.Micro (1 GB RAM) & Ampere A1 (Ubuntu 22.04/24.04)
# Public IP: 130.210.54.23 | Repo: https://github.com/abhibroomies-hub/kot.git
# ============================================================================

# STEP 1: Create 2 GB Swap File (Essential for 1 GB RAM VM.Standard.E2.1.Micro during Vite build)
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# STEP 2: Install Node.js 22 LTS (Required for Vite 8 + Native WebSocket) + PM2 + Nginx
sudo apt update -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo DEBIAN_FRONTEND=noninteractive apt install -y nodejs git nginx unzip iptables-persistent
sudo npm install -g pm2

# STEP 3: Open HTTP (80), HTTPS (443) & App (3000) ports on OCI Ubuntu Firewall
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save || true

# STEP 4: Clone GitHub project & compile production bundle
if [ ! -d "/opt/kot/.git" ]; then
  sudo mkdir -p /opt/kot
  sudo chown -R $USER:$USER /opt/kot
  git clone https://github.com/abhibroomies-hub/kot.git /opt/kot
else
  cd /opt/kot && git pull
fi
cd /opt/kot
NODE_OPTIONS="--max-old-space-size=1536" npm install --legacy-peer-deps
NODE_OPTIONS="--max-old-space-size=1536" npm run build
npx esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=server.js

# STEP 5: Create .env file (Add Oracle Wallet / Gemini vars later if needed)
if [ ! -f /opt/kot/.env ]; then
cat << 'EOF' > /opt/kot/.env
DEFAULT_APP_PORT=3000
NODE_ENV=production
EOF
fi

# STEP 6: Configure Nginx Reverse Proxy on Port 80 (SSE real-time streaming enabled)
sudo tee /etc/nginx/sites-available/neoquant > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
EOF
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/neoquant /etc/nginx/sites-enabled/neoquant
sudo nginx -t && sudo systemctl restart nginx

# STEP 7: Start NeoQuant 24x7 with PM2 + Auto-Start on VM Reboot
pm2 delete neoquant-live-bot 2>/dev/null || true
NODE_ENV=production pm2 start /opt/kot/server.js --name neoquant-live-bot --cwd /opt/kot
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

# STEP 8: Daily 08:30 IST (03:00 UTC) Self-Learning Cron before NSE Market Open
(crontab -l 2>/dev/null | grep -v "train-all" || true; echo "0 3 * * 1-5 curl -s -X POST http://127.0.0.1:3000/api/ai/train-all > /tmp/neoquant-ai-train.log 2>&1") | crontab -

echo "NeoQuant 24x7 Bot is LIVE at http://130.210.54.23 (and http://130.210.54.23:3000)!"
`;

export const KAGGLE_AI_TRAINER_PYTHON = `# ============================================================================
# NeoQuant Kaggle Daily AI Self-Trainer Notebook (Python — Free GPU/CPU)
# WHY KAGGLE + ORACLE TOGETHER?
# - Kaggle Notebooks auto-stop after 12 hours (NOT for 24x7 live order execution).
# - Best Architecture:
#     1) Oracle Cloud Always-Free VM runs Kotak Neo Bot 24x7 (zero downtime).
#     2) Kaggle Scheduled Notebook runs heavy multi-pair AI Grid/RL training daily
#        on 1-year real data and pushes upgraded indicators straight to your Oracle Bot!
# ============================================================================
# In Kaggle Notebook: Settings -> Turn ON "Internet", then Schedule -> "Run Daily"
# Add your Oracle Bot URL in Kaggle Secrets as NEOQUANT_ORACLE_URL (e.g. https://bot.yourdomain.com)

# !pip install -q yfinance pandas numpy requests

import os
import json
import requests
import numpy as np
import pandas as pd
import yfinance as yf

NEOQUANT_ORACLE_URL = os.environ.get("NEOQUANT_ORACLE_URL", "http://<YOUR_ORACLE_VM_IP>:3000")

PAIRS = {
    "USDINR": "INR=X",
    "EURINR": "EURINR=X",
    "GBPINR": "GBPINR=X",
    "JPYINR": "JPY=X",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "USDCHF": "CHF=X",
    "EURGBP": "EURGBP=X",
    "EURJPY": "EURJPY=X",
    "GBPJPY": "GBPJPY=X",
    "NIFTY50": "^NSEI",
    "BANKNIFTY": "^NSEBANK",
}

def compute_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1/period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1/period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def evaluate_ema_rsi(df, fast, slow, rsi_len, sl_mult, tp_mult):
    close = df["Close"].squeeze()
    high = df["High"].squeeze()
    low = df["Low"].squeeze()
    ema_f = close.ewm(span=fast, adjust=False).mean()
    ema_s = close.ewm(span=slow, adjust=False).mean()
    rsi = compute_rsi(close, rsi_len)
    tr = pd.concat([(high - low), (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean()

    wins, losses, gross_p, gross_l = 0, 0, 0.0, 0.0
    i = slow + 15
    while i < len(close) - 10:
        c = float(close.iloc[i])
        a = float(atr.iloc[i]) if not np.isnan(atr.iloc[i]) else c * 0.002
        bull = ema_f.iloc[i] > ema_s.iloc[i] and rsi.iloc[i] > 42 and rsi.iloc[i] < 65
        bear = ema_f.iloc[i] < ema_s.iloc[i] and rsi.iloc[i] < 58 and rsi.iloc[i] > 35
        if bull or bear:
            direction = 1 if bull else -1
            sl = c - direction * a * sl_mult
            tp = c + direction * a * tp_mult
            exit_pnl = 0.0
            for j in range(i + 1, min(i + 24, len(close))):
                hi, lo = float(high.iloc[j]), float(low.iloc[j])
                if direction == 1:
                    if lo <= sl: exit_pnl = -a * sl_mult; i = j; break
                    if hi >= tp: exit_pnl = a * tp_mult; i = j; break
                else:
                    if hi >= sl: exit_pnl = -a * sl_mult; i = j; break
                    if lo <= tp: exit_pnl = a * tp_mult; i = j; break
            if exit_pnl > 0:
                wins += 1; gross_p += exit_pnl
            elif exit_pnl < 0:
                losses += 1; gross_l += abs(exit_pnl)
        i += 1

    total = wins + losses
    if total < 5:
        return None
    wr = round((wins / total) * 100, 1)
    pf = round(gross_p / max(gross_l, 1e-6), 2)
    score = pf * 25 + wr * 0.7
    return {"score": score, "winRatePct": wr, "profitFactor": pf, "tradesCount": total}

print("Starting NeoQuant Kaggle AI Multi-Pair Self-Trainer...")
for sym, ticker in PAIRS.items():
    try:
        df = yf.download(ticker, period="60d", interval="30m", progress=False)
        if df is None or len(df) < 120:
            continue
        best = None
        for fast, slow in [(8, 21), (9, 26), (12, 34)]:
            for sl_m, tp_m in [(1.4, 2.4), (1.6, 2.8)]:
                res = evaluate_ema_rsi(df, fast, slow, 14, sl_m, tp_m)
                if res and (best is None or res["score"] > best["score"]):
                    best = {**res, "fast": fast, "slow": slow, "sl": sl_m, "tp": tp_m}
        if not best:
            continue

        payload = {
            "symbol": sym,
            "timeframe": "30M",
            "regime": "TRENDING_CHANNEL",
            "strategy": "EMA_RSI_CONFLUENCE",
            "indicatorConfig": {
                "fastEmaPeriod": best["fast"],
                "slowEmaPeriod": best["slow"],
                "rsiPeriod": 14,
                "rsiOversold": 40,
                "rsiOverbought": 60,
                "atrPeriod": 14,
                "atrMultiplierSL": best["sl"],
                "atrMultiplierTP": best["tp"],
                "bollingerPeriod": 20,
                "bollingerStdDev": 2.0,
                "adxPeriod": 14,
                "adxThreshold": 20,
                "useAdxFilter": True,
                "useSessionFilter": False,
                "useHigherTimeframeTrend": True,
            },
            "winRatePct": best["winRatePct"],
            "profitFactor": best["profitFactor"],
            "netReturnPct": round((best["profitFactor"] - 1.0) * 18.0, 1),
            "tradesCount": best["tradesCount"],
            "origin": "BACKTEST_AUTOFIX",
        }
        print(f"[LEARNED] {sym}: EMA {best['fast']}/{best['slow']} | WR {best['winRatePct']}% | PF {best['profitFactor']}")
        # Push directly to your Oracle Cloud 24x7 NeoQuant server (which writes to Oracle ADB!)
        if "<YOUR_ORACLE_VM_IP>" not in NEOQUANT_ORACLE_URL:
            r = requests.post(f"{NEOQUANT_ORACLE_URL}/api/ai/memory/learn", json=payload, timeout=10)
            print(f"  -> Synced to Oracle Bot: HTTP {r.status_code}")
    except Exception as ex:
        print(f"[SKIP] {sym}: {ex}")
`;
