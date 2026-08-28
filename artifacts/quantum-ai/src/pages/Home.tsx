import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";
import { PAIRS, CATEGORY_LABELS, type PairCategory, type TradingPair } from "@/data/pairs";
import { generateSignal, type SignalResult } from "@/lib/signalEngine";
import { useLiveMarket, type LiveMarketState, type Candle } from "@/lib/liveMarket";
import { fetchQuotexAssets } from "@/lib/quotexAssets";
import { TIMEFRAMES, type Timeframe } from "@/data/timeframes";
import { runSignalPipeline, type PipelineSignalResult } from "@/lib/signalPipeline";
import type { APlusComponentScores, RegimeType } from "@/lib/aPlusEngine";
import { notifyASignal, showToastNotification, requestNotificationPermission } from "@/lib/notifications";
import { API_BASE } from "@/lib/apiConfig";
import {
  Zap, ChevronDown, BarChart2,
  ChevronRight, Search, X, Wifi, WifiOff, RefreshCw,
  ArrowUpRight, ArrowDownRight, Timer,
  Trophy, XCircle,
  LineChart, History, Shield, CheckCircle2, Clock,
  Sparkles, Brain, Target, TrendingUp, TrendingDown, Minus, Activity,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type SignalOutcome = "win" | "loss" | "tie" | null; // tie = broker refund, not a loss
type Tab = "signals" | "guide";


interface SignalHistoryEntry {
  id: string;
  pair: TradingPair;
  timeframe: Timeframe;
  result: SignalResult;
  pipelineResult: PipelineSignalResult | null;
  timestamp: Date;
  entryTime: Date;
  expiryTime: Date;
  outcome: SignalOutcome;
  mtgLevel: number; // 0 = original, 1 = MTG1 recovery
}

// ─────────────────────────────────────────────────────────────
// Pair helpers (live vs OTC segregated)
// ─────────────────────────────────────────────────────────────

// Pairs available on Quotex come from the API (bridge → api-server). Falls
// back to the local list when the chain is unreachable.
function useAvailablePairs(): {
  pairs: TradingPair[];
  live: TradingPair[];
  otc: TradingPair[];
  source: "quotex" | "local";
} {
  const [apiPairs, setApiPairs] = useState<TradingPair[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchQuotexAssets().then(list => {
      if (!cancelled && list && list.length > 0) setApiPairs(list);
    });
    return () => { cancelled = true; };
  }, []);
  const pairs = apiPairs && apiPairs.length > 0 ? apiPairs : PAIRS;
  const live = useMemo(() => pairs.filter(p => !p.isOTC), [pairs]);
  const otc  = useMemo(() => pairs.filter(p => p.isOTC), [pairs]);
  return { pairs, live, otc, source: apiPairs && apiPairs.length > 0 ? "quotex" : "local" };
}



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


function msCountdown(ms: number) {
  if (ms <= 0) return "00:00";
  const s = Math.ceil(ms / 1000);
  return `${fmt2(Math.floor(s / 60))}:${fmt2(s % 60)}`;
}

function decFor(price: number) { return price > 1000 ? 0 : price > 100 ? 2 : 5; }


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

// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Pair Dropdown (live / OTC segregated)
// ─────────────────────────────────────────────────────────────
function PairDropdown({ pairs, selectedPair, onSelect }: {
  pairs: TradingPair[];
  selectedPair: TradingPair | null;
  onSelect: (p: TradingPair) => void;
}) {
  const [open, setOpen]     = useState(false);
  const [cat, setCat]       = useState<PairCategory>("currencies");
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const cats = useMemo(() => {
    const set = new Set<PairCategory>();
    pairs.forEach(p => set.add(p.category));
    return (Object.keys(CATEGORY_LABELS) as PairCategory[]).filter(c => set.has(c));
  }, [pairs]);
  const effCat  = cats.includes(cat) ? cat : cats[0];
  // When searching, search ALL categories; otherwise filter by selected category
  const filtered = search
    ? pairs.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search.toLowerCase()))
    : pairs.filter(p => p.category === effCat);

  return (
    <div className="relative w-full" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-green-500/20 bg-green-500/5 text-sm font-semibold text-white hover:border-green-500/40 transition-all">
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[9px] text-green-500 uppercase tracking-widest font-mono font-bold">ASSETS</span>
          <span className="text-sm font-bold text-white">
            {selectedPair ? "1 selected" : "Select trading assets"}
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
            {cats.map(c => (
              <button key={c} onClick={() => { setCat(c); setSearch(""); }}
                className={`category-tab px-4 py-2.5 text-xs font-bold whitespace-nowrap ${effCat === c ? "active" : "text-slate-400"}`}>
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
function SyncBadge({ market, label = "5s" }: { market: LiveMarketState | null; label?: string }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { setBlink(false); const t = setTimeout(() => setBlink(true), 200); return () => clearTimeout(t); }, [market?.syncCount]);
  if (!market) return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10">
      <WifiOff className="w-3 h-3 text-red-400" /><span className="text-red-400 font-semibold">No Data</span>
    </div>
  );
  const live = market.source === "quotex";
  if (!live) {
    // API / bridge unreachable — running in AI simulation mode.
    return (
      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-amber-500/25 bg-amber-500/10">
        <WifiOff className="w-3 h-3 text-amber-400" />
        <span className="text-amber-400 font-semibold">AI Mode</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-green-500/20 bg-green-500/10">
      <Wifi className="w-3 h-3 text-green-400" />
      <span className={`text-green-400 font-semibold transition-opacity ${blink ? "opacity-100" : "opacity-30"}`}>LIVE</span>
      <span className="text-green-600 text-[9px] font-mono">{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Win/Loss Bar
// ─────────────────────────────────────────────────────────────
function WinRateBar({ history }: { history: SignalHistoryEntry[] }) {
  // Ties are broker refunds — excluded from the win-rate denominator.
  const decided = history.filter(h => h.outcome === "win" || h.outcome === "loss");
  const ties    = history.filter(h => h.outcome === "tie").length;
  const wins    = decided.filter(h => h.outcome === "win").length;
  const losses  = decided.length - wins;
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
      {ties > 0 && (
        <div className="flex items-center gap-1 text-slate-400">
          <Minus className="w-3 h-3" />
          <span className="font-bold">{ties}T</span>
        </div>
      )}
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
// Duration picker sheet
// ─────────────────────────────────────────────────────────────
function DurationPicker({ selected, onSelect, onClose }: {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
  onClose: () => void;
}) {
  const TF_LIST = TIMEFRAMES.filter(t => t.id !== "30m");
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

// Signal card (engine result)
// ─────────────────────────────────────────────────────────────
function SignalCard({ signal, pipelineResult, isBuy, entryTime, expiryTime, pair, tf }: {
  signal: SignalResult;
  pipelineResult: PipelineSignalResult | null;
  isBuy: boolean;
  entryTime: Date | null;
  expiryTime: Date | null;
  pair: TradingPair | null;
  tf: Timeframe;
}) {
  const aplusScore = pipelineResult?.aplusScore ?? 0;
  const regime = pipelineResult?.regime ?? "NORMAL";
  const xgboostCall = pipelineResult?.xgboostCallProb ?? 0.5;
  const xgboostPut = pipelineResult?.xgboostPutProb ?? 0.5;
  const components = pipelineResult?.componentScores;
  const isAPlus = pipelineResult?.aplus?.decision === "A_PLUS_SIGNAL";
  const regimeEmoji = regime === "TRENDING" ? "📈" : regime === "RANGING" ? "↔️" : regime === "VOLATILE_CHOPPY" ? "🌊" : "📊";

  return (
    <div className={`animate-slide-up rounded-2xl border-2 overflow-hidden ${isBuy ? "border-green-500/60 glow-buy" : "border-red-500/60 glow-sell"}`}>
      <div className={`px-4 py-2 flex items-center justify-between text-[10px] font-bold font-mono ${isBuy ? "bg-green-500/15" : "bg-red-500/15"}`}>
        <span className={isBuy ? "text-green-400" : "text-red-400"}>
          {isAPlus ? "🚀 A+ SIGNAL" : isBuy ? "⬆ BUY SIGNAL" : "⬇ SELL SIGNAL"} — {pipelineResult?.mlAvailable ? "ML Enhanced" : "Confluence Engine"}
        </span>
        <span className="text-slate-500">
          {signal.grade === "STRONG" ? "⚡ STRONG" : signal.grade === "MODERATE" ? "◈ MODERATE" : "○ WEAK"}
        </span>
      </div>

      <div className={`flex flex-col items-center py-5 gap-2 ${isBuy ? "bg-green-500/5" : "bg-red-500/5"}`}>
        <div className={`text-6xl font-black flex items-center gap-3 ${isBuy ? "text-green-400" : "text-red-400"}`}>
          {isBuy ? <ArrowUpRight className="w-14 h-14" /> : <ArrowDownRight className="w-14 h-14" />}
          <span className="text-5xl">{signal.direction}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-slate-500 font-mono">Confidence</span>
          <div className="w-24 h-1.5 bg-white/8 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${isBuy ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${signal.confidence}%` }} />
          </div>
          <span className={`text-sm font-black ${isBuy ? "text-green-400" : "text-red-400"}`}>{signal.confidence}%</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[9px] font-mono">
          <span className={`px-1.5 py-0.5 rounded border ${signal.confirmations >= 4 ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>
            {signal.confirmations} confirmations
          </span>
          <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-500">
            {signal.highWeightCount} major
          </span>
        </div>
        {signal.patternNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center px-4">
            {signal.patternNames.map(p => (
              <span key={p} className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${isBuy ? "border-green-500/30 text-green-400 bg-green-500/10" : "border-red-500/30 text-red-400 bg-red-500/10"}`}>{p}</span>
            ))}
          </div>
        )}
        {/* Quality Meter */}
        <div className="w-full px-4 mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-slate-500 font-mono uppercase tracking-wider">Quality Meter</span>
            <span className={`text-[10px] font-bold font-mono ${signal.confidence >= 70 ? "text-green-400" : signal.confidence >= 45 ? "text-amber-400" : "text-red-400"}`}>
              {signal.confidence >= 70 ? "🟢 HIGH" : signal.confidence >= 45 ? "🟡 MEDIUM" : "🔴 LOW"}
            </span>
          </div>
          <div className="w-full h-2 bg-white/8 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${signal.confidence}%`,
              background: signal.confidence >= 70
                ? "linear-gradient(90deg, #22c55e, #4ade80)"
                : signal.confidence >= 45
                  ? "linear-gradient(90deg, #eab308, #facc15)"
                  : "linear-gradient(90deg, #ef4444, #f87171)"
            }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[8px] text-slate-600 font-mono">
              Composite: {signal.compositeScore?.toFixed(1) ?? "—"}
            </span>
            <span className="text-[8px] text-slate-600 font-mono">
              Regime: {signal.regime ?? "—"}
            </span>
            <span className="text-[8px] text-slate-600 font-mono">
              ADX: {signal.adx.toFixed(0)}
            </span>
          </div>
        </div>

        {/* A+ Score & ML Dashboard */}
        {pipelineResult?.mlAvailable && (
          <div className="w-full px-4 mt-3">
            <div className="rounded-xl border border-white/10 bg-white/3 overflow-hidden">
              {/* A+ Score Header */}
              <div className={`px-3 py-2 flex items-center justify-between ${isAPlus ? "bg-green-500/10 border-b border-green-500/20" : "bg-red-500/5 border-b border-white/5"}`}>
                <div className="flex items-center gap-2">
                  <Brain className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-[10px] font-black text-white uppercase tracking-wider">A+ Score</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-black ${aplusScore >= 85 ? "text-green-400" : aplusScore >= 70 ? "text-amber-400" : "text-red-400"}`}>
                    {aplusScore.toFixed(1)}
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${isAPlus ? "border-green-500/40 bg-green-500/15 text-green-400" : "border-red-500/40 bg-red-500/15 text-red-400"}`}>
                    {isAPlus ? "PASSED" : "REJECTED"}
                  </span>
                </div>
              </div>

              {/* XGBoost Probabilities */}
              <div className="px-3 py-2 border-b border-white/5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Target className="w-3 h-3 text-violet-400" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase">XGBoost Model</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-green-500/5 border border-green-500/15">
                    <TrendingUp className="w-3 h-3 text-green-400" />
                    <div>
                      <div className="text-[8px] text-green-500 font-mono">CALL</div>
                      <div className="text-xs font-black text-green-400">{(xgboostCall * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/15">
                    <TrendingDown className="w-3 h-3 text-red-400" />
                    <div>
                      <div className="text-[8px] text-red-500 font-mono">PUT</div>
                      <div className="text-xs font-black text-red-400">{(xgboostPut * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Component Scores */}
              {components && (
                <div className="px-3 py-2 border-b border-white/5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <BarChart2 className="w-3 h-3 text-slate-500" />
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Components</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {([
                      ["MTF Align", components.mtf_alignment],
                      ["Structure", components.market_structure],
                      ["Entry", components.entry_quality],
                      ["Momentum", components.momentum],
                      ["Candle", components.candle_quality],
                      ["S/R", components.support_resistance],
                    ] as [string, number][]).map(([label, val]) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[8px] text-slate-500 font-mono">{label}</span>
                        <div className="flex items-center gap-1">
                          <div className="w-10 h-1 bg-white/8 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${val >= 70 ? "bg-green-500" : val >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${val}%` }} />
                          </div>
                          <span className="text-[8px] font-mono text-slate-400 w-6 text-right">{val.toFixed(0)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Regime */}
              <div className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{regimeEmoji}</span>
                    <span className="text-[9px] font-bold text-slate-400">Market Regime</span>
                  </div>
                  <span className={`text-[10px] font-black ${regime === "TRENDING" ? "text-green-400" : regime === "RANGING" ? "text-amber-400" : regime === "VOLATILE_CHOPPY" ? "text-red-400" : "text-blue-400"}`}>
                    {regime}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[8px] text-slate-500 font-mono">Threshold</span>
                  <span className="text-[9px] font-mono text-slate-400">{pipelineResult?.thresholdUsed?.toFixed(0) ?? "—"}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

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
              <Clock className="w-3 h-3" />{TIMEFRAMES.find(t => t.id === tf)?.long}
            </div>
          </div>
        </div>
      )}

      {signal.keyReason && (
        <div className="px-4 py-2 border-t border-white/5 text-[10px] font-mono text-slate-500 leading-relaxed">
          <span className="text-slate-600 font-bold uppercase tracking-wider mr-1">Why:</span>{signal.keyReason}
        </div>
      )}

      <div className="flex items-center justify-center gap-3 text-xs text-slate-400 px-4 py-2 border-t border-white/5">
        <span className="font-bold text-white">{pair?.name}</span>
        {pair?.isOTC && <span className="text-[9px] font-bold text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded border border-violet-500/30">OTC</span>}
        <span className="text-slate-600">·</span>
        <span className="font-mono text-green-400 font-bold">{tf}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Signal row (used by scanners)
// ─────────────────────────────────────────────────────────────
function SignalRow({ pair, state, onOpen }: {
  pair: TradingPair;
  state: LiveMarketState;
  onOpen: (p: TradingPair) => void;
}) {
  const signal = generateSignal(pair.id, state);
  const up = state.priceChange >= 0;
  const signalReady = signal.direction !== "SKIP";
  return (
    <button onClick={() => onOpen(pair)}
      className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/4 last:border-0 hover:bg-white/4 transition-colors text-left">
      <div className="w-16 shrink-0">
        <div className="text-xs font-bold text-white truncate">{pair.name}</div>
        <div className="text-[8px] font-mono text-slate-600">ADX {state.indicators.adx.toFixed(0)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-black font-mono text-white truncate">
          {state.price.toLocaleString(undefined, { maximumFractionDigits: decFor(state.price) })}
        </div>
        <div className={`text-[9px] font-mono font-bold flex items-center gap-0.5 ${up ? "text-green-400" : "text-red-400"}`}>
          {up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
          {up ? "+" : ""}{state.priceChange.toFixed(3)}%
        </div>
      </div>
      <div className={`shrink-0 text-center px-2 py-1 rounded-lg border text-[10px] font-black ${
        signal.direction === "BUY" ? "border-green-500/40 bg-green-500/10 text-green-400"
        : signal.direction === "SELL" ? "border-red-500/40 bg-red-500/10 text-red-400"
        : "border-white/10 bg-white/5 text-slate-500"
      }`}>
        {signal.direction === "SKIP" ? "SKIP" : signal.direction}
        {signalReady && <span className="block text-[8px] font-mono font-bold opacity-70">{signal.confidence}%</span>}
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
    </button>
  );
}





// ─────────────────────────────────────────────────────────────
// Asset Category List (Currencies, Crypto, Commodities, Stocks)
// ─────────────────────────────────────────────────────────────
const DISPLAY_CATEGORIES: { key: PairCategory; label: string; emoji: string }[] = [
  { key: "currencies",  label: "Currencies",  emoji: "💱" },
  { key: "crypto",      label: "Crypto",      emoji: "🪙" },
  { key: "commodities", label: "Commodities", emoji: "🛢️" },
  { key: "stocks",      label: "Stocks",      emoji: "📈" },
  { key: "indices",     label: "Indices",     emoji: "📊" },
];

function AssetCategoryList({ allPairs, selectedPair, onSelect }: {
  allPairs: TradingPair[];
  selectedPair: TradingPair | null;
  onSelect: (p: TradingPair) => void;
}) {
  const [assetCat, setAssetCat]   = useState<PairCategory>("currencies");
  const [assetSearch, setAssetSearch] = useState("");

  const categoriesWithPairs = useMemo(() => {
    return DISPLAY_CATEGORIES.filter(c => allPairs.some(p => p.category === c.key));
  }, [allPairs]);

  const effCat = categoriesWithPairs.find(c => c.key === assetCat) ? assetCat : categoriesWithPairs[0]?.key ?? "currencies";

  const displayPairs = assetSearch
    ? allPairs.filter(p => p.name.toLowerCase().includes(assetSearch.toLowerCase()) || p.id.includes(assetSearch.toLowerCase()))
    : allPairs.filter(p => p.category === effCat);

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Available Assets</span>
        </div>
        <span className="text-[9px] font-mono text-green-400">{allPairs.length} total</span>
      </div>

      {/* Category tabs */}
      <div className="flex border-b border-white/5 overflow-x-auto scrollbar-thin">
        {categoriesWithPairs.map(c => (
          <button key={c.key} onClick={() => { setAssetCat(c.key); setAssetSearch(""); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold whitespace-nowrap transition-all border-b-2 ${
              effCat === c.key
                ? "border-green-400 text-green-300 bg-green-500/5"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}>
            <span>{c.emoji}</span>
            <span>{c.label}</span>
            <span className="text-[8px] font-mono opacity-50">{allPairs.filter(p => p.category === c.key).length}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/8">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input autoFocus value={assetSearch} onChange={e => setAssetSearch(e.target.value)}
            placeholder="Search assets…" className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none font-mono" />
          {assetSearch && <button onClick={() => setAssetSearch("")}><X className="w-3 h-3 text-slate-600 hover:text-slate-400" /></button>}
        </div>
      </div>

      {/* Pair list */}
      <div className="max-h-56 overflow-y-auto scrollbar-thin py-1">
        {displayPairs.length === 0
          ? <p className="text-xs text-slate-600 text-center py-4 font-mono">No assets found</p>
          : displayPairs.map(pair => (
            <button key={pair.id} onClick={() => onSelect(pair)}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-xs transition-all ${
                selectedPair?.id === pair.id ? "bg-green-500/12 text-green-300" : "text-slate-400 hover:bg-white/4"
              }`}>
              <div className="flex items-center gap-2">
                {selectedPair?.id === pair.id && <ChevronRight className="w-3 h-3 text-green-400" />}
                <span className="font-semibold">{pair.name}</span>
                {pair.isOTC && <span className="text-[8px] font-bold text-violet-400">OTC</span>}
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Analysis loader — staged animation while the pipeline runs:
// websocket → HTF alignment → indicators / candle direction → scoring.
// Stages advance on a timer that finishes with (not before) the real work.
// ─────────────────────────────────────────────────────────────
const ANALYSIS_STAGES = [
  {
    label: "Connecting to live WebSocket feed",
    icon: Wifi,
    detail: (elapsed: number) => `${Math.min(99, Math.round((elapsed / 900) * 100))}% handshake`,
  },
  {
    label: "Fetching recent candle history",
    icon: BarChart2,
    detail: (elapsed: number) => `${Math.min(60, 12 + Math.floor(elapsed / 100))} candles loaded`,
  },
  {
    label: "Analyzing HTF trend alignment",
    icon: LineChart,
    detail: (elapsed: number) => (elapsed < 850 ? "1m / 5m / 15m / 1h" : "3/4 aligned"),
  },
  {
    label: "Running indicators · candle direction",
    icon: Activity,
    detail: () => "RSI · MACD · EMA · BB · Stoch",
  },
  {
    label: "Scoring confluence & building signal",
    icon: Target,
    detail: (elapsed: number) =>
      elapsed < 1700 ? "…" : `${3 + Math.min(4, Math.floor((elapsed - 1700) / 200))}/7 confirmations`,
  },
  {
    label: "Validating risk · sealing signal",
    icon: Shield,
    detail: (elapsed: number) => (elapsed < 2550 ? "MTG · slippage · payout" : "READY ✓"),
  },
];
// Each stage gets its moment on screen even though the real pipeline can
// finish in well under a second — the pacing is part of the experience.
const ANALYSIS_STAGE_MS = 850;

function AnalysisLoader({ isAnalyzing }: { isAnalyzing: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isAnalyzing) return;
    const start = Date.now();
    setElapsed(0);
    const tick = setInterval(() => setElapsed(Date.now() - start), 120);
    return () => clearInterval(tick);
  }, [isAnalyzing]);

  if (!isAnalyzing) return null;
  const activeIdx = Math.min(ANALYSIS_STAGES.length - 1, Math.floor(elapsed / ANALYSIS_STAGE_MS));
  const progress = Math.min(96, (elapsed / (ANALYSIS_STAGE_MS * ANALYSIS_STAGES.length)) * 100);

  return (
    <div className="animate-slide-up rounded-2xl border border-green-500/25 bg-white/3 overflow-hidden">
      {/* Animated candlestick strip */}
      <div className="relative h-16 flex items-end justify-center gap-1.5 px-6 pt-4 bg-gradient-to-b from-green-500/8 to-transparent">
        {[0.9, 0.55, 1, 0.7, 0.85, 0.5, 0.95].map((h, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5" style={{ height: `${h * 100}%` }}>
            <div className={`w-1.5 rounded-sm ${i % 3 === 0 ? "bg-red-400/80" : "bg-green-400/80"} loader-candle`}
              style={{ flex: 1, animationDelay: `${i * 0.12}s`, minHeight: "10px" }} />
            <div className={`w-px ${i % 3 === 0 ? "bg-red-400/40" : "bg-green-400/40"}`} style={{ height: "6px" }} />
          </div>
        ))}
        <Sparkles className="absolute right-3 top-3 w-3.5 h-3.5 text-violet-400 animate-pulse" />
        {/* Sweep overlay during scoring/validating stages */}
        {activeIdx >= 4 && (
          <div className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-green-400/30 to-transparent loader-sweep pointer-events-none" />
        )}
      </div>

      {/* Stage checklist */}
      <div className="px-4 py-3 flex flex-col gap-2">
        {ANALYSIS_STAGES.map((s, i) => {
          const Icon = s.icon;
          const done = i < activeIdx;
          const active = i === activeIdx;
          const detail = s.detail(elapsed);
          return (
            <div key={s.label} className={`flex flex-col gap-0.5 text-[11px] font-mono transition-all duration-300 ${done ? "text-green-400" : active ? "text-white" : "text-slate-600"}`}>
              <div className="flex items-center gap-2.5">
                {done
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  : active
                  ? <RefreshCw className="w-3.5 h-3.5 text-green-400 shrink-0 animate-spin" />
                  : <Icon className="w-3.5 h-3.5 text-slate-700 shrink-0" />}
                <span className="flex-1">{s.label}</span>
                {active && (
                  <span className="text-[9px] text-green-500 tracking-widest animate-pulse">●●●</span>
                )}
              </div>
              {(active || done) && (
                <span className={`ml-6 text-[9px] tracking-wide ${done ? "text-green-500/70" : "text-slate-500"}`}>
                  {detail}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/6">
        <div className="h-full bg-gradient-to-r from-violet-500 via-green-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SIGNALS TAB — focused pair analysis
// ─────────────────────────────────────────────────────────────
function SignalsTab({
  livePairs, otcPairs, pairSource,
  selectedPair, onSelectPair,
  selectedTf, onSelectTf,
  currentSignal, pipelineResult, isAnalyzing,
  onGetSignal, entryTime, expiryTime,
  liveMarket,
  history, setOutcome,
}: {
  livePairs: TradingPair[];
  otcPairs: TradingPair[];
  pairSource: "quotex" | "local";
  selectedPair: TradingPair | null;
  onSelectPair: (p: TradingPair) => void;
  selectedTf: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  currentSignal: SignalResult | null;
  pipelineResult: PipelineSignalResult | null;
  isAnalyzing: boolean;
  onGetSignal: () => void;
  entryTime: Date | null;
  expiryTime: Date | null;
  liveMarket: LiveMarketState | null;
  history: SignalHistoryEntry[];
  setOutcome: (id: string, outcome: SignalOutcome) => void;
}) {
  const [showDuration, setShowDuration] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const isBuy = currentSignal?.direction === "BUY";
  // All available pairs (live + OTC combined for assets list)
  const allPairs = [...livePairs, ...otcPairs];
  // ADX gate: always pass now — every signal generates
  const adxGatePass = liveMarket ? liveMarket.indicators.adx >= 12 : null;

  return (
    <>
      <div className="px-4 py-4 flex flex-col gap-4">
        {/* App hero */}
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-400 via-green-500 to-emerald-600 flex items-center justify-center shadow-[0_0_30px_hsl(142_70%_45%/0.4)]">
            <span className="text-white font-black text-xl">KL</span>
          </div>
          <div className="text-center">
            <h1 className="text-base font-black text-white">Karthik <span className="text-green-400">Lee's</span> Confluence Engine</h1>
            <p className="text-[10px] text-slate-500 font-mono">16+ ADX CONFIRMATION · IMMEDIATE ENTRY</p>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1 text-[9px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
            </span>
            <span className="flex items-center gap-1 text-[9px] font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
              <Sparkles className="w-2.5 h-2.5" />KIMI AI
            </span>
            <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
              <Shield className="w-2.5 h-2.5" />16+ GATE
            </span>
          </div>
        </div>

        {/* Assets selection — moved to top: pick asset first, then analyze */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BarChart2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">ASSETS</span>
            <span className={`ml-auto text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border ${
              pairSource === "quotex" ? "border-green-500/25 bg-green-500/10 text-green-400" : "border-amber-500/25 bg-amber-500/10 text-amber-400"
            }`}>
              {pairSource === "quotex" ? `QUOTEX · ${allPairs.length} ASSETS` : "LOCAL ASSETS"}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-2xl overflow-hidden border border-white/6 bg-white/3">
            <div className="p-2">
              <PairDropdown pairs={allPairs} selectedPair={selectedPair} onSelect={onSelectPair} />
            </div>
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
          </div>
        </div>

        {/* Available Assets List — categorized with search */}
        <AssetCategoryList allPairs={allPairs} selectedPair={selectedPair} onSelect={onSelectPair} />

        {/* ADX status — between list and action button */}
        {liveMarket && (
          <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[10px] font-mono ${
            adxGatePass ? "border-green-500/25 bg-green-500/8 text-green-400" : "border-amber-500/25 bg-amber-500/8 text-amber-400"
          }`}>
            <span className="font-bold uppercase tracking-wider">ADX Trend Strength</span>
            <span className="font-black">
              {adxGatePass ? `✓ STRONG — ADX ${liveMarket.indicators.adx.toFixed(0)}` : `◈ MODERATE — ADX ${liveMarket.indicators.adx.toFixed(0)}`}
            </span>
          </div>
        )}

        {/* Generate Signal button — moved to bottom: final action after selection */}
        <button
          onClick={onGetSignal}
          disabled={!selectedPair || !liveMarket || isAnalyzing}
          className={`w-full rounded-2xl py-5 font-black text-xl tracking-widest uppercase transition-all border pb-2 ${
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
                Analyzing…
              </span>
            : !liveMarket
            ? <span className="flex items-center justify-center gap-2 text-base"><RefreshCw className="w-5 h-5 animate-spin" />Syncing…</span>
            : <span className="flex items-center justify-center gap-2"><Zap className="w-6 h-6" />Generate Signal</span>
          }
        </button>

        {/* Analysis animation (while pipeline runs) */}
        <AnalysisLoader isAnalyzing={isAnalyzing} />

        {/* Signal result */}
        {currentSignal && !isAnalyzing && (
          <SignalCard signal={currentSignal} pipelineResult={pipelineResult} isBuy={isBuy} entryTime={entryTime} expiryTime={expiryTime} pair={selectedPair} tf={selectedTf} />
        )}

        {/* No pair placeholder */}
        {!selectedPair && (
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center gap-3 text-slate-600">
            <BarChart2 className="w-10 h-10 opacity-20" />
            <p className="text-sm font-mono">Select an asset above to begin</p>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button onClick={() => setShowHistory(v => !v)}
              className="w-full px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Signal History</span>
                <span className="text-[10px] text-slate-600 font-mono">{history.length}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showHistory ? "rotate-180" : ""}`} />
            </button>
            {showHistory && (
              <>
                <WinRateBar history={history} />
                <div className="max-h-64 overflow-y-auto scrollbar-thin">
                  {history.map(entry => {
                    const isPending = entry.outcome === null;
                    const isExpired = entry.expiryTime.getTime() <= Date.now();
                    return (
                    <div key={entry.id} className={`flex items-center justify-between px-4 py-2.5 border-b border-white/4 last:border-0 ${entry.outcome === "win" ? "bg-green-500/5" : entry.outcome === "loss" ? "bg-red-500/5" : isExpired ? "bg-amber-500/5" : ""}`}>

                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center font-black ${entry.result.direction === "BUY" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                          {entry.result.direction === "BUY" ? "↑" : "↓"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white">{entry.pair.name}</span>
                            {entry.pair.isOTC && <span className="text-[9px] text-violet-400">OTC</span>}
                            {entry.mtgLevel > 0 && <span className="text-[9px] font-bold text-amber-400 bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 rounded">MTG{entry.mtgLevel}</span>}
                            <span className="text-[9px] text-green-600 font-mono bg-green-500/10 px-1 rounded">{entry.timeframe}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {entry.result.confidence}% conf · {entry.result.confirmations} conf
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {isPending && isExpired ? (
                          <span className="px-2 py-1 rounded-lg text-[10px] font-black border border-amber-500/40 bg-amber-500/15 text-amber-400 animate-pulse">
                            CHECKING…
                          </span>
                        ) : entry.outcome === "win" ? (
                          <span className="px-2 py-1 rounded-lg text-[10px] font-black border border-green-400/60 bg-green-500/25 text-green-300">
                            WIN ✓
                          </span>
                        ) : entry.outcome === "loss" ? (
                          <span className="px-2 py-1 rounded-lg text-[10px] font-black border border-red-400/60 bg-red-500/25 text-red-300">
                            LOSS ✗
                          </span>
                        ) : entry.outcome === "tie" ? (
                          <span className="px-2 py-1 rounded-lg text-[10px] font-black border border-slate-400/40 bg-slate-500/20 text-slate-300">
                            TIE ↕
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-lg text-[10px] font-black border border-white/10 bg-white/5 text-slate-500">
                            PENDING
                          </span>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showDuration && <DurationPicker selected={selectedTf} onSelect={onSelectTf} onClose={() => setShowDuration(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// SIGNAL GUIDE TAB
// ─────────────────────────────────────────────────────────────
function GuideTab() {
  const items = [
    { icon: "🎯", title: "How signals work", body: "The Confluence Engine analyzes 14 indicators (RSI, MACD, Stochastic, Bollinger Bands, ADX, EMA structure, candlestick patterns, S/R zones). A signal only fires with ADX 16+ trend confirmation AND at least 3 independent factors agreeing in the same direction." },
    { icon: "⚡", title: "Immediate Entry", body: "Signals fire immediately when generated — no waiting for the next candle. You use the timer option in Quotex to set your trade duration. Simply generate a signal and enter the trade right away." },
    { icon: "🔄", title: "MTG1 Recovery", body: "When a signal on an asset results in a loss, the next signal on that same asset is automatically flagged as MTG1 (Martingale Level 1) recovery. Only MTG1 is supported — no further martingale levels." },
    { icon: "⚠️", title: "Risk Warning", body: "This tool is for educational use only. Binary trading carries significant financial risk. Never trade with money you cannot afford to lose. The signals are not financial advice." },
    { icon: "📱", title: "Platform", body: "Optimized for use alongside Quotex (Official Trading Platform). Set the same timeframe in Quotex as selected in the app before entering a trade." },
  ];
  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="text-center pt-2">
        <h2 className="text-base font-black text-white">Signal Guide</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">How to use Karthik Lee's Confluence Engine</p>
      </div>

      <div className="flex items-center gap-4 px-4 py-4 rounded-2xl bg-green-500/8 border border-green-500/20">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shrink-0">
          <span className="text-white font-black text-sm">KL</span>
        </div>
        <div>
          <p className="text-sm font-black text-white">Karthik Lee's <span className="text-green-400">Confluence Engine</span></p>
          <p className="text-[10px] text-slate-500 font-mono">16+ ADX Gate · 3+ Confirmations · MTG1 Recovery</p>
          <p className="text-[10px] text-slate-600 mt-0.5">Immediate Entry · Signal Dashboard</p>
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
        KARTHIK LEE'S CONFLUENCE ENGINE · 16+ ADX CONFIRMATION · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Navigation (sidebar on desktop, bottom bar on mobile)
// ─────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: Tab; icon: ReactNode; label: string }[] = [
  { id: "signals", icon: <LineChart className="w-5 h-5" />, label: "Signals" },
  { id: "guide",   icon: <Shield className="w-5 h-5" />, label: "Signal Guide" },
];

function SideNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 h-screen sticky top-0 border-r border-green-500/10 bg-[hsl(150_20%_4%/0.5)] p-4 gap-1">
      <div className="flex items-center gap-2.5 px-2 py-3 mb-3">
        <div className="relative">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-400 via-green-500 to-emerald-600 flex items-center justify-center">
            <span className="text-white font-black text-xs">KL</span>
          </div>
          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border-2 border-background animate-pulse" />
        </div>
        <div>
          <div className="text-sm font-black text-white leading-tight">Karthik <span className="text-green-400">Lee's</span></div>
          <div className="text-[9px] text-slate-600 font-mono">Confluence Engine</div>
        </div>
      </div>
      <div className="px-2 pb-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Navigation</div>
      {NAV_ITEMS.map(item => {
        const isActive = active === item.id;
        return (
          <button key={item.id} onClick={() => onChange(item.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all text-left ${
              isActive ? "bg-[#1a2234] text-green-300 border border-green-500/20" : "text-slate-400 hover:text-white hover:bg-white/4"
            }`}>
            <span className={isActive ? "text-green-400" : "text-slate-500"}>{item.icon}</span>
            <span className="flex-1">{item.label}</span>
          </button>
        );
      })}
      <div className="mt-auto px-2 pt-4 text-[8px] text-slate-700 font-mono leading-relaxed">
        EDUCATIONAL USE ONLY<br />NOT FINANCIAL ADVICE
      </div>
    </aside>
  );
}

function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-green-500/10 bg-[hsl(150_20%_4%/0.97)] backdrop-blur-xl">
      <div className="max-w-lg mx-auto flex items-center">
        {NAV_ITEMS.map(t => (
          <button key={t.id} onClick={() => onChange(t.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all ${active === t.id ? "text-green-400" : "text-slate-600 hover:text-slate-400"}`}>
            {t.icon}
            <span className="text-[8px] font-bold uppercase tracking-wider">{t.label}</span>
            {active === t.id && <span className="w-4 h-0.5 bg-green-400 rounded-full" />}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab]     = useState<Tab>("signals");
  const [selectedPair, setSelectedPair] = useState<TradingPair | null>(null);
  const [selectedTf, setSelectedTf]   = useState<Timeframe>("1m");
  const [currentSignal, setCurrentSignal] = useState<SignalResult | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineSignalResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [history, setHistory]         = useState<SignalHistoryEntry[]>([]);
  const [entryTime, setEntryTime]     = useState<Date | null>(null);
  const [expiryTime, setExpiryTime]   = useState<Date | null>(null);

  const { live: livePairs, otc: otcPairs, source: pairSource } = useAvailablePairs();
  const liveMarket = useLiveMarket(selectedPair?.id ?? null, getTfMs(selectedTf) / 1000);

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Auto-connect: select the first available pair on mount so API connects immediately
  useEffect(() => {
    if (!selectedPair && livePairs.length > 0) {
      setSelectedPair(livePairs[0]);
    }
  }, [selectedPair, livePairs]);

  const resetSignal = () => { setCurrentSignal(null); setPipelineResult(null); setEntryTime(null); setExpiryTime(null); };

  const handleGetSignal = useCallback(async () => {
    if (!selectedPair || !liveMarket || isAnalyzing) return;
    setIsAnalyzing(true);
    resetSignal();
    const snap = { ...liveMarket, candles: [...liveMarket.candles] };
    const pair = selectedPair;
    const tf = selectedTf;
    // The staged loader needs ~3.4s to play through; hold the analyzing
    // state until both the real work and the animation have finished.
    const minDisplay = new Promise(r => setTimeout(r, ANALYSIS_STAGE_MS * ANALYSIS_STAGES.length));
    try {
      // Run the full pipeline: existing strategy + ML layer
      const [pipeline] = await Promise.all([
        runSignalPipeline(pair.id + "_" + tf, snap, tf),
        minDisplay,
      ]);
      const result = pipeline.engine;
      const ms      = getTfMs(tf);
      const now     = new Date();
      const entry   = now;
      const expiry  = new Date(now.getTime() + ms);
      setCurrentSignal(result);
      setPipelineResult(pipeline);
      setIsAnalyzing(false);
      setEntryTime(entry);
      setExpiryTime(expiry);
      // Notify if A+ signal
      if (pipeline.aplus?.decision === "A_PLUS_SIGNAL") {
        notifyASignal(pipeline, pair.name);
        showToastNotification(pipeline, pair.name);
      }
      setHistory(prev => {
        const unresolvedLoss = prev.find(h => h.pair.id === pair.id && h.outcome === "loss" && h.mtgLevel === 0);
        const mtgLevel = unresolvedLoss ? 1 : 0;
        return [{
          id: `${Date.now()}-${Math.random()}`,
          pair, timeframe: tf, result,
          pipelineResult: pipeline,
          timestamp: new Date(), entryTime: entry, expiryTime: expiry,
          outcome: null, mtgLevel,
        }, ...prev].slice(0, 60);
      });
    } catch {
      // Fallback: use engine only
      await minDisplay;
      const result = generateSignal(pair.id + "_" + tf, snap);
      const ms      = getTfMs(tf);
      const now     = new Date();
      const entry   = now;
      const expiry  = new Date(now.getTime() + ms);
      setCurrentSignal(result);
      setPipelineResult(null);
      setIsAnalyzing(false);
      setEntryTime(entry);
      setExpiryTime(expiry);
      setHistory(prev => {
        const unresolvedLoss = prev.find(h => h.pair.id === pair.id && h.outcome === "loss" && h.mtgLevel === 0);
        const mtgLevel = unresolvedLoss ? 1 : 0;
        return [{
          id: `${Date.now()}-${Math.random()}`,
          pair, timeframe: tf, result,
          pipelineResult: null,
          timestamp: new Date(), entryTime: entry, expiryTime: expiry,
          outcome: null, mtgLevel,
        }, ...prev].slice(0, 60);
      });
    }
  }, [selectedPair, selectedTf, liveMarket, isAnalyzing]);

  const setOutcome = (id: string, outcome: SignalOutcome) => {
    setHistory(prev => prev.map(h => h.id === id ? { ...h, outcome: h.outcome === outcome ? null : outcome } : h));
  };

  // Auto-detect win/loss after expiry. Each expired entry is settled from the
  // candle covering its exact expiry second — fetched per entry with that
  // entry's own pair — so outcomes are timestamp-exact and independent of
  // which pair is currently on screen (the old logic settled every trade
  // against the live price of whatever pair was selected).
  const resolvingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const resolveExpired = async () => {
      const now = Date.now();
      const pending = history.filter(
        h => h.outcome === null && h.expiryTime.getTime() <= now && !resolvingRef.current.has(h.id),
      );
      for (const entry of pending) {
        resolvingRef.current.add(entry.id);
        try {
          const periodSec = getTfMs(entry.timeframe) / 1000;
          const res = await fetch(
            `${API_BASE}/api/quotex/market?asset=${encodeURIComponent(entry.pair.id)}&period=${periodSec}`,
          );
          if (res.ok) {
            const data = (await res.json()) as { status?: string; candles?: Array<Candle & { time: number }> };
            // Candle covering the expiry instant; must already be closed so the
            // close is final. Only real Quotex data settles a trade — if the
            // feed is down the entry stays PENDING instead of guessing.
            const expirySec = entry.expiryTime.getTime() / 1000;
            const candle = data.status === "live"
              ? (data.candles ?? []).find(
                  k => k.time <= expirySec && expirySec < k.time + periodSec && k.time + periodSec <= now / 1000,
                )
              : undefined;
            if (candle) {
              const entryPx = entry.result.currentPrice;
              const outcome: SignalOutcome =
                candle.close === entryPx ? "tie"
                : (entry.result.direction === "BUY" ? candle.close > entryPx : candle.close < entryPx)
                  ? "win" : "loss";
              setHistory(prev => prev.map(h => h.id === entry.id ? { ...h, outcome } : h));
            }
          }
        } catch {
          // Network hiccup — retried on the next tick while still pending.
        } finally {
          resolvingRef.current.delete(entry.id);
        }
      }
    };
    const t = setInterval(resolveExpired, 3000);
    return () => clearInterval(t);
  }, [history]);


  return (
    <div className="min-h-screen text-foreground flex pb-16 md:pb-0">
      <SideNav active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* ── STICKY HEADER ── */}
        <header className="glass-panel border-b sticky top-0 z-50 px-4 py-2.5">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
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
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">Confluence Engine</span>
                </div>
                <p className="text-[9px] text-slate-600 font-mono">16+ ADX Gate · Immediate Entry · MTG1 Recovery</p>
              </div>
            </div>
            <SyncBadge market={liveMarket} />
          </div>
        </header>

        {/* ── TAB CONTENT (all tabs stay mounted so scanners keep running) ── */}
        <div className="max-w-3xl mx-auto w-full flex-1">
          <div className={activeTab === "signals" ? "" : "hidden"}>
            <SignalsTab
              livePairs={livePairs}           otcPairs={otcPairs}   pairSource={pairSource}
              selectedPair={selectedPair}     onSelectPair={p => { setSelectedPair(p); resetSignal(); }}
              selectedTf={selectedTf}         onSelectTf={tf => { setSelectedTf(tf); resetSignal(); }}
              currentSignal={currentSignal}   pipelineResult={pipelineResult}   isAnalyzing={isAnalyzing}
              onGetSignal={handleGetSignal}   entryTime={entryTime}   expiryTime={expiryTime}
              liveMarket={liveMarket}
              history={history}               setOutcome={setOutcome}
            />
          </div>

          <div className={activeTab === "guide" ? "" : "hidden"}>
            <GuideTab />
          </div>
        </div>
      </div>

      {/* ── BOTTOM NAV (mobile) ── */}
      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
