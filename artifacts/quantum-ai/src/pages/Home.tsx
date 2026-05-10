import { useState, useCallback, useRef, useEffect } from "react";
import { PAIRS, CATEGORY_LABELS, type PairCategory, type TradingPair } from "@/data/pairs";
import { generateSignal, type SignalResult, type StrategyScore } from "@/lib/signalEngine";
import { useLiveMarket } from "@/lib/liveMarket";
import {
  Zap, TrendingUp, Shield, Activity, ChevronUp, ChevronDown,
  Minus, Clock, AlertTriangle, BarChart2, Radio, Layers,
  ChevronRight, Search, X, Wifi, WifiOff, RefreshCw,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";

import { TIMEFRAMES, type Timeframe } from "@/data/timeframes";

interface SignalHistoryEntry {
  id: string;
  pair: TradingPair;
  timeframe: Timeframe;
  result: SignalResult;
  timestamp: Date;
}

const FEATURE_CHIPS = [
  { icon: TrendingUp, label: "Smart Trend Analyzer",         color: "text-cyan-400"    },
  { icon: Shield,     label: "Pattern Killer Detection",      color: "text-violet-400"  },
  { icon: Activity,   label: "High-Volatility Precision",     color: "text-emerald-400" },
  { icon: Layers,     label: "Premium Multi-Asset Intelligence", color: "text-amber-400" },
];

/* ── Live Ticker Strip ── */
function LiveTicker({ market, pair }: { market: ReturnType<typeof useLiveMarket>; pair: TradingPair | null }) {
  const [flash, setFlash] = useState(false);
  const prevPrice = useRef<number | null>(null);
  useEffect(() => {
    if (!market) return;
    if (prevPrice.current !== null && prevPrice.current !== market.price) {
      setFlash(true);
      setTimeout(() => setFlash(false), 400);
    }
    prevPrice.current = market.price;
  }, [market?.price]);

  if (!pair || !market) return null;
  const isUp = market.priceChange >= 0;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-xl border transition-colors duration-300 ${flash ? "border-cyan-400/50 bg-cyan-500/8" : "border-white/8 bg-white/3"}`}>
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isUp ? "bg-emerald-400" : "bg-red-400"}`} />
        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Live Price</span>
      </div>
      <span className="font-mono font-black text-white text-sm">{market.price.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
      <div className={`flex items-center gap-0.5 text-xs font-bold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
        {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
        {isUp ? "+" : ""}{market.priceChange.toFixed(4)}%
      </div>
      <div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-slate-500">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
          market.volatility === "high" ? "bg-red-500/15 text-red-400" :
          market.volatility === "medium" ? "bg-amber-500/15 text-amber-400" :
          "bg-slate-500/15 text-slate-500"
        }`}>
          {market.volatility.toUpperCase()} VOL
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
          market.momentum === "strong" ? "bg-cyan-500/15 text-cyan-400" :
          market.momentum === "normal" ? "bg-blue-500/15 text-blue-400" :
          "bg-slate-500/10 text-slate-600"
        }`}>
          {market.momentum.toUpperCase()} MOM
        </span>
        <span className="text-slate-600">
          {market.lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

/* ── Sync Status ── */
function SyncBadge({ market }: { market: ReturnType<typeof useLiveMarket> }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    setBlink(false);
    const t = setTimeout(() => setBlink(true), 200);
    return () => clearTimeout(t);
  }, [market?.syncCount]);

  if (!market) return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10">
      <WifiOff className="w-3 h-3 text-red-400" />
      <span className="text-red-400 font-semibold">No Data</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10">
      <Wifi className="w-3 h-3 text-emerald-400" />
      <span className={`text-emerald-400 font-semibold transition-opacity duration-200 ${blink ? "opacity-100" : "opacity-40"}`}>LIVE SYNC</span>
      <span className="text-emerald-600 text-[9px] font-mono">#{market.syncCount}</span>
    </div>
  );
}

/* ── Pair Dropdown ── */
function PairDropdown({ selectedPair, onSelect }: { selectedPair: TradingPair | null; onSelect: (pair: TradingPair) => void }) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<PairCategory>("currencies");
  const [search, setSearch] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = PAIRS.filter(p =>
    p.category === activeCategory &&
    (search === "" || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="relative w-full" ref={dropRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-200 text-sm font-semibold ${
          open ? "border-cyan-500/60 bg-cyan-500/8 text-cyan-300"
          : selectedPair ? "border-white/15 bg-white/5 text-white hover:border-cyan-500/40"
          : "border-white/10 bg-white/4 text-slate-500 hover:border-white/20"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-500" />
          {selectedPair ? (
            <span className="flex items-center gap-2">
              {selectedPair.name}
              {selectedPair.isOTC && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-300 border border-violet-500/30">OTC</span>}
            </span>
          ) : <span>Select a trading pair…</span>}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180 text-cyan-400" : "text-slate-500"}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 glass-panel-bright rounded-2xl border border-cyan-500/20 shadow-[0_8px_40px_hsl(186_100%_50%/0.12)] animate-slide-up overflow-hidden">
          <div className="flex border-b border-white/6 overflow-x-auto scrollbar-thin">
            {(Object.keys(CATEGORY_LABELS) as PairCategory[]).map(cat => (
              <button key={cat} onClick={() => { setActiveCategory(cat); setSearch(""); }}
                className={`category-tab px-4 py-2.5 text-xs font-bold whitespace-nowrap text-slate-400 ${activeCategory === cat ? "active" : ""}`}>
                {CATEGORY_LABELS[cat]}
                <span className="ml-1 text-[9px] text-slate-600">({PAIRS.filter(p => p.category === cat).length})</span>
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
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-all duration-150 ${
                      selectedPair?.id === pair.id ? "bg-cyan-500/12 text-cyan-300" : "text-slate-300 hover:bg-white/5"
                    }`}>
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

/* ── Direction Badge ── */
function DirectionBadge({ direction }: { direction: SignalResult["direction"] }) {
  if (direction === "BUY") return (
    <div className="flex items-center gap-2 animate-glow-buy rounded-2xl px-7 py-3.5 bg-emerald-500/10 border border-emerald-500/40">
      <ChevronUp className="w-9 h-9 text-emerald-400" strokeWidth={3} />
      <span className="text-4xl font-black text-emerald-400 tracking-widest">BUY</span>
    </div>
  );
  if (direction === "SELL") return (
    <div className="flex items-center gap-2 animate-glow-sell rounded-2xl px-7 py-3.5 bg-red-500/10 border border-red-500/40">
      <ChevronDown className="w-9 h-9 text-red-400" strokeWidth={3} />
      <span className="text-4xl font-black text-red-400 tracking-widest">SELL</span>
    </div>
  );
  return (
    <div className="flex items-center gap-2 animate-glow-neutral rounded-2xl px-7 py-3.5 bg-amber-500/10 border border-amber-500/40">
      <Minus className="w-9 h-9 text-amber-400" strokeWidth={3} />
      <span className="text-4xl font-black text-amber-400 tracking-widest">NEUTRAL</span>
    </div>
  );
}

function GradeBadge({ grade }: { grade: SignalResult["grade"] }) {
  const map: Record<string, { cls: string; label: string }> = {
    STRONG:  { cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "⚡ Strong" },
    NEUTRAL: { cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",         label: "◈ Neutral" },
    WEAK:    { cls: "bg-slate-500/20 text-slate-400 border-slate-500/30",      label: "○ Weak" },
  };
  const { cls, label } = map[grade] ?? map["WEAK"];
  return <span className={`text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>{label}</span>;
}

/* ── Strategy Table Row ── */
function StrategyRow({ s, direction }: { s: StrategyScore; direction: SignalResult["direction"] }) {
  const active = direction === "BUY" ? s.bullish : s.bearish;
  const opposite = direction === "BUY" ? s.bearish : s.bullish;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-emerald-400" : opposite ? "bg-red-400" : "bg-slate-600"}`} />
        <span className="text-xs text-slate-400 truncate">{s.name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-1 w-12 bg-white/5 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${active ? "bg-emerald-400" : opposite ? "bg-red-400" : "bg-slate-600"}`}
            style={{ width: `${(s.weight / 2) * 100}%` }} />
        </div>
        <span className={`text-[10px] font-mono font-bold w-8 text-right ${active ? "text-emerald-300" : opposite ? "text-red-300" : "text-slate-600"}`}>
          {active ? `+${s.weight}` : opposite ? `-${s.weight}` : "—"}
        </span>
      </div>
    </div>
  );
}

/* ── Indicator Row ── */
function IndicatorRow({ label, value, status }: { label: string; value: string; status: "bull" | "bear" | "neutral" }) {
  const dot = status === "bull" ? "bg-emerald-400" : status === "bear" ? "bg-red-400" : "bg-slate-600";
  const val = status === "bull" ? "text-emerald-300" : status === "bear" ? "text-red-300" : "text-slate-400";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className={`text-xs font-mono font-semibold ${val}`}>{value}</span>
      </div>
    </div>
  );
}

function HistoryDirectionIcon({ direction }: { direction: SignalResult["direction"] }) {
  if (direction === "BUY") return <ChevronUp className="w-4 h-4 text-emerald-400" strokeWidth={3} />;
  if (direction === "SELL") return <ChevronDown className="w-4 h-4 text-red-400" strokeWidth={3} />;
  return <Minus className="w-4 h-4 text-amber-400" strokeWidth={2} />;
}

function HistoryDirectionText({ direction }: { direction: SignalResult["direction"] }) {
  if (direction === "BUY") return <span className="font-bold text-emerald-400">BUY</span>;
  if (direction === "SELL") return <span className="font-bold text-red-400">SELL</span>;
  return <span className="font-bold text-amber-400">NEUTRAL</span>;
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
  const [activeTab, setActiveTab]       = useState<"strategies" | "indicators">("strategies");
  const historyRef                      = useRef<HTMLDivElement>(null);

  const activeTf    = TIMEFRAMES.find(t => t.id === selectedTf)!;
  const liveMarket  = useLiveMarket(selectedPair?.id ?? null);

  const handleGetSignal = useCallback(() => {
    if (!selectedPair || !liveMarket || isAnalyzing) return;
    setIsAnalyzing(true);
    setCurrentSignal(null);
    // Snapshot the live market at the moment of click
    const snapshot = { ...liveMarket };
    setTimeout(() => {
      const result = generateSignal(selectedPair.id + "_" + selectedTf, snapshot);
      setCurrentSignal(result);
      setIsAnalyzing(false);
      setHistory(prev => [{
        id: `${Date.now()}-${Math.random()}`,
        pair: selectedPair,
        timeframe: selectedTf,
        result,
        timestamp: new Date(),
      }, ...prev].slice(0, 100));
    }, 1600);
  }, [selectedPair, selectedTf, liveMarket, isAnalyzing]);

  const ind = currentSignal?.indicators;

  return (
    <div className="min-h-screen text-foreground">

      {/* ── Header ── */}
      <header className="glass-panel border-b sticky top-0 z-40 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <span className="text-white font-black text-sm">KL</span>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-background animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-white leading-none">
                  Karthik<span className="text-cyan-400"> Lee's</span>
                </h1>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase tracking-wider">AI Engine</span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">Quotex Multi-Timeframe Signal Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SyncBadge market={liveMarket} />
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/8">
              <Clock className="w-3.5 h-3.5 text-cyan-500" />
              <span className="font-semibold text-cyan-300">{activeTf.long}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── LEFT COLUMN ── */}
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Feature chips */}
          <div className="flex flex-wrap gap-2">
            {FEATURE_CHIPS.map(({ icon: Icon, label, color }) => (
              <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-panel text-xs font-medium">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-slate-300">{label}</span>
              </div>
            ))}
          </div>

          {/* Signal Panel */}
          <div className="glass-panel-bright rounded-2xl p-5 flex flex-col gap-4">

            {/* Pair dropdown */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2">Select Trading Pair</p>
              <PairDropdown selectedPair={selectedPair} onSelect={pair => { setSelectedPair(pair); setCurrentSignal(null); }} />
            </div>

            {/* Timeframe selector */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2">Select Timeframe</p>
              <div className="grid grid-cols-4 gap-2">
                {TIMEFRAMES.map(tf => (
                  <button key={tf.id}
                    onClick={() => { setSelectedTf(tf.id); setCurrentSignal(null); }}
                    className={`py-2.5 rounded-xl text-sm font-bold border transition-all duration-150 ${
                      selectedTf === tf.id
                        ? "border-cyan-500/70 bg-cyan-500/15 text-cyan-300 shadow-[0_0_14px_hsl(186_100%_50%/0.18)]"
                        : "border-white/10 bg-white/4 text-slate-400 hover:border-white/20 hover:text-slate-300"
                    }`}>
                    <span className="block font-mono">{tf.label}</span>
                    <span className="block text-[9px] font-normal mt-0.5 opacity-60">{tf.long}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Live ticker */}
            {selectedPair && <LiveTicker market={liveMarket} pair={selectedPair} />}

            {/* Pair info strip */}
            {selectedPair && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/4 border border-white/8 flex-wrap">
                <div>
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Pair</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-black text-white">{selectedPair.name}</span>
                    {selectedPair.isOTC && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">OTC</span>}
                  </div>
                </div>
                <div className="w-px h-8 bg-white/8" />
                <div>
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Timeframe</p>
                  <p className="text-sm font-bold text-cyan-300">{activeTf.long}</p>
                </div>
                <div className="w-px h-8 bg-white/8" />
                <div>
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Profitability</p>
                  <p className="text-sm font-bold text-cyan-400">{selectedPair.profitability}%</p>
                </div>
                {liveMarket && (
                  <>
                    <div className="w-px h-8 bg-white/8" />
                    <div>
                      <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Session</p>
                      <p className={`text-sm font-bold capitalize ${
                        liveMarket.sessionBias === "bullish" ? "text-emerald-400" :
                        liveMarket.sessionBias === "bearish" ? "text-red-400" : "text-slate-400"
                      }`}>{liveMarket.sessionBias}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* GET SIGNAL BUTTON */}
            <button
              onClick={handleGetSignal}
              disabled={!selectedPair || !liveMarket || isAnalyzing}
              className={`signal-btn w-full relative rounded-2xl py-4 font-black text-lg tracking-widest uppercase transition-all duration-200 border ${
                !selectedPair || !liveMarket
                  ? "border-white/10 bg-white/5 text-slate-600 cursor-not-allowed"
                  : isAnalyzing
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 cursor-wait"
                  : "border-cyan-500/60 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 hover:border-cyan-400 hover:text-white hover:shadow-[0_0_30px_hsl(186_100%_50%/0.3)] animate-pulse-ring"
              }`}
            >
              {isAnalyzing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                  Analyzing Live Market…
                </span>
              ) : !liveMarket ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Syncing Market Data…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Zap className="w-5 h-5" />
                  Get Signal
                </span>
              )}
            </button>

            {/* ── Signal result ── */}
            {currentSignal && !isAnalyzing && (
              <div className="animate-slide-up space-y-4">

                {/* Direction + Grade */}
                <div className="flex flex-col items-center gap-3">
                  <DirectionBadge direction={currentSignal.direction} />
                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    <GradeBadge grade={currentSignal.grade} />
                    <span className="text-xs text-slate-500 font-mono">
                      Score {currentSignal.direction === "BUY" ? currentSignal.buyScore : currentSignal.sellScore}/{currentSignal.maxScore}
                    </span>
                    <span className="text-xs text-slate-600">·</span>
                    <span className="text-xs font-semibold text-cyan-400 font-mono">{currentSignal.confidence}% confidence</span>
                  </div>
                </div>

                {/* Fakeout warning */}
                {currentSignal.fakeoutWarning && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Fakeout pattern detected — trend conviction maintained, trade with caution</span>
                  </div>
                )}

                {/* Score bars */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="glass-panel rounded-xl p-3">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-emerald-400 font-semibold">BUY Score</span>
                      <span className="text-emerald-300 font-mono font-bold">{currentSignal.buyScore}/{currentSignal.maxScore}</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700"
                        style={{ width: `${(currentSignal.buyScore / currentSignal.maxScore) * 100}%` }} />
                    </div>
                  </div>
                  <div className="glass-panel rounded-xl p-3">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-red-400 font-semibold">SELL Score</span>
                      <span className="text-red-300 font-mono font-bold">{currentSignal.sellScore}/{currentSignal.maxScore}</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-700"
                        style={{ width: `${(currentSignal.sellScore / currentSignal.maxScore) * 100}%` }} />
                    </div>
                  </div>
                </div>

                {/* Analysis tab switcher */}
                <div className="glass-panel rounded-xl overflow-hidden">
                  <div className="flex border-b border-white/5">
                    {(["strategies", "indicators"] as const).map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
                          activeTab === tab ? "text-cyan-300 bg-cyan-500/8 border-b-2 border-cyan-500" : "text-slate-500 hover:text-slate-300"
                        }`}>
                        {tab === "strategies" ? "11 Strategies" : "Indicators"}
                      </button>
                    ))}
                  </div>
                  <div className="p-3">
                    {activeTab === "strategies" ? (
                      <div>
                        {currentSignal.strategies.map((s, i) => (
                          <StrategyRow key={i} s={s} direction={currentSignal.direction} />
                        ))}
                      </div>
                    ) : (
                      <div>
                        <IndicatorRow label="EMA 200 Trend" value={ind!.trendEMA200 === "bullish" ? "▲ Bullish" : "▼ Bearish"} status={ind!.trendEMA200 === "bullish" ? "bull" : "bear"} />
                        <IndicatorRow label="EMA Crossover" value={ind!.emaCross === "golden" ? "Golden Cross ✓" : ind!.emaCross === "death" ? "Death Cross ✗" : "None"} status={ind!.emaCross === "golden" ? "bull" : ind!.emaCross === "death" ? "bear" : "neutral"} />
                        <IndicatorRow label="ADX" value={`${ind!.adxStrength}${ind!.adxStrength >= 25 ? " ✓" : " (weak)"}`} status={ind!.adxStrength >= 25 ? "bull" : "neutral"} />
                        <IndicatorRow label="RSI" value={`${ind!.rsi}`} status={ind!.rsi < 42 ? "bull" : ind!.rsi > 58 ? "bear" : "neutral"} />
                        <IndicatorRow label="Stoch %K / %D" value={`${ind!.stochK} / ${ind!.stochD}`} status={ind!.stochK < 25 ? "bull" : ind!.stochK > 75 ? "bear" : "neutral"} />
                        <IndicatorRow label="MACD Histogram" value={ind!.macdHist === "rising" ? "Rising ↑" : "Falling ↓"} status={ind!.macdHist === "rising" ? "bull" : "bear"} />
                        <IndicatorRow label="Bollinger Bands" value={ind!.bbPosition.replace(/_/g, " ")} status={ind!.bbPosition.includes("lower") ? "bull" : ind!.bbPosition.includes("upper") ? "bear" : "neutral"} />
                        <IndicatorRow label="Rate of Change" value={`${ind!.roc > 0 ? "+" : ""}${ind!.roc}`} status={ind!.roc > 0.5 ? "bull" : ind!.roc < -0.5 ? "bear" : "neutral"} />
                        <IndicatorRow label="Volume" value={ind!.volumeSpike ? "Spike ✓" : "Normal"} status={ind!.volumeSpike ? "bull" : "neutral"} />
                        <IndicatorRow label="Momentum" value={ind!.momentum.charAt(0).toUpperCase() + ind!.momentum.slice(1)} status={ind!.momentum === "strong" ? "bull" : ind!.momentum === "weak" ? "bear" : "neutral"} />
                        <IndicatorRow label="Volatility" value={ind!.volatility.charAt(0).toUpperCase() + ind!.volatility.slice(1)} status={ind!.volatility === "high" ? "bull" : "neutral"} />
                        <IndicatorRow label="Session Bias" value={ind!.sessionBias.charAt(0).toUpperCase() + ind!.sessionBias.slice(1)} status={ind!.sessionBias === "bullish" ? "bull" : ind!.sessionBias === "bearish" ? "bear" : "neutral"} />
                        <IndicatorRow label="Fake Breakout" value={ind!.fakeBreakout ? "Detected ⚠" : "None"} status={ind!.fakeBreakout ? "bear" : "neutral"} />
                        <IndicatorRow label="Fake Reversal" value={ind!.fakeReversal ? "Detected ⚠" : "None"} status={ind!.fakeReversal ? "bear" : "neutral"} />
                        <IndicatorRow label="Color Pattern" value={ind!.colorPattern === "bull" ? "Bull ▲" : ind!.colorPattern === "bear" ? "Bear ▼" : "None"} status={ind!.colorPattern === "bull" ? "bull" : ind!.colorPattern === "bear" ? "bear" : "neutral"} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Key notes */}
                {currentSignal.analysisNotes.slice(0, 4).length > 0 && (
                  <div className="glass-panel rounded-xl p-3 space-y-1.5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2">Engine Notes</p>
                    {currentSignal.analysisNotes.slice(0, 4).map((note, i) => (
                      <p key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                        <span className="text-cyan-500 mt-0.5 shrink-0">›</span>{note}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!selectedPair && (
              <p className="text-sm text-slate-600 font-mono text-center">← Select a pair above to begin</p>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN: History ── */}
        <div className="flex flex-col gap-4">

          {/* Market overview card */}
          {liveMarket && selectedPair && (
            <div className="glass-panel rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                <p className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Market Pulse</p>
              </div>
              <IndicatorRow label="Live Trend" value={liveMarket.trend === "bullish" ? "▲ Bullish" : "▼ Bearish"} status={liveMarket.trend === "bullish" ? "bull" : "bear"} />
              <IndicatorRow label="Momentum" value={liveMarket.momentum.charAt(0).toUpperCase() + liveMarket.momentum.slice(1)} status={liveMarket.momentum === "strong" ? "bull" : "neutral"} />
              <IndicatorRow label="Volatility" value={liveMarket.volatility.charAt(0).toUpperCase() + liveMarket.volatility.slice(1)} status={liveMarket.volatility === "high" ? "bear" : liveMarket.volatility === "medium" ? "neutral" : "bull"} />
              <IndicatorRow label="Volume" value={liveMarket.volumeSpike ? "Spike ✓" : "Normal"} status={liveMarket.volumeSpike ? "bull" : "neutral"} />
              <IndicatorRow label="EMA Cross" value={liveMarket.emaCross === "golden" ? "Golden ✓" : liveMarket.emaCross === "death" ? "Death ✗" : "None"} status={liveMarket.emaCross === "golden" ? "bull" : liveMarket.emaCross === "death" ? "bear" : "neutral"} />
              <IndicatorRow label="BB Position" value={liveMarket.bbPosition.replace(/_/g, " ")} status={liveMarket.bbPosition.includes("lower") ? "bull" : liveMarket.bbPosition.includes("upper") ? "bear" : "neutral"} />
              <IndicatorRow label="Session" value={liveMarket.sessionBias.charAt(0).toUpperCase() + liveMarket.sessionBias.slice(1)} status={liveMarket.sessionBias === "bullish" ? "bull" : liveMarket.sessionBias === "bearish" ? "bear" : "neutral"} />
              <div className="pt-1 text-[9px] text-slate-600 font-mono text-right">Sync #{liveMarket.syncCount} · {liveMarket.lastSync.toLocaleTimeString()}</div>
            </div>
          )}

          {/* Signal History */}
          <div className="glass-panel rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: 500 }}>
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Signal Log</span>
              </div>
              {history.length > 0 && <span className="text-[10px] text-slate-600 font-mono">{history.length} signals</span>}
            </div>
            <div ref={historyRef} className="overflow-y-auto scrollbar-thin flex-1">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-600">
                  <BarChart2 className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs font-mono">No signals yet</p>
                  <p className="text-[10px] mt-1 text-slate-700">Select a pair and click Get Signal</p>
                </div>
              ) : history.map(entry => (
                <div key={entry.id} className="history-row px-4 py-2.5 border-b border-white/4 last:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HistoryDirectionIcon direction={entry.result.direction} />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-white">{entry.pair.name}</span>
                          {entry.pair.isOTC && <span className="text-[9px] text-violet-400 font-bold">OTC</span>}
                          <span className="text-[9px] text-cyan-600 font-mono font-bold bg-cyan-500/10 px-1 rounded">{entry.timeframe}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <HistoryDirectionText direction={entry.result.direction} />
                          <span className="text-[10px] text-slate-600">·</span>
                          <GradeBadge grade={entry.result.grade} />
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 font-mono">
                        {entry.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </p>
                      <p className="text-[10px] text-slate-600 font-mono">{entry.result.confidence}% conf</p>
                    </div>
                  </div>
                  {entry.result.fakeoutWarning && (
                    <div className="flex items-center gap-1 mt-1">
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
                      <span className="text-[9px] text-amber-600">Fakeout detected</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4 text-[10px] text-slate-700 font-mono">
        KARTHIK LEE'S AI ENGINE v3.0 · FOR EDUCATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}
