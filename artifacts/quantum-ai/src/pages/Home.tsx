import { useState, useCallback, useRef, useEffect } from "react";
import { PAIRS, CATEGORY_LABELS, type PairCategory, type TradingPair } from "@/data/pairs";
import { generateSignal, type SignalResult } from "@/lib/signalEngine";
import {
  Zap, TrendingUp, Shield, Activity, ChevronUp, ChevronDown,
  Minus, Clock, AlertTriangle, BarChart2, Cpu, Radio, Layers, ChevronRight, Search, X
} from "lucide-react";

interface SignalHistoryEntry {
  id: string;
  pair: TradingPair;
  result: SignalResult;
  timestamp: Date;
}

const FEATURE_CHIPS = [
  { icon: TrendingUp, label: "Smart Trend Analyzer", color: "text-cyan-400" },
  { icon: Shield, label: "Pattern Killer Detection", color: "text-violet-400" },
  { icon: Activity, label: "High-Volatility Precision", color: "text-emerald-400" },
  { icon: Layers, label: "Premium Multi-Asset Intelligence", color: "text-amber-400" },
];

/* ── Pair Dropdown ── */
function PairDropdown({
  selectedPair,
  onSelect,
}: {
  selectedPair: TradingPair | null;
  onSelect: (pair: TradingPair) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<PairCategory>("currencies");
  const [search, setSearch] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = PAIRS.filter(
    (p) =>
      p.category === activeCategory &&
      (search === "" || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="relative w-full" ref={dropRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-200 text-sm font-semibold ${
          open
            ? "border-cyan-500/60 bg-cyan-500/8 text-cyan-300"
            : selectedPair
            ? "border-white/15 bg-white/5 text-white hover:border-cyan-500/40"
            : "border-white/10 bg-white/4 text-slate-500 hover:border-white/20"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-500" />
          {selectedPair ? (
            <span className="flex items-center gap-2">
              {selectedPair.name}
              {selectedPair.isOTC && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-300 border border-violet-500/30">
                  OTC
                </span>
              )}
            </span>
          ) : (
            <span>Select a trading pair…</span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180 text-cyan-400" : "text-slate-500"}`}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 glass-panel-bright rounded-2xl border border-cyan-500/20 shadow-[0_8px_40px_hsl(186_100%_50%/0.12)] animate-slide-up overflow-hidden">
          {/* Category tabs */}
          <div className="flex border-b border-white/6 overflow-x-auto scrollbar-thin">
            {(Object.keys(CATEGORY_LABELS) as PairCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setSearch(""); }}
                className={`category-tab px-4 py-2.5 text-xs font-bold whitespace-nowrap text-slate-400 ${activeCategory === cat ? "active" : ""}`}
              >
                {CATEGORY_LABELS[cat]}
                <span className="ml-1 text-[9px] text-slate-600">
                  ({PAIRS.filter((p) => p.category === cat).length})
                </span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-white/5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/8">
              <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pair…"
                className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none font-mono"
              />
              {search && (
                <button onClick={() => setSearch("")}>
                  <X className="w-3 h-3 text-slate-600 hover:text-slate-400" />
                </button>
              )}
            </div>
          </div>

          {/* Pair list */}
          <div className="max-h-60 overflow-y-auto scrollbar-thin py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-4 font-mono">No pairs found</p>
            ) : (
              filtered.map((pair) => (
                <button
                  key={pair.id}
                  onClick={() => { onSelect(pair); setOpen(false); setSearch(""); }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-all duration-150 ${
                    selectedPair?.id === pair.id
                      ? "bg-cyan-500/12 text-cyan-300"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {selectedPair?.id === pair.id && (
                      <ChevronRight className="w-3 h-3 text-cyan-400" />
                    )}
                    <span className="font-semibold">{pair.name}</span>
                    {pair.isOTC && (
                      <span className="text-[9px] font-bold text-violet-400">OTC</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{pair.profitability}%</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Direction Badge ── */
function DirectionBadge({ direction }: { direction: SignalResult["direction"] }) {
  if (direction === "BUY")
    return (
      <div className="flex items-center gap-2 animate-glow-buy rounded-2xl px-7 py-3.5 bg-emerald-500/10 border border-emerald-500/40">
        <ChevronUp className="w-9 h-9 text-emerald-400" strokeWidth={3} />
        <span className="text-4xl font-black text-emerald-400 tracking-widest">BUY</span>
      </div>
    );
  if (direction === "SELL")
    return (
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
  const colors: Record<string, string> = {
    A: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    B: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
    C: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    NEUTRAL: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${colors[grade]}`}>
      {grade === "NEUTRAL" ? "—" : `Grade ${grade}`}
    </span>
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

function IndicatorRow({
  label, value, status,
}: {
  label: string; value: string; status: "bull" | "bear" | "neutral";
}) {
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

/* ── Main Page ── */
export default function Home() {
  const [selectedPair, setSelectedPair] = useState<TradingPair | null>(null);
  const [currentSignal, setCurrentSignal] = useState<SignalResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [history, setHistory] = useState<SignalHistoryEntry[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);

  const handleGetSignal = useCallback(() => {
    if (!selectedPair || isAnalyzing) return;
    setIsAnalyzing(true);
    setCurrentSignal(null);
    setTimeout(() => {
      const result = generateSignal(selectedPair.id);
      setCurrentSignal(result);
      setIsAnalyzing(false);
      const entry: SignalHistoryEntry = {
        id: `${Date.now()}-${Math.random()}`,
        pair: selectedPair,
        result,
        timestamp: new Date(),
      };
      setHistory((prev) => [entry, ...prev].slice(0, 100));
    }, 1400);
  }, [selectedPair, isAnalyzing]);

  const ind = currentSignal?.indicators;

  return (
    <div className="min-h-screen text-foreground">
      {/* Header */}
      <header className="glass-panel border-b sticky top-0 z-40 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center shadow-lg">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-background animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-white leading-none">
                  Quantum<span className="text-cyan-400">AI</span> Engine
                </h1>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase tracking-wider">
                  Pro
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">Quotex 1-Min Signal Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-semibold">LIVE</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span>1-Min</span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT */}
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

          {/* Signal panel */}
          <div className="glass-panel-bright rounded-2xl p-5 flex flex-col gap-5">

            {/* Pair dropdown */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2">Select Trading Pair</p>
              <PairDropdown
                selectedPair={selectedPair}
                onSelect={(pair) => {
                  setSelectedPair(pair);
                  setCurrentSignal(null);
                }}
              />
            </div>

            {/* Selected pair info strip */}
            {selectedPair && (
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/4 border border-white/8">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Pair</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-black text-white">{selectedPair.name}</span>
                      {selectedPair.isOTC && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">OTC</span>
                      )}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-white/8" />
                  <div>
                    <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Timeframe</p>
                    <p className="text-sm font-bold text-white">1 Min</p>
                  </div>
                  <div className="w-px h-8 bg-white/8" />
                  <div>
                    <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Profitability</p>
                    <p className="text-sm font-bold text-cyan-400">{selectedPair.profitability}%</p>
                  </div>
                </div>
              </div>
            )}

            {/* GET SIGNAL BUTTON */}
            <button
              onClick={handleGetSignal}
              disabled={!selectedPair || isAnalyzing}
              className={`signal-btn w-full relative rounded-2xl py-4 font-black text-lg tracking-widest uppercase transition-all duration-200 border ${
                !selectedPair
                  ? "border-white/10 bg-white/5 text-slate-600 cursor-not-allowed"
                  : isAnalyzing
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 cursor-wait"
                  : "border-cyan-500/60 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 hover:border-cyan-400 hover:text-white hover:shadow-[0_0_30px_hsl(186_100%_50%/0.3)] animate-pulse-ring"
              }`}
            >
              {isAnalyzing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                  Analyzing Market…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Zap className="w-5 h-5" />
                  Get Signal
                </span>
              )}
            </button>

            {/* Signal result */}
            {currentSignal && !isAnalyzing && (
              <div className="animate-slide-up space-y-4">
                {/* Direction */}
                <div className="flex flex-col items-center gap-3">
                  <DirectionBadge direction={currentSignal.direction} />
                  <div className="flex items-center gap-3">
                    <GradeBadge grade={currentSignal.grade} />
                    <span className="text-xs text-slate-500 font-mono">
                      Score {Math.max(currentSignal.buyScore, currentSignal.sellScore)}/6
                    </span>
                    <span className="text-xs text-slate-500 font-mono">·</span>
                    <span className="text-xs font-semibold text-cyan-400 font-mono">
                      {currentSignal.confidence}% confidence
                    </span>
                  </div>
                </div>

                {/* Fakeout warning */}
                {currentSignal.fakeoutWarning && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Fakeout detected — trend conviction maintained, trade with caution</span>
                  </div>
                )}

                {/* Score bars */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="glass-panel rounded-xl p-3">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-emerald-400 font-semibold">BUY Score</span>
                      <span className="text-emerald-300 font-mono font-bold">{currentSignal.buyScore}/6</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700"
                        style={{ width: `${(currentSignal.buyScore / 6) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="glass-panel rounded-xl p-3">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-red-400 font-semibold">SELL Score</span>
                      <span className="text-red-300 font-mono font-bold">{currentSignal.sellScore}/6</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-700"
                        style={{ width: `${(currentSignal.sellScore / 6) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Analysis notes */}
                {currentSignal.analysisNotes.length > 0 && (
                  <div className="glass-panel rounded-xl p-3 space-y-1.5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2">Engine Analysis</p>
                    {currentSignal.analysisNotes.map((note, i) => (
                      <p key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                        <span className="text-cyan-500 mt-0.5">›</span>
                        {note}
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

        {/* RIGHT: Indicators + History */}
        <div className="flex flex-col gap-4">
          {/* Indicator Dashboard */}
          {currentSignal && ind && (
            <div className="glass-panel rounded-2xl p-4 animate-slide-up">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-4 h-4 text-cyan-400" />
                <p className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Indicator State</p>
              </div>
              <IndicatorRow
                label="Trend EMA"
                value={ind.trendEMA === "bullish" ? "▲ Bullish" : "▼ Bearish"}
                status={ind.trendEMA === "bullish" ? "bull" : "bear"}
              />
              <IndicatorRow
                label="ADX Strength"
                value={`${ind.adxStrength}${ind.adxStrength >= 20 ? " ✓" : " (weak)"}`}
                status={ind.adxStrength >= 20 ? "bull" : "neutral"}
              />
              <IndicatorRow
                label="RSI"
                value={`${ind.rsi}`}
                status={ind.rsi < 40 ? "bull" : ind.rsi > 60 ? "bear" : "neutral"}
              />
              <IndicatorRow
                label="Stoch %K"
                value={`${ind.stochK}`}
                status={ind.stochK < 30 ? "bull" : ind.stochK > 70 ? "bear" : "neutral"}
              />
              <IndicatorRow
                label="MACD Hist"
                value={ind.macdHist === "rising" ? "Rising ↑" : "Falling ↓"}
                status={ind.macdHist === "rising" ? "bull" : "bear"}
              />
              <IndicatorRow
                label="Volume"
                value={ind.volumeHigh ? "High ✓" : "Normal"}
                status={ind.volumeHigh ? "bull" : "neutral"}
              />
              <IndicatorRow
                label="Support Zone"
                value={ind.nearSupport ? "Near ✓" : "Far"}
                status={ind.nearSupport ? "bull" : "neutral"}
              />
              <IndicatorRow
                label="Resistance Zone"
                value={ind.nearResistance ? "Near ✓" : "Far"}
                status={ind.nearResistance ? "bear" : "neutral"}
              />
              <IndicatorRow
                label="Fake Breakout"
                value={ind.fakeBreakout ? "Detected ⚠" : "None"}
                status={ind.fakeBreakout ? "bear" : "neutral"}
              />
              <IndicatorRow
                label="Fake Reversal"
                value={ind.fakeReversal ? "Detected ⚠" : "None"}
                status={ind.fakeReversal ? "bear" : "neutral"}
              />
              <IndicatorRow
                label="Color Pattern"
                value={ind.colorPattern === "bull" ? "Bull ▲" : ind.colorPattern === "bear" ? "Bear ▼" : "None"}
                status={ind.colorPattern === "bull" ? "bull" : ind.colorPattern === "bear" ? "bear" : "neutral"}
              />
              <IndicatorRow
                label="Candle"
                value={ind.bullCandle ? "Bullish" : ind.bearCandle ? "Bearish" : "Doji"}
                status={ind.bullCandle ? "bull" : ind.bearCandle ? "bear" : "neutral"}
              />
            </div>
          )}

          {/* Signal History */}
          <div className="glass-panel rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: 480 }}>
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Signal Log</span>
              </div>
              {history.length > 0 && (
                <span className="text-[10px] text-slate-600 font-mono">{history.length} signals</span>
              )}
            </div>
            <div ref={historyRef} className="overflow-y-auto scrollbar-thin flex-1">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-600">
                  <Clock className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs font-mono">No signals yet</p>
                  <p className="text-[10px] mt-1 text-slate-700">Select a pair and click Get Signal</p>
                </div>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className="history-row px-4 py-2.5 border-b border-white/4 last:border-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HistoryDirectionIcon direction={entry.result.direction} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white">{entry.pair.name}</span>
                            {entry.pair.isOTC && (
                              <span className="text-[9px] text-violet-400 font-bold">OTC</span>
                            )}
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
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4 text-[10px] text-slate-700 font-mono">
        QUANTUM AI ENGINE v2.0 · FOR EDUCATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}
