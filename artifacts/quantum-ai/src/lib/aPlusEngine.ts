/**
 * A+ Quality Scoring Engine (TypeScript)
 *
 * Browser-side fallback when the Python ML service is unreachable.
 * Mirrors the Python aplus_scorer.py logic.
 *
 * Combines:
 * - XGBoost probability (25%)
 * - Multi-timeframe alignment (15%)
 * - Market structure (15%)
 * - Entry quality (15%)
 * - Momentum (10%)
 * - Candle quality (8%)
 * - Support/resistance (5%)
 * - Volatility/regime (7%)
 *
 * All weights are configurable. Dynamic thresholds based on regime.
 */

import type { LiveMarketState, Candle } from "./liveMarket";
import type { SignalResult, SignalDirection } from "./signalEngine";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type RegimeType = "TRENDING" | "RANGING" | "VOLATILE_CHOPPY" | "NORMAL";

export interface QualityWeights {
  xgboost_prob: number;
  mtf_alignment: number;
  market_structure: number;
  entry_quality: number;
  momentum: number;
  candle_quality: number;
  support_resistance: number;
  volatility_regime: number;
}

export interface RegimeThresholds {
  trending: number;
  normal: number;
  ranging: number;
  choppy: number;
}

export interface APlusComponentScores {
  xgboost_prob: number;
  mtf_alignment: number;
  market_structure: number;
  entry_quality: number;
  momentum: number;
  candle_quality: number;
  support_resistance: number;
  volatility_regime: number;
}

export interface APlusResult {
  score: number;
  decision: "A_PLUS_SIGNAL" | "REJECTED";
  thresholdUsed: number;
  regime: RegimeType;
  direction: "CALL" | "PUT";
  callProbability: number;
  putProbability: number;
  componentScores: APlusComponentScores;
  reasons: string[];
}

// ─────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────

const DEFAULT_WEIGHTS: QualityWeights = {
  xgboost_prob: 0.25,
  mtf_alignment: 0.15,
  market_structure: 0.15,
  entry_quality: 0.15,
  momentum: 0.10,
  candle_quality: 0.08,
  support_resistance: 0.05,
  volatility_regime: 0.07,
};

const DEFAULT_THRESHOLDS: RegimeThresholds = {
  trending: 82,
  normal: 85,
  ranging: 86,
  choppy: 90,
};

// ─────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────

function emaLast(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let result = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    result = data[i] * k + result * (1 - k);
  }
  return result;
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

// ─────────────────────────────────────────────
// Regime Classifier
// ─────────────────────────────────────────────

function classifyRegime(mkt: LiveMarketState): RegimeType {
  const adx = mkt.indicators.adx;
  const atrVal = mkt.indicators.atr14;
  const price = mkt.price;

  // Volatility regime via ATR relative to recent average
  const atrPct = price > 0 ? atrVal / price : 0;

  // Use ADX for trend detection
  if (adx > 25) {
    return "TRENDING";
  } else if (adx < 18) {
    return "RANGING";
  }

  // Check for choppy conditions
  if (mkt.volume.spike || atrPct > 0.008) {
    return "VOLATILE_CHOPPY";
  }

  return "NORMAL";
}

// ─────────────────────────────────────────────
// Component Scorers
// ─────────────────────────────────────────────

function scoreXGBoost(callProb: number, putProb: number, direction: "CALL" | "PUT"): number {
  if (direction === "CALL") return callProb * 100;
  return putProb * 100;
}

function scoreMTF(mkt: LiveMarketState): number {
  // Approximate multi-TF alignment from indicators
  const ema10 = mkt.indicators.ema10;
  const ema21 = mkt.indicators.ema21;
  const ema50 = mkt.indicators.ema50;
  const price = mkt.price;

  let alignment = 0;
  // 15m proxy: price vs EMA50
  if (price > ema50) alignment += 3;
  else alignment -= 3;
  // 5m proxy: price vs EMA21
  if (price > ema21) alignment += 2;
  else alignment -= 2;
  // 1m: price vs EMA10
  if (price > ema10) alignment += 1;
  else alignment -= 1;

  // Normalize to 0-100
  return (Math.abs(alignment) / 6) * 100;
}

function scoreStructure(mkt: LiveMarketState): number {
  let score = 50;

  // Market structure
  const structure = mkt.structure;
  if (structure.trend === "bullish") score += 15;
  else if (structure.trend === "bearish") score += 15;

  if (structure.higherHighs) score += 10;
  if (structure.lowerLows) score += 10;

  // ADX strength
  const adx = mkt.indicators.adx;
  if (adx > 30) score += 10;
  else if (adx > 20) score += 5;

  return Math.max(0, Math.min(100, score));
}

function scoreEntryQuality(mkt: LiveMarketState, strategyScore: number, strategyConfirmations: number): number {
  let score = 50;

  // Strategy alignment with market
  const direction = mkt.indicators.emaTrend;
  if (mkt.structure.trend === direction) score += 15;

  // Confirmations
  score += Math.min(20, strategyConfirmations * 7);

  // RSI not extreme
  const rsi = mkt.indicators.rsi14;
  if (rsi > 30 && rsi < 70) score += 10;
  else score -= 5;

  // Price near EMA21 (pullback entry)
  const distToEma = Math.abs(mkt.price - mkt.indicators.ema21) / mkt.price;
  if (distToEma < 0.002) score += 10;

  return Math.max(0, Math.min(100, score));
}

function scoreMomentum(mkt: LiveMarketState): number {
  let score = 50;

  // RSI
  const rsi = mkt.indicators.rsi14;
  if (rsi >= 40 && rsi <= 60) score += 10;
  else if (rsi < 30 || rsi > 70) score -= 10;

  // MACD histogram
  const macdHist = mkt.indicators.macdHist;
  score += Math.max(-15, Math.min(15, macdHist * 10000));

  // Stochastic
  const stochK = mkt.indicators.stochK;
  if (stochK >= 20 && stochK <= 80) score += 5;

  return Math.max(0, Math.min(100, score));
}

function scoreCandleQuality(mkt: LiveMarketState): number {
  let score = 50;
  const candles = mkt.candles;
  if (candles.length < 2) return score;

  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low || 0.00001;
  const bodyRatio = body / range;

  // Strong body candle
  if (bodyRatio > 0.6) score += 20;
  else if (bodyRatio < 0.2) score -= 10;

  // Rejection wicks
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const rejection = (upperWick + lowerWick) / Math.max(body, 0.00001);
  if (rejection > 1.5) score += 15;

  // Close position
  const closePos = range > 0 ? (last.close - last.low) / range : 0.5;
  const isBull = last.close > last.open;
  if (isBull && closePos > 0.7) score += 10;
  else if (!isBull && closePos < 0.3) score += 10;

  return Math.max(0, Math.min(100, score));
}

function scoreSR(mkt: LiveMarketState): number {
  let score = 50;
  const price = mkt.price;
  const resistance = mkt.sr.resistance;
  const support = mkt.sr.support;
  const range = resistance - support || price * 0.01;

  const supportDist = (price - support) / range;
  const resistanceDist = (resistance - price) / range;

  if (supportDist < 0.2) score += 20;
  else if (resistanceDist < 0.2) score += 20;

  if (mkt.sr.atKeyLevel) score += 10;

  return Math.max(0, Math.min(100, score));
}

function scoreVolatility(mkt: LiveMarketState): number {
  let score = 50;
  const atrVal = mkt.indicators.atr14;
  const price = mkt.price;
  const atrPct = price > 0 ? atrVal / price : 0;

  // Moderate volatility is best
  if (atrPct > 0.001 && atrPct < 0.005) score += 20;
  else if (atrPct > 0.01) score -= 15;
  else if (atrPct < 0.0005) score -= 10;

  // Volume
  if (mkt.volume.spike) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ─────────────────────────────────────────────
// Main A+ Evaluation
// ─────────────────────────────────────────────

export function evaluateAPlus(
  mkt: LiveMarketState,
  signalResult: SignalResult,
  callProbability: number = 0.5,
  putProbability: number = 0.5,
  weights: QualityWeights = DEFAULT_WEIGHTS,
  thresholds: RegimeThresholds = DEFAULT_THRESHOLDS,
): APlusResult {
  const reasons: string[] = [];

  // Determine direction
  const direction: "CALL" | "PUT" = signalResult.direction === "BUY" ? "CALL" : "PUT";

  // Classify regime
  const regime = classifyRegime(mkt);
  const threshold = thresholds[regime.toLowerCase() as keyof RegimeThresholds] ?? thresholds.normal;

  // Compute component scores
  const components: APlusComponentScores = {
    xgboost_prob: scoreXGBoost(callProbability, putProbability, direction),
    mtf_alignment: scoreMTF(mkt),
    market_structure: scoreStructure(mkt),
    entry_quality: scoreEntryQuality(mkt, signalResult.confidence / 100, signalResult.confirmations),
    momentum: scoreMomentum(mkt),
    candle_quality: scoreCandleQuality(mkt),
    support_resistance: scoreSR(mkt),
    volatility_regime: scoreVolatility(mkt),
  };

  // Weighted composite
  let score =
    components.xgboost_prob * weights.xgboost_prob +
    components.mtf_alignment * weights.mtf_alignment +
    components.market_structure * weights.market_structure +
    components.entry_quality * weights.entry_quality +
    components.momentum * weights.momentum +
    components.candle_quality * weights.candle_quality +
    components.support_resistance * weights.support_resistance +
    components.volatility_regime * weights.volatility_regime;

  score = Math.max(0, Math.min(100, score));

  // Decision
  const decision: "A_PLUS_SIGNAL" | "REJECTED" = score >= threshold ? "A_PLUS_SIGNAL" : "REJECTED";

  // Build reasons
  reasons.push(`Regime: ${regime} (threshold: ${threshold})`);
  reasons.push(`XGBoost: ${direction} = ${((direction === "CALL" ? callProbability : putProbability) * 100).toFixed(1)}%`);
  reasons.push(`MTF alignment: ${components.mtf_alignment.toFixed(1)}/100`);
  reasons.push(`Structure: ${components.market_structure.toFixed(1)}/100`);
  reasons.push(`Entry quality: ${components.entry_quality.toFixed(1)}/100`);
  reasons.push(`Momentum: ${components.momentum.toFixed(1)}/100`);
  reasons.push(`Candle: ${components.candle_quality.toFixed(1)}/100`);
  reasons.push(`S/R: ${components.support_resistance.toFixed(1)}/100`);
  reasons.push(`Volatility: ${components.volatility_regime.toFixed(1)}/100`);

  if (decision === "A_PLUS_SIGNAL") {
    reasons.push(`✅ PASSED — Score ${score.toFixed(1)} >= threshold ${threshold}`);
  } else {
    reasons.push(`❌ REJECTED — Score ${score.toFixed(1)} < threshold ${threshold}`);
  }

  return {
    score,
    decision,
    thresholdUsed: threshold,
    regime,
    direction,
    callProbability,
    putProbability,
    componentScores: components,
    reasons,
  };
}
