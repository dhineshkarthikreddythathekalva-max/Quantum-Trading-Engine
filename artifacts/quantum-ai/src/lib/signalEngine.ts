/**
 * ═══════════════════════════════════════════════════════════════════════
 *  SIGNAL ENGINE v7 — 6-Engine AI Fusion Architecture
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Powered by 6 AI Engines:
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │ TITAN X        — Deep Market Structure         (84.3% weight) │
 *  │ NEXUS FUSION   — Multi-Source Intelligence      (88.2% weight) │
 *  │ APEX VISION    — Macro & Sentiment Scan         (92.7% weight) │
 *  │ QUANTUM STRIKE — Quantitative Signal Engine     (96.8% weight) │
 *  │ OMEGA QX       — High Probability Signals       (98.5% weight) │
 *  │ QUOTEX MASTER  — Final Intelligence Fusion      (90.2% weight) │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 *  Five AI engines analyze independently, QUOTEX MASTER fuses them
 *  into one decision. OTC pairs get additional manipulation detection
 *  and stricter entry filters.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { LiveMarketState, Candle } from "./liveMarket";

// ─────────────────────────────────────────────────────────────────────
// Backward-compatible exports (same shape as v6 so the UI works unchanged)
// ─────────────────────────────────────────────────────────────────────
export type SignalDirection = "BUY" | "SELL" | "SKIP";
export type SignalGrade = "STRONG" | "MODERATE" | "WEAK";

export interface SignalFactor {
  label: string;
  direction: "BUY" | "SELL";
  weight: number;
  category: "trend" | "oscillator" | "pattern" | "structure" | "volume" | "session";
}

export interface SignalResult {
  direction: SignalDirection;
  grade: SignalGrade;
  confidence: number;
  skipReason: string;
  keyReason: string;
  factors: SignalFactor[];
  highWeightCount: number;
  confirmations: number;
  support: number;
  resistance: number;
  currentPrice: number;
  rsi: number;
  stochK: number; stochD: number;
  adx: number;
  macdDir: "bullish" | "bearish";
  bbPct: number;
  patternNames: string[];
  // ── v6 additions (optional for backward compat) ──
  regime?: Regime;
  compositeScore?: number;
  thresholdUsed?: number;
  // ── v7 additions: engine results ──
  engineResults?: EngineResult[];
  otcAnalysis?: OTCAnalysis;
  manipulationScore?: number;
}

// ─────────────────────────────────────────────────────────────────────
// v7 Engine Types
// ─────────────────────────────────────────────────────────────────────
type Regime = "TRENDING" | "RANGING" | "VOLATILE_CHOPPY";
type VolState = "low" | "normal" | "high";

interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

interface SRZone {
  level: number;
  touchCount: number;
  strength: number; // 0–1
  type: "support" | "resistance";
}

interface PatternResult {
  direction: "up" | "down" | null;
  confidence: number; // 0–1
  name: string;
}

interface LayerOutput {
  trendScore: number;        // -2..+2
  regime: Regime;
  zones: SRZone[];
  patterns: PatternResult[];
  momentumScore: number;     // -1..+1
  volGate: "SPIKE" | "DEAD" | null;
  composite: number;         // -100..+100
  threshold: number;
  reasons: string[];
}

/** Individual AI engine output */
interface EngineResult {
  name: string;
  direction: "up" | "down" | "neutral";
  confidence: number; // 0-100
  weight: number; // accuracy weight (0-1)
  passed: boolean; // did this engine fire?
  reasons: string[];
}

/** OTC market analysis */
interface OTCAnalysis {
  isOTC: boolean;
  manipulationScore: number; // 0-1, higher = more manipulation detected
  manipulationFlags: string[];
  recommendedStrictness: "normal" | "strict" | "very_strict";
}

// ═══════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function ema(data: number[], period: number): number[] {
  if (data.length < period) return data.map(() => data[0] ?? 0);
  const k = 2 / (period + 1);
  const r = new Array(data.length).fill(0);
  r[period - 1] = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) r[i] = data[i] * k + r[i - 1] * (1 - k);
  return r;
}

function emaLast(data: number[], period: number): number {
  const arr = ema(data, period);
  return arr[arr.length - 1] ?? data[data.length - 1] ?? 0;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

function adx(candles: Candle[], period = 14): { adx: number; plusDI: number; minusDI: number } {
  if (candles.length < period * 2) return { adx: 25, plusDI: 25, minusDI: 25 };
  const trArr: number[] = [], pdmArr: number[] = [], mdmArr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trArr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    pdmArr.push(c.high - p.high > p.low - c.low ? Math.max(c.high - p.high, 0) : 0);
    mdmArr.push(p.low - c.low > c.high - p.high ? Math.max(p.low - c.low, 0) : 0);
  }
  let aTr = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let aPd = pdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  let aMd = mdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  const dxArr: number[] = [];
  for (let i = period; i < trArr.length; i++) {
    aTr = aTr - aTr / period + trArr[i];
    aPd = aPd - aPd / period + pdmArr[i];
    aMd = aMd - aMd / period + mdmArr[i];
    const pdi = aTr > 0 ? (aPd / aTr) * 100 : 0;
    const mdi = aTr > 0 ? (aMd / aTr) * 100 : 0;
    dxArr.push(pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0);
  }
  if (dxArr.length < period) return { adx: 25, plusDI: 25, minusDI: 25 };
  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
  let aTr2 = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let aPd2 = pdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  let aMd2 = mdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  for (let i = period; i < trArr.length; i++) {
    aTr2 = aTr2 - aTr2 / period + trArr[i];
    aPd2 = aPd2 - aPd2 / period + pdmArr[i];
    aMd2 = aMd2 - aMd2 / period + mdmArr[i];
  }
  return {
    adx: adxVal,
    plusDI: aTr2 > 0 ? (aPd2 / aTr2) * 100 : 0,
    minusDI: aTr2 > 0 ? (aMd2 / aTr2) * 100 : 0,
  };
}

function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3): { k: number; d: number } {
  if (candles.length < kPeriod + dPeriod) return { k: 50, d: 50 };
  const kArr: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const sl = candles.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...sl.map(c => c.high));
    const lo = Math.min(...sl.map(c => c.low));
    kArr.push(hi !== lo ? ((candles[i].close - lo) / (hi - lo)) * 100 : 50);
  }
  const dArr = ema(kArr, dPeriod);
  return { k: kArr[kArr.length - 1], d: dArr[dArr.length - 1] };
}

function bollinger(closes: number[], period = 20, mult = 2): { upper: number; mid: number; lower: number; pct: number } {
  if (closes.length < period) {
    const p = closes[closes.length - 1];
    return { upper: p * 1.002, mid: p, lower: p * 0.998, pct: 0.5 };
  }
  const s = closes.slice(-period);
  const mid = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper = mid + mult * std;
  const lower = mid - mult * std;
  const price = closes[closes.length - 1];
  return { upper, mid, lower, pct: upper !== lower ? Math.max(0, Math.min(1, (price - lower) / (upper - lower))) : 0.5 };
}

/** Aggregate 1m candles into higher timeframe candles */
function aggregateCandles(candles1m: Candle[], targetMinutes: number): Candle[] {
  if (targetMinutes <= 1) return candles1m;
  const result: Candle[] = [];
  for (let i = 0; i < candles1m.length; i += targetMinutes) {
    const group = candles1m.slice(i, i + targetMinutes);
    if (!group.length) continue;
    result.push({
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((s, c) => s + c.volume, 0),
    });
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
//  OTC MANIPULATION DETECTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detects OTC market manipulation patterns.
 * OTC pairs have synthetic price feeds controlled by the broker,
 * leading to abnormal wicks, sudden volatility spikes, and
 * stop-hunt patterns.
 */
function detectOTCManipulation(
  pairId: string,
  candles: Candle[],
  atrVal: number,
): OTCAnalysis {
  const isOTC = pairId.toLowerCase().includes("_otc");
  const flags: string[] = [];
  let score = 0;

  if (!isOTC || candles.length < 5) {
    return {
      isOTC,
      manipulationScore: 0,
      manipulationFlags: [],
      recommendedStrictness: "normal",
    };
  }

  const recent = candles.slice(-10);

  // ── Flag 1: Abnormal wick ratio (>70% of range is wick) ──
  let abnormalWickCount = 0;
  for (const c of recent) {
    const range = c.high - c.low || 0.000001;
    const body = Math.abs(c.close - c.open);
    const wicks = range - body;
    if (wicks / range > 0.70) abnormalWickCount++;
  }
  if (abnormalWickCount >= 3) {
    flags.push(`${abnormalWickCount}/10 candles with >70% wick ratio (stop-hunt pattern)`);
    score += 0.3;
  }

  // ── Flag 2: Sudden ATR spike (>3x recent average) ──
  const atrHistory: number[] = [];
  for (let i = 20; i <= candles.length; i += 5) {
    atrHistory.push(atr(candles.slice(0, i), 14));
  }
  const avgAtr = atrHistory.length > 0
    ? atrHistory.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, atrHistory.length)
    : atrVal;
  if (avgAtr > 0 && atrVal > avgAtr * 3) {
    flags.push(`ATR spike: current ${atrVal.toFixed(5)} vs avg ${avgAtr.toFixed(5)} (${(atrVal / avgAtr).toFixed(1)}x)`);
    score += 0.25;
  }

  // ── Flag 3: Consecutive opposing wicks (stop-hunt ladder) ──
  let opposingWicks = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const prevUpperWick = prev.high - Math.max(prev.open, prev.close);
    const prevLowerWick = Math.min(prev.open, prev.close) - prev.low;
    const currUpperWick = curr.high - Math.max(curr.open, curr.close);
    const currLowerWick = Math.min(curr.open, curr.close) - curr.low;

    // Upper wick followed by lower wick (or vice versa) = stop hunt
    if ((prevUpperWick > prevLowerWick * 2 && currLowerWick > currUpperWick * 2) ||
        (prevLowerWick > prevUpperWick * 2 && currUpperWick > currLowerWick * 2)) {
      opposingWicks++;
    }
  }
  if (opposingWicks >= 2) {
    flags.push(`${opposingWicks} stop-hunt wick pairs detected`);
    score += 0.25;
  }

  // ── Flag 4: Body-to-range ratio < 0.15 (indecision candles) ──
  let indecisionCount = 0;
  for (const c of recent.slice(-5)) {
    const range = c.high - c.low || 0.000001;
    const body = Math.abs(c.close - c.open);
    if (body / range < 0.15) indecisionCount++;
  }
  if (indecisionCount >= 3) {
    flags.push(`${indecisionCount}/5 recent candles are dojis (indecision)`);
    score += 0.15;
  }

  // ── Flag 5: Price reversal within single candle (>0.8 ATR swing) ──
  let reversalCandles = 0;
  for (const c of recent) {
    const range = c.high - c.low;
    if (atrVal > 0 && range > atrVal * 0.8) {
      const body = Math.abs(c.close - c.open);
      if (body / range < 0.3) reversalCandles++; // Large range but small body = reversal
    }
  }
  if (reversalCandles >= 2) {
    flags.push(`${reversalCandles} large-range reversal candles (manipulation)`);
    score += 0.2;
  }

  // Determine strictness
  let recommendedStrictness: "normal" | "strict" | "very_strict";
  if (score >= 0.6) {
    recommendedStrictness = "very_strict";
  } else if (score >= 0.3) {
    recommendedStrictness = "strict";
  } else {
    recommendedStrictness = "normal";
  }

  return {
    isOTC: true,
    manipulationScore: Math.min(1, score),
    manipulationFlags: flags,
    recommendedStrictness,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENTRY TIMING OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════

interface EntryTimingResult {
  optimal: boolean;
  score: number; // 0-100
  reasons: string[];
}

/**
 * Checks if NOW is a good time to enter a trade.
 * Returns optimal=true only when entry conditions are favorable.
 */
function checkEntryTiming(
  candles: Candle[],
  atrVal: number,
  direction: "up" | "down",
  zones: SRZone[],
): EntryTimingResult {
  const reasons: string[] = [];
  let score = 50; // Start neutral

  if (candles.length < 5) {
    return { optimal: false, score: 30, reasons: ["Insufficient candles for entry timing"] };
  }

  const curr = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low || 0.000001;
  const bodyRatio = body / range;

  // ── Check 1: Current candle already extended? ──
  const moveFromOpen = Math.abs(curr.close - curr.open);
  if (atrVal > 0 && moveFromOpen > atrVal * 0.6) {
    score -= 25;
    reasons.push(`Candle already moved ${(moveFromOpen / atrVal).toFixed(1)}×ATR from open — too extended`);
  } else {
    score += 10;
    reasons.push(`Candle movement within optimal range`);
  }

  // ── Check 2: Is this a good entry candle? ──
  // Strong body candle in signal direction = good entry
  const isBullish = curr.close > curr.open;
  const isBearish = curr.close < curr.open;

  if (direction === "up" && isBullish && bodyRatio > 0.5) {
    score += 15;
    reasons.push("Bullish entry candle with strong body");
  } else if (direction === "down" && isBearish && bodyRatio > 0.5) {
    score += 15;
    reasons.push("Bearish entry candle with strong body");
  } else if (bodyRatio < 0.2) {
    score -= 10;
    reasons.push("Doji/indecision candle — poor entry");
  }

  // ── Check 3: Rejection wick in signal direction ──
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;

  if (direction === "up" && lowerWick > body * 1.5 && lowerWick > range * 0.4) {
    score += 20;
    reasons.push("Bullish rejection wick (hammer-like)");
  } else if (direction === "down" && upperWick > body * 1.5 && upperWick > range * 0.4) {
    score += 20;
    reasons.push("Bearish rejection wick (shooting star-like)");
  }

  // ── Check 4: Near S/R zone with confirmation ──
  for (const z of zones) {
    const dist = Math.abs(curr.close - z.level);
    if (atrVal > 0 && dist < atrVal * 0.3) {
      if (direction === "up" && z.type === "support") {
        score += 15;
        reasons.push(`At support zone ${z.level.toFixed(5)} — good for long`);
      } else if (direction === "down" && z.type === "resistance") {
        score += 15;
        reasons.push(`At resistance zone ${z.level.toFixed(5)} — good for short`);
      }
    }
  }

  // ── Check 5: Momentum confirmation ──
  const prevBody = Math.abs(prev.close - prev.open);
  if (direction === "up" && curr.close > prev.close && curr.close > curr.open) {
    score += 10;
    reasons.push("Momentum confirms upward direction");
  } else if (direction === "down" && curr.close < prev.close && curr.close < curr.open) {
    score += 10;
    reasons.push("Momentum confirms downward direction");
  }

  // ── Check 6: Wick-to-body ratio quality ──
  if (bodyRatio > 0.6) {
    score += 10;
    reasons.push("Strong body candle (high conviction)");
  } else if (bodyRatio < 0.3) {
    score -= 15;
    reasons.push("Weak body — low conviction candle");
  }

  const optimal = score >= 40; // Lower threshold so signals fire more often

  return {
    optimal,
    score: Math.max(0, Math.min(100, score)),
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE 1: TITAN X — Deep Market Structure (84.3% weight)
// ═══════════════════════════════════════════════════════════════════════

function detectSwings(candles: Candle[], pivotWidth = 2): Swing[] {
  const swings: Swing[] = [];
  const n = candles.length;
  for (let i = pivotWidth; i < n - pivotWidth; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= pivotWidth; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, price: candles[i].high, type: "high" });
    if (isLow) swings.push({ index: i, price: candles[i].low, type: "low" });
  }
  return swings;
}

/** Score trend per timeframe: +2 strong up, +1 weak up, 0 range, -1/-2 down */
function perTimeframeTrend(candles: Candle[]): number {
  if (candles.length < 10) return 0;
  const swings = detectSwings(candles, 2);
  const highs = swings.filter(s => s.type === "high").slice(-4);
  const lows = swings.filter(s => s.type === "low").slice(-4);

  let hh = 0, hl = 0, ll = 0, lh = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price) hh++;
    else lh++;
  }
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price > lows[i - 1].price) hl++;
    else ll++;
  }

  const bullStructure = hh >= 1 && hl >= 1 && ll === 0;
  const bearStructure = ll >= 1 && lh >= 1 && hh === 0;

  // EMA alignment as tiebreaker
  const closes = candles.map(c => c.close);
  const ema10 = emaLast(closes, Math.min(10, closes.length - 1));
  const ema21 = emaLast(closes, Math.min(21, closes.length - 1));
  const ema50 = closes.length >= 50 ? emaLast(closes, 50) : ema21;
  const emaAlignedBull = ema10 > ema21 && ema21 > ema50;
  const emaAlignedBear = ema10 < ema21 && ema21 < ema50;

  // Price vs EMA50
  const price = closes[closes.length - 1];
  const aboveEma50 = price > ema50;

  if (bullStructure && emaAlignedBull) return 2;
  if (bullStructure || (hh >= 1 && aboveEma50)) return 1;
  if (bearStructure && emaAlignedBear) return -2;
  if (bearStructure || (ll >= 1 && !aboveEma50)) return -1;
  return 0;
}

function engineTitanX(
  candlesByTf: Record<string, Candle[]>,
  zones: SRZone[],
  currentPrice: number,
  atrVal: number,
): EngineResult {
  const reasons: string[] = [];

  // Multi-timeframe trend analysis
  const tfWeights: Record<string, number> = { "15m": 3.0, "5m": 2.0, "2m": 1.5, "1m": 1.0 };
  let weightedSum = 0, totalWeight = 0;

  for (const [tf, weight] of Object.entries(tfWeights)) {
    const c = candlesByTf[tf];
    if (!c || c.length < 6) continue;
    const score = perTimeframeTrend(c);
    weightedSum += score * weight;
    totalWeight += weight;
    if (score !== 0) {
      const dir = score > 0 ? "uptrend" : "downtrend";
      const strength = Math.abs(score) >= 2 ? "strong structural" : "weak/pullback";
      reasons.push(`${tf} ${strength} ${dir}`);
    }
  }

  const trendScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // S/R zone proximity analysis
  let nearestZone: SRZone | null = null;
  let nearestDist = Infinity;
  for (const z of zones) {
    const d = Math.abs(z.level - currentPrice);
    if (d < nearestDist) { nearestDist = d; nearestZone = z; }
  }

  const distAtr = atrVal > 0 ? nearestDist / atrVal : 999;
  if (distAtr < 0.3 && nearestZone) {
    reasons.push(`Price at ${nearestZone.type} zone (${nearestZone.level.toFixed(5)})`);
  }

  // Structure score: 0-100
  let structureScore = 55;
  if (Math.abs(trendScore) >= 1.5) structureScore = 90;
  else if (Math.abs(trendScore) >= 1) structureScore = 75;
  else if (Math.abs(trendScore) >= 0.5) structureScore = 65;
  else if (Math.abs(trendScore) > 0) structureScore = 55;

  // Zone alignment bonus
  if (nearestZone && distAtr < 0.5) {
    if (trendScore > 0 && nearestZone.type === "support") structureScore += 15;
    else if (trendScore < 0 && nearestZone.type === "resistance") structureScore += 15;
  }

  structureScore = Math.min(100, structureScore);

  const direction = trendScore > 0.15 ? "up" : trendScore < -0.15 ? "down" : "neutral";
  const passed = structureScore >= 45 && direction !== "neutral";

  return {
    name: "TITAN X",
    direction,
    confidence: structureScore,
    weight: 0.843,
    passed,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE 2: NEXUS FUSION — Multi-Source Intelligence (88.2% weight)
// ═══════════════════════════════════════════════════════════════════════

function engineNexusFusion(
  candles: Candle[],
  ind: LiveMarketState["indicators"],
): EngineResult {
  const reasons: string[] = [];
  let bullVotes = 0, bearVotes = 0;

  // ── RSI ──
  if (ind.rsi14 < 35) { bullVotes += 2; reasons.push(`RSI oversold (${ind.rsi14.toFixed(0)})`); }
  else if (ind.rsi14 < 45) { bullVotes += 1; reasons.push(`RSI low (${ind.rsi14.toFixed(0)})`); }
  else if (ind.rsi14 > 65) { bearVotes += 2; reasons.push(`RSI overbought (${ind.rsi14.toFixed(0)})`); }
  else if (ind.rsi14 > 55) { bearVotes += 1; reasons.push(`RSI high (${ind.rsi14.toFixed(0)})`); }

  // ── MACD ──
  if (ind.macdHist > 0 && ind.macdCross === "bullish") { bullVotes += 2; reasons.push("MACD bullish crossover"); }
  else if (ind.macdHist > 0) { bullVotes += 1; reasons.push("MACD positive"); }
  else if (ind.macdHist < 0 && ind.macdCross === "bearish") { bearVotes += 2; reasons.push("MACD bearish crossover"); }
  else if (ind.macdHist < 0) { bearVotes += 1; reasons.push("MACD negative"); }

  // ── Stochastic ──
  if (ind.stochK < 20 && ind.stochK > ind.stochD) { bullVotes += 2; reasons.push(`Stoch oversold+cross (${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)})`); }
  else if (ind.stochK < 30) { bullVotes += 1; reasons.push(`Stoch low (${ind.stochK.toFixed(0)})`); }
  else if (ind.stochK > 80 && ind.stochK < ind.stochD) { bearVotes += 2; reasons.push(`Stoch overbought+cross (${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)})`); }
  else if (ind.stochK > 70) { bearVotes += 1; reasons.push(`Stoch high (${ind.stochK.toFixed(0)})`); }

  // ── Bollinger Bands ──
  if (ind.bbPct < 0.1) { bullVotes += 1; reasons.push("Price below lower BB (oversold)"); }
  else if (ind.bbPct > 0.9) { bearVotes += 1; reasons.push("Price above upper BB (overbought)"); }

  // ── ADX ──
  const adxStrong = ind.adx > 25;
  if (adxStrong) {
    if (ind.plusDI > ind.minusDI) { bullVotes += 1; reasons.push(`ADX strong bullish (+DI > -DI, ADX ${ind.adx.toFixed(0)})`); }
    else { bearVotes += 1; reasons.push(`ADX strong bearish (-DI > +DI, ADX ${ind.adx.toFixed(0)})`); }
  } else {
    reasons.push(`ADX weak (${ind.adx.toFixed(0)}) — no trend confirmation`);
  }

  // ── EMA Stack ──
  if (ind.emaStack === "bull_stack") { bullVotes += 2; reasons.push("EMA bull stack (10>21>50)"); }
  else if (ind.emaStack === "bear_stack") { bearVotes += 2; reasons.push("EMA bear stack (10<21<50)"); }

  // Calculate confidence based on agreement strength
  const totalVotes = bullVotes + bearVotes;
  const agreement = totalVotes > 0 ? Math.abs(bullVotes - bearVotes) / totalVotes : 0;
  const confidence = Math.round(50 + agreement * 50);

  const direction = bullVotes > bearVotes ? "up" : bearVotes > bullVotes ? "down" : "neutral";
  const passed = confidence >= 45 && direction !== "neutral" && (bullVotes >= 2 || bearVotes >= 2);

  reasons.push(`Votes: bull=${bullVotes} bear=${bearVotes} → ${direction}`);

  return {
    name: "NEXUS FUSION",
    direction,
    confidence,
    weight: 0.882,
    passed,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE 3: APEX VISION — Macro & Sentiment Scan (92.7% weight)
// ═══════════════════════════════════════════════════════════════════════

function engineApexVision(
  candles: Candle[],
  ind: LiveMarketState["indicators"],
  volume: LiveMarketState["volume"],
  sessionBias: LiveMarketState["sessionBias"],
  sessionName: string,
  atrVal: number,
): EngineResult {
  const reasons: string[] = [];
  let score = 50;

  // ── Session Time Analysis ──
  const now = new Date();
  const hour = now.getUTCHours();

  // London-NY overlap (13:00-16:00 UTC) = best volatility
  if (hour >= 13 && hour <= 16) {
    score += 15;
    reasons.push("London-NY overlap (high liquidity)");
  }
  // Asian session (00:00-08:00 UTC) = lower volatility
  else if (hour >= 0 && hour < 8) {
    score -= 10;
    reasons.push("Asian session (lower volatility)");
  }
  // NY session (13:00-21:00 UTC)
  else if (hour >= 13 && hour <= 21) {
    score += 10;
    reasons.push("NY session (active)");
  }

  // ── Volume Analysis ──
  if (volume.spike) {
    score += 10;
    reasons.push("Volume spike detected");
  }
  if (volume.trend === "rising") {
    score += 5;
    reasons.push("Volume trending up");
  } else if (volume.trend === "falling") {
    score -= 5;
    reasons.push("Volume trending down");
  }

  // ── Volatility Regime ──
  const candles15m = aggregateCandles(candles, 15);
  const adxResult = adx(candles15m.length >= 28 ? candles15m : candles, 14);
  const isTrending = adxResult.adx > 22;

  // ATR relative to price
  const atrPct = ind.ema50 > 0 ? atrVal / ind.ema50 : 0;
  if (atrPct > 0.008) {
    score -= 10;
    reasons.push("High volatility — manipulation risk");
  } else if (atrPct > 0.002 && atrPct < 0.006) {
    score += 10;
    reasons.push("Optimal volatility range");
  }

  // ── Session Bias Alignment ──
  if (sessionBias !== "neutral") {
    score += 5;
    reasons.push(`Session bias: ${sessionBias}`);
  }

  // ── Trend confirmation from higher TF ──
  if (isTrending) {
    score += 10;
    reasons.push(`Higher TF trending (ADX ${adxResult.adx.toFixed(0)})`);
  } else {
    reasons.push(`Higher TF ranging (ADX ${adxResult.adx.toFixed(0)})`);
  }

  score = Math.max(0, Math.min(100, score));

  const direction = score >= 52 ? "up" : score <= 48 ? "down" : "neutral";
  const passed = score >= 50 || score <= 50; // Always pass — this engine provides context, not veto

  return {
    name: "APEX VISION",
    direction,
    confidence: score,
    weight: 0.927,
    passed,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE 4: QUANTUM STRIKE — Quantitative Signal Engine (96.8% weight)
// ═══════════════════════════════════════════════════════════════════════

function engineQuantumStrike(
  candles: Candle[],
  zones: SRZone[],
  atrVal: number,
  regime: Regime,
): EngineResult {
  const reasons: string[] = [];
  let bullScore = 0, bearScore = 0;

  if (candles.length < 5) {
    return { name: "QUANTUM STRIKE", direction: "neutral", confidence: 30, weight: 0.968, passed: false, reasons: ["Insufficient data"] };
  }

  const curr = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low || 0.00001;
  const bodyRatio = body / range;

  // ── Candle Pattern Detection ──

  // Engulfing
  const prevBody = Math.abs(prev.close - prev.open);
  if (prev.close < prev.open && curr.close > curr.open && body > prevBody * 1.1) {
    bullScore += 30;
    reasons.push("Bullish engulfing pattern");
  } else if (prev.close > prev.open && curr.close < curr.open && body > prevBody * 1.1) {
    bearScore += 30;
    reasons.push("Bearish engulfing pattern");
  }

  // Pin Bar / Hammer
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const avgBody = candles.slice(-5, -1).reduce((s, x) => s + Math.abs(x.close - x.open), 0) / 4;

  if (lowerWick > body * 2.5 && lowerWick > range * 0.6 && body < avgBody * 0.8) {
    bullScore += 25;
    reasons.push("Bullish pin bar (hammer)");
  } else if (upperWick > body * 2.5 && upperWick > range * 0.6 && body < avgBody * 0.8) {
    bearScore += 25;
    reasons.push("Bearish pin bar (shooting star)");
  }

  // Doji with direction bias
  if (body / range < 0.15 && body < avgBody * 0.4) {
    if (upperWick > lowerWick * 2.5 && upperWick > range * 0.5) {
      bearScore += 15;
      reasons.push("Bearish doji (upper shadow dominant)");
    } else if (lowerWick > upperWick * 2.5 && lowerWick > range * 0.5) {
      bullScore += 15;
      reasons.push("Bullish doji (lower shadow dominant)");
    }
  }

  // Three White Soldiers / Three Black Crows
  if (candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];

    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open &&
        c2.close > c1.close && c3.close > c2.close) {
      bullScore += 20;
      reasons.push("Three white soldiers");
    } else if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open &&
               c2.close < c1.close && c3.close < c2.close) {
      bearScore += 20;
      reasons.push("Three black crows");
    }
  }

  // Morning/Evening Star (3-candle reversal)
  if (candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const c2Body = Math.abs(c2.close - c2.open);
    const c2Range = c2.high - c2.low || 0.00001;

    // Morning Star: bearish, small body, bullish
    if (c1.close < c1.open && c2Body / c2Range < 0.2 && c3.close > c3.open && c3.close > (c1.open + c1.close) / 2) {
      bullScore += 25;
      reasons.push("Morning star reversal");
    }
    // Evening Star: bullish, small body, bearish
    if (c1.close > c1.open && c2Body / c2Range < 0.2 && c3.close < c3.open && c3.close < (c1.open + c1.close) / 2) {
      bearScore += 25;
      reasons.push("Evening star reversal");
    }
  }

  // ── Wick Analysis ──
  // Long wick rejection at S/R
  for (const z of zones) {
    const dist = atrVal > 0 ? Math.abs(curr.close - z.level) / atrVal : 999;
    if (dist < 0.3) {
      if (z.type === "support" && lowerWick > body * 1.5) {
        bullScore += 20;
        reasons.push(`Rejection at support ${z.level.toFixed(5)}`);
      } else if (z.type === "resistance" && upperWick > body * 1.5) {
        bearScore += 20;
        reasons.push(`Rejection at resistance ${z.level.toFixed(5)}`);
      }
    }
  }

  // ── Body Ratio Quality ──
  if (bodyRatio > 0.6) {
    const dir = curr.close > curr.open ? "bull" : "bear";
    if (dir === "bull") bullScore += 10;
    else bearScore += 10;
    reasons.push(`Strong body candle (${(bodyRatio * 100).toFixed(0)}% body ratio)`);
  }

  // ── Regime adjustment ──
  if (regime === "VOLATILE_CHOPPY") {
    bullScore = Math.round(bullScore * 0.7);
    bearScore = Math.round(bearScore * 0.7);
    reasons.push("Choppy regime — pattern confidence reduced");
  }

  const totalScore = bullScore + bearScore;
  const confidence = Math.min(100, Math.round(50 + (totalScore / 60) * 50));
  const direction = bullScore > bearScore ? "up" : bearScore > bullScore ? "down" : "neutral";
  const passed = direction !== "neutral" && totalScore >= 10;

  return {
    name: "QUANTUM STRIKE",
    direction,
    confidence,
    weight: 0.968,
    passed,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE 5: OMEGA QX — High Probability Gate (98.5% weight)
// ═══════════════════════════════════════════════════════════════════════

function engineOmegaQX(
  engines: EngineResult[],
  entryTiming: EntryTimingResult,
  otcAnalysis: OTCAnalysis,
): EngineResult {
  const reasons: string[] = [];

  // Count how many engines agree on direction
  const passedEngines = engines.filter(e => e.passed && e.direction !== "neutral");

  // Weighted voting: each engine's vote = confidence × weight
  let upWeight = 0, downWeight = 0;
  for (const e of passedEngines) {
    const vote = e.confidence * e.weight;
    if (e.direction === "up") upWeight += vote;
    else if (e.direction === "down") downWeight += vote;
  }
  const upCount = passedEngines.filter(e => e.direction === "up").length;
  const downCount = passedEngines.filter(e => e.direction === "down").length;
  // Use weighted direction when counts are tied, otherwise majority count
  let majorityDir: "up" | "down" | "neutral";
  if (upCount > downCount) majorityDir = "up";
  else if (downCount > upCount) majorityDir = "down";
  else if (upWeight > downWeight) majorityDir = "up";
  else if (downWeight > upWeight) majorityDir = "down";
  else majorityDir = "neutral";

  // Count agreeing engines
  const agreeingCount = majorityDir === "up" ? upCount : downCount;

  // ── Gate 1: Minimum engine agreement ──
  const minEngines = otcAnalysis.recommendedStrictness === "very_strict" ? 3
    : otcAnalysis.recommendedStrictness === "strict" ? 2
    : 2;

  if (agreeingCount < minEngines) {
    reasons.push(`Only ${agreeingCount}/${minEngines} engines agree — need more consensus`);
    return {
      name: "OMEGA QX",
      direction: "neutral",
      confidence: 30 + agreeingCount * 10,
      weight: 0.985,
      passed: false,
      reasons,
    };
  }

  reasons.push(`${agreeingCount} engines agree on ${majorityDir}`);

  // ── Entry timing is informational only (not a gate) ──
  if (entryTiming.optimal) {
    reasons.push(`Entry timing optimal (score ${entryTiming.score})`);
  } else {
    reasons.push(`Entry timing acceptable (score ${entryTiming.score}) — signal still fires`);
  }

  // ── OTC manipulation is a penalty, not a veto ──
  if (otcAnalysis.isOTC && otcAnalysis.manipulationScore > 0.7) {
    reasons.push(`⚠ OTC manipulation detected (${(otcAnalysis.manipulationScore * 100).toFixed(0)}%) — confidence reduced`);
  }

  // ── Calculate final confidence ──
  // Weighted average of agreeing engines
  let weightedSum = 0, totalWeight = 0;
  for (const e of passedEngines) {
    if (e.direction === majorityDir) {
      weightedSum += e.confidence * e.weight;
      totalWeight += e.weight;
    }
  }
  const baseConfidence = totalWeight > 0 ? weightedSum / totalWeight : 50;

  // Bonuses
  let confidence = baseConfidence;
  if (agreeingCount >= 4) confidence += 12; // Strong consensus bonus
  if (agreeingCount >= 3) confidence += 5; // Moderate consensus bonus
  if (entryTiming.score >= 60) confidence += 8; // Good entry bonus
  if (otcAnalysis.isOTC && otcAnalysis.manipulationScore < 0.2) confidence += 5; // Clean OTC bonus

  // Penalties
  if (otcAnalysis.isOTC && otcAnalysis.manipulationScore > 0.5) confidence -= 8; // OTC manipulation penalty
  if (agreeingCount < 3) confidence -= 3; // Weak consensus penalty

  confidence = Math.max(40, Math.min(98, Math.round(confidence)));

  return {
    name: "OMEGA QX",
    direction: majorityDir,
    confidence,
    weight: 0.985,
    passed: true,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE 6: QUOTEX MASTER — Final Intelligence Fusion (90.2% weight)
// ═══════════════════════════════════════════════════════════════════════

function engineQuotexMaster(
  engines: EngineResult[],
  otcAnalysis: OTCAnalysis,
  regime: Regime,
): EngineResult {
  const reasons: string[] = [];

  // All engines must have run
  if (engines.length < 4) {
    return {
      name: "QUOTEX MASTER",
      direction: "neutral",
      confidence: 20,
      weight: 0.902,
      passed: false,
      reasons: ["Insufficient engine data"],
    };
  }

  // Get OMEGA QX result (the gatekeeper)
  const omega = engines.find(e => e.name === "OMEGA QX");
  if (!omega || !omega.passed) {
    reasons.push("OMEGA QX gate did not pass");
    return {
      name: "QUOTEX MASTER",
      direction: omega?.direction ?? "neutral",
      confidence: omega?.confidence ?? 20,
      weight: 0.902,
      passed: false,
      reasons,
    };
  }

  // Weighted fusion of all passed engines
  const passedEngines = engines.filter(e => e.passed && e.direction !== "neutral");
  let weightedSum = 0, totalWeight = 0;
  let upWeight = 0, downWeight = 0;

  for (const e of passedEngines) {
    weightedSum += e.confidence * e.weight;
    totalWeight += e.weight;
    if (e.direction === "up") upWeight += e.confidence * e.weight;
    else if (e.direction === "down") downWeight += e.confidence * e.weight;
    reasons.push(`${e.name}: ${e.direction} (${e.confidence.toFixed(0)}% × ${(e.weight * 100).toFixed(0)}%)`);
  }

  // If OMEGA QX is neutral, use weighted direction from all engines as fallback
  let finalDirection: "up" | "down" | "neutral" = omega.direction;
  if (finalDirection === "neutral" && passedEngines.length >= 2) {
    if (upWeight > downWeight * 1.1) finalDirection = "up";
    else if (downWeight > upWeight * 1.1) finalDirection = "down";
  }

  let finalConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // ── Regime adjustment ──
  if (regime === "TRENDING") {
    finalConfidence *= 1.05;
    reasons.push("Regime bonus: trending (+5%)");
  } else if (regime === "VOLATILE_CHOPPY") {
    finalConfidence *= 0.9;
    reasons.push("Regime penalty: choppy (-10%)");
  }

  // ── OTC adjustment ──
  if (otcAnalysis.isOTC) {
    const otcPenalty = otcAnalysis.manipulationScore * 15;
    finalConfidence -= otcPenalty;
    reasons.push(`OTC manipulation penalty (-${otcPenalty.toFixed(0)}%)`);
  }

  // ── Engine agreement bonus ──
  const allAgree = passedEngines.every(e => e.direction === omega.direction);
  if (allAgree && passedEngines.length >= 4) {
    finalConfidence += 8;
    reasons.push("Full engine agreement bonus (+8%)");
  }

  finalConfidence = Math.max(15, Math.min(98, Math.round(finalConfidence)));

  // Determine final grade
  let grade: SignalGrade;
  if (finalConfidence >= 80) grade = "STRONG";
  else if (finalConfidence >= 60) grade = "MODERATE";
  else grade = "WEAK";

  return {
    name: "QUOTEX MASTER",
    direction: finalDirection,
    confidence: finalConfidence,
    weight: 0.902,
    passed: omega.passed || (finalDirection !== "neutral" && passedEngines.length >= 2),
    reasons: [
      `Final fusion: ${finalDirection} @ ${finalConfidence}% (${grade})`,
      ...reasons,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  REGIME CLASSIFIER (internal use)
// ═══════════════════════════════════════════════════════════════════════

function classifyRegime(candles1m: Candle[], candles5m: Candle[]): { regime: Regime; reasons: string[] } {
  const reasons: string[] = [];

  const currentAtr = atr(candles1m, 14);
  const atrHistory: number[] = [];
  for (let i = 20; i <= candles1m.length; i++) {
    atrHistory.push(atr(candles1m.slice(0, i), 14));
  }
  const avgAtr = atrHistory.length > 0
    ? atrHistory.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, atrHistory.length)
    : currentAtr;
  const atrRatio = avgAtr > 0 ? currentAtr / avgAtr : 1;
  const volState: VolState = atrRatio > 2.2 ? "high" : atrRatio < 0.5 ? "low" : "normal";
  reasons.push(`Volatility: ${volState} (ATR ratio ${atrRatio.toFixed(2)})`);

  const adxResult = adx(candles5m.length >= 28 ? candles5m : candles1m, 14);
  const isTrending = adxResult.adx > 22;
  reasons.push(`ADX ${adxResult.adx.toFixed(1)} → ${isTrending ? "trending" : "ranging"}`);

  let regime: Regime;
  if (volState === "high") regime = "VOLATILE_CHOPPY";
  else if (isTrending) regime = "TRENDING";
  else regime = "RANGING";

  reasons.push(`Regime: ${regime}`);
  return { regime, reasons };
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT — v7 6-Engine Architecture
// ═══════════════════════════════════════════════════════════════════════

export function generateSignal(
  _pairId: string,
  mkt: LiveMarketState,
): SignalResult {
  const { candles, price, sr, indicators: ind, patterns: _oldPatterns, volume } = mkt;

  // ── Aggregate 1m candles into higher timeframes ──
  const candles2m = aggregateCandles(candles, 2);
  const candles5m = aggregateCandles(candles, 5);
  const candles15m = aggregateCandles(candles, 15);
  const candlesByTf: Record<string, Candle[]> = { "1m": candles, "2m": candles2m, "5m": candles5m, "15m": candles15m };

  const atrVal = atr(candles, 14);

  // ── OTC Analysis ──
  const otcAnalysis = detectOTCManipulation(_pairId, candles, atrVal);

  // ── Regime Classification ──
  const { regime, reasons: regimeReasons } = classifyRegime(candles, candles5m);

  // ── S/R Zones (for engine use) ──
  const zones: SRZone[] = [];
  const source = candles15m.length >= 10 ? candles15m : candles5m;
  if (source.length >= 10) {
    const swings = detectSwings(source, 2);
    const currentAtr = atr(source, 14);
    const tolerance = currentAtr * 0.5;
    const rawLevels = swings.map(s => s.price).sort((a, b) => a - b);
    let cluster: number[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const level = cluster.reduce((a, b) => a + b, 0) / cluster.length;
      zones.push({
        level,
        touchCount: cluster.length,
        strength: Math.min(1, cluster.length / 5),
        type: level < price ? "support" : "resistance",
      });
      cluster = [];
    };
    for (const lv of rawLevels) {
      if (cluster.length === 0 || Math.abs(lv - cluster[cluster.length - 1]) < tolerance) {
        cluster.push(lv);
      } else {
        flush();
        cluster.push(lv);
      }
    }
    flush();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  RUN ALL 6 ENGINES
  // ═══════════════════════════════════════════════════════════════════════

  // Engine 1: TITAN X
  const titanX = engineTitanX(candlesByTf, zones, price, atrVal);

  // Engine 2: NEXUS FUSION
  const nexusFusion = engineNexusFusion(candles, ind);

  // Engine 3: APEX VISION
  const apexVision = engineApexVision(candles, ind, volume, mkt.sessionBias, mkt.sessionName, atrVal);

  // Engine 4: QUANTUM STRIKE
  const quantumStrike = engineQuantumStrike(candles, zones, atrVal, regime);

  // Engine 5: OMEGA QX (needs entry timing first)
  // Determine preliminary direction from first 4 engines
  const preliminaryEngines = [titanX, nexusFusion, apexVision, quantumStrike];
  const passedEngines = preliminaryEngines.filter(e => e.passed && e.direction !== "neutral");
  const upCount = passedEngines.filter(e => e.direction === "up").length;
  const downCount = passedEngines.filter(e => e.direction === "down").length;
  const preliminaryDir = upCount > downCount ? "up" : downCount > upCount ? "down" : "neutral";

  // Entry timing check
  const entryTiming = preliminaryDir !== "neutral"
    ? checkEntryTiming(candles, atrVal, preliminaryDir, zones)
    : { optimal: false, score: 30, reasons: ["No directional consensus"] };

  // Run OMEGA QX
  const omegaQX = engineOmegaQX(preliminaryEngines, entryTiming, otcAnalysis);

  // Engine 6: QUOTEX MASTER
  const allEngines = [titanX, nexusFusion, apexVision, quantumStrike, omegaQX];
  const quotexMaster = engineQuotexMaster(allEngines, otcAnalysis, regime);

  // ═══════════════════════════════════════════════════════════════════════
  //  BUILD OUTPUT
  // ═══════════════════════════════════════════════════════════════════════

  // Final direction from QUOTEX MASTER
  const finalDirection = quotexMaster.passed ? quotexMaster.direction : "neutral";
  const signalDirection: SignalDirection = finalDirection === "up" ? "BUY" : finalDirection === "down" ? "SELL" : "SKIP";

  // Skip reason
  let skipReason = "";
  if (signalDirection === "SKIP") {
    if (!omegaQX.passed) {
      skipReason = omegaQX.reasons[0] ?? "OMEGA QX gate did not pass";
    } else {
      skipReason = "QUOTEX MASTER fusion did not pass threshold";
    }
  }

  // Grade from QUOTEX MASTER
  const grade: SignalGrade = quotexMaster.confidence >= 80 ? "STRONG"
    : quotexMaster.confidence >= 60 ? "MODERATE"
    : "WEAK";

  // Confidence from QUOTEX MASTER (no artificial floor)
  const confidence = quotexMaster.confidence;

  // Factors for UI (backward compat)
  const factors: SignalFactor[] = [];
  for (const e of allEngines) {
    if (e.passed && e.direction !== "neutral") {
      factors.push({
        label: `${e.name}: ${e.reasons[0] ?? e.direction}`,
        direction: e.direction === "up" ? "BUY" : "SELL",
        weight: e.confidence * e.weight / 50,
        category: e.name === "TITAN X" ? "trend" : e.name === "NEXUS FUSION" ? "oscillator" : "pattern",
      });
    }
  }

  const highWeightCount = factors.filter(f => f.weight >= 2.0).length;
  const confirmations = allEngines.filter(e => e.passed).length;

  // Key reason (from QUOTEX MASTER top reason)
  const keyReason = quotexMaster.reasons[0] ?? `${signalDirection} confluence (${regime})`;

  // Pattern names for UI badges
  const patternNames: string[] = [];
  for (const e of allEngines) {
    if (e.passed && e.direction !== "neutral") {
      const emoji = e.confidence >= 80 ? " ⚡" : "";
      patternNames.push(`${e.name}${emoji}`);
    }
  }

  // Support / Resistance
  const supportZone = zones.filter(z => z.type === "support").sort((a, b) => b.level - a.level)[0];
  const resistanceZone = zones.filter(z => z.type === "resistance").sort((a, b) => a.level - b.level)[0];
  const support = supportZone?.level ?? sr.support;
  const resistance = resistanceZone?.level ?? sr.resistance;

  return {
    direction: signalDirection,
    grade,
    confidence,
    skipReason,
    keyReason: `[${regime}] ${keyReason}`,
    factors,
    highWeightCount,
    confirmations,
    support,
    resistance,
    currentPrice: price,
    rsi: ind.rsi14,
    stochK: ind.stochK,
    stochD: ind.stochD,
    adx: ind.adx,
    macdDir: ind.macdHist >= 0 ? "bullish" : "bearish",
    bbPct: ind.bbPct,
    patternNames,
    // v6 additions
    regime,
    compositeScore: quotexMaster.confidence,
    thresholdUsed: 60,
    // v7 additions
    engineResults: allEngines,
    otcAnalysis,
    manipulationScore: otcAnalysis.manipulationScore,
  };
}
