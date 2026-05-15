import { useState, useCallback, useEffect, useRef } from "react";
import { PAIRS, CATEGORY_LABELS, type PairCategory, type TradingPair } from "@/data/pairs";
import { generateSignal, type SignalResult } from "@/lib/signalEngine";
import { useLiveMarket } from "@/lib/liveMarket";
import { TIMEFRAMES, type Timeframe } from "@/data/timeframes";
import {
  Zap, ChevronUp, ChevronDown, Clock, AlertTriangle, BarChart2,
  ChevronRight, Search, X, Wifi, WifiOff, RefreshCw, ArrowUpRight,
  ArrowDownRight, Timer, TrendingUp, TrendingDown, Activity,
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

/* ── Candle helpers ── */
function getNextCandleMs(tf: Timeframe): number {
  const now  = Date.now();
  const msMap: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
  const ms   = msMap[tf];
  return Math.ceil(now / ms) * ms;
}
function fmt2(n: number) { return String(n).padStart(2, "0"); }
function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00";
  const s = Math.ceil(ms / 1000);
  return `${fmt2(Math.floor(s / 60))}:${fmt2(s % 60)}`;
}

/* ── Live digital clock ── */
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = fmt2(now.getHours());
  const m = fmt2(now.getMinutes());
  const s = fmt2(now.getSeconds());
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-1 leading-none select-none">
        <span className="text-5xl font-black font-mono text-white tracking-tight">{h}</span>
        <span className={`text-5xl font-black font-mono tracking-tight transition-opacity duration-300 ${now.getSeconds() % 2 === 0 ? "opacity-100" : "opacity-30"} text-cyan-400`}>:</span>
        <span className="text-5xl font-black font-mono text-white tracking-tight">{m}</span>
        <span className={`text-5xl font-black font-mono tracking-tight transition-opacity duration-300 ${now.getSeconds() % 2 === 0 ? "opacity-100" : "opacity-30"} text-cyan-400`}>:</span>
        <span className="text-3xl font-black font-mono text-slate-400 tracking-tight pb-0.5">{s}</span>
      </div>
      <p className="text-[10px] text-slate-600 font-mono mt-1">{date}</p>
    </div>
  );
}

/* ── Candle countdown ── */
function CandleTimer({ tf }: { tf: Timeframe }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    function tick() {
      const msMap: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
      const ms = msMap[tf];
      const next = Math.ceil(Date.now() / ms) * ms;
      setRemaining(next - Date.now());
    }
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [tf]);

  const msMap: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
  const total = msMap[tf];
  const pct   = 1 - remaining / total;
  const urgent = remaining < 5000;

  return (
    <div className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border ${urgent ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/8 bg-white/4 text-slate-400"}`}>
      <Timer className={`w-3.5 h-3.5 ${urgent ? "text-red-400 animate-pulse" : "text-cyan-500"}`} />
      <span className="font-bold">{formatCountdown(remaining)}</span>
      <span className="text-slate-600 text-[9px]">next candle</span>
      <div className="w-16 h-1 bg-white/8 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${urgent ? "bg-red-400" : "bg-cyan-500"}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

/* ── Entry countdown ── */
function EntryCountdown({ entryTime }: { entryTime: Date }) {
  const [rem, setRem] = useState(entryTime.getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setRem(entryTime.getTime() - Date.now()), 500);
    return () => clearInterval(t);
  }, [entryTime]);
  const done = rem <= 0;
  return (
    <div className={`flex items-center gap-1.5 font-mono font-bold text-sm ${done ? "text-emerald-400 animate-pulse" : "text-amber-400"}`}>
      <Timer className="w-4 h-4" />
      {done ? "ENTER NOW →" : `Enter in ${formatCountdown(rem)}`}
    </div>
  );
}

/* ── S/R Zone bar ── */
function SRZoneBar({ support, resistance, price }: { support: number; resistance: number; price: number }) {
  const range = resistance - support || 1;
  const pct   = Math.max(0, Math.min(1, (price - support) / range));
  const decimals = price > 100 ? 2 : 5;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 uppercase tracking-widest">
        <span>Support</span>
        <span className="text-white font-bold text-xs">{price.toLocaleString(undefined, { maximumFractionDigits: decimals })}</span>
        <span>Resistance</span>
      </div>
      <div className="relative h-2 bg-white/5 rounded-full overflow-visible">
        {/* green zone */}
        <div className="absolute left-0 top-0 h-full w-[15%] bg-emerald-500/30 rounded-l-full" />
        {/* red zone */}
        <div className="absolute right-0 top-0 h-full w-[15%] bg-red-500/30 rounded-r-full" />
        {/* price dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-cyan-400 bg-background shadow-[0_0_8px_hsl(186_100%_50%/0.8)] transition-all duration-700"
          style={{ left: `${pct * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[9px] font-mono">
        <span className="text-emerald-400 font-bold">{support.toLocaleString(undefined, { maximumFractionDigits: decimals })}</span>
        <span className="text-red-400 font-bold">{resistance.toLocaleString(undefined, { maximumFractionDigits: decimals })}</span>
      </div>
    </div>
  );
}

/* ── Pair Dropdown ── */
function PairDropdown({ selectedPair, onSelect }: { selectedPair: TradingPair | null; onSelect: (p: TradingPair) => void }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat]   = useState<PairCategory>("currencies");
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
          open ? "border-cyan-500/60 bg-cyan-500/8 text-cyan-300" :
          selectedPair ? "border-white/15 bg-white/5 text-white hover:border-cyan-500/40" :
          "border-white/10 bg-white/4 text-slate-500 hover:border-white/20"
        }`}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-500" />
          {selectedPair ? (
            <span className="flex items-center gap-2">
              {selectedPair.name}
              {selectedPair.isOTC && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-300 border border-violet-500/30">OTC</span>}
            </span>
          ) : "Select a trading pair…"}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180 text-cyan-400" : "text-slate-500"}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 glass-panel-bright rounded-2xl border border-cyan-500/20 shadow-[0_8px_40px_hsl(186_100%_50%/0.12)] animate-slide-up overflow-hidden">
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
          <div className="max-h-60 overflow-y-auto scrollbar-thin py-1">
            {filtered.length === 0
              ? <p className="text-xs text-slate-600 text-center py-4 font-mono">No pairs found</p>
              : filtered.map(pair => (
                  <button key={pair.id} onClick={() => { onSelect(pair); setOpen(false); setSearch(""); }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-all ${selectedPair?.id === pair.id ? "bg-cyan-500/12 text-cyan-300" : "text-slate-300 hover:bg-white/5"}`}>
                    <div className="flex items-center gap-2">
                      {selectedPair?.id === pair.id && <ChevronRight className="w-3 h-3 text-cyan-400" />}
                      <span className="font-semibold">{pair.name}</span>
                      {pair.isOTC && <span className="text-[9px] font-bold text-violet-400">OTC</span>}
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

/* ── Sync Badge ── */
function SyncBadge({ market }: { market: ReturnType<typeof useLiveMarket> }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    setBlink(false);
    const t = setTimeout(() => setBlink(true), 200);
    return () => clearTimeout(t);
  }, [market?.syncCount]);
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
  const [selectedTf,   setSelectedTf]   = useState<Timeframe>("1m");
  const [currentSignal, setCurrentSignal] = useState<SignalResult | null>(null);
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [history, setHistory]           = useState<SignalHistoryEntry[]>([]);
  const [entryTime, setEntryTime]       = useState<Date | null>(null);
  const [expiryTime, setExpiryTime]     = useState<Date | null>(null);

  const activeTf    = TIMEFRAMES.find(t => t.id === selectedTf)!;
  const liveMarket  = useLiveMarket(selectedPair?.id ?? null);

  const handleGetSignal = useCallback(() => {
    if (!selectedPair || !liveMarket || isAnalyzing) return;
    setIsAnalyzing(true);
    setCurrentSignal(null);
    setEntryTime(null);
    setExpiryTime(null);
    const snapshot = { ...liveMarket, priceHistory: [...liveMarket.priceHistory] };
    setTimeout(() => {
      const result = generateSignal(selectedPair.id + "_" + selectedTf, snapshot);
      const msMap: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
      const entry  = new Date(getNextCandleMs(selectedTf));
      const expiry = new Date(entry.getTime() + msMap[selectedTf]);
      setCurrentSignal(result);
      setEntryTime(entry);
      setExpiryTime(expiry);
      setIsAnalyzing(false);
      setHistory(prev => [{
        id: `${Date.now()}-${Math.random()}`,
        pair: selectedPair, timeframe: selectedTf, result,
        timestamp: new Date(), entryTime: entry, expiryTime: expiry,
      }, ...prev].slice(0, 50));
    }, 1400);
  }, [selectedPair, selectedTf, liveMarket, isAnalyzing]);

  const isBuy  = currentSignal?.direction === "BUY";
  const isSell = currentSignal?.direction === "SELL";

  const gradeColor = (g: SignalResult["grade"]) =>
    g === "STRONG" ? "text-emerald-400" : g === "NEUTRAL" ? "text-amber-400" : "text-slate-400";
  const gradeLabel = (g: SignalResult["grade"]) =>
    g === "STRONG" ? "⚡ STRONG" : g === "NEUTRAL" ? "◈ MODERATE" : "○ WEAK";

  return (
    <div className="min-h-screen text-foreground">

      {/* ── Header ── */}
      <header className="glass-panel border-b sticky top-0 z-40 px-4 py-2.5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 via-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <span className="text-white font-black text-[10px]">KL</span>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border-2 border-background animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-black text-white">Karthik<span className="text-cyan-400"> Lee's</span></h1>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">AI Engine</span>
              </div>
              <p className="text-[9px] text-slate-600 font-mono">Quotex Signal Intelligence</p>
            </div>
          </div>
          <SyncBadge market={liveMarket} />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-4">

        {/* ── CLOCK PANEL ── */}
        <div className="glass-panel-bright rounded-2xl p-5 flex flex-col items-center gap-3">
          <LiveClock />
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <CandleTimer tf={selectedTf} />
            {liveMarket && selectedPair && (
              <div className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1.5 rounded-lg border ${
                liveMarket.trend === "bullish" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}>
                {liveMarket.trend === "bullish" ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {liveMarket.trend.toUpperCase()}
              </div>
            )}
            {liveMarket && (
              <div className="flex items-center gap-1 text-xs font-mono px-2.5 py-1.5 rounded-lg border border-white/8 bg-white/4 text-slate-400">
                <Activity className="w-3.5 h-3.5 text-cyan-500" />
                {liveMarket.volatility.toUpperCase()} VOL
              </div>
            )}
          </div>
        </div>

        {/* ── MAGIC V ALERT (if detected, always shown) ── */}
        {liveMarket?.magicV.detected && (
          <div className={`rounded-2xl border-2 px-4 py-3 flex items-center gap-3 animate-slide-up ${
            liveMarket.magicV.direction === "bull"
              ? "border-emerald-500/60 bg-emerald-500/8"
              : "border-red-500/60 bg-red-500/8"
          }`}>
            <div className={`text-3xl font-black select-none ${liveMarket.magicV.direction === "bull" ? "text-emerald-400" : "text-red-400"}`}>
              {liveMarket.magicV.direction === "bull" ? "V" : "∧"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-black ${liveMarket.magicV.direction === "bull" ? "text-emerald-400" : "text-red-400"}`}>
                  Magic {liveMarket.magicV.direction === "bull" ? "Bull-V" : "Bear-V"} Pattern
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  liveMarket.magicV.strength === "strong"
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                    : "border-white/15 bg-white/5 text-slate-400"
                }`}>{liveMarket.magicV.strength?.toUpperCase()}</span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Depth {liveMarket.magicV.depth.toFixed(3)}% ·
                {liveMarket.magicV.direction === "bull" ? " Sharp dip + recovery detected — BUY bias" : " Sharp spike + collapse detected — SELL bias"}
              </p>
            </div>
          </div>
        )}

        {/* ── S/R PANEL (shown when pair selected) ── */}
        {liveMarket && selectedPair && (
          <div className="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono mb-1">
              <span>Support / Resistance</span>
              <span className={`flex items-center gap-1 ${
                liveMarket.sr.bounceFromSupport    ? "text-emerald-400" :
                liveMarket.sr.bounceFromResistance ? "text-red-400" :
                liveMarket.sr.nearSupport          ? "text-emerald-600" :
                liveMarket.sr.nearResistance       ? "text-red-600" : "text-slate-600"
              }`}>
                {liveMarket.sr.bounceFromSupport && "↑ BOUNCE FROM SUPPORT"}
                {liveMarket.sr.bounceFromResistance && "↓ REJECTED AT RESISTANCE"}
                {!liveMarket.sr.bounceFromSupport && !liveMarket.sr.bounceFromResistance && liveMarket.sr.nearSupport && "⚡ NEAR SUPPORT"}
                {!liveMarket.sr.bounceFromSupport && !liveMarket.sr.bounceFromResistance && liveMarket.sr.nearResistance && "⚡ NEAR RESISTANCE"}
                {!liveMarket.sr.nearSupport && !liveMarket.sr.nearResistance && "MID RANGE"}
              </span>
            </div>
            <SRZoneBar support={liveMarket.sr.support} resistance={liveMarket.sr.resistance} price={liveMarket.price} />
            {/* Live price strip */}
            <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-white/5">
              <span className="text-slate-500">{selectedPair.name}</span>
              <span className="font-black text-white">{liveMarket.price.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
              <span className={`flex items-center gap-0.5 font-bold ${liveMarket.priceChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {liveMarket.priceChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {liveMarket.priceChange >= 0 ? "+" : ""}{liveMarket.priceChange.toFixed(4)}%
              </span>
            </div>
          </div>
        )}

        {/* ── CONTROL PANEL ── */}
        <div className="glass-panel-bright rounded-2xl p-4 flex flex-col gap-3">
          <PairDropdown selectedPair={selectedPair} onSelect={p => { setSelectedPair(p); setCurrentSignal(null); setEntryTime(null); setExpiryTime(null); }} />
          <div className="grid grid-cols-4 gap-2">
            {TIMEFRAMES.map(tf => (
              <button key={tf.id} onClick={() => { setSelectedTf(tf.id); setCurrentSignal(null); setEntryTime(null); setExpiryTime(null); }}
                className={`py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  selectedTf === tf.id
                    ? "border-cyan-500/70 bg-cyan-500/15 text-cyan-300 shadow-[0_0_14px_hsl(186_100%_50%/0.18)]"
                    : "border-white/10 bg-white/4 text-slate-400 hover:border-white/20"
                }`}>
                <span className="block font-mono">{tf.label}</span>
                <span className="block text-[9px] font-normal mt-0.5 opacity-60">{tf.long}</span>
              </button>
            ))}
          </div>

          {/* GET SIGNAL */}
          <button onClick={handleGetSignal} disabled={!selectedPair || !liveMarket || isAnalyzing}
            className={`w-full rounded-2xl py-4 font-black text-lg tracking-widest uppercase transition-all duration-200 border ${
              !selectedPair || !liveMarket ? "border-white/10 bg-white/5 text-slate-600 cursor-not-allowed" :
              isAnalyzing ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 cursor-wait" :
              "border-cyan-500/60 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 hover:border-cyan-400 hover:text-white hover:shadow-[0_0_30px_hsl(186_100%_50%/0.3)]"
            }`}>
            {isAnalyzing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                Analyzing…
              </span>
            ) : !liveMarket ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />Syncing…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Zap className="w-5 h-5" />Get Signal
              </span>
            )}
          </button>
        </div>

        {/* ── SIGNAL RESULT ── */}
        {currentSignal && entryTime && expiryTime && !isAnalyzing && (
          <div className={`animate-slide-up rounded-2xl border-2 overflow-hidden ${
            isBuy  ? "border-emerald-500/60 shadow-[0_0_40px_hsl(152_70%_50%/0.15)]" :
            isSell ? "border-red-500/60 shadow-[0_0_40px_hsl(0_70%_55%/0.15)]" :
                     "border-amber-500/40"
          }`}>

            {/* Grade bar at top */}
            <div className={`px-4 py-1.5 flex items-center justify-between text-[10px] font-bold font-mono ${
              isBuy ? "bg-emerald-500/10" : isSell ? "bg-red-500/10" : "bg-amber-500/10"
            }`}>
              <span className={gradeColor(currentSignal.grade)}>{gradeLabel(currentSignal.grade)}</span>
              <span className="text-slate-500">{currentSignal.confidence}% confidence</span>
            </div>

            <div className={`p-5 flex flex-col gap-4 ${isBuy ? "bg-emerald-500/5" : isSell ? "bg-red-500/5" : "bg-amber-500/5"}`}>

              {/* Direction — massive */}
              <div className="flex flex-col items-center py-3 gap-2">
                {isBuy && (
                  <div className="flex items-center gap-3">
                    <ChevronUp className="w-20 h-20 text-emerald-400" strokeWidth={3} />
                    <span className="text-7xl font-black text-emerald-400 tracking-widest">BUY</span>
                  </div>
                )}
                {isSell && (
                  <div className="flex items-center gap-3">
                    <ChevronDown className="w-20 h-20 text-red-400" strokeWidth={3} />
                    <span className="text-7xl font-black text-red-400 tracking-widest">SELL</span>
                  </div>
                )}
              </div>

              {/* Key reason */}
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold ${
                isBuy ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" :
                        "bg-red-500/10 border border-red-500/20 text-red-300"
              }`}>
                <span className="mt-0.5 shrink-0">›</span>
                <span>{currentSignal.keyReason}</span>
              </div>

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
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    {activeTf.long}
                  </div>
                </div>
              </div>

              {/* Pair + payout */}
              <div className="flex items-center justify-center gap-3 text-xs text-slate-400 flex-wrap">
                <span className="font-bold text-white">{selectedPair?.name}</span>
                {selectedPair?.isOTC && <span className="text-[9px] font-bold text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded border border-violet-500/30">OTC</span>}
                <span className="text-slate-600">·</span>
                <span className="font-mono text-cyan-400 font-bold">{selectedTf}</span>
                <span className="text-slate-600">·</span>
                <span className="font-mono">{selectedPair?.profitability}% payout</span>
              </div>

              {/* Magic V + S/R badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {currentSignal.magicVSignal && (
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${isBuy ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}>
                    {isBuy ? "V" : "∧"} Magic V Confirmed
                  </span>
                )}
                {currentSignal.srBounce && (
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${isBuy ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}>
                    {isBuy ? "↑ Support Bounce" : "↓ Resistance Reject"}
                  </span>
                )}
              </div>

              {/* Fakeout warning */}
              {currentSignal.fakeoutWarning && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Conflicting pattern — consider skipping or waiting for next signal
                </div>
              )}
            </div>
          </div>
        )}

        {/* No pair selected */}
        {!selectedPair && (
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center gap-3 text-slate-600">
            <BarChart2 className="w-10 h-10 opacity-20" />
            <p className="text-sm font-mono">Select a pair and timeframe to begin</p>
          </div>
        )}

        {/* ── SIGNAL HISTORY ── */}
        {history.length > 0 && (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Signal History</span>
              </div>
              <span className="text-[10px] text-slate-600 font-mono">{history.length} signals</span>
            </div>
            <div className="max-h-72 overflow-y-auto scrollbar-thin">
              {history.map(entry => (
                <div key={entry.id} className="history-row flex items-center justify-between px-4 py-3 border-b border-white/4 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-lg ${
                      entry.result.direction === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                    }`}>
                      {entry.result.direction === "BUY" ? "↑" : "↓"}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white">{entry.pair.name}</span>
                        {entry.pair.isOTC && <span className="text-[9px] text-violet-400">OTC</span>}
                        <span className="text-[9px] text-cyan-600 font-mono bg-cyan-500/10 px-1 rounded">{entry.timeframe}</span>
                        {entry.result.magicVSignal && (
                          <span className={`text-[9px] font-bold px-1 rounded ${entry.result.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                            {entry.result.direction === "BUY" ? "V" : "∧"}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        {entry.entryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} → {entry.expiryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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
        KARTHIK LEE'S AI ENGINE v3.0 · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}
