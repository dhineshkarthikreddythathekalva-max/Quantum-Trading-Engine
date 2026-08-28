#!/usr/bin/env tsx
/**
 * Backtest Script v2 — runs the signal pipeline (engine + deep analysis)
 * against real Quotex candle data.
 *
 * Compares OLD (engine-only) vs NEW (engine + deep analysis pipeline).
 *
 * Strategy:
 *  1. Fetch 120 candles for multiple assets/periods from the local bridge.
 *  2. Slide a window (size = LOOKBACK) across each candle set.
 *  3. At each window position, build a LiveMarketState and run BOTH:
 *     a) generateSignal (old engine-only)
 *     b) runSignalPipelineSync (new engine + deep analysis)
 *  4. Check what happened in the next N candles to determine win/loss.
 *  5. Collect 150 signals and report statistics.
 */

const BRIDGE_URL = process.env.BRIDGE_URL || "http://127.0.0.1:5001";
const LOOKBACK = 80;
const LOOK_AHEAD = 1;
const TARGET_SIGNALS = 150;

// ── Imports ──
import { computeMarketState } from "../src/lib/liveMarket";
import { generateSignal } from "../src/lib/signalEngine";
import { runSignalPipelineSync } from "../src/lib/signalPipeline";
import type { Candle } from "../src/lib/liveMarket";
import type { SignalResult } from "../src/lib/signalEngine";
import type { PipelineSignalResult } from "../src/lib/signalPipeline";

// ── Assets and periods to sample from ──
const ASSETS = [
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD",
  "EURJPY", "GBPJPY", "USDCHF", "NZDUSD", "EURGBP",
  "EURUSD_otc", "GBPUSD_otc", "USDJPY_otc", "AUDUSD_otc",
  "BTCUSD_otc", "ETHUSD_otc", "XAUUSD", "USCrude_otc",
];
const PERIODS = [60, 300];

// ── Fetch candles from the bridge ──
async function fetchCandles(asset: string, period: number): Promise<Candle[] | null> {
  try {
    const url = `${BRIDGE_URL}/market?asset=${encodeURIComponent(asset)}&period=${period}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "bypass-tunnel-reminder": "true" },
    });
    if (!res.ok) return null;
    const data = await res.json() as { status: string; candles?: Candle[] };
    if (data.status === "live" && data.candles && data.candles.length >= LOOKBACK + LOOK_AHEAD) {
      return data.candles;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Determine if signal was correct ──
function checkOutcome(
  direction: string,
  entryCandle: Candle,
  futureCandles: Candle[],
): "WIN" | "LOSS" | "SKIP" | "NO_SIGNAL" {
  if (direction === "SKIP") return "SKIP";
  if (futureCandles.length < LOOK_AHEAD) return "NO_SIGNAL";

  const entryPrice = entryCandle.close;
  const outcomeCandle = futureCandles[LOOK_AHEAD - 1];
  const exitPrice = outcomeCandle.close;

  if (direction === "BUY") {
    return exitPrice > entryPrice ? "WIN" : "LOSS";
  } else if (direction === "SELL") {
    return exitPrice < entryPrice ? "WIN" : "LOSS";
  }
  return "NO_SIGNAL";
}

// ── Main ──
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SIGNAL PIPELINE BACKTEST v2 — Engine + Deep Analysis");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`Lookback: ${LOOKBACK} candles | Look-ahead: ${LOOK_AHEAD} candle`);
  console.log(`Target signals: ${TARGET_SIGNALS}\n`);

  // ── Step 1: Collect candle data ──
  console.log("📡 Fetching candle data from Quotex bridge...\n");
  const allCandleSets: { asset: string; period: number; candles: Candle[] }[] = [];

  for (const asset of ASSETS) {
    for (const period of PERIODS) {
      const candles = await fetchCandles(asset, period);
      if (candles) {
        allCandleSets.push({ asset, period, candles });
        process.stdout.write(`  ✅ ${asset} (${period}s): ${candles.length} candles\n`);
      } else {
        process.stdout.write(`  ⏭ ${asset} (${period}s): skipped\n`);
      }
    }
  }

  console.log(`\n📊 Got candle data for ${allCandleSets.length} asset/period combos\n`);

  if (allCandleSets.length === 0) {
    console.error("❌ No candle data available. Is the bridge running?");
    process.exit(1);
  }

  // ── Step 2: Generate signals ──
  interface BacktestSignal {
    asset: string;
    period: number;
    // Engine-only result
    engineSignal: SignalResult;
    engineOutcome: "WIN" | "LOSS" | "SKIP" | "NO_SIGNAL";
    // Pipeline result (engine + deep analysis)
    pipelineResult: PipelineSignalResult;
    pipelineOutcome: "WIN" | "LOSS" | "SKIP" | "NO_SIGNAL";
    entryPrice: number;
    entryTime: number;
    directionReversed: boolean;
  }

  const signals: BacktestSignal[] = [];
  let windowIdx = 0;
  const maxPerSet = Math.ceil(TARGET_SIGNALS / allCandleSets.length) + 2;
  const stepSize = (candlesLen: number) => {
    const available = candlesLen - LOOKBACK - LOOK_AHEAD;
    return Math.max(1, Math.floor(available / maxPerSet));
  };

  for (const { asset, period, candles } of allCandleSets) {
    if (signals.length >= TARGET_SIGNALS) break;

    const step = stepSize(candles.length);
    for (let start = 0; start <= candles.length - LOOKBACK - LOOK_AHEAD && signals.length < TARGET_SIGNALS; start += step) {
      const window = candles.slice(start, start + LOOKBACK);
      const futureCandles = candles.slice(start + LOOKBACK, start + LOOKBACK + LOOK_AHEAD);

      if (window.length < LOOKBACK) break;

      const mkt = computeMarketState(asset, windowIdx, window);

      // Engine-only
      const engineSignal = generateSignal(asset, mkt);
      const engineOutcome = checkOutcome(engineSignal.direction, window[window.length - 1], futureCandles);

      // Pipeline (engine + deep analysis)
      const pipelineResult = runSignalPipelineSync(asset, mkt);
      const pipelineOutcome = checkOutcome(pipelineResult.finalDirection, window[window.length - 1], futureCandles);

      signals.push({
        asset,
        period,
        engineSignal,
        engineOutcome,
        pipelineResult,
        pipelineOutcome,
        entryPrice: window[window.length - 1].close,
        entryTime: window[window.length - 1].time,
        directionReversed: pipelineResult.analysis?.directionReversed ?? false,
      });

      windowIdx++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  REPORT: ENGINE-ONLY (OLD)
  // ═══════════════════════════════════════════════════════════════════════
  const engineActed = signals.filter(s => s.engineOutcome === "WIN" || s.engineOutcome === "LOSS");
  const engineWins = signals.filter(s => s.engineOutcome === "WIN").length;
  const engineLosses = signals.filter(s => s.engineOutcome === "LOSS").length;
  const engineSkips = signals.filter(s => s.engineOutcome === "SKIP").length;
  const engineWinRate = engineActed.length > 0 ? ((engineWins / engineActed.length) * 100).toFixed(1) : "N/A";

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  OLD: ENGINE-ONLY RESULTS");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`  Total signals:      ${signals.length}`);
  console.log(`  Acted (BUY/SELL):   ${engineActed.length}`);
  console.log(`  SKIP:               ${engineSkips}`);
  console.log(`  ✅ Wins:            ${engineWins}`);
  console.log(`  ❌ Losses:          ${engineLosses}`);
  console.log(`  📈 Win rate:        ${engineWinRate}%  (${engineWins}/${engineActed.length})\n`);

  // Engine grade breakdown
  const engineStrong = engineActed.filter(s => s.engineSignal.grade === "STRONG");
  const engineModerate = engineActed.filter(s => s.engineSignal.grade === "MODERATE");
  const engineWeak = engineActed.filter(s => s.engineSignal.grade === "WEAK");
  const gradeWR = (arr: typeof engineActed) => {
    const a = arr.length;
    const w = arr.filter(s => s.engineOutcome === "WIN").length;
    return a > 0 ? ((w / a) * 100).toFixed(1) : "N/A";
  };

  console.log("  By Grade:");
  console.log(`    STRONG   (${engineStrong.length}):  ${gradeWR(engineStrong)}%`);
  console.log(`    MODERATE (${engineModerate.length}): ${gradeWR(engineModerate)}%`);
  console.log(`    WEAK     (${engineWeak.length}):  ${gradeWR(engineWeak)}%`);
  console.log("");

  // Engine confidence buckets
  const eBuckets = [
    { label: "80-89%", min: 80, max: 89.99 },
    { label: "70-79%", min: 70, max: 79.99 },
    { label: "60-69%", min: 60, max: 69.99 },
    { label: "50-59%", min: 50, max: 59.99 },
  ];
  console.log("  By Confidence:");
  for (const b of eBuckets) {
    const group = engineActed.filter(s => s.engineSignal.confidence >= b.min && s.engineSignal.confidence <= b.max);
    const w = group.filter(s => s.engineOutcome === "WIN").length;
    if (group.length > 0) {
      console.log(`    ${b.label.padEnd(10)} (${group.length}): ${((w / group.length) * 100).toFixed(1)}%`);
    }
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  //  REPORT: PIPELINE (NEW — Engine + Deep Analysis)
  // ═══════════════════════════════════════════════════════════════════════
  const pipeActed = signals.filter(s => s.pipelineOutcome === "WIN" || s.pipelineOutcome === "LOSS");
  const pipeWins = signals.filter(s => s.pipelineOutcome === "WIN").length;
  const pipeLosses = signals.filter(s => s.pipelineOutcome === "LOSS").length;
  const pipeSkips = signals.filter(s => s.pipelineOutcome === "SKIP").length;
  const pipeWinRate = pipeActed.length > 0 ? ((pipeWins / pipeActed.length) * 100).toFixed(1) : "N/A";

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  NEW: ENGINE + DEEP ANALYSIS PIPELINE");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`  Total signals:      ${signals.length}`);
  console.log(`  Acted (BUY/SELL):   ${pipeActed.length}`);
  console.log(`  SKIP:               ${pipeSkips}`);
  console.log(`  ✅ Wins:            ${pipeWins}`);
  console.log(`  ❌ Losses:          ${pipeLosses}`);
  console.log(`  📈 Win rate:        ${pipeWinRate}%  (${pipeWins}/${pipeActed.length})`);
  console.log("");

  // Improvement
  const oldRate = engineActed.length > 0 ? (engineWins / engineActed.length) * 100 : 0;
  const newRate = pipeActed.length > 0 ? (pipeWins / pipeActed.length) * 100 : 0;
  const improvement = newRate - oldRate;
  console.log(`  📊 Improvement:     ${improvement >= 0 ? "+" : ""}${improvement.toFixed(1)}% (${oldRate.toFixed(1)}% → ${newRate.toFixed(1)}%)`);
  console.log("");

  // Direction reversals
  const reversed = signals.filter(s => s.directionReversed);
  const reversedWins = reversed.filter(s => s.pipelineOutcome === "WIN").length;
  const reversedActed = reversed.filter(s => s.pipelineOutcome === "WIN" || s.pipelineOutcome === "LOSS");
  console.log(`  🔄 Direction reversals: ${reversed.length}/${signals.length} (${((reversed.length / signals.length) * 100).toFixed(1)}%)`);
  if (reversedActed.length > 0) {
    console.log(`     Reversal win rate:   ${((reversedWins / reversedActed.length) * 100).toFixed(1)}% (${reversedWins}/${reversedActed.length})`);
  }
  console.log("");

  // Pipeline grade breakdown
  const pipeStrong = pipeActed.filter(s => s.pipelineResult.finalGrade === "STRONG");
  const pipeModerate = pipeActed.filter(s => s.pipelineResult.finalGrade === "MODERATE");
  const pipeWeak = pipeActed.filter(s => s.pipelineResult.finalGrade === "WEAK");
  const pGradeWR = (arr: typeof pipeActed) => {
    const a = arr.length;
    const w = arr.filter(s => s.pipelineOutcome === "WIN").length;
    return a > 0 ? ((w / a) * 100).toFixed(1) : "N/A";
  };

  console.log("  By Grade (pipeline):");
  console.log(`    STRONG   (${pipeStrong.length}):  ${pGradeWR(pipeStrong)}%`);
  console.log(`    MODERATE (${pipeModerate.length}): ${pGradeWR(pipeModerate)}%`);
  console.log(`    WEAK     (${pipeWeak.length}):  ${pGradeWR(pipeWeak)}%`);
  console.log("");

  // Pipeline confidence buckets
  const pBuckets = [
    { label: "80-89%", min: 80, max: 89.99 },
    { label: "70-79%", min: 70, max: 79.99 },
    { label: "60-69%", min: 60, max: 69.99 },
    { label: "50-59%", min: 50, max: 59.99 },
    { label: "<50%",    min: 0,  max: 49.99 },
  ];
  console.log("  By Confidence (pipeline):");
  for (const b of pBuckets) {
    const group = pipeActed.filter(s => s.pipelineResult.finalConfidence >= b.min && s.pipelineResult.finalConfidence <= b.max);
    const w = group.filter(s => s.pipelineOutcome === "WIN").length;
    if (group.length > 0) {
      console.log(`    ${b.label.padEnd(10)} (${group.length}): ${((w / group.length) * 100).toFixed(1)}%`);
    }
  }
  console.log("");

  // ── By Direction (pipeline) ──
  const pBuys = pipeActed.filter(s => s.pipelineResult.finalDirection === "BUY");
  const pSells = pipeActed.filter(s => s.pipelineResult.finalDirection === "SELL");
  const pBuyWins = pBuys.filter(s => s.pipelineOutcome === "WIN").length;
  const pSellWins = pSells.filter(s => s.pipelineOutcome === "WIN").length;

  console.log("  By Direction (pipeline):");
  console.log(`    BUY  (${pBuys.length}):  ${pBuys.length > 0 ? ((pBuyWins / pBuys.length) * 100).toFixed(1) : "N/A"}%`);
  console.log(`    SELL (${pSells.length}): ${pSells.length > 0 ? ((pSellWins / pSells.length) * 100).toFixed(1) : "N/A"}%`);
  console.log("");

  // ── By Asset (pipeline) ──
  const assetStats: Record<string, { total: number; wins: number; acted: number }> = {};
  for (const s of signals) {
    if (!assetStats[s.asset]) assetStats[s.asset] = { total: 0, wins: 0, acted: 0 };
    assetStats[s.asset].total++;
    if (s.pipelineOutcome === "WIN" || s.pipelineOutcome === "LOSS") {
      assetStats[s.asset].acted++;
      if (s.pipelineOutcome === "WIN") assetStats[s.asset].wins++;
    }
  }

  console.log("  By Asset (pipeline):");
  const sortedAssets = Object.entries(assetStats).sort((a, b) => b[1].total - a[1].total);
  for (const [asset, stats] of sortedAssets) {
    const wr = stats.acted > 0 ? ((stats.wins / stats.acted) * 100).toFixed(1) : "N/A";
    console.log(`    ${asset.padEnd(20)} (${stats.total} signals, ${stats.acted} acted): ${wr}%`);
  }
  console.log("");

  // ── By Timeframe ──
  const tf60 = pipeActed.filter(s => s.period === 60);
  const tf300 = pipeActed.filter(s => s.period === 300);
  const tf60W = tf60.filter(s => s.pipelineOutcome === "WIN").length;
  const tf300W = tf300.filter(s => s.pipelineOutcome === "WIN").length;

  console.log("  By Timeframe (pipeline):");
  console.log(`    1m  (${tf60.length}):  ${tf60.length > 0 ? ((tf60W / tf60.length) * 100).toFixed(1) : "N/A"}%`);
  console.log(`    5m  (${tf300.length}): ${tf300.length > 0 ? ((tf300W / tf300.length) * 100).toFixed(1) : "N/A"}%`);
  console.log("");

  // ── Sample signals (first 20) ──
  console.log("─── Sample Signals (first 20) ───");
  console.log("  #  | Asset              | Engine | Pipeline | Grade | Conf  | Rev | Outcome");
  console.log("  ---|--------------------|--------|----------|-------|-------|-----|--------");
  for (let i = 0; i < Math.min(20, signals.length); i++) {
    const s = signals[i];
    const pipeIcon = s.pipelineOutcome === "WIN" ? "✅" : s.pipelineOutcome === "LOSS" ? "❌" : s.pipelineOutcome === "SKIP" ? "⏭" : "❓";
    const engineIcon = s.engineOutcome === "WIN" ? "✅" : s.engineOutcome === "LOSS" ? "❌" : s.engineOutcome === "SKIP" ? "⏭" : "❓";
    const assetPad = s.asset.padEnd(18);
    const rev = s.directionReversed ? "YES" : " - ";
    console.log(
      `  ${String(i + 1).padStart(3)} | ${assetPad} | ${s.engineSignal.direction.padEnd(6)} | ${s.pipelineResult.finalDirection.padEnd(8)} | ${s.pipelineResult.finalGrade.padEnd(5)} | ${String(s.pipelineResult.finalConfidence).padStart(4)}% | ${rev} | ${engineIcon}→${pipeIcon}`
    );
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Backtest complete.");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
