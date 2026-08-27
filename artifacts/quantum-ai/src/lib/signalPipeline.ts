/**
 * Signal Pipeline — integrates existing signal engine with XGBoost A+ layer.
 *
 * Flow:
 *   Quotex live data
 *   → Existing signal engine (generateSignal)
 *   → Candidate CALL/PUT
 *   → Feature engine (via ML service or browser fallback)
 *   → XGBoost probability (via ML service or neutral fallback)
 *   → A+ quality scoring
 *   → Dynamic threshold
 *   → Final signal: A+ SIGNAL or NO SIGNAL
 *   → Result tracking
 *
 * This module does NOT modify the existing signal engine.
 * It wraps it and adds the ML layer on top.
 */

import type { LiveMarketState, Candle } from "./liveMarket";
import {
  generateSignal,
  type SignalResult,
  type SignalDirection,
  type SignalGrade,
} from "./signalEngine";
import {
  evaluateAPlus,
  type APlusResult,
  type APlusComponentScores,
  type RegimeType,
} from "./aPlusEngine";
import {
  evaluate as mlEvaluate,
  checkMLHealth,
  storeSignal,
  type MLEvaluateResponse,
} from "./mlClient";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PipelineSignalResult {
  // Original signal engine output (always present)
  engine: SignalResult;

  // ML layer output (null if ML service unreachable and no fallback)
  aplus: APlusResult | null;

  // Final decision
  finalDirection: SignalDirection; // "BUY" | "SELL" | "SKIP"
  finalGrade: SignalGrade;
  finalConfidence: number;

  // ML metadata
  mlAvailable: boolean;
  xgboostCallProb: number;
  xgboostPutProb: number;
  aplusScore: number;
  regime: RegimeType;
  componentScores: APlusComponentScores | null;
  thresholdUsed: number;

  // Reasons from ML layer
  mlReasons: string[];
}

// ─────────────────────────────────────────────
// Feature Extraction (browser-side fallback)
// ─────────────────────────────────────────────

function extractCandlesForML(mkt: LiveMarketState): Candle[] {
  // Return raw candles for the ML service
  return mkt.candles.map(c => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

// ─────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────

/**
 * Run the full signal pipeline:
 * 1. Existing strategy generates candidate
 * 2. ML layer evaluates candidate
 * 3. A+ scoring determines final signal
 */
export async function runSignalPipeline(
  pairId: string,
  mkt: LiveMarketState,
  expiry: string = "1m",
): Promise<PipelineSignalResult> {
  // ── Step 1: Existing strategy generates candidate ──
  const engineResult = generateSignal(pairId, mkt);

  // If engine says SKIP, no ML evaluation needed
  if (engineResult.direction === "SKIP") {
    return {
      engine: engineResult,
      aplus: null,
      finalDirection: "SKIP",
      finalGrade: "WEAK",
      finalConfidence: 0,
      mlAvailable: false,
      xgboostCallProb: 0.5,
      xgboostPutProb: 0.5,
      aplusScore: 0,
      regime: "NORMAL",
      componentScores: null,
      thresholdUsed: 85,
      mlReasons: ["No candidate from existing strategy"],
    };
  }

  // ── Step 2: Determine direction and get ML evaluation ──
  const direction = engineResult.direction === "BUY" ? "CALL" : "PUT";
  const candles = extractCandlesForML(mkt);
  const mlAvailable = await checkMLHealth();

  let aplusResult: APlusResult | null = null;
  let mlResponse: MLEvaluateResponse | null = null;

  if (mlAvailable && candles.length >= 20) {
    // ── Try Python ML service first ──
    mlResponse = await mlEvaluate({
      candles,
      direction,
      expiry,
      asset: pairId,
      timeframe: "1m",
      entry_price: mkt.price,
      strategy_score: engineResult.compositeScore ?? 0,
      strategy_direction: engineResult.direction === "BUY" ? 1 : -1,
      strategy_confirmations: engineResult.confirmations,
      store: true,
    });

    if (mlResponse) {
      aplusResult = {
        score: mlResponse.score,
        decision: mlResponse.decision,
        thresholdUsed: mlResponse.threshold_used,
        regime: mlResponse.regime as RegimeType,
        direction: mlResponse.direction as "CALL" | "PUT",
        callProbability: mlResponse.call_probability,
        putProbability: mlResponse.put_probability,
        componentScores: mlResponse.component_scores,
        reasons: mlResponse.reasons,
      };
    }
  }

  // ── Fallback: browser-side A+ scoring ──
  if (!aplusResult) {
    aplusResult = evaluateAPlus(mkt, engineResult, 0.5, 0.5);
  }

  // ── Step 3: Final decision ──
  const passed = aplusResult.decision === "A_PLUS_SIGNAL";

  const finalDirection: SignalDirection = passed
    ? engineResult.direction
    : "SKIP";

  return {
    engine: engineResult,
    aplus: aplusResult,
    finalDirection,
    finalGrade: passed ? engineResult.grade : "WEAK",
    finalConfidence: passed ? engineResult.confidence : 0,
    mlAvailable,
    xgboostCallProb: aplusResult.callProbability,
    xgboostPutProb: aplusResult.putProbability,
    aplusScore: aplusResult.score,
    regime: aplusResult.regime,
    componentScores: aplusResult.componentScores,
    thresholdUsed: aplusResult.thresholdUsed,
    mlReasons: aplusResult.reasons,
  };
}

/**
 * Determine if a signal should be shown to the user.
 * This is the main gate for signal display.
 */
export function shouldShowSignal(result: PipelineSignalResult): boolean {
  if (result.finalDirection === "SKIP") return false;
  if (result.aplus === null) {
    // ML unavailable — fall back to engine grade
    return result.engine.grade === "STRONG" || result.engine.grade === "MODERATE";
  }
  return result.aplus.decision === "A_PLUS_SIGNAL";
}

/**
 * Get the A+ badge color class based on score.
 */
export function getAPlusColor(score: number): string {
  if (score >= 90) return "text-green-400";
  if (score >= 80) return "text-emerald-400";
  if (score >= 70) return "text-amber-400";
  if (score >= 60) return "text-orange-400";
  return "text-red-400";
}

/**
 * Get regime display info.
 */
export function getRegimeInfo(regime: RegimeType): {
  label: string;
  color: string;
  icon: string;
} {
  switch (regime) {
    case "TRENDING":
      return { label: "Trending", color: "text-green-400", icon: "📈" };
    case "RANGING":
      return { label: "Ranging", color: "text-amber-400", icon: "↔️" };
    case "VOLATILE_CHOPPY":
      return { label: "Choppy", color: "text-red-400", icon: "🌊" };
    case "NORMAL":
    default:
      return { label: "Normal", color: "text-blue-400", icon: "📊" };
  }
}
