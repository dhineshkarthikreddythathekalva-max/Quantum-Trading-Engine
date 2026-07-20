import { useState, useCallback, useEffect, useRef } from "react";
import { PAIRS, CATEGORY_LABELS, type PairCategory, type TradingPair } from "@/data/pairs";
import { generateSignal, type SignalResult } from "@/lib/signalEngine";
import { useLiveMarket } from "@/lib/liveMarket";
import { TIMEFRAMES, type Timeframe } from "@/data/timeframes";
import {
  Zap, ChevronUp, ChevronDown, Clock, AlertTriangle, BarChart2,
  ChevronRight, Search, X, Wifi, WifiOff, RefreshCw,
  ArrowUpRight, ArrowDownRight, Timer, TrendingUp, TrendingDown,
  Activity, Layers,
} from "lucide-react";

interface SignalHistoryEntry {
  id: string;
  pair: TradingPair;
  timeframe: Timeframe;
  result: SignalResult;
  timestamp: Date;
  entryTime: Date;
  expiryTime: Date;
}

/* ── helpers ── */
function fmt2(n: number) { return String(n).padStart(2, "0"); }
function getNextCandleMs(tf: Timeframe): number {
  const ms: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
  return Math.ceil(Date.now() / ms[tf]) * ms[tf];
}
function msCountdown(ms: number) {
  if (ms <= 0) return "00:00";
  const s = Math.ceil(ms / 1000);
  return `${fmt2(Math.floor(s / 60))}:${fmt2(s % 60)}`;
}

/* ── Live digital clock ── */
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const blink = now.getSeconds() % 2 === 0;
  return (
    <div className="flex flex-col items-center select-none">
      <div className="flex items-end gap-0.5 leading-none">
        <span className="text-5xl font-black font-mono text-white tracking-tight">{fmt2(now.getHours())}</span>
        <span className={`text-5xl font-black font-mono text-cyan-400 tracking-tight transition-opacity duration-200 ${blink ? "opacity-100" : "opacity-20"}`}>:</span>
        <span className="text-5xl font-black font-mono text-white tracking-tight">{fmt2(now.getMinutes())}</span>
        <span className={`text-5xl font-black font-mono text-cyan-400 tracking-tight transition-opacity duration-200 ${blink ? "opacity-100" : "opacity-20"}`}>:</span>
        <span className="text-3xl font-black font-mono text-slate-400 tracking-tight pb-1">{fmt2(now.getSeconds())}</span>
      </div>
      <p className="text-[10px] text-slate-600 font-mono mt-1">
        {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
      </p>
    </div>
  );
}

/* ── Candle countdown ── */
function CandleTimer({ tf }: { tf: Timeframe }) {
  const msMap: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
  const [rem, setRem] = useState(0);
  useEffect(() => {
    const tick = () => { const next = Math.ceil(Date.now() / msMap[tf]) * msMap[tf]; setRem(next - Date.now()); };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [tf]);
  const pct    = 1 - rem / msMap[tf];
  const urgent = rem < 5000;
  return (
    <div className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border ${urgent ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/8 bg-white/4 text-slate-400"}`}>
      <Timer className={`w-3.5 h-3.5 shrink-0 ${urgent ? "text-red-400 animate-pulse" : "text-cyan-500"}`} />
      <span className="font-bold">{msCountdown(rem)}</span>
      <span className="text-slate-600 text-[9px]">next candle</span>
      <div className="w-14 h-1 bg-white/8 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${urgent ? "bg-red-400" : "bg-cyan-500"}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

/* ── Entry countdown ── */
function EntryCountdown({ entryTime }: { entryTime: Date }) {
  const [rem, setRem] = useState(entryTime.getTime() - Date.now());
  useEffect(() => { const t = setInterval(() => setRem(entryTime.getTime() - Date.now()), 500); return () => clearInterval(t); }, [entryTime]);
  return (
    <div className={`flex items-center gap-1.5 font-mono font-bold text-sm ${rem <= 0 ? "text-emerald-400 animate-pulse" : "text-amber-400"}`}>
      <Timer className="w-4 h-4" />
      {rem <= 0 ? "ENTER NOW →" : `Enter in ${msCountdown(rem)}`}
    </div>
  );
}

/* ── S/R zone bar ── */
function SRBar({ support, resistance, price }: { support: number; resistance: number; price: number }) {
  const range = resistance - support || 1;
  const pct   = Math.max(0, Math.min(1, (price - support) / range));
  const dec   = price > 100 ? 2 : 5;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 uppercase tracking-widest">
        <span className="text-emerald-500">Support</span>
        <span className="text-white font-bold text-xs">{price.toLocaleString(undefined, { maximumFractionDigits: dec })}</span>
        <span className="text-red-500">Resistance</span>
      </div>
      <div className="relative h-2.5 bg-white/5 rounded-full">
        <div className="absolute left-0 top-0 h-full w-[15%] bg-emerald-500/25 rounded-l-full" />
        <div className="absolute right-0 top-0 h-full w-[15%] bg-red-500/25 rounded-r-full" />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-cyan-400 bg-background shadow-[0_0_10px_hsl(186_100%_50%/0.8)] transition-all duration-700"
          style={{ left: `${pct * 100}%` }} />
      </div>
      <div className="flex justify-between text-[9px] font-mono font-bold">
        <span className="text-emerald-400">{support.toLocaleString(undefined, { maximumFractionDigits: dec })}</span>
        <span className="text-red-400">{resistance.toLocaleString(undefined, { maximumFractionDigits: dec })}</span>
      </div>
    </div>
  );
}

/* ── RSI Arc gauge ── */
function RSIGauge({ value }: { value: number }) {
  const color = value < 30 ? "#34d399" : value > 70 ? "#f87171" : "#94a3b8";
  const label = value < 30 ? "OVERSOLD" : value > 70 ? "OVERBOUGHT" : "NEUTRAL";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`text-lg font-black font-mono`} style={{ color }}>{value.toFixed(0)}</div>
      <div className="text-[8px] font-bold text-slate-600 uppercase tracking-wider">RSI</div>
      <div className={`text-[8px] font-bold`} style={{ color }}>{label}</div>
    </div>
  );
}

/* ── Indicator chip ── */
function IndChip({ label, value, bull }: { label: string; value: string; bull: boolean | null }) {
  const color = bull === null ? "text-slate-400 border-white/10 bg-white/4"
    : bull ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/8"
    : "text-red-400 border-red-500/30 bg-red-500/8";
  return (
    <div className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg border text-center ${color}`}>
      <div className="text-[9px] font-bold opacity-60 uppercase tracking-wider">{label}</div>
      <div className="text-[11px] font-black font-mono mt-0.5">{value}</div>
    </div>
  );
}

/* ── Live Indicators Panel ── */
function IndicatorsPanel({ market }: { market: ReturnType<typeof useLiveMarket> }) {
  if (!market) return null;
  const { indicators: ind, structure: str } = market;
  const rsiColor = ind.rsi14 < 30 ? "text-emerald-400" : ind.rsi14 > 70 ? "text-red-400" : "text-slate-400";

  return (
    <div className="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Live Indicators</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ml-auto ${
          str.trend === "bullish" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : str.trend === "bearish" ? "border-red-500/30 bg-red-500/10 text-red-400"
          : "border-white/10 bg-white/5 text-slate-500"
        }`}>
          {str.trend.toUpperCase()}
        </span>
      </div>

      {/* Row 1: RSI + ADX + BB */}
      <div className="grid grid-cols-4 gap-2">
        <IndChip label="RSI(14)" value={ind.rsi14.toFixed(0)} bull={ind.rsi14 < 45 ? true : ind.rsi14 > 55 ? false : null} />
        <IndChip label="ADX" value={ind.adx.toFixed(0)} bull={ind.adx > 25 ? true : null} />
        <IndChip label="STOCH" value={`${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)}`}
          bull={ind.stochSignal === "oversold" ? true : ind.stochSignal === "overbought" ? false : ind.stochK > ind.stochD ? true : false} />
        <IndChip label="BB%" value={`${(ind.bbPct * 100).toFixed(0)}%`}
          bull={ind.bbPct < 0.35 ? true : ind.bbPct > 0.65 ? false : null} />
      </div>

      {/* Row 2: EMA + MACD */}
      <div className="grid grid-cols-3 gap-2">
        <IndChip label="EMA Trend" value={ind.emaTrend === "bullish" ? "↑ BULL" : "↓ BEAR"}
          bull={ind.emaTrend === "bullish"} />
        <IndChip label="MACD" value={ind.macdCross !== "none" ? (ind.macdCross === "bullish" ? "✕ UP" : "✕ DN") : (ind.macdHist >= 0 ? "▲ POS" : "▼ NEG")}
          bull={ind.macdHist >= 0} />
        <IndChip label="+DI/-DI" value={`${ind.plusDI.toFixed(0)}/${ind.minusDI.toFixed(0)}`}
          bull={ind.plusDI > ind.minusDI} />
      </div>

      {/* RSI visual bar */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[9px] font-mono text-slate-600">
          <span className="text-emerald-600">30</span>
          <span className={`font-bold ${rsiColor}`}>RSI {ind.rsi14.toFixed(1)}</span>
          <span className="text-red-600">70</span>
        </div>
        <div className="relative h-1.5 bg-white/5 rounded-full">
          <div className="absolute left-[30%] w-px h-full bg-emerald-500/40" />
          <div className="absolute left-[70%] w-px h-full bg-red-500/40" />
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 transition-all duration-700"
            style={{ left: `${ind.rsi14}%`, borderColor: ind.rsi14 < 30 ? "#34d399" : ind.rsi14 > 70 ? "#f87171" : "#94a3b8", background: "hsl(var(--background))" }} />
        </div>
      </div>
    </div>
  );
}

/* ── Pair dropdown ── */
function PairDropdown({ selectedPair, onSelect }: { selectedPair: TradingPair | null; onSelect: (p: TradingPair) => void }) {
  const [open, setOpen]   = useState(false);
  const [cat, setCat]     = useState<PairCategory>("currencies");
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = PAIRS.filter(p => p.category === cat && (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="relative w-full" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
          open ? "border-cyan-500/60 bg-cyan-500/8 text-cyan-300"
          : selectedPair ? "border-white/15 bg-white/5 text-white hover:border-cyan-500/40"
          : "border-white/10 bg-white/4 text-slate-500 hover:border-white/20"
        }`}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" />
          {selectedPair
            ? <span className="flex items-center gap-2">
                {selectedPair.name}
                {selectedPair.isOTC && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-300 border border-violet-500/30">OTC</span>}
              </span>
            : "Select a trading pair…"}
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180 text-cyan-400" : "text-slate-500"}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[100] glass-panel-bright rounded-2xl border border-cyan-500/20 shadow-[0_8px_40px_hsl(186_100%_50%/0.15)] animate-slide-up overflow-hidden">
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
                placeholder="Search pair…"
                className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none font-mono" />
              {search && <button onClick={() => setSearch("")}><X className="w-3 h-3 text-slate-600 hover:text-slate-400" /></button>}
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin py-1">
            {filtered.length === 0
              ? <p className="text-xs text-slate-600 text-center py-4 font-mono">No pairs found</p>
              : filtered.map(pair => (
                  <button key={pair.id} onClick={() => { onSelect(pair); setOpen(false); setSearch(""); }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-all ${selectedPair?.id === pair.id ? "bg-cyan-500/12 text-cyan-300" : "text-slate-300 hover:bg-white/5"}`}>
                    <div className="flex items-center gap-2">
                      {selectedPair?.id === pair.id && <ChevronRight className="w-3 h-3 text-cyan-400" />}
                      <span className="font-semibold">{pair.name}</span>
                      {pair.isOTC && <span className="text-[9px] text-violet-400 font-bold">OTC</span>}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{pair.profitability}%</span>
                  </button>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sync badge ── */
function SyncBadge({ market }: { market: ReturnType<typeof useLiveMarket> }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { setBlink(false); const t = setTimeout(() => setBlink(true), 200); return () => clearTimeout(t); }, [market?.syncCount]);
  if (!market) return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10">
      <WifiOff className="w-3 h-3 text-red-400" /><span className="text-red-400 font-semibold">No Data</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10">
      <Wifi className="w-3 h-3 text-emerald-400" />
      <span className={`text-emerald-400 font-semibold transition-opacity ${blink ? "opacity-100" : "opacity-30"}`}>LIVE</span>
      <span className="text-emerald-600 text-[9px] font-mono">3s</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════ */
export default function Home() {
  const [selectedPair, setSelectedPair] = useState<TradingPair | null>(null);
  const [selectedTf, setSelectedTf]     = useState<Timeframe>("1m");
  const [currentSignal, setCurrentSignal] = useState<SignalResult | null>(null);
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [history, setHistory]           = useState<SignalHistoryEntry[]>([]);
  const [entryTime, setEntryTime]       = useState<Date | null>(null);
  const [expiryTime, setExpiryTime]     = useState<Date | null>(null);

  const activeTf   = TIMEFRAMES.find(t => t.id === selectedTf)!;
  const liveMarket = useLiveMarket(selectedPair?.id ?? null);

  const resetSignal = () => { setCurrentSignal(null); setEntryTime(null); setExpiryTime(null); };

  const handleGetSignal = useCallback(() => {
    if (!selectedPair || !liveMarket || isAnalyzing) return;
    setIsAnalyzing(true);
    resetSignal();
    const snap = { ...liveMarket, candles: [...liveMarket.candles] };
    setTimeout(() => {
      const result = generateSignal(selectedPair.id + "_" + selectedTf, snap);
      const msMap: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
      const entry  = new Date(getNextCandleMs(selectedTf));
      const expiry = new Date(entry.getTime() + msMap[selectedTf]);
      setCurrentSignal(result);
      setIsAnalyzing(false);
      if (result.direction !== "SKIP") {
        setEntryTime(entry);
        setExpiryTime(expiry);
        setHistory(prev => [{
          id: `${Date.now()}-${Math.random()}`,
          pair: selectedPair, timeframe: selectedTf, result,
          timestamp: new Date(), entryTime: entry, expiryTime: expiry,
        }, ...prev].slice(0, 50));
      } else {
        setEntryTime(null);
        setExpiryTime(null);
      }
    }, 1400);
  }, [selectedPair, selectedTf, liveMarket, isAnalyzing]);

  const isBuy = currentSignal?.direction === "BUY";
  const gradeLabel = (g: SignalResult["grade"]) =>
    g === "STRONG" ? "⚡ STRONG" : g === "MODERATE" ? "◈ MODERATE" : "○ WEAK";

  return (
    <div className="min-h-screen text-foreground flex flex-col">

      {/* ── STICKY HEADER ── */}
      <header className="glass-panel border-b sticky top-0 z-50 px-4 py-2.5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 via-violet-500 to-fuchsia-600 flex items-center justify-center">
                <span className="text-white font-black text-[10px]">KL</span>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border-2 border-background animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-black text-white">Karthik<span className="text-cyan-400"> Lee's</span></h1>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">AI Engine v4</span>
              </div>
              <p className="text-[9px] text-slate-600 font-mono">Real Indicator Confluence Engine</p>
            </div>
          </div>
          <SyncBadge market={liveMarket} />
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full px-4 py-4 flex flex-col gap-4">

        {/* ══ 1. CONTROLS ══ */}
        <div className="glass-panel-bright rounded-2xl p-4 flex flex-col gap-3">
          <PairDropdown
            selectedPair={selectedPair}
            onSelect={p => { setSelectedPair(p); resetSignal(); }}
          />
          <div className="grid grid-cols-4 gap-2">
            {TIMEFRAMES.map(tf => (
              <button key={tf.id} onClick={() => { setSelectedTf(tf.id); resetSignal(); }}
                className={`py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  selectedTf === tf.id
                    ? "border-cyan-500/70 bg-cyan-500/15 text-cyan-300 shadow-[0_0_14px_hsl(186_100%_50%/0.2)]"
                    : "border-white/10 bg-white/4 text-slate-400 hover:border-white/20"
                }`}>
                <span className="block font-mono">{tf.label}</span>
                <span className="block text-[9px] font-normal mt-0.5 opacity-60">{tf.long}</span>
              </button>
            ))}
          </div>
          <button onClick={handleGetSignal} disabled={!selectedPair || !liveMarket || isAnalyzing}
            className={`w-full rounded-2xl py-4 font-black text-lg tracking-widest uppercase transition-all border ${
              !selectedPair || !liveMarket ? "border-white/10 bg-white/5 text-slate-600 cursor-not-allowed"
              : isAnalyzing ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 cursor-wait"
              : "border-cyan-500/60 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 hover:border-cyan-400 hover:text-white hover:shadow-[0_0_30px_hsl(186_100%_50%/0.3)]"
            }`}>
            {isAnalyzing
              ? <span className="flex items-center justify-center gap-2"><span className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />Analyzing 12 Indicators…</span>
              : !liveMarket
              ? <span className="flex items-center justify-center gap-2"><RefreshCw className="w-5 h-5 animate-spin" />Syncing…</span>
              : <span className="flex items-center justify-center gap-2"><Zap className="w-5 h-5" />Get Signal</span>
            }
          </button>
        </div>

        {/* ══ 2. CLOCK + TIMER ══ */}
        <div className="glass-panel rounded-2xl px-4 py-4 flex flex-col items-center gap-3">
          <LiveClock />
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <CandleTimer tf={selectedTf} />
            {liveMarket && (
              <div className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1.5 rounded-lg border ${
                liveMarket.structure.trend === "bullish" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : liveMarket.structure.trend === "bearish" ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-white/10 bg-white/5 text-slate-500"
              }`}>
                {liveMarket.structure.trend === "bullish" ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {liveMarket.structure.trend.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* ══ 3. LIVE INDICATORS PANEL ══ */}
        {liveMarket && <IndicatorsPanel market={liveMarket} />}

        {/* ══ 4. LIVE PRICE + S/R ══ */}
        {liveMarket && selectedPair && (
          <div className="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500 font-semibold">{selectedPair.name}</span>
              <span className="font-black text-white text-base">{liveMarket.price.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
              <span className={`flex items-center gap-0.5 font-bold ${liveMarket.priceChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {liveMarket.priceChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {liveMarket.priceChange >= 0 ? "+" : ""}{liveMarket.priceChange.toFixed(4)}%
              </span>
            </div>
            <SRBar support={liveMarket.sr.support} resistance={liveMarket.sr.resistance} price={liveMarket.price} />
            <div className="text-[10px] font-mono font-bold text-center">
              {liveMarket.sr.bounceFromSupport    && <span className="text-emerald-400">↑ BOUNCING FROM SUPPORT</span>}
              {liveMarket.sr.bounceFromResistance && <span className="text-red-400">↓ REJECTED AT RESISTANCE</span>}
              {!liveMarket.sr.bounceFromSupport && !liveMarket.sr.bounceFromResistance && liveMarket.sr.nearSupport    && <span className="text-emerald-600">⚡ NEAR SUPPORT</span>}
              {!liveMarket.sr.bounceFromSupport && !liveMarket.sr.bounceFromResistance && liveMarket.sr.nearResistance && <span className="text-red-600">⚡ NEAR RESISTANCE</span>}
              {!liveMarket.sr.nearSupport && !liveMarket.sr.nearResistance && <span className="text-slate-600">MID RANGE</span>}
            </div>
          </div>
        )}

        {/* ══ 5. SIGNAL RESULT ══ */}
        {currentSignal && !isAnalyzing && (
          <>
            {/* SKIP card */}
            {currentSignal.direction === "SKIP" && (
              <div className="animate-slide-up rounded-2xl border-2 border-amber-500/40 bg-amber-500/5 overflow-hidden">
                <div className="px-4 py-1.5 bg-amber-500/10 flex items-center justify-between text-[10px] font-bold font-mono">
                  <span className="text-amber-400">⏸ NO SIGNAL</span>
                  <span className="text-slate-500">Indicators not aligned</span>
                </div>
                <div className="p-6 flex flex-col items-center gap-4">
                  <span className="text-6xl font-black text-amber-400 tracking-widest select-none">SKIP</span>
                  <p className="text-sm text-amber-300 font-bold text-center">Do not enter this candle</p>
                  <div className="w-full flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{currentSignal.skipReason}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Wait for next candle · indicators update every 3 seconds</span>
                  </div>
                </div>
              </div>
            )}

            {/* BUY / SELL card */}
            {(currentSignal.direction === "BUY" || currentSignal.direction === "SELL") && entryTime && expiryTime && (
              <div className={`animate-slide-up rounded-2xl border-2 overflow-hidden ${
                isBuy ? "border-emerald-500/60 shadow-[0_0_40px_hsl(152_70%_50%/0.15)]"
                      : "border-red-500/60 shadow-[0_0_40px_hsl(0_70%_55%/0.15)]"
              }`}>
                {/* grade bar */}
                <div className={`px-4 py-1.5 flex items-center justify-between text-[10px] font-bold font-mono ${isBuy ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                  <span className={isBuy ? "text-emerald-400" : "text-red-400"}>{gradeLabel(currentSignal.grade)}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">{currentSignal.highWeightCount} major signals</span>
                    <span className="text-slate-500">{currentSignal.confidence}% confidence</span>
                  </div>
                </div>

                <div className={`p-5 flex flex-col gap-4 ${isBuy ? "bg-emerald-500/5" : "bg-red-500/5"}`}>

                  {/* BIG direction */}
                  <div className="flex flex-col items-center py-2">
                    {isBuy
                      ? <div className="flex items-center gap-3"><ChevronUp className="w-20 h-20 text-emerald-400" strokeWidth={3} /><span className="text-7xl font-black text-emerald-400 tracking-widest">BUY</span></div>
                      : <div className="flex items-center gap-3"><ChevronDown className="w-20 h-20 text-red-400" strokeWidth={3} /><span className="text-7xl font-black text-red-400 tracking-widest">SELL</span></div>
                    }
                  </div>

                  {/* Key reason */}
                  <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold ${
                    isBuy ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                          : "bg-red-500/10 border border-red-500/20 text-red-300"
                  }`}>
                    <span className="mt-0.5 shrink-0">›</span>
                    <span>{currentSignal.keyReason}</span>
                  </div>

                  {/* Indicator snapshot row */}
                  <div className="grid grid-cols-4 gap-2">
                    <RSIGauge value={currentSignal.rsi} />
                    <div className="flex flex-col items-center gap-0.5">
                      <div className={`text-lg font-black font-mono ${currentSignal.adx > 25 ? "text-cyan-400" : "text-slate-500"}`}>{currentSignal.adx.toFixed(0)}</div>
                      <div className="text-[8px] font-bold text-slate-600 uppercase tracking-wider">ADX</div>
                      <div className={`text-[8px] font-bold ${currentSignal.adx > 30 ? "text-cyan-400" : currentSignal.adx > 20 ? "text-slate-400" : "text-slate-600"}`}>
                        {currentSignal.adx > 30 ? "TRENDING" : currentSignal.adx > 20 ? "MODERATE" : "WEAK"}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <div className={`text-base font-black font-mono ${currentSignal.macdDir === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                        {currentSignal.macdDir === "bullish" ? "▲" : "▼"}
                      </div>
                      <div className="text-[8px] font-bold text-slate-600 uppercase tracking-wider">MACD</div>
                      <div className={`text-[8px] font-bold ${currentSignal.macdDir === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                        {currentSignal.macdDir.toUpperCase()}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <div className={`text-sm font-black font-mono ${currentSignal.stochK < 20 ? "text-emerald-400" : currentSignal.stochK > 80 ? "text-red-400" : "text-slate-400"}`}>
                        {currentSignal.stochK.toFixed(0)}/{currentSignal.stochD.toFixed(0)}
                      </div>
                      <div className="text-[8px] font-bold text-slate-600 uppercase tracking-wider">STOCH</div>
                      <div className={`text-[8px] font-bold ${currentSignal.stochK < 20 ? "text-emerald-400" : currentSignal.stochK > 80 ? "text-red-400" : "text-slate-500"}`}>
                        {currentSignal.stochK < 20 ? "OVERSOLD" : currentSignal.stochK > 80 ? "OVERBOUGHT" : "NEUTRAL"}
                      </div>
                    </div>
                  </div>

                  {/* Pattern badges */}
                  {currentSignal.patternNames.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3 h-3 text-slate-600" />
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Patterns Detected</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {currentSignal.patternNames.map(p => (
                          <span key={p} className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                            isBuy ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : "border-red-500/40 bg-red-500/10 text-red-300"
                          }`}>{p}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Confirmed factors list */}
                  {currentSignal.factors.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3 h-3 text-slate-600" />
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Confirmed Signals ({currentSignal.factors.length})</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        {currentSignal.factors.slice(0, 6).map((f, i) => (
                          <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
                            f.weight >= 2.0 ? (isBuy ? "bg-emerald-500/10 border border-emerald-500/15" : "bg-red-500/10 border border-red-500/15")
                                           : "bg-white/3 border border-white/6"
                          }`}>
                            <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${f.weight >= 2.0 ? (isBuy ? "bg-emerald-400" : "bg-red-400") : "bg-slate-600"}`} />
                            <span className={f.weight >= 2.0 ? (isBuy ? "text-emerald-300" : "text-red-300") : "text-slate-500"}>{f.label}</span>
                            <span className={`ml-auto font-mono text-[9px] font-bold ${f.weight >= 2.0 ? "text-slate-400" : "text-slate-600"}`}>{f.weight.toFixed(1)}</span>
                          </div>
                        ))}
                        {currentSignal.factors.length > 6 && (
                          <div className="text-[10px] text-slate-600 font-mono text-center">+{currentSignal.factors.length - 6} more signals</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Entry + Expiry */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Entry At</span>
                      <span className="text-base font-black text-white font-mono">
                        {entryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <EntryCountdown entryTime={entryTime} />
                    </div>
                    <div className="flex flex-col gap-1.5 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Expiry</span>
                      <span className="text-base font-black text-white font-mono">
                        {expiryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-slate-400 font-mono">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />{activeTf.long}
                      </div>
                    </div>
                  </div>

                  {/* Pair info */}
                  <div className="flex items-center justify-center gap-3 text-xs text-slate-400 flex-wrap">
                    <span className="font-bold text-white">{selectedPair?.name}</span>
                    {selectedPair?.isOTC && <span className="text-[9px] font-bold text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded border border-violet-500/30">OTC</span>}
                    <span className="text-slate-600">·</span>
                    <span className="font-mono text-cyan-400 font-bold">{selectedTf}</span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono">{selectedPair?.profitability}% payout</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* No pair placeholder */}
        {!selectedPair && (
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center gap-3 text-slate-600">
            <BarChart2 className="w-10 h-10 opacity-20" />
            <p className="text-sm font-mono">Select a pair above to begin</p>
          </div>
        )}

        {/* ══ 6. SIGNAL HISTORY ══ */}
        {history.length > 0 && (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Signal History</span>
              </div>
              <span className="text-[10px] text-slate-600 font-mono">{history.length} signals</span>
            </div>
            <div className="max-h-64 overflow-y-auto scrollbar-thin">
              {history.map(entry => (
                <div key={entry.id} className="history-row flex items-center justify-between px-4 py-3 border-b border-white/4 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-lg ${
                      entry.result.direction === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                    }`}>
                      {entry.result.direction === "BUY" ? "↑" : "↓"}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-white">{entry.pair.name}</span>
                        {entry.pair.isOTC && <span className="text-[9px] text-violet-400">OTC</span>}
                        <span className="text-[9px] text-cyan-600 font-mono bg-cyan-500/10 px-1 rounded">{entry.timeframe}</span>
                        {entry.result.patternNames.length > 0 && (
                          <span className={`text-[9px] font-bold ${entry.result.direction === "BUY" ? "text-emerald-500" : "text-red-500"}`}>
                            {entry.result.patternNames[0]}
                          </span>
                        )}
                        <span className={`text-[9px] font-bold px-1 rounded ${
                          entry.result.grade === "STRONG" ? "text-amber-400" : entry.result.grade === "MODERATE" ? "text-slate-400" : "text-slate-600"
                        }`}>{entry.result.grade}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        {entry.entryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} →{" "}
                        {entry.expiryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        {" · "}{entry.result.confidence}% conf
                      </div>
                    </div>
                  </div>
                  <div className={`text-base font-black ${entry.result.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                    {entry.result.direction}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      <div className="text-center py-4 text-[10px] text-slate-700 font-mono">
        KARTHIK LEE'S AI ENGINE v4.0 · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}
