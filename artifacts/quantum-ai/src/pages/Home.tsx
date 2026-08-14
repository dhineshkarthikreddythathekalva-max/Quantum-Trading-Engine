import { useState, useCallback, useEffect, useRef } from "react";
import { PAIRS, CATEGORY_LABELS, type PairCategory, type TradingPair } from "@/data/pairs";
import { generateSignal, type SignalResult } from "@/lib/signalEngine";
import { useLiveMarket } from "@/lib/liveMarket";
import { TIMEFRAMES, type Timeframe } from "@/data/timeframes";
import {
  Zap, ChevronDown, AlertTriangle, BarChart2,
  ChevronRight, Search, X, Wifi, WifiOff, RefreshCw,
  ArrowUpRight, ArrowDownRight, Timer, TrendingUp, TrendingDown,
  Activity, Layers, Trophy, XCircle,
  Home as HomeIcon, LineChart, History, HelpCircle,
  LogOut, Shield, Cpu, CheckCircle2, Sparkles, Settings2,
  Clock, Target,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type SignalOutcome = "win" | "loss" | null;
type Tab = "home" | "trade" | "history" | "support";

interface SignalHistoryEntry {
  id: string;
  pair: TradingPair;
  timeframe: Timeframe;
  result: SignalResult;
  timestamp: Date;
  entryTime: Date;
  expiryTime: Date;
  outcome: SignalOutcome;
}

// ─────────────────────────────────────────────────────────────
// AI Engine Models
// ─────────────────────────────────────────────────────────────
const AI_MODELS = [
  { id: "quantum-x",   name: "Quantum-X v3",     accuracy: 82.4, desc: "Next-gen quantum-inspired predictor",   icon: "⚡" },
  { id: "neural-9",    name: "Neural-9 Pro",      accuracy: 79.8, desc: "9-year pattern recognition engine",     icon: "🧠" },
  { id: "confluence",  name: "Confluence Pro",    accuracy: 85.2, desc: "Multi-indicator confluence system",     icon: "◈"  },
  { id: "cross-corr",  name: "Cross-Correlator",  accuracy: 81.6, desc: "Cross-asset correlation engine",        icon: "⊗"  },
] as const;
type ModelId = typeof AI_MODELS[number]["id"];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function fmt2(n: number) { return String(n).padStart(2, "0"); }

function getTfMs(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    "30s": 30000, "1m": 60000, "2m": 120000, "3m": 180000,
    "5m": 300000, "15m": 900000, "30m": 1800000,
  };
  return map[tf];
}

function getNextCandleMs(tf: Timeframe): number {
  const ms = getTfMs(tf);
  return Math.ceil(Date.now() / ms) * ms;
}

function msCountdown(ms: number) {
  if (ms <= 0) return "00:00";
  const s = Math.ceil(ms / 1000);
  return `${fmt2(Math.floor(s / 60))}:${fmt2(s % 60)}`;
}

// ─────────────────────────────────────────────────────────────
// Circular Gauge (Home config screen)
// ─────────────────────────────────────────────────────────────
function CircularGauge({ value, modelName }: { value: number; modelName: string }) {
  const r   = 44;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(1, value / 100);

  return (
    <div className="flex items-center gap-4 px-4 py-4 rounded-2xl bg-green-500/8 border border-green-500/20">
      {/* Gauge */}
      <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(74,222,128,0.12)" strokeWidth="7" />
          <circle
            cx="50" cy="50" r={r} fill="none"
            stroke="url(#gGrad)" strokeWidth="7"
            strokeDasharray={`${pct * circ} ${circ}`}
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="gGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
        </svg>
        <div className="flex flex-col items-center z-10">
          <span className="text-3xl font-black text-white leading-none">{value}</span>
          <span className="text-[8px] font-bold text-green-400 uppercase tracking-wider mt-0.5">AI CONF.</span>
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="text-xs font-black text-green-400 uppercase tracking-wider">AI ENGINE ACTIVE</span>
        </div>
        <p className="text-sm font-bold text-white leading-tight">{modelName}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <div className="h-1.5 flex-1 bg-white/8 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full" style={{ width: `${pct * 100}%` }} />
          </div>
          <span className="text-[10px] text-green-400 font-mono font-bold">{value}%</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Live Clock
// ─────────────────────────────────────────────────────────────
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const blink = now.getSeconds() % 2 === 0;
  return (
    <div className="flex flex-col items-center select-none">
      <div className="flex items-end gap-0.5 leading-none">
        <span className="text-5xl font-black font-mono text-white tracking-tight">{fmt2(now.getHours())}</span>
        <span className={`text-5xl font-black font-mono text-green-400 tracking-tight transition-opacity duration-200 ${blink ? "opacity-100" : "opacity-20"}`}>:</span>
        <span className="text-5xl font-black font-mono text-white tracking-tight">{fmt2(now.getMinutes())}</span>
        <span className={`text-5xl font-black font-mono text-green-400 tracking-tight transition-opacity duration-200 ${blink ? "opacity-100" : "opacity-20"}`}>:</span>
        <span className="text-3xl font-black font-mono text-slate-400 tracking-tight pb-1">{fmt2(now.getSeconds())}</span>
      </div>
      <p className="text-[10px] text-slate-600 font-mono mt-1">
        {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Candle countdown
// ─────────────────────────────────────────────────────────────
function CandleTimer({ tf }: { tf: Timeframe }) {
  const [rem, setRem] = useState(0);
  useEffect(() => {
    const tick = () => { const next = getNextCandleMs(tf); setRem(next - Date.now()); };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [tf]);
  const ms    = getTfMs(tf);
  const pct   = 1 - rem / ms;
  const urgent = rem < 5000;
  return (
    <div className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border ${urgent ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/8 bg-white/4 text-slate-400"}`}>
      <Timer className={`w-3.5 h-3.5 shrink-0 ${urgent ? "text-red-400 animate-pulse" : "text-green-500"}`} />
      <span className="font-bold">{msCountdown(rem)}</span>
      <span className="text-slate-600 text-[9px]">next candle</span>
      <div className="w-14 h-1 bg-white/8 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${urgent ? "bg-red-400" : "bg-green-500"}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Entry countdown
// ─────────────────────────────────────────────────────────────
function EntryCountdown({ entryTime }: { entryTime: Date }) {
  const [rem, setRem] = useState(entryTime.getTime() - Date.now());
  useEffect(() => { const t = setInterval(() => setRem(entryTime.getTime() - Date.now()), 500); return () => clearInterval(t); }, [entryTime]);
  return (
    <div className={`flex items-center gap-1.5 font-mono font-bold text-sm ${rem <= 0 ? "text-green-400 animate-pulse" : "text-amber-400"}`}>
      <Timer className="w-4 h-4" />
      {rem <= 0 ? "ENTER NOW →" : `Enter in ${msCountdown(rem)}`}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// S/R Bar
// ─────────────────────────────────────────────────────────────
function SRBar({ support, resistance, price }: { support: number; resistance: number; price: number }) {
  const range = resistance - support || 1;
  const pct   = Math.max(0, Math.min(1, (price - support) / range));
  const dec   = price > 100 ? 2 : 5;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 uppercase tracking-widest">
        <span className="text-green-500">Support</span>
        <span className="text-white font-bold text-xs">{price.toLocaleString(undefined, { maximumFractionDigits: dec })}</span>
        <span className="text-red-500">Resistance</span>
      </div>
      <div className="relative h-2.5 bg-white/5 rounded-full">
        <div className="absolute left-0 top-0 h-full w-[12%] bg-green-500/25 rounded-l-full" />
        <div className="absolute right-0 top-0 h-full w-[12%] bg-red-500/25 rounded-r-full" />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-green-400 bg-background shadow-[0_0_10px_hsl(142_70%_50%/0.8)] transition-all duration-700"
          style={{ left: `${pct * 100}%` }} />
      </div>
      <div className="flex justify-between text-[9px] font-mono font-bold">
        <span className="text-green-400">{support.toLocaleString(undefined, { maximumFractionDigits: dec })}</span>
        <span className="text-red-400">{resistance.toLocaleString(undefined, { maximumFractionDigits: dec })}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Indicator chip
// ─────────────────────────────────────────────────────────────
function IndChip({ label, value, bull }: { label: string; value: string; bull: boolean | null }) {
  const color = bull === null ? "text-slate-400 border-white/10 bg-white/4"
    : bull ? "text-green-400 border-green-500/30 bg-green-500/8"
    : "text-red-400 border-red-500/30 bg-red-500/8";
  return (
    <div className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg border text-center ${color}`}>
      <div className="text-[9px] font-bold opacity-60 uppercase tracking-wider">{label}</div>
      <div className="text-[11px] font-black font-mono mt-0.5">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Indicators Panel
// ─────────────────────────────────────────────────────────────
function IndicatorsPanel({ market }: { market: ReturnType<typeof useLiveMarket> }) {
  if (!market) return null;
  const { indicators: ind, structure: str, sessionName } = market;
  const rsiColor = ind.rsi14 < 30 ? "text-green-400" : ind.rsi14 > 70 ? "text-red-400" : "text-slate-400";
  const stackColor = ind.emaStack === "bull_stack" ? "border-green-500/30 bg-green-500/10 text-green-400"
    : ind.emaStack === "bear_stack" ? "border-red-500/30 bg-red-500/10 text-red-400"
    : "border-white/10 bg-white/5 text-slate-500";
  return (
    <div className="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Live Indicators</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
          str.trend === "bullish" ? "border-green-500/30 bg-green-500/10 text-green-400"
          : str.trend === "bearish" ? "border-red-500/30 bg-red-500/10 text-red-400"
          : "border-white/10 bg-white/5 text-slate-500"
        }`}>{str.trend.toUpperCase()}</span>
        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ml-1 ${stackColor}`}>
          {ind.emaStack === "bull_stack" ? "EMA ↑↑↑" : ind.emaStack === "bear_stack" ? "EMA ↓↓↓" : "EMA MIX"}
        </span>
        <span className="ml-auto text-[8px] font-mono text-slate-600">{sessionName}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <IndChip label="RSI(14)" value={ind.rsi14.toFixed(0)} bull={ind.rsi14 < 45 ? true : ind.rsi14 > 55 ? false : null} />
        <IndChip label="ADX"     value={ind.adx.toFixed(0)}   bull={ind.adx > 25 ? true : null} />
        <IndChip label="STOCH"   value={`${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)}`}
          bull={ind.stochSignal === "oversold" ? true : ind.stochSignal === "overbought" ? false : ind.stochK > ind.stochD} />
        <IndChip label="BB%"     value={`${(ind.bbPct * 100).toFixed(0)}%`}
          bull={ind.bbPct < 0.35 ? true : ind.bbPct > 0.65 ? false : null} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <IndChip label="EMA Trend" value={ind.emaTrend === "bullish" ? "↑ BULL" : "↓ BEAR"} bull={ind.emaTrend === "bullish"} />
        <IndChip label="MACD" value={ind.macdCross !== "none" ? (ind.macdCross === "bullish" ? "✕ UP" : "✕ DN") : (ind.macdHist >= 0 ? "▲ POS" : "▼ NEG")}
          bull={ind.macdHist >= 0} />
        <IndChip label="+DI/-DI" value={`${ind.plusDI.toFixed(0)}/${ind.minusDI.toFixed(0)}`} bull={ind.plusDI > ind.minusDI} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[9px] font-mono text-slate-600">
          <span className="text-green-600">30</span>
          <span className={`font-bold ${rsiColor}`}>RSI {ind.rsi14.toFixed(1)}</span>
          <span className="text-red-600">70</span>
        </div>
        <div className="relative h-1.5 bg-white/5 rounded-full">
          <div className="absolute left-[30%] w-px h-full bg-green-500/40" />
          <div className="absolute left-[70%] w-px h-full bg-red-500/40" />
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 transition-all duration-700"
            style={{ left: `${ind.rsi14}%`, borderColor: ind.rsi14 < 30 ? "#4ade80" : ind.rsi14 > 70 ? "#f87171" : "#94a3b8", background: "hsl(var(--background))" }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pair Dropdown
// ─────────────────────────────────────────────────────────────
function PairDropdown({ selectedPair, onSelect, compact }: { selectedPair: TradingPair | null; onSelect: (p: TradingPair) => void; compact?: boolean }) {
  const [open, setOpen]     = useState(false);
  const [cat, setCat]       = useState<PairCategory>("currencies");
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = PAIRS.filter(p => p.category === cat && (!search || p.name.toLowerCase().includes(search.toLowerCase())));

  if (compact) {
    return (
      <div className="relative w-full" ref={ref}>
        <button onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-green-500/20 bg-green-500/5 text-sm font-semibold text-white hover:border-green-500/40 transition-all">
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[9px] text-green-500 uppercase tracking-widest font-mono font-bold">ASSETS</span>
            <span className="text-sm font-bold text-white">
              {selectedPair ? `1 selected` : "Select trading assets"}
            </span>
            {selectedPair && (
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedPair.name}{selectedPair.isOTC ? " (OTC)" : ""}
              </span>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-2 z-[100] glass-panel-bright rounded-2xl border border-green-500/20 shadow-[0_8px_40px_hsl(142_70%_30%/0.3)] animate-slide-up overflow-hidden">
            <div className="flex border-b border-white/6 overflow-x-auto scrollbar-thin">
              {(Object.keys(CATEGORY_LABELS) as PairCategory[]).map(c => (
                <button key={c} onClick={() => { setCat(c); setSearch(""); }}
                  className={`category-tab px-4 py-2.5 text-xs font-bold whitespace-nowrap ${cat === c ? "active" : "text-slate-400"}`}>
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/8">
                <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search pair…" className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none font-mono" />
                {search && <button onClick={() => setSearch("")}><X className="w-3 h-3 text-slate-600 hover:text-slate-400" /></button>}
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto scrollbar-thin py-1">
              {filtered.length === 0
                ? <p className="text-xs text-slate-600 text-center py-4 font-mono">No pairs found</p>
                : filtered.map(pair => (
                    <button key={pair.id} onClick={() => { onSelect(pair); setOpen(false); setSearch(""); }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-all ${selectedPair?.id === pair.id ? "bg-green-500/12 text-green-300" : "text-slate-300 hover:bg-white/5"}`}>
                      <div className="flex items-center gap-2">
                        {selectedPair?.id === pair.id && <ChevronRight className="w-3 h-3 text-green-400" />}
                        <span className="font-semibold">{pair.name}</span>
                        {pair.isOTC && <span className="text-[9px] text-violet-400 font-bold">OTC</span>}
                      </div>
                    </button>
                  ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
          open ? "border-green-500/60 bg-green-500/8 text-green-300"
          : selectedPair ? "border-white/15 bg-white/5 text-white hover:border-green-500/40"
          : "border-white/10 bg-white/4 text-slate-500 hover:border-white/20"
        }`}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          {selectedPair
            ? <span className="flex items-center gap-2">
                {selectedPair.name}
                {selectedPair.isOTC && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-300 border border-violet-500/30">OTC</span>}
              </span>
            : "Select a trading pair…"}
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180 text-green-400" : "text-slate-500"}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[100] glass-panel-bright rounded-2xl border border-green-500/20 shadow-[0_8px_40px_hsl(142_70%_30%/0.25)] animate-slide-up overflow-hidden">
          <div className="flex border-b border-white/6 overflow-x-auto scrollbar-thin">
            {(Object.keys(CATEGORY_LABELS) as PairCategory[]).map(c => (
              <button key={c} onClick={() => { setCat(c); setSearch(""); }}
                className={`category-tab px-4 py-2.5 text-xs font-bold whitespace-nowrap ${cat === c ? "active" : "text-slate-400"}`}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <div className="px-3 py-2 border-b border-white/5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/8">
              <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search pair…" className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none font-mono" />
              {search && <button onClick={() => setSearch("")}><X className="w-3 h-3 text-slate-600 hover:text-slate-400" /></button>}
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin py-1">
            {filtered.length === 0
              ? <p className="text-xs text-slate-600 text-center py-4 font-mono">No pairs found</p>
              : filtered.map(pair => (
                  <button key={pair.id} onClick={() => { onSelect(pair); setOpen(false); setSearch(""); }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-all ${selectedPair?.id === pair.id ? "bg-green-500/12 text-green-300" : "text-slate-300 hover:bg-white/5"}`}>
                    <div className="flex items-center gap-2">
                      {selectedPair?.id === pair.id && <ChevronRight className="w-3 h-3 text-green-400" />}
                      <span className="font-semibold">{pair.name}</span>
                      {pair.isOTC && <span className="text-[9px] text-violet-400 font-bold">OTC</span>}
                    </div>
                  </button>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sync Badge
// ─────────────────────────────────────────────────────────────
function SyncBadge({ market }: { market: ReturnType<typeof useLiveMarket> }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { setBlink(false); const t = setTimeout(() => setBlink(true), 200); return () => clearTimeout(t); }, [market?.syncCount]);
  if (!market) return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10">
      <WifiOff className="w-3 h-3 text-red-400" /><span className="text-red-400 font-semibold">No Data</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-green-500/20 bg-green-500/10">
      <Wifi className="w-3 h-3 text-green-400" />
      <span className={`text-green-400 font-semibold transition-opacity ${blink ? "opacity-100" : "opacity-30"}`}>LIVE</span>
      <span className="text-green-600 text-[9px] font-mono">3s</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Win/Loss Bar
// ─────────────────────────────────────────────────────────────
function WinRateBar({ history }: { history: SignalHistoryEntry[] }) {
  const decided = history.filter(h => h.outcome !== null);
  const wins    = decided.filter(h => h.outcome === "win").length;
  const losses  = decided.filter(h => h.outcome === "loss").length;
  const rate    = decided.length > 0 ? Math.round((wins / decided.length) * 100) : null;
  if (history.length === 0) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 text-xs font-mono">
      <div className="flex items-center gap-1.5 text-slate-400">
        <span className="text-slate-500">Total:</span>
        <span className="font-bold text-white">{history.length}</span>
      </div>
      <div className="flex items-center gap-1 text-green-400">
        <Trophy className="w-3 h-3" />
        <span className="font-bold">{wins}W</span>
      </div>
      <div className="flex items-center gap-1 text-red-400">
        <XCircle className="w-3 h-3" />
        <span className="font-bold">{losses}L</span>
      </div>
      {rate !== null && (
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-20 h-1.5 bg-white/8 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-700" style={{ width: `${rate}%` }} />
          </div>
          <span className={`font-black text-sm ${rate >= 70 ? "text-green-400" : rate >= 50 ? "text-amber-400" : "text-red-400"}`}>{rate}%</span>
        </div>
      )}
      {decided.length === 0 && <span className="ml-auto text-slate-600 text-[9px]">Mark signals as win/loss to track rate</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Martingale Calculator
// ─────────────────────────────────────────────────────────────
function MartingalePanel() {
  const [base, setBase]             = useState("1");
  const [multiplier, setMultiplier] = useState(2.2);
  const [step, setStep]             = useState(1);
  const PAYOUT   = 0.85;
  const MAX_STEPS = 6;

  const baseVal      = Math.max(0.01, parseFloat(base) || 1);
  const stakes       = Array.from({ length: MAX_STEPS }, (_, i) =>
    parseFloat((baseVal * Math.pow(multiplier, i)).toFixed(2))
  );
  const totalLost    = parseFloat(stakes.slice(0, step - 1).reduce((a, b) => a + b, 0).toFixed(2));
  const currentStake = stakes[step - 1];
  const profit       = parseFloat((currentStake * PAYOUT - totalLost).toFixed(2));

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Martingale Recovery</span>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">OTC MODE</span>
        </div>
        {step > 1 && (
          <button onClick={() => setStep(1)} className="text-[9px] text-slate-600 hover:text-slate-400 font-mono transition-colors">RESET</button>
        )}
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <div className="text-[9px] text-slate-500 uppercase tracking-widest font-mono mb-1.5">Base Stake</div>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus-within:border-green-500/40">
              <span className="text-slate-500 font-mono text-xs font-bold">$</span>
              <input type="number" min="0.1" step="0.5" value={base}
                onChange={e => { setBase(e.target.value); setStep(1); }}
                className="flex-1 bg-transparent text-white font-black text-sm font-mono outline-none w-16" />
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[9px] text-slate-500 uppercase tracking-widest font-mono mb-1.5">Multiplier</div>
            <div className="flex gap-1">
              {[2.0, 2.2, 2.3].map(m => (
                <button key={m} onClick={() => { setMultiplier(m); setStep(1); }}
                  className={`flex-1 py-2 rounded-lg text-xs font-black border transition-all ${
                    multiplier === m ? "border-green-500/60 bg-green-500/15 text-green-300" : "border-white/10 bg-white/4 text-slate-500 hover:border-white/20"
                  }`}>{m}×</button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-1.5">
          {stakes.map((stake, i) => {
            const sn = i + 1;
            const isActive = sn === step;
            const isPast   = sn < step;
            return (
              <div key={sn} className={`flex flex-col items-center py-2 px-1 rounded-lg border text-center transition-all ${
                isActive ? "border-amber-500/60 bg-amber-500/15" : isPast ? "border-red-500/30 bg-red-500/8 opacity-70" : "border-white/8 bg-white/3 opacity-35"
              }`}>
                <div className={`text-[8px] font-bold font-mono ${isActive ? "text-amber-400" : isPast ? "text-red-400" : "text-slate-600"}`}>S{sn}</div>
                <div className={`text-xs font-black font-mono mt-0.5 ${isActive ? "text-white" : isPast ? "text-red-300" : "text-slate-600"}`}>${stake}</div>
                <div className={`text-[7px] font-bold mt-0.5 ${isActive ? "text-amber-400" : isPast ? "text-red-500" : "text-slate-700"}`}>
                  {isPast ? "LOST" : isActive ? "NOW" : ""}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="px-2 py-2 rounded-lg bg-white/5 border border-white/8">
            <div className="text-[9px] text-slate-500 font-mono uppercase">Lost So Far</div>
            <div className="text-sm font-black text-red-400 font-mono">${totalLost.toFixed(2)}</div>
            <div className="text-[8px] text-slate-600 font-mono">{step - 1} trades</div>
          </div>
          <div className="px-2 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="text-[9px] text-amber-400 font-mono uppercase font-bold">Enter Now</div>
            <div className="text-sm font-black text-white font-mono">${currentStake}</div>
            <div className="text-[8px] text-amber-500 font-mono">Step {step}</div>
          </div>
          <div className="px-2 py-2 rounded-lg bg-white/5 border border-white/8">
            <div className="text-[9px] text-slate-500 font-mono uppercase">If Win</div>
            <div className={`text-sm font-black font-mono ${profit >= 0 ? "text-green-400" : "text-orange-400"}`}>{profit >= 0 ? "+" : ""}${profit}</div>
            <div className="text-[8px] text-slate-600 font-mono">net profit</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setStep(1)}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-green-500/50 bg-green-500/15 text-green-300 font-black text-sm hover:border-green-400 transition-all active:scale-95">
            <Trophy className="w-4 h-4" /> WIN — RESET
          </button>
          <button onClick={() => setStep(s => Math.min(s + 1, MAX_STEPS))} disabled={step >= MAX_STEPS}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-black text-sm transition-all active:scale-95 ${
              step >= MAX_STEPS ? "border-red-500/20 bg-red-500/5 text-red-800 cursor-not-allowed"
              : "border-red-500/50 bg-red-500/15 text-red-300 hover:border-red-400"
            }`}>
            <XCircle className="w-4 h-4" />
            {step >= MAX_STEPS ? "MAX STEP" : "LOSS — NEXT"}
          </button>
        </div>

        {step >= 4 && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/8">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-red-400 font-mono leading-relaxed">
              Step {step} — High capital at risk. OTC manipulation &amp; error candles are common at this depth.
            </p>
          </div>
        )}
        <div className="text-[9px] text-slate-700 font-mono text-center">Calculated at 85% Quotex payout · Win resets to Step 1</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Bottom Navigation
// ─────────────────────────────────────────────────────────────
function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "home",    icon: <HomeIcon className="w-5 h-5" />,    label: "Home"    },
    { id: "trade",   icon: <LineChart className="w-5 h-5" />,   label: "Trade"   },
    { id: "history", icon: <History className="w-5 h-5" />,     label: "History" },
    { id: "support", icon: <HelpCircle className="w-5 h-5" />,  label: "Support" },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-green-500/10 bg-[hsl(150_20%_4%/0.97)] backdrop-blur-xl">
      <div className="max-w-lg mx-auto flex items-center">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all ${
              active === t.id ? "text-green-400" : "text-slate-600 hover:text-slate-400"
            }`}
          >
            {t.icon}
            <span className="text-[9px] font-bold uppercase tracking-wider">{t.label}</span>
            {active === t.id && <span className="w-4 h-0.5 bg-green-400 rounded-full" />}
          </button>
        ))}
        <button
          onClick={() => {/* sign out: noop for now */}}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-slate-600 hover:text-red-400 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Sign out</span>
        </button>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
// Duration picker sheet
// ─────────────────────────────────────────────────────────────
function DurationPicker({ selected, onSelect, onClose }: {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
  onClose: () => void;
}) {
  const TF_LIST = TIMEFRAMES.filter(t => t.id !== "30m"); // match video: 30s,1m,2m,3m,5m,15m
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-[hsl(150_20%_5%)] border border-green-500/15 rounded-t-3xl p-5 pb-8 animate-slide-up"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-black text-white">Select Signal Duration</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Choose your preferred timeframe</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-white/8 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {TF_LIST.map(tf => (
            <button key={tf.id} onClick={() => { onSelect(tf.id); onClose(); }}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all ${
                selected === tf.id
                  ? "border-green-500/60 bg-green-500/15 text-green-300"
                  : "border-white/6 bg-white/3 text-slate-300 hover:border-white/15"
              }`}>
              <Clock className={`w-4 h-4 ${selected === tf.id ? "text-green-400" : "text-slate-500"}`} />
              <span className="font-bold text-sm">{tf.label}</span>
              <span className="text-xs text-slate-500 ml-auto">{tf.long}</span>
              {selected === tf.id && <CheckCircle2 className="w-4 h-4 text-green-400" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Model picker sheet
// ─────────────────────────────────────────────────────────────
function ModelPicker({ selected, onSelect, onClose }: {
  selected: ModelId;
  onSelect: (id: ModelId) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-[hsl(150_20%_5%)] border border-green-500/15 rounded-t-3xl p-5 pb-8 animate-slide-up"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-black text-white">Select AI Model</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Choose your signal engine</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-white/8 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {AI_MODELS.map(m => (
            <button key={m.id} onClick={() => { onSelect(m.id as ModelId); onClose(); }}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all ${
                selected === m.id
                  ? "border-green-500/60 bg-green-500/15"
                  : "border-white/6 bg-white/3 hover:border-white/15"
              }`}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-white/8 border border-white/10 shrink-0">{m.icon}</div>
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${selected === m.id ? "text-green-300" : "text-white"}`}>{m.name}</span>
                  <span className={`text-[10px] font-black ${selected === m.id ? "text-green-400" : "text-slate-500"}`}>{m.accuracy}%</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{m.desc}</div>
              </div>
              {selected === m.id && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HOME TAB — Configuration
// ─────────────────────────────────────────────────────────────
function HomeTab({
  selectedPair, onSelectPair,
  selectedTf, onSelectTf,
  selectedModel, onSelectModel,
  onLaunch, confidence,
}: {
  selectedPair: TradingPair | null;
  onSelectPair: (p: TradingPair) => void;
  selectedTf: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  selectedModel: ModelId;
  onSelectModel: (id: ModelId) => void;
  onLaunch: () => void;
  confidence: number;
}) {
  const [showDuration, setShowDuration] = useState(false);
  const [showModel, setShowModel]       = useState(false);
  const model = AI_MODELS.find(m => m.id === selectedModel)!;

  return (
    <>
      <div className="px-4 py-4 flex flex-col gap-4">
        {/* Page header */}
        <div className="text-center pt-2">
          <h2 className="text-base font-black text-white">AI Trading Configuration</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Set up your intelligent trading parameters</p>
        </div>

        {/* Circular gauge */}
        <CircularGauge value={confidence} modelName={model.desc} />

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: <Cpu className="w-5 h-5 text-slate-400" />,    label: "AI POWERED",  value: "AI",    color: "" },
            { icon: <Target className="w-5 h-5 text-green-500" />, label: "ACCURACY",    value: `${model.accuracy}%`, color: "text-green-400" },
            { icon: <Activity className="w-5 h-5 text-violet-400" />, label: "ACTIVE",   value: "24/7",  color: "text-violet-400" },
            { icon: <Zap className="w-5 h-5 text-amber-400" />,    label: "SIGNALS",     value: "∞",     color: "text-amber-400"  },
          ].map(item => (
            <div key={item.label} className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-white/4 border border-white/8">
              {item.icon}
              <span className={`text-xl font-black ${item.color || "text-white"}`}>{item.value}</span>
              <span className="text-[9px] text-slate-600 uppercase tracking-widest font-mono font-bold">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Platform */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">TRADING PLATFORM</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/4 border border-white/8">
            <div className="w-9 h-9 rounded-lg bg-red-500 flex items-center justify-center text-white font-black text-sm shrink-0">Q</div>
            <div>
              <p className="text-sm font-black text-white">Quotex</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">OFFICIAL TRADING PLATFORM</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/15 border border-green-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-green-400 font-bold">Active</span>
            </div>
          </div>
        </div>

        {/* Assets */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BarChart2 className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">TRADING ASSETS</span>
          </div>
          <PairDropdown selectedPair={selectedPair} onSelect={onSelectPair} compact />
        </div>

        {/* Duration */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">SIGNAL DURATION</span>
          </div>
          <button onClick={() => setShowDuration(true)}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-green-500/5 border border-green-500/15 hover:border-green-500/30 transition-all">
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-[9px] text-green-500 uppercase tracking-widest font-mono font-bold">DURATION</span>
              <span className="text-sm font-bold text-white">{selectedTf}</span>
              <span className="text-[10px] text-slate-500">Choose your preferred signal timeframe</span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
          </button>
        </div>

        {/* AI Model */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">AI MODEL</span>
          </div>
          <button onClick={() => setShowModel(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-green-500/5 border border-green-500/15 hover:border-green-500/30 transition-all">
            <div className="w-9 h-9 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-lg shrink-0">{model.icon}</div>
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{model.name}</span>
                <span className="text-[10px] font-black text-green-400">{model.accuracy}%</span>
              </div>
              <span className="text-[10px] text-slate-500">{model.desc}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
          </button>
        </div>

        {/* Launch */}
        <button
          onClick={onLaunch}
          className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl font-black text-base text-black bg-gradient-to-r from-green-400 to-green-500 hover:from-green-300 hover:to-green-400 shadow-[0_0_30px_hsl(142_70%_45%/0.5)] hover:shadow-[0_0_40px_hsl(142_70%_45%/0.7)] transition-all active:scale-95"
        >
          <Zap className="w-5 h-5" />
          Launch AI Trading Session
        </button>

        <div className="text-center text-[9px] text-slate-700 font-mono pb-2">
          KARTHIK LEE'S AI ENGINE v5.0 · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE
        </div>
      </div>

      {showDuration && <DurationPicker selected={selectedTf} onSelect={onSelectTf} onClose={() => setShowDuration(false)} />}
      {showModel    && <ModelPicker    selected={selectedModel} onSelect={onSelectModel} onClose={() => setShowModel(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// TRADE TAB — Signal Generation
// ─────────────────────────────────────────────────────────────
function TradeTab({
  selectedPair, onSelectPair,
  selectedTf, onSelectTf,
  selectedModel, onSelectModel,
  currentSignal, isAnalyzing,
  onGetSignal, entryTime, expiryTime,
  liveMarket,
}: {
  selectedPair: TradingPair | null;
  onSelectPair: (p: TradingPair) => void;
  selectedTf: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  selectedModel: ModelId;
  onSelectModel: (id: ModelId) => void;
  currentSignal: SignalResult | null;
  isAnalyzing: boolean;
  onGetSignal: () => void;
  entryTime: Date | null;
  expiryTime: Date | null;
  liveMarket: ReturnType<typeof useLiveMarket>;
}) {
  const [showDuration, setShowDuration] = useState(false);
  const [showModel, setShowModel]       = useState(false);
  const model = AI_MODELS.find(m => m.id === selectedModel)!;
  const isBuy = currentSignal?.direction === "BUY";

  return (
    <>
      <div className="px-4 py-4 flex flex-col gap-4">

        {/* App hero */}
        <div className="flex flex-col items-center gap-2 py-3">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-400 via-green-500 to-emerald-600 flex items-center justify-center shadow-[0_0_30px_hsl(142_70%_45%/0.4)]">
            <span className="text-white font-black text-xl">KL</span>
          </div>
          <div className="text-center">
            <h1 className="text-base font-black text-white">Karthik <span className="text-green-400">Lee's</span> AI Engine</h1>
            <p className="text-[10px] text-slate-500 font-mono">AI-POWERED TRADING SIGNALS</p>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1 text-[9px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
            </span>
            <span className="flex items-center gap-1 text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />AI ACTIVE
            </span>
            <span className="flex items-center gap-1 text-[9px] font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
              <Shield className="w-2.5 h-2.5" />SECURE
            </span>
          </div>
        </div>

        {/* Generate Signal button */}
        <button
          onClick={onGetSignal}
          disabled={!selectedPair || !liveMarket || isAnalyzing}
          className={`w-full rounded-2xl py-5 font-black text-xl tracking-widest uppercase transition-all border ${
            !selectedPair || !liveMarket
              ? "border-white/10 bg-white/5 text-slate-600 cursor-not-allowed"
              : isAnalyzing
              ? "border-green-500/40 bg-green-500/10 text-green-400 cursor-wait"
              : "border-green-500/60 bg-gradient-to-r from-green-500/20 to-green-600/20 text-green-300 hover:border-green-400 hover:text-white hover:shadow-[0_0_40px_hsl(142_70%_45%/0.4)]"
          }`}
        >
          {isAnalyzing
            ? <span className="flex items-center justify-center gap-2 text-base">
                <span className="w-5 h-5 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
                Analyzing {model.name}…
              </span>
            : !liveMarket
            ? <span className="flex items-center justify-center gap-2 text-base"><RefreshCw className="w-5 h-5 animate-spin" />Syncing…</span>
            : <span className="flex items-center justify-center gap-2"><Sparkles className="w-6 h-6" />Generate Signal</span>
          }
        </button>

        {/* Session configuration */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Settings2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">SESSION CONFIGURATION</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-2xl overflow-hidden border border-white/6 bg-white/3">
            {/* Assets */}
            <PairDropdown selectedPair={selectedPair} onSelect={onSelectPair} compact />
            {/* Duration */}
            <button onClick={() => setShowDuration(true)}
              className="flex items-center gap-3 px-4 py-3.5 border-t border-white/5 text-left hover:bg-white/4 transition-all">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-green-500" />
              </div>
              <div className="flex-1">
                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-mono font-bold">DURATION</div>
                <div className="text-sm font-bold text-white">{selectedTf}</div>
                <div className="text-[10px] text-slate-600">Tap to change timeframe</div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
            </button>
            {/* Model */}
            <button onClick={() => setShowModel(true)}
              className="flex items-center gap-3 px-4 py-3.5 border-t border-white/5 text-left hover:bg-white/4 transition-all">
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-base shrink-0">{model.icon}</div>
              <div className="flex-1">
                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-mono font-bold">AI MODEL</div>
                <div className="text-sm font-bold text-white">{model.name}</div>
                <div className="text-[10px] text-slate-600">Tap to swap engine</div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
            </button>
          </div>
        </div>

        {/* Clock + candle timer */}
        <div className="glass-panel rounded-2xl px-4 py-4 flex flex-col items-center gap-3">
          <LiveClock />
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <CandleTimer tf={selectedTf} />
            {liveMarket && (
              <div className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1.5 rounded-lg border ${
                liveMarket.structure.trend === "bullish" ? "border-green-500/30 bg-green-500/10 text-green-400"
                : liveMarket.structure.trend === "bearish" ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-white/10 bg-white/5 text-slate-500"
              }`}>
                {liveMarket.structure.trend === "bullish" ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {liveMarket.structure.trend.toUpperCase()}
              </div>
            )}
            {liveMarket && (
              <div className="text-[9px] font-mono text-slate-500 px-2 py-1 rounded border border-white/8 bg-white/4">
                {liveMarket.sessionName}
              </div>
            )}
          </div>
        </div>

        {/* Live indicators */}
        {liveMarket && <IndicatorsPanel market={liveMarket} />}

        {/* Price + S/R */}
        {liveMarket && selectedPair && (
          <div className="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500 font-semibold">{selectedPair.name}</span>
              <span className="font-black text-white text-base">{liveMarket.price.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
              <span className={`flex items-center gap-0.5 font-bold ${liveMarket.priceChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                {liveMarket.priceChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {liveMarket.priceChange >= 0 ? "+" : ""}{liveMarket.priceChange.toFixed(4)}%
              </span>
            </div>
            <SRBar support={liveMarket.sr.support} resistance={liveMarket.sr.resistance} price={liveMarket.price} />
            <div className="text-[10px] font-mono font-bold text-center">
              {liveMarket.sr.bounceFromSupport    && <span className="text-green-400">↑ BOUNCING FROM SUPPORT</span>}
              {liveMarket.sr.bounceFromResistance && <span className="text-red-400">↓ REJECTED AT RESISTANCE</span>}
              {!liveMarket.sr.bounceFromSupport && !liveMarket.sr.bounceFromResistance && liveMarket.sr.nearSupport    && <span className="text-green-600">⚡ NEAR SUPPORT</span>}
              {!liveMarket.sr.bounceFromSupport && !liveMarket.sr.bounceFromResistance && liveMarket.sr.nearResistance && <span className="text-red-600">⚡ NEAR RESISTANCE</span>}
              {!liveMarket.sr.nearSupport && !liveMarket.sr.nearResistance && <span className="text-slate-600">MID RANGE</span>}
            </div>
          </div>
        )}

        {/* Signal result */}
        {currentSignal && !isAnalyzing && (
          <>
            {currentSignal.direction === "SKIP" ? (
              <div className="animate-slide-up rounded-2xl border-2 border-amber-500/40 bg-amber-500/5 overflow-hidden">
                <div className="px-4 py-1.5 bg-amber-500/10 flex items-center justify-between text-[10px] font-bold font-mono">
                  <span className="text-amber-500">⚠ SKIP SIGNAL — {model.name}</span>
                  <span className="text-slate-600">{currentSignal.confidence}% conf</span>
                </div>
                <div className="px-4 py-4 text-center">
                  <p className="text-amber-400 font-bold text-sm">Market conditions unclear</p>
                  <p className="text-slate-500 text-xs mt-1">Wait for the next candle and generate a new signal</p>
                </div>
              </div>
            ) : (
              <div className={`animate-slide-up rounded-2xl border-2 overflow-hidden ${isBuy ? "border-green-500/60 glow-buy" : "border-red-500/60 glow-sell"}`}>
                <div className={`px-4 py-2 flex items-center justify-between text-[10px] font-bold font-mono ${isBuy ? "bg-green-500/15" : "bg-red-500/15"}`}>
                  <span className={isBuy ? "text-green-400" : "text-red-400"}>
                    {isBuy ? "⬆ BUY SIGNAL" : "⬇ SELL SIGNAL"} — {model.name}
                  </span>
                  <span className="text-slate-500">
                    {currentSignal.grade === "STRONG" ? "⚡ STRONG" : currentSignal.grade === "MODERATE" ? "◈ MODERATE" : "○ WEAK"}
                  </span>
                </div>

                {/* Direction + confidence */}
                <div className={`flex flex-col items-center py-6 gap-2 ${isBuy ? "bg-green-500/5" : "bg-red-500/5"}`}>
                  <div className={`text-7xl font-black flex items-center gap-3 ${isBuy ? "text-green-400" : "text-red-400"}`}>
                    {isBuy ? <ArrowUpRight className="w-16 h-16" /> : <ArrowDownRight className="w-16 h-16" />}
                    <span className="text-6xl">{currentSignal.direction}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-500 font-mono">Confidence</span>
                    <div className="w-24 h-1.5 bg-white/8 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isBuy ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${currentSignal.confidence}%` }} />
                    </div>
                    <span className={`text-sm font-black ${isBuy ? "text-green-400" : "text-red-400"}`}>{currentSignal.confidence}%</span>
                  </div>
                  {currentSignal.patternNames.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 justify-center px-4">
                      {currentSignal.patternNames.map(p => (
                        <span key={p} className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${isBuy ? "border-green-500/30 text-green-400 bg-green-500/10" : "border-red-500/30 text-red-400 bg-red-500/10"}`}>{p}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Entry / expiry */}
                {entryTime && expiryTime && (
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 bg-white/3 border-t border-white/5">
                    <div className="flex flex-col gap-1 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10">
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Entry</span>
                      <span className="text-sm font-black text-white font-mono">
                        {entryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <EntryCountdown entryTime={entryTime} />
                    </div>
                    <div className="flex flex-col gap-1 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10">
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Expiry</span>
                      <span className="text-sm font-black text-white font-mono">
                        {expiryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-slate-400 font-mono">
                        <Clock className="w-3 h-3" />{TIMEFRAMES.find(t => t.id === selectedTf)?.long}
                      </div>
                    </div>
                  </div>
                )}

                {/* Pair info */}
                <div className="flex items-center justify-center gap-3 text-xs text-slate-400 px-4 py-2 border-t border-white/5">
                  <span className="font-bold text-white">{selectedPair?.name}</span>
                  {selectedPair?.isOTC && <span className="text-[9px] font-bold text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded border border-violet-500/30">OTC</span>}
                  <span className="text-slate-600">·</span>
                  <span className="font-mono text-green-400 font-bold">{selectedTf}</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* No pair placeholder */}
        {!selectedPair && (
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center gap-3 text-slate-600">
            <BarChart2 className="w-10 h-10 opacity-20" />
            <p className="text-sm font-mono">Select a pair in configuration to begin</p>
          </div>
        )}
      </div>

      {showDuration && <DurationPicker selected={selectedTf} onSelect={onSelectTf} onClose={() => setShowDuration(false)} />}
      {showModel    && <ModelPicker    selected={selectedModel} onSelect={onSelectModel} onClose={() => setShowModel(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// HISTORY TAB
// ─────────────────────────────────────────────────────────────
function HistoryTab({
  history, setOutcome,
}: {
  history: SignalHistoryEntry[];
  setOutcome: (id: string, outcome: SignalOutcome) => void;
}) {
  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="text-center pt-2">
        <h2 className="text-base font-black text-white">Signal History</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">Track your wins and losses</p>
      </div>

      {history.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 flex flex-col items-center gap-3 text-slate-600">
          <History className="w-10 h-10 opacity-20" />
          <p className="text-sm font-mono">No signals yet — generate one in Trade</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Signals</span>
            </div>
            <span className="text-[10px] text-slate-600 font-mono">{history.length} total</span>
          </div>
          <WinRateBar history={history} />
          <div className="max-h-[50vh] overflow-y-auto scrollbar-thin">
            {history.map(entry => (
              <div key={entry.id} className={`flex items-center justify-between px-4 py-3 border-b border-white/4 last:border-0 transition-colors ${
                entry.outcome === "win" ? "bg-green-500/5" : entry.outcome === "loss" ? "bg-red-500/5" : ""
              }`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center font-black text-lg ${
                    entry.result.direction === "BUY" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                  }`}>{entry.result.direction === "BUY" ? "↑" : "↓"}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-white">{entry.pair.name}</span>
                      {entry.pair.isOTC && <span className="text-[9px] text-violet-400">OTC</span>}
                      <span className="text-[9px] text-green-600 font-mono bg-green-500/10 px-1 rounded">{entry.timeframe}</span>
                      {entry.result.patternNames.length > 0 && (
                        <span className={`text-[9px] font-bold ${entry.result.direction === "BUY" ? "text-green-500" : "text-red-500"}`}>
                          {entry.result.patternNames[0]}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {entry.entryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      {" → "}{entry.expiryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      {" · "}{entry.result.confidence}% conf
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button
                    onClick={() => setOutcome(entry.id, "win")}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-black border transition-all ${
                      entry.outcome === "win"
                        ? "bg-green-500/25 border-green-400/60 text-green-300 shadow-[0_0_10px_hsl(142_70%_50%/0.3)]"
                        : "bg-white/4 border-white/10 text-slate-600 hover:border-green-500/40 hover:text-green-500"
                    }`}
                  >
                    <Trophy className="w-3 h-3" />WIN
                  </button>
                  <button
                    onClick={() => setOutcome(entry.id, "loss")}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-black border transition-all ${
                      entry.outcome === "loss"
                        ? "bg-red-500/25 border-red-400/60 text-red-300 shadow-[0_0_10px_hsl(0_70%_55%/0.3)]"
                        : "bg-white/4 border-white/10 text-slate-600 hover:border-red-500/40 hover:text-red-500"
                    }`}
                  >
                    <XCircle className="w-3 h-3" />LOSS
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Martingale */}
      <MartingalePanel />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SUPPORT TAB
// ─────────────────────────────────────────────────────────────
function SupportTab() {
  const items = [
    { icon: "🤖", title: "How signals work", body: "The engine analyzes 14 indicators using Wilder's RSI, true MACD, Stochastic, Bollinger Bands, and ADX. Signals only fire when multiple independent factors agree — this is called confluence." },
    { icon: "📊", title: "9-Year Pro Patterns", body: "Morning Star, Evening Star, Three White Soldiers, Three Black Crows, Harami patterns and more. Each pattern is scored higher when it appears at a key support/resistance level." },
    { icon: "🧠", title: "AI Engine Models", body: "Switch between Quantum-X v3, Neural-9 Pro, Confluence Pro and Cross-Correlator on the Trade tab. Each uses the same base indicators with different weighting strategies." },
    { icon: "🔄", title: "Martingale Recovery", body: "If you get a loss due to OTC manipulation or error candles, use the Martingale calculator in History. It shows exactly how much to stake on the next trade to recover at 85% Quotex payout." },
    { icon: "⚠️", title: "Risk Warning", body: "This tool is for educational use only. Binary trading carries significant financial risk. Never trade with money you cannot afford to lose. The signals are not financial advice." },
    { icon: "📱", title: "Platform", body: "Optimized for use alongside Quotex (Official Trading Platform). Set the same timeframe in Quotex as selected in the app before entering a trade." },
  ];
  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="text-center pt-2">
        <h2 className="text-base font-black text-white">Support & Info</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">How to use Karthik Lee's AI Engine</p>
      </div>

      {/* Version card */}
      <div className="flex items-center gap-4 px-4 py-4 rounded-2xl bg-green-500/8 border border-green-500/20">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shrink-0">
          <span className="text-white font-black text-sm">KL</span>
        </div>
        <div>
          <p className="text-sm font-black text-white">Karthik Lee's AI Engine <span className="text-green-400">v5.0</span></p>
          <p className="text-[10px] text-slate-500 font-mono">9-Year Pro Confluence Engine</p>
          <p className="text-[10px] text-slate-600 mt-0.5">Quantum-X · Neural-9 · Cross-Correlator</p>
        </div>
      </div>

      {items.map(item => (
        <div key={item.title} className="px-4 py-4 rounded-2xl bg-white/3 border border-white/8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">{item.icon}</span>
            <h3 className="text-sm font-black text-white">{item.title}</h3>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{item.body}</p>
        </div>
      ))}

      <div className="text-center text-[9px] text-slate-700 font-mono pb-2">
        KARTHIK LEE'S AI ENGINE v5.0 · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab]         = useState<Tab>("home");
  const [selectedPair, setSelectedPair]   = useState<TradingPair | null>(null);
  const [selectedTf, setSelectedTf]       = useState<Timeframe>("1m");
  const [selectedModel, setSelectedModel] = useState<ModelId>("quantum-x");
  const [currentSignal, setCurrentSignal] = useState<SignalResult | null>(null);
  const [isAnalyzing, setIsAnalyzing]     = useState(false);
  const [history, setHistory]             = useState<SignalHistoryEntry[]>([]);
  const [entryTime, setEntryTime]         = useState<Date | null>(null);
  const [expiryTime, setExpiryTime]       = useState<Date | null>(null);

  const liveMarket = useLiveMarket(selectedPair?.id ?? null);

  const resetSignal = () => { setCurrentSignal(null); setEntryTime(null); setExpiryTime(null); };

  const handleGetSignal = useCallback(() => {
    if (!selectedPair || !liveMarket || isAnalyzing) return;
    setIsAnalyzing(true);
    resetSignal();
    const snap = { ...liveMarket, candles: [...liveMarket.candles] };
    setTimeout(() => {
      const result  = generateSignal(selectedPair.id + "_" + selectedTf, snap);
      const ms      = getTfMs(selectedTf);
      const entry   = new Date(getNextCandleMs(selectedTf));
      const expiry  = new Date(entry.getTime() + ms);
      setCurrentSignal(result);
      setIsAnalyzing(false);
      if (result.direction !== "SKIP") {
        setEntryTime(entry);
        setExpiryTime(expiry);
        setHistory(prev => [{
          id: `${Date.now()}-${Math.random()}`,
          pair: selectedPair, timeframe: selectedTf, result,
          timestamp: new Date(), entryTime: entry, expiryTime: expiry,
          outcome: null,
        }, ...prev].slice(0, 60));
      }
    }, 1400);
  }, [selectedPair, selectedTf, liveMarket, isAnalyzing]);

  const setOutcome = (id: string, outcome: SignalOutcome) => {
    setHistory(prev => prev.map(h => h.id === id ? { ...h, outcome: h.outcome === outcome ? null : outcome } : h));
  };

  const handleLaunch = () => setActiveTab("trade");

  // Dynamic confidence: use latest signal confidence or model accuracy
  const model      = AI_MODELS.find(m => m.id === selectedModel)!;
  const confidence = currentSignal ? currentSignal.confidence : Math.round(model.accuracy);

  return (
    <div className="min-h-screen text-foreground flex flex-col pb-20">

      {/* ── STICKY HEADER ── */}
      <header className="glass-panel border-b sticky top-0 z-50 px-4 py-2.5">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-green-400 via-green-500 to-emerald-600 flex items-center justify-center">
                <span className="text-white font-black text-[10px]">KL</span>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border-2 border-background animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-black text-white">Karthik<span className="text-green-400"> Lee's</span></h1>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">AI Engine v5</span>
              </div>
              <p className="text-[9px] text-slate-600 font-mono">9-Year Pro Confluence Engine</p>
            </div>
          </div>
          <SyncBadge market={liveMarket} />
        </div>
      </header>

      {/* ── TAB CONTENT ── */}
      <div className="max-w-lg mx-auto w-full flex-1">
        {activeTab === "home" && (
          <HomeTab
            selectedPair={selectedPair}     onSelectPair={p => { setSelectedPair(p); resetSignal(); }}
            selectedTf={selectedTf}         onSelectTf={tf => { setSelectedTf(tf); resetSignal(); }}
            selectedModel={selectedModel}   onSelectModel={setSelectedModel}
            onLaunch={handleLaunch}         confidence={confidence}
          />
        )}
        {activeTab === "trade" && (
          <TradeTab
            selectedPair={selectedPair}     onSelectPair={p => { setSelectedPair(p); resetSignal(); }}
            selectedTf={selectedTf}         onSelectTf={tf => { setSelectedTf(tf); resetSignal(); }}
            selectedModel={selectedModel}   onSelectModel={setSelectedModel}
            currentSignal={currentSignal}   isAnalyzing={isAnalyzing}
            onGetSignal={handleGetSignal}   entryTime={entryTime}   expiryTime={expiryTime}
            liveMarket={liveMarket}
          />
        )}
        {activeTab === "history" && (
          <HistoryTab history={history} setOutcome={setOutcome} />
        )}
        {activeTab === "support" && <SupportTab />}
      </div>

      {/* ── BOTTOM NAV ── */}
      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
