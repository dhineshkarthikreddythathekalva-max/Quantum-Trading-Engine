import { useState, useCallback, useEffect, useRef } from "react";
import { PAIRS, CATEGORY_LABELS, type PairCategory, type TradingPair } from "@/data/pairs";
import { generateSignal, type SignalResult } from "@/lib/signalEngine";
import { useLiveMarket } from "@/lib/liveMarket";
import { TIMEFRAMES, type Timeframe } from "@/data/timeframes";
import {
  Zap, TrendingUp, ChevronUp, ChevronDown, Clock,
  AlertTriangle, BarChart2, ChevronRight, Search, X,
  Wifi, WifiOff, RefreshCw, ArrowUpRight, ArrowDownRight,
  Timer,
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

/* ── Candle boundary helpers ── */
function getNextCandleMs(tf: Timeframe): number {
  const now = Date.now();
  const map: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
  const interval = map[tf];
  return Math.ceil(now / interval) * interval;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/* ── Entry Countdown ── */
function EntryCountdown({ entryTime }: { entryTime: Date }) {
  const [remaining, setRemaining] = useState(entryTime.getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setRemaining(entryTime.getTime() - Date.now()), 500);
    return () => clearInterval(t);
  }, [entryTime]);
  const done = remaining <= 0;
  return (
    <div className={`flex items-center gap-2 text-sm font-mono font-bold ${done ? "text-emerald-400" : "text-amber-400"}`}>
      <Timer className="w-4 h-4" />
      {done ? <span className="text-emerald-400 animate-pulse">ENTER NOW ↗</span> : <span>Enter in {formatCountdown(remaining)}</span>}
    </div>
  );
}

/* ── Pair Dropdown ── */
function PairDropdown({ selectedPair, onSelect }: { selectedPair: TradingPair | null; onSelect: (p: TradingPair) => void }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<PairCategory>("currencies");
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
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-all ${
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
      <WifiOff className="w-3 h-3 text-red-400" />
      <span className="text-red-400 font-semibold">No Data</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10">
      <Wifi className="w-3 h-3 text-emerald-400" />
      <span className={`text-emerald-400 font-semibold transition-opacity duration-200 ${blink ? "opacity-100" : "opacity-40"}`}>LIVE</span>
      <span className="text-emerald-600 text-[9px] font-mono">3s sync</span>
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

  const handleGetSignal = useCallback(() => {
    if (!selectedPair || !liveMarket || isAnalyzing) return;
    setIsAnalyzing(true);
    setCurrentSignal(null);
    setEntryTime(null);
    setExpiryTime(null);
    const snapshot = { ...liveMarket };
    setTimeout(() => {
      const result = generateSignal(selectedPair.id + "_" + selectedTf, snapshot);

      // Entry = next candle open, expiry = one candle after that
      const map: Record<Timeframe, number> = { "30s": 30000, "1m": 60000, "5m": 300000, "30m": 1800000 };
      const candleMs = map[selectedTf];
      const entry = new Date(getNextCandleMs(selectedTf));
      const expiry = new Date(entry.getTime() + candleMs);

      setCurrentSignal(result);
      setEntryTime(entry);
      setExpiryTime(expiry);
      setIsAnalyzing(false);

      setHistory(prev => [{
        id: `${Date.now()}-${Math.random()}`,
        pair: selectedPair,
        timeframe: selectedTf,
        result,
        timestamp: new Date(),
        entryTime: entry,
        expiryTime: expiry,
      }, ...prev].slice(0, 50));
    }, 1400);
  }, [selectedPair, selectedTf, liveMarket, isAnalyzing]);

  const isBuy  = currentSignal?.direction === "BUY";
  const isSell = currentSignal?.direction === "SELL";

  return (
    <div className="min-h-screen text-foreground">

      {/* ── Header ── */}
      <header className="glass-panel border-b sticky top-0 z-40 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 via-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <span className="text-white font-black text-xs">KL</span>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border-2 border-background animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-black tracking-tight text-white leading-none">
                  Karthik<span className="text-cyan-400"> Lee's</span>
                </h1>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase">AI Engine</span>
              </div>
              <p className="text-[9px] text-slate-600 font-mono mt-0.5">Quotex Signal Intelligence</p>
            </div>
          </div>
          <SyncBadge market={liveMarket} />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col gap-4">

        {/* Pair + Timeframe */}
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

          {/* Live price strip (minimal) */}
          {liveMarket && selectedPair && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/4 border border-white/8 text-xs font-mono">
              <span className="text-slate-500">{selectedPair.name}</span>
              <span className="font-black text-white">{liveMarket.price.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
              <span className={`flex items-center gap-0.5 font-bold ${liveMarket.priceChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {liveMarket.priceChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {liveMarket.priceChange >= 0 ? "+" : ""}{liveMarket.priceChange.toFixed(4)}%
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                liveMarket.volatility === "high" ? "bg-red-500/15 text-red-400" :
                liveMarket.volatility === "medium" ? "bg-amber-500/15 text-amber-400" :
                "bg-slate-500/15 text-slate-500"
              }`}>{liveMarket.volatility.toUpperCase()} VOL</span>
            </div>
          )}

          {/* GET SIGNAL button */}
          <button
            onClick={handleGetSignal}
            disabled={!selectedPair || !liveMarket || isAnalyzing}
            className={`w-full rounded-2xl py-4 font-black text-lg tracking-widest uppercase transition-all duration-200 border ${
              !selectedPair || !liveMarket
                ? "border-white/10 bg-white/5 text-slate-600 cursor-not-allowed"
                : isAnalyzing
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 cursor-wait"
                : "border-cyan-500/60 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 hover:border-cyan-400 hover:text-white hover:shadow-[0_0_30px_hsl(186_100%_50%/0.3)]"
            }`}>
            {isAnalyzing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                Analyzing…
              </span>
            ) : !liveMarket ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Syncing…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Zap className="w-5 h-5" />
                Get Signal
              </span>
            )}
          </button>
        </div>

        {/* ── SIGNAL RESULT ── */}
        {currentSignal && entryTime && expiryTime && !isAnalyzing && (
          <div className={`animate-slide-up rounded-2xl border-2 p-5 flex flex-col gap-4 ${
            isBuy  ? "border-emerald-500/50 bg-emerald-500/5 shadow-[0_0_40px_hsl(152_70%_50%/0.12)]" :
            isSell ? "border-red-500/50 bg-red-500/5 shadow-[0_0_40px_hsl(0_70%_55%/0.12)]" :
                     "border-amber-500/50 bg-amber-500/5"
          }`}>

            {/* Direction — BIG */}
            <div className="flex flex-col items-center gap-2 py-2">
              {isBuy && (
                <div className="flex items-center gap-3">
                  <ChevronUp className="w-16 h-16 text-emerald-400" strokeWidth={3} />
                  <span className="text-6xl font-black text-emerald-400 tracking-widest">BUY</span>
                </div>
              )}
              {isSell && (
                <div className="flex items-center gap-3">
                  <ChevronDown className="w-16 h-16 text-red-400" strokeWidth={3} />
                  <span className="text-6xl font-black text-red-400 tracking-widest">SELL</span>
                </div>
              )}
              {!isBuy && !isSell && (
                <span className="text-4xl font-black text-amber-400">WAIT</span>
              )}
            </div>

            {/* Entry + Expiry — the key info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Entry At</span>
                <span className="text-sm font-black text-white font-mono">
                  {entryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <EntryCountdown entryTime={entryTime} />
              </div>
              <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Expiry</span>
                <span className="text-sm font-black text-white font-mono">
                  {expiryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  {activeTf.long} candle
                </div>
              </div>
            </div>

            {/* Pair + Timeframe confirm */}
            <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
              <span className="font-bold text-white">{selectedPair?.name}</span>
              {selectedPair?.isOTC && <span className="text-[9px] font-bold text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded border border-violet-500/30">OTC</span>}
              <span className="text-slate-600">·</span>
              <span className="font-mono text-cyan-400 font-bold">{selectedTf}</span>
              <span className="text-slate-600">·</span>
              <TrendingUp className="w-3.5 h-3.5 text-cyan-500" />
              <span className="font-mono">{selectedPair?.profitability}% payout</span>
            </div>

            {/* Fakeout warning */}
            {currentSignal.fakeoutWarning && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Conflicting pattern detected — consider skipping this signal
              </div>
            )}
          </div>
        )}

        {/* Placeholder when no pair selected */}
        {!selectedPair && (
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center gap-3 text-slate-600">
            <BarChart2 className="w-10 h-10 opacity-20" />
            <p className="text-sm font-mono">Select a pair and timeframe to begin</p>
          </div>
        )}

        {/* ── Signal History ── */}
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
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm ${
                      entry.result.direction === "BUY"  ? "bg-emerald-500/15 text-emerald-400" :
                      entry.result.direction === "SELL" ? "bg-red-500/15 text-red-400"         :
                                                          "bg-amber-500/15 text-amber-400"
                    }`}>
                      {entry.result.direction === "BUY" ? "↑" : entry.result.direction === "SELL" ? "↓" : "—"}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">{entry.pair.name}</span>
                        {entry.pair.isOTC && <span className="text-[9px] text-violet-400">OTC</span>}
                        <span className="text-[9px] text-cyan-600 font-mono bg-cyan-500/10 px-1 rounded">{entry.timeframe}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Entry {entry.entryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} → Exp {entry.expiryTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-black ${
                      entry.result.direction === "BUY" ? "text-emerald-400" :
                      entry.result.direction === "SELL" ? "text-red-400" : "text-amber-400"
                    }`}>{entry.result.direction}</div>
                    <div className="text-[9px] text-slate-600 font-mono">{entry.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="text-center py-4 text-[10px] text-slate-700 font-mono">
        KARTHIK LEE'S AI ENGINE v3.0 · FOR EDUCATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}
