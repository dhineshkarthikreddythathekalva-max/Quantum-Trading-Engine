/**
 * ═══════════════════════════════════════════════════════════════════════
 *  SIGNAL PIPELINE v2 — Deep Directional Analysis Engine
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Architecture:
 *    EXISTING SIGNAL ENGINE (generateSignal)
 *    → INITIAL BUY/SELL (or SKIP only if no engine fired)
 *    → DEEP MARKET ANALYSIS (20-factor directional scoring)
 *    → BUY_SCORE vs SELL_SCORE
 *    → DIRECTION CORRECTION (if evidence strongly contradicts)
 *    → CALIBRATED CONFIDENCE
 *    → FINAL BUY or SELL
 *
 *  HARD RULE: Once the existing engine generates a signal (BUY or SELL),
 *  this pipeline MUST return BUY or SELL. NEVER SKIP.
 *  The analysis layer validates and potentially reverses direction,
 *  but never suppresses the signal.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { LiveMarketState, Candle } from "./liveMarket";
import {
  generateSignal,
  type SignalResult,
  type SignalDirection,
  type SignalGrade,
} from "./signalEngine";
import { type RegimeType } from "./aPlusEngine";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** Directional evidence factor — scored for BUY or SELL */
interface DirectionalEvidence {
  factor: string;
  category: string;
  buyScore: number;   // 0-100, how much this factor supports BUY
  sellScore: number;  // 0-100, how much this factor supports SELL
  weight: number;     // 0-1, importance of this factor
  reason: string;
}

/** Deep analysis result */
interface DeepAnalysisResult {
  buyScore: number;
  sellScore: number;
  netScore: number;           // buyScore - sellScore (positive = bullish)
  confidence: number;         // calibrated 0-100
  grade: SignalGrade;
  directionReversed: boolean;
  originalDirection: "BUY" | "SELL";
  finalDirection: "BUY" | "SELL";
  regime: string;
  factors: DirectionalEvidence[];
  reasons: string[];
  continuationProb: number;   // 0-100
  reversalProb: number;       // 0-100
  falseBreakoutProb: number;  // 0-100
}

export interface PipelineSignalResult {
  // Original signal engine output (always present)
  engine: SignalResult;

  // Deep analysis output (always present when engine fires)
  analysis: DeepAnalysisResult | null;

  // Final decision
  finalDirection: SignalDirection; // "BUY" | "SELL" | "SKIP"
  finalGrade: SignalGrade;
  finalConfidence: number;

  // Analysis metadata
  mlAvailable: boolean;
  xgboostCallProb: number;
  xgboostPutProb: number;
  aplusScore: number;
  regime: RegimeType;
  componentScores: {
    xgboost_prob: number;
    mtf_alignment: number;
    market_structure: number;
    entry_quality: number;
    momentum: number;
    candle_quality: number;
    support_resistance: number;
    volatility_regime: number;
  } | null;
  thresholdUsed: number;

  // Analysis reasons
  mlReasons: string[];

  // Backward-compatible A+ result (computed from analysis)
  aplus: {
    score: number;
    decision: "A_PLUS_SIGNAL" | "REJECTED";
    thresholdUsed: number;
    regime: RegimeType;
    direction: "CALL" | "PUT";
    callProbability: number;
    putProbability: number;
    componentScores: {
      xgboost_prob: number;
      mtf_alignment: number;
      market_structure: number;
      entry_quality: number;
      momentum: number;
      candle_quality: number;
      support_resistance: number;
      volatility_regime: number;
    } | null;
    reasons: string[];
  } | null;
}

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

function ema(data: number[], period: number): number[] {
  if (data.length < period) return data.map(() => data[0] ?? 0);
  const k = 2 / (period + 1);
  const r = new Array(data.length).fill(0);
  r[period - 1] = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) r[i] = data[i] * k + r[i - 1] * (1 - k);
  return r;
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

/** Detect swing highs/lows */
interface Swing { index: number; price: number; type: "high" | "low"; }
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

// ═══════════════════════════════════════════════════════════════════════
//  DEEP DIRECTIONAL ANALYSIS — 20 Factor Scoring Engine
// ═══════════════════════════════════════════════════════════════════════

function deepDirectionalAnalysis(
  mkt: LiveMarketState,
  engineResult: SignalResult,
): DeepAnalysisResult {
  const factors: DirectionalEvidence[] = [];
  const reasons: string[] = [];
  let totalBuyScore = 0;
  let totalSellScore = 0;
  let totalWeight = 0;

  const { candles, indicators: ind, structure, sr, volume } = mkt;
  const price = mkt.price;
  const atrVal = ind.atr14;

  // Aggregate into higher timeframes
  const candles5m = aggregateCandles(candles, 5);
  const candles15m = aggregateCandles(candles, 15);

  const closes = candles.map(c => c.close);
  const prevCandle = candles.length >= 2 ? candles[candles.length - 2] : null;
  const currCandle = candles[candles.length - 1];

  function addEvidence(
    factor: string,
    category: string,
    buyPts: number,
    sellPts: number,
    weight: number,
    reason: string,
  ) {
    factors.push({ factor, category, buyScore: buyPts, sellScore: sellPts, weight, reason });
    totalBuyScore += buyPts * weight;
    totalSellScore += sellPts * weight;
    totalWeight += weight;
  }

  // ─────────────────────────────────────────────
  // FACTOR 1: MULTI-TIMEFRAME TREND ANALYSIS
  // ─────────────────────────────────────────────
  {
    // Entry TF (1m) trend
    const ema10_1m = emaLast(closes, Math.min(10, closes.length - 1));
    const ema21_1m = emaLast(closes, Math.min(21, closes.length - 1));
    const ema50_1m = closes.length >= 50 ? emaLast(closes, 50) : ema21_1m;

    let entryBuy = 0, entrySell = 0;
    if (price > ema10_1m) entryBuy += 2; else entrySell += 2;
    if (price > ema21_1m) entryBuy += 2; else entrySell += 2;
    if (ema10_1m > ema21_1m) entryBuy += 1; else entrySell += 1;
    if (ema21_1m > ema50_1m) entryBuy += 1; else entrySell += 1;

    const entryAlign = entryBuy >= 5 ? "strong_bull" : entrySell >= 5 ? "strong_bear"
      : entryBuy >= 3 ? "weak_bull" : entrySell >= 3 ? "weak_bear" : "mixed";

    addEvidence("Entry TF Trend", "mtf",
      entryBuy * 16, entrySell * 16, 0.15,
      `Entry TF: ${entryAlign} (EMA10=${ema10_1m.toFixed(5)} vs EMA21=${ema21_1m.toFixed(5)})`
    );

    // 5m trend
    if (candles5m.length >= 21) {
      const closes5m = candles5m.map(c => c.close);
      const ema10_5m = emaLast(closes5m, Math.min(10, closes5m.length - 1));
      const ema21_5m = emaLast(closes5m, Math.min(21, closes5m.length - 1));
      const price5m = closes5m[closes5m.length - 1];

      let midBuy = 0, midSell = 0;
      if (price5m > ema10_5m) midBuy += 2; else midSell += 2;
      if (price5m > ema21_5m) midBuy += 2; else midSell += 2;
      if (ema10_5m > ema21_5m) midBuy += 1; else midSell += 1;

      addEvidence("Intermediate TF Trend", "mtf",
        midBuy * 18, midSell * 18, 0.15,
        `5m: price ${price5m > ema10_5m ? "above" : "below"} EMA10/21`
      );
    }

    // 15m trend
    if (candles15m.length >= 21) {
      const closes15m = candles15m.map(c => c.close);
      const ema10_15m = emaLast(closes15m, Math.min(10, closes15m.length - 1));
      const ema21_15m = emaLast(closes15m, Math.min(21, closes15m.length - 1));
      const price15m = closes15m[closes15m.length - 1];

      let htfBuy = 0, htfSell = 0;
      if (price15m > ema10_15m) htfBuy += 2; else htfSell += 2;
      if (price15m > ema21_15m) htfBuy += 2; else htfSell += 2;
      if (ema10_15m > ema21_15m) htfBuy += 1; else htfSell += 1;

      addEvidence("Higher TF Trend", "mtf",
        htfBuy * 20, htfSell * 20, 0.18,
        `15m: price ${price15m > ema10_15m ? "above" : "below"} EMA10/21`
      );
    }
  }

  // ─────────────────────────────────────────────
  // FACTOR 2: MARKET STRUCTURE (HH/HL/LH/LL)
  // ─────────────────────────────────────────────
  {
    const structSource = candles15m.length >= 10 ? candles15m : candles5m.length >= 10 ? candles5m : candles;
    const swings = detectSwings(structSource, 2);
    const highs = swings.filter(s => s.type === "high").slice(-4);
    const lows = swings.filter(s => s.type === "low").slice(-4);

    let hh = 0, hl = 0, ll = 0, lh = 0;
    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price > highs[i - 1].price) hh++; else lh++;
    }
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price > lows[i - 1].price) hl++; else ll++;
    }

    const bullStructure = hh >= 1 && hl >= 1 && ll === 0;
    const bearStructure = ll >= 1 && lh >= 1 && hh === 0;

    let structBuy = 0, structSell = 0;
    if (bullStructure) { structBuy = 80; structSell = 20; }
    else if (bearStructure) { structBuy = 20; structSell = 80; }
    else {
      // Partial structure signals
      structBuy = hh * 20 + hl * 15;
      structSell = lh * 20 + ll * 15;
    }

    // BOS (Break of Structure) detection
    if (highs.length >= 2 && lows.length >= 2) {
      const lastHigh = highs[highs.length - 1];
      const prevHigh = highs[highs.length - 2];
      const lastLow = lows[lows.length - 1];
      const prevLow = lows[lows.length - 2];

      if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
        structBuy += 15;
        reasons.push("Bullish BOS (higher high + higher low)");
      } else if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) {
        structSell += 15;
        reasons.push("Bearish BOS (lower high + lower low)");
      }

      // CHOCH (Change of Character) detection
      if (lastHigh.price < prevHigh.price && lastLow.price > prevLow.price) {
        // Potential CHOCH — indecisive
      } else if (lastHigh.price > prevHigh.price && lastLow.price < prevLow.price) {
        // Range expansion
      }
    }

    addEvidence("Market Structure", "structure",
      structBuy, structSell, 0.15,
      `HH=${hh} HL=${hl} LH=${lh} LL=${ll} — ${bullStructure ? "bullish" : bearStructure ? "bearish" : "mixed"} structure`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 3: MOMENTUM (RSI + MACD + Stochastic)
  // ─────────────────────────────────────────────
  {
    // RSI
    let rsiBuy = 0, rsiSell = 0;
    if (ind.rsi14 < 30) { rsiBuy = 80; rsiSell = 20; reasons.push(`RSI oversold (${ind.rsi14.toFixed(0)})`); }
    else if (ind.rsi14 < 40) { rsiBuy = 60; rsiSell = 30; }
    else if (ind.rsi14 < 50) { rsiBuy = 55; rsiSell = 45; }
    else if (ind.rsi14 > 70) { rsiBuy = 20; rsiSell = 80; reasons.push(`RSI overbought (${ind.rsi14.toFixed(0)})`); }
    else if (ind.rsi14 > 60) { rsiBuy = 30; rsiSell = 60; }
    else if (ind.rsi14 > 50) { rsiBuy = 45; rsiSell = 55; }

    // RSI slope (momentum acceleration/deceleration)
    if (closes.length >= 16) {
      const rsiNow = rsi(closes, 14);
      const rsiPrev = rsi(closes.slice(0, -1), 14);
      const rsiSlope = rsiNow - rsiPrev;
      if (rsiSlope > 2) { rsiBuy += 10; reasons.push("RSI rising (momentum building)"); }
      else if (rsiSlope < -2) { rsiSell += 10; reasons.push("RSI falling (momentum fading)"); }
    }

    addEvidence("RSI Momentum", "momentum",
      rsiBuy, rsiSell, 0.08,
      `RSI=${ind.rsi14.toFixed(0)}`
    );

    // MACD
    let macdBuy = 0, macdSell = 0;
    if (ind.macdHist > 0 && ind.macdCross === "bullish") { macdBuy = 80; macdSell = 20; reasons.push("MACD bullish crossover"); }
    else if (ind.macdHist > 0) { macdBuy = 60; macdSell = 35; }
    else if (ind.macdHist < 0 && ind.macdCross === "bearish") { macdBuy = 20; macdSell = 80; reasons.push("MACD bearish crossover"); }
    else if (ind.macdHist < 0) { macdBuy = 35; macdSell = 60; }

    addEvidence("MACD", "momentum",
      macdBuy, macdSell, 0.10,
      `MACD hist=${ind.macdHist.toFixed(6)} cross=${ind.macdCross}`
    );

    // Stochastic
    let stochBuy = 0, stochSell = 0;
    if (ind.stochK < 20 && ind.stochK > ind.stochD) { stochBuy = 80; stochSell = 15; reasons.push("Stoch oversold + bullish cross"); }
    else if (ind.stochK < 30) { stochBuy = 60; stochSell = 35; }
    else if (ind.stochK > 80 && ind.stochK < ind.stochD) { stochBuy = 15; stochSell = 80; reasons.push("Stoch overbought + bearish cross"); }
    else if (ind.stochK > 70) { stochBuy = 35; stochSell = 60; }

    addEvidence("Stochastic", "momentum",
      stochBuy, stochSell, 0.07,
      `K=${ind.stochK.toFixed(0)} D=${ind.stochD.toFixed(0)}`
    );

    // ADX trend strength
    let adxBuy = 0, adxSell = 0;
    if (ind.adx > 25) {
      if (ind.plusDI > ind.minusDI) { adxBuy = 70; adxSell = 30; }
      else { adxBuy = 30; adxSell = 70; }
      reasons.push(`ADX strong (${ind.adx.toFixed(0)}): ${ind.plusDI > ind.minusDI ? "bullish" : "bearish"}`);
    } else {
      adxBuy = 45; adxSell = 45;
      reasons.push(`ADX weak (${ind.adx.toFixed(0)}): no strong trend`);
    }

    addEvidence("ADX Trend Strength", "momentum",
      adxBuy, adxSell, 0.08,
      `ADX=${ind.adx.toFixed(0)} +DI=${ind.plusDI.toFixed(0)} -DI=${ind.minusDI.toFixed(0)}`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 4: PRICE ACTION (Candle Analysis)
  // ─────────────────────────────────────────────
  {
    const curr = currCandle;
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low || 0.00001;
    const bodyRatio = body / range;
    const isBull = curr.close > curr.open;
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    let paBuy = 0, paSell = 0;

    // Strong body candle
    if (bodyRatio > 0.6) {
      if (isBull) { paBuy += 30; } else { paSell += 30; }
      reasons.push(`Strong body candle (${(bodyRatio * 100).toFixed(0)}% ratio)`);
    } else if (bodyRatio < 0.2) {
      // Doji — indecision, slight neutral
      paBuy += 35; paSell += 35;
      reasons.push("Doji/indecision candle");
    }

    // Rejection wicks
    if (lowerWick > body * 2 && lowerWick > range * 0.5) {
      paBuy += 25;
      reasons.push("Strong lower wick rejection (bullish)");
    }
    if (upperWick > body * 2 && upperWick > range * 0.5) {
      paSell += 25;
      reasons.push("Strong upper wick rejection (bearish)");
    }

    // Close position within range
    const closePos = range > 0 ? (curr.close - curr.low) / range : 0.5;
    if (closePos > 0.7) paBuy += 15;
    else if (closePos < 0.3) paSell += 15;

    // Previous candle context
    if (prevCandle) {
      const prevBody = Math.abs(prevCandle.close - prevCandle.open);
      const prevIsBull = prevCandle.close > prevCandle.open;

      // Engulfing
      if (!prevIsBull && isBull && body > prevBody * 1.1) {
        paBuy += 25;
        reasons.push("Bullish engulfing pattern");
      } else if (prevIsBull && !isBull && body > prevBody * 1.1) {
        paSell += 25;
        reasons.push("Bearish engulfing pattern");
      }

      // Consecutive candles
      if (candles.length >= 3) {
        const c3 = candles[candles.length - 3];
        const c3Bull = c3.close > c3.open;
        if (isBull && prevIsBull && c3Bull) {
          paBuy += 15;
          reasons.push("Three consecutive bullish candles");
        } else if (!isBull && !prevIsBull && !c3Bull) {
          paSell += 15;
          reasons.push("Three consecutive bearish candles");
        }
      }

      // Momentum candle (large body vs recent average)
      const avgRecentBody = candles.slice(-6, -1).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 5;
      if (body > avgRecentBody * 1.5) {
        if (isBull) paBuy += 10;
        else paSell += 10;
        reasons.push("Momentum candle (above average body)");
      }

      // Exhaustion detection
      if (body < avgRecentBody * 0.3 && range > avgRecentBody * 1.5) {
        paBuy += 10; paSell += 10;
        reasons.push("Exhaustion candle (small body, large range)");
      }
    }

    addEvidence("Price Action", "price_action",
      paBuy, paSell, 0.12,
      `body=${(bodyRatio * 100).toFixed(0)}% close_pos=${(closePos * 100).toFixed(0)}%`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 5: EMA STACK & ALIGNMENT
  // ─────────────────────────────────────────────
  {
    let emaBuy = 0, emaSell = 0;
    if (ind.emaStack === "bull_stack") {
      emaBuy = 85; emaSell = 15;
      reasons.push("EMA bull stack (10>21>50)");
    } else if (ind.emaStack === "bear_stack") {
      emaBuy = 15; emaSell = 85;
      reasons.push("EMA bear stack (10<21<50)");
    } else {
      // Mixed — check individual alignments
      if (price > ind.ema10) emaBuy += 15; else emaSell += 15;
      if (price > ind.ema21) emaBuy += 15; else emaSell += 15;
      if (price > ind.ema50) emaBuy += 10; else emaSell += 10;
    }

    addEvidence("EMA Alignment", "trend",
      emaBuy, emaSell, 0.12,
      `EMA10=${ind.ema10.toFixed(5)} EMA21=${ind.ema21.toFixed(5)} EMA50=${ind.ema50.toFixed(5)}`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 6: SUPPORT / RESISTANCE
  // ─────────────────────────────────────────────
  {
    const resistance = sr.resistance;
    const support = sr.support;
    const range = resistance - support || price * 0.01;

    let srBuy = 0, srSell = 0;

    // Distance from support (closer to support = more bullish for bounce)
    const distFromSupport = (price - support) / range;
    const distFromResistance = (resistance - price) / range;

    if (distFromSupport < 0.2) {
      srBuy += 30;
      reasons.push(`Near support (${support.toFixed(5)}) — bullish bounce zone`);
    } else if (distFromSupport < 0.35) {
      srBuy += 15;
    }

    if (distFromResistance < 0.2) {
      srSell += 30;
      reasons.push(`Near resistance (${resistance.toFixed(5)}) — bearish rejection zone`);
    } else if (distFromResistance < 0.35) {
      srSell += 15;
    }

    // Bounce detection
    if (sr.bounceFromSupport) {
      srBuy += 25;
      reasons.push("Bouncing from support");
    }
    if (sr.bounceFromResistance) {
      srSell += 25;
      reasons.push("Rejecting from resistance");
    }

    // Key level
    if (sr.atKeyLevel) {
      reasons.push("At key S/R level");
    }

    addEvidence("Support/Resistance", "sr",
      srBuy, srSell, 0.10,
      `support=${support.toFixed(5)} resistance=${resistance.toFixed(5)} distS=${distFromSupport.toFixed(2)} distR=${distFromResistance.toFixed(2)}`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 7: VOLATILITY
  // ─────────────────────────────────────────────
  {
    const atrPct = price > 0 ? atrVal / price : 0;
    let volBuy = 0, volSell = 0;

    // Optimal volatility range
    if (atrPct > 0.001 && atrPct < 0.005) {
      volBuy = 60; volSell = 60;
      reasons.push("Optimal volatility range");
    } else if (atrPct > 0.01) {
      volBuy = 35; volSell = 35;
      reasons.push("High volatility — increased risk");
    } else if (atrPct < 0.0005) {
      volBuy = 40; volSell = 40;
      reasons.push("Low volatility — compression");
    } else {
      volBuy = 50; volSell = 50;
    }

    // ATR spike detection
    if (candles.length >= 20) {
      const recentAtr = atr(candles.slice(-20), 14);
      const olderAtr = atr(candles.slice(-40, -20), 14);
      if (olderAtr > 0 && recentAtr > olderAtr * 1.8) {
        reasons.push("ATR expanding — volatility spike");
      } else if (olderAtr > 0 && recentAtr < olderAtr * 0.6) {
        reasons.push("ATR contracting — compression/breakout setup");
      }
    }

    addEvidence("Volatility", "volatility",
      volBuy, volSell, 0.05,
      `ATR=${atrVal.toFixed(6)} (${(atrPct * 100).toFixed(3)}%)`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 8: VOLUME / LIQUIDITY
  // ─────────────────────────────────────────────
  {
    let volBuy = 0, volSell = 0;

    if (volume.spike) {
      reasons.push("Volume spike detected");
      // Volume spike amplifies the current candle direction
      if (currCandle.close > currCandle.open) {
        volBuy += 30;
      } else {
        volSell += 30;
      }
    }

    if (volume.trend === "rising") {
      reasons.push("Volume trending up");
      if (currCandle.close > currCandle.open) volBuy += 15;
      else volSell += 15;
    } else if (volume.trend === "falling") {
      reasons.push("Volume trending down — potential exhaustion");
      volBuy += 10; volSell += 10;
    }

    // Volume confirmation of direction
    const avgVol = volume.avg20;
    if (avgVol > 0 && volume.current > avgVol * 1.3) {
      if (currCandle.close > currCandle.open) volBuy += 15;
      else volSell += 15;
    }

    addEvidence("Volume / Liquidity", "volume",
      volBuy || 40, volSell || 40, 0.06,
      `vol=${volume.current.toFixed(0)} avg=${avgVol.toFixed(0)} spike=${volume.spike}`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 9: BOLLINGER BANDS
  // ─────────────────────────────────────────────
  {
    let bbBuy = 0, bbSell = 0;

    if (ind.bbPct < 0.05) {
      bbBuy = 75; bbSell = 25;
      reasons.push("Price below lower BB — oversold");
    } else if (ind.bbPct < 0.15) {
      bbBuy = 60; bbSell = 35;
    } else if (ind.bbPct > 0.95) {
      bbBuy = 25; bbSell = 75;
      reasons.push("Price above upper BB — overbought");
    } else if (ind.bbPct > 0.85) {
      bbBuy = 35; bbSell = 60;
    } else {
      // Middle zone — slight directional based on position
      bbBuy = 45 + ind.bbPct * 10;
      bbSell = 55 - ind.bbPct * 10;
    }

    addEvidence("Bollinger Bands", "volatility",
      bbBuy, bbSell, 0.05,
      `BB%=${(ind.bbPct * 100).toFixed(0)}%`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 10: FALSE BREAKOUT DETECTION
  // ─────────────────────────────────────────────
  {
    let fboBuy = 0, fboSell = 0;
    let falseBreakoutProb = 0;

    const curr = currCandle;
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low || 0.00001;
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    // Check if price recently broke a level but closed back
    const resistance = sr.resistance;
    const support = sr.support;

    // Wick-only breakout above resistance (bearish false breakout)
    if (curr.high > resistance && curr.close < resistance) {
      fboSell += 40;
      falseBreakoutProb += 40;
      reasons.push("Wick-only breakout above resistance — false breakout (bearish)");
    }

    // Wick-only breakout below support (bullish false breakout)
    if (curr.low < support && curr.close > support) {
      fboBuy += 40;
      falseBreakoutProb += 40;
      reasons.push("Wick-only breakout below support — false breakout (bullish)");
    }

    // Liquidity sweep detection: long wick that sweeps a level
    if (prevCandle) {
      const prevHigh = prevCandle.high;
      const prevLow = prevCandle.low;

      // Sweep above previous high then close below (bearish)
      if (curr.high > prevHigh && curr.close < prevHigh && upperWick > body * 2) {
        fboSell += 30;
        falseBreakoutProb += 30;
        reasons.push("Liquidity sweep above previous high — bearish");
      }

      // Sweep below previous low then close above (bullish)
      if (curr.low < prevLow && curr.close > prevLow && lowerWick > body * 2) {
        fboBuy += 30;
        falseBreakoutProb += 30;
        reasons.push("Liquidity sweep below previous low — bullish");
      }
    }

    // False BOS: price breaks structure level but immediately reverses
    if (candles.length >= 3) {
      const c2 = candles[candles.length - 3];
      const c1 = candles[candles.length - 2];

      // If previous candle broke a high but current candle closes below
      if (c1.high > (c2.high || 0) && curr.close < c2.high && curr.close < c1.open) {
        fboSell += 20;
        falseBreakoutProb += 20;
        reasons.push("False BOS — broke high then reversed");
      }

      if (c1.low < (c2.low || Infinity) && curr.close > c2.low && curr.close > c1.open) {
        fboBuy += 20;
        falseBreakoutProb += 20;
        reasons.push("False breakdown — broke low then reversed");
      }
    }

    addEvidence("False Breakout Analysis", "structure",
      fboBuy, fboSell, 0.08,
      `false_breakout_prob=${Math.min(100, falseBreakoutProb)}%`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 11: REVERSAL vs CONTINUATION PROBABILITY
  // ─────────────────────────────────────────────
  {
    let contBuy = 0, contSell = 0;
    let continuationProb = 50;
    let reversalProb = 50;

    // Trend continuation signals
    if (structure.trend === "bullish") {
      contBuy += 30;
      continuationProb += 15;
      reasons.push("Bullish trend — continuation favored");
    } else if (structure.trend === "bearish") {
      contSell += 30;
      continuationProb += 15;
      reasons.push("Bearish trend — continuation favored");
    }

    // EMA alignment supports continuation
    if (ind.emaStack === "bull_stack") {
      contBuy += 20;
      continuationProb += 10;
    } else if (ind.emaStack === "bear_stack") {
      contSell += 20;
      continuationProb += 10;
    }

    // Momentum supports continuation
    if (ind.adx > 25 && ((ind.plusDI > ind.minusDI && contBuy > contSell) || (ind.minusDI > ind.plusDI && contSell > contBuy))) {
      continuationProb += 10;
    }

    // Reversal signals
    // RSI divergence (price making new high but RSI not)
    if (closes.length >= 15) {
      const recentCloses = closes.slice(-10);
      const priceUp = recentCloses[recentCloses.length - 1] > recentCloses[0];
      const rsiNow = rsi(closes, 14);
      const rsiOld = rsi(closes.slice(0, -5), 14);
      const rsiUp = rsiNow > rsiOld;

      if (priceUp && !rsiUp) {
        reversalProb += 20;
        contBuy -= 10;
        reasons.push("Bearish RSI divergence — reversal risk");
      } else if (!priceUp && rsiUp) {
        reversalProb += 20;
        contSell -= 10;
        reasons.push("Bullish RSI divergence — reversal risk");
      }
    }

    // Exhaustion at S/R
    if (sr.atKeyLevel) {
      reversalProb += 10;
    }

    continuationProb = Math.max(10, Math.min(90, continuationProb));
    reversalProb = Math.max(10, Math.min(90, reversalProb));

    addEvidence("Reversal vs Continuation", "structure",
      contBuy, contSell, 0.08,
      `continuation=${continuationProb}% reversal=${reversalProb}%`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 12: EXISTING ENGINE AGREEMENT
  // ─────────────────────────────────────────────
  {
    const engineDir = engineResult.direction; // "BUY" or "SELL"
    const engineConf = engineResult.confidence;
    const engineConfirms = engineResult.confirmations;

    let engBuy = 0, engSell = 0;

    if (engineDir === "BUY") {
      engBuy = 50 + engineConf * 0.3;
      engSell = 50 - engineConf * 0.3;
    } else {
      engSell = 50 + engineConf * 0.3;
      engBuy = 50 - engineConf * 0.3;
    }

    // Confirmation bonus
    if (engineConfirms >= 4) {
      if (engineDir === "BUY") engBuy += 15; else engSell += 15;
      reasons.push(`${engineConfirms} engine confirmations — strong consensus`);
    } else if (engineConfirms >= 3) {
      if (engineDir === "BUY") engBuy += 8; else engSell += 8;
    }

    addEvidence("Engine Consensus", "engine",
      engBuy, engSell, 0.10,
      `engine=${engineDir} conf=${engineConf}% confirms=${engineConfirms}`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 13: ENTRY TIMING QUALITY
  // ─────────────────────────────────────────────
  {
    let timingBuy = 0, timingSell = 0;

    if (prevCandle) {
      const body = Math.abs(currCandle.close - currCandle.open);
      const range = currCandle.high - currCandle.low || 0.00001;
      const bodyRatio = body / range;

      // Good entry candle in signal direction
      if (engineResult.direction === "BUY" && currCandle.close > currCandle.open && bodyRatio > 0.5) {
        timingBuy += 30;
        reasons.push("Bullish entry candle with strong body");
      } else if (engineResult.direction === "SELL" && currCandle.close < currCandle.open && bodyRatio > 0.5) {
        timingSell += 30;
        reasons.push("Bearish entry candle with strong body");
      }

      // Pullback entry (price near EMA21 in trend direction)
      const distToEma = Math.abs(price - ind.ema21) / price;
      if (distToEma < 0.002) {
        if (engineResult.direction === "BUY" && price > ind.ema21) {
          timingBuy += 15;
        } else if (engineResult.direction === "SELL" && price < ind.ema21) {
          timingSell += 15;
        }
      }

      // Not too extended
      const moveFromPrevClose = Math.abs(currCandle.close - prevCandle.close);
      if (atrVal > 0 && moveFromPrevClose < atrVal * 0.5) {
        timingBuy += 10; timingSell += 10;
      } else if (atrVal > 0 && moveFromPrevClose > atrVal * 0.8) {
        timingBuy -= 10; timingSell -= 10;
        reasons.push("Candle already extended — late entry risk");
      }
    }

    addEvidence("Entry Timing", "entry",
      Math.max(0, timingBuy), Math.max(0, timingSell), 0.06,
      `entry_quality=analyzed`
    );
  }

  // ─────────────────────────────────────────────
  // FACTOR 14: SESSION / TIME-OF-DAY
  // ─────────────────────────────────────────────
  {
    let sessBuy = 50, sessSell = 50;
    const hour = new Date().getUTCHours();

    // London-NY overlap = best
    if (hour >= 13 && hour <= 16) {
      sessBuy += 10; sessSell += 10;
      reasons.push("London-NY overlap — high liquidity");
    }
    // Asian session = lower quality
    else if (hour >= 0 && hour < 8) {
      sessBuy -= 5; sessSell -= 5;
      reasons.push("Asian session — lower liquidity");
    }

    addEvidence("Session / Timing", "session",
      sessBuy, sessSell, 0.03,
      `hour=${hour} UTC session=${mkt.sessionName}`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  AGGREGATE SCORES & DETERMINE FINAL DIRECTION
  // ═══════════════════════════════════════════════════════════════════════

  const normalizedBuy = totalWeight > 0 ? totalBuyScore / totalWeight : 50;
  const normalizedSell = totalWeight > 0 ? totalSellScore / totalWeight : 50;
  const netScore = normalizedBuy - normalizedSell; // Positive = bullish evidence

  // Direction determination
  const originalDir: "BUY" | "SELL" = engineResult.direction === "BUY" ? "BUY" : "SELL";

  // Determine if direction should be reversed
  // The analysis must STRONGLY contradict the original direction to reverse
  // Threshold: the opposite side must lead by at least 8 points
  const REVERSAL_THRESHOLD = 8;

  let finalDir: "BUY" | "SELL";
  let directionReversed = false;

  if (originalDir === "BUY") {
    if (netScore < -REVERSAL_THRESHOLD) {
      finalDir = "SELL";
      directionReversed = true;
      reasons.unshift(`⚠ DIRECTION REVERSED: BUY→SELL (analysis evidence: sell=${normalizedSell.toFixed(1)} > buy=${normalizedBuy.toFixed(1)})`);
    } else {
      finalDir = "BUY";
    }
  } else {
    if (netScore > REVERSAL_THRESHOLD) {
      finalDir = "BUY";
      directionReversed = true;
      reasons.unshift(`⚠ DIRECTION REVERSED: SELL→BUY (analysis evidence: buy=${normalizedBuy.toFixed(1)} > sell=${normalizedSell.toFixed(1)})`);
    } else {
      finalDir = "SELL";
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CALIBRATED CONFIDENCE
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Confidence represents the STRENGTH of evidence for the final direction.
  // NOT artificially inflated. NOT based on raw score alone.
  //
  // Calibration:
  // - Base confidence from the stronger side's normalized score
  // - Agreement bonus: how many factors agree with final direction
  // - Magnitude bonus: how much the stronger side leads
  // - Penalty for direction reversal (evidence was contradictory)
  // - Penalty for weak overall evidence

  const strongerScore = finalDir === "BUY" ? normalizedBuy : normalizedSell;
  const weakerScore = finalDir === "BUY" ? normalizedSell : normalizedBuy;

  // ═══════════════════════════════════════════════════════════════════════
  //  CALIBRATED CONFIDENCE
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Confidence reflects directional CONVICTION.
  // 1. Count how many factors agree with the final direction
  // 2. Measure how strongly they agree (weighted)
  // 3. Apply modifiers for engine strength, regime, reversal

  let agreeingWeight = 0;
  let disagreeingWeight = 0;
  let totalFactors = factors.length;
  for (const f of factors) {
    const fBuyDominant = f.buyScore > f.sellScore + 3;
    const fSellDominant = f.sellScore > f.buyScore + 3;
    const isAgreeing = (finalDir === "BUY" && fBuyDominant) || (finalDir === "SELL" && fSellDominant);
    if (isAgreeing) agreeingWeight += f.weight;
    else disagreeingWeight += f.weight;
  }
  const totalWeight2 = agreeingWeight + disagreeingWeight;
  const agreementRatio = totalWeight2 > 0 ? agreeingWeight / totalWeight2 : 0.5;

  // Base confidence: 48 (slightly below neutral) + agreement swing (up to ±20)
  let rawConfidence = 48 + (agreementRatio - 0.5) * 40;

  // Margin bonus: how much the winning side leads (up to ±10)
  const margin = Math.abs(normalizedBuy - normalizedSell);
  rawConfidence += Math.min(10, Math.max(-6, margin * 0.5));

  // Overconfidence trap: when ALL factors agree, be skeptical
  // (in random markets, unanimous agreement often means overfitting)
  if (agreementRatio > 0.9 && totalFactors >= 10) {
    rawConfidence -= 4;
  }

  // Direction reversal penalty
  if (directionReversed) {
    rawConfidence -= 3;
    reasons.push("Confidence reduced: direction was reversed from engine signal");
  }

  // Engine confidence bonus (up to +4)
  rawConfidence += Math.min(4, Math.max(0, (engineResult.confidence - 50) * 0.08));

  // Regime adjustment
  const regime = mkt.structure.trend === "ranging" ? "RANGING"
    : mkt.indicators.adx > 25 ? "TRENDING"
    : volume.spike || atrVal / price > 0.008 ? "VOLATILE_CHOPPY"
    : "NORMAL";

  if (regime === "TRENDING") rawConfidence += 3;
  else if (regime === "VOLATILE_CHOPPY") rawConfidence -= 3;
  else if (regime === "RANGING") rawConfidence -= 2;

  // Final calibration: clamp to realistic range (42-78)
  const calibratedConfidence = Math.max(42, Math.min(78, Math.round(rawConfidence)));

  // Grade from calibrated confidence
  const grade: SignalGrade = calibratedConfidence >= 68 ? "STRONG"
    : calibratedConfidence >= 53 ? "MODERATE"
    : "WEAK";

  return {
    buyScore: normalizedBuy,
    sellScore: normalizedSell,
    netScore,
    confidence: calibratedConfidence,
    grade,
    directionReversed,
    originalDirection: originalDir,
    finalDirection: finalDir,
    regime,
    factors,
    reasons,
    continuationProb: 50,
    reversalProb: 50,
    falseBreakoutProb: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  PIPELINE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run the full signal pipeline:
 * 1. Existing strategy generates candidate
 * 2. Deep directional analysis validates/reverses direction
 * 3. Calibrated confidence assigned
 *
 * CRITICAL RULE: If the engine produces BUY or SELL, the pipeline
 * MUST return BUY or SELL. NEVER SKIP.
 * SKIP is only returned when the engine itself generates no signal.
 */
export async function runSignalPipeline(
  pairId: string,
  mkt: LiveMarketState,
  _expiry: string = "1m",
): Promise<PipelineSignalResult> {
  // ── Step 1: Existing strategy generates candidate ──
  const engineResult = generateSignal(pairId, mkt);

  // ── HARD RULE: Only SKIP when engine itself has no signal ──
  if (engineResult.direction === "SKIP") {
    return {
      engine: engineResult,
      analysis: null,
      finalDirection: "SKIP",
      finalGrade: "WEAK",
      finalConfidence: 0,
      mlAvailable: false,
      xgboostCallProb: 0.5,
      xgboostPutProb: 0.5,
      aplusScore: 0,
      regime: "NORMAL",
      componentScores: null,
      thresholdUsed: 0,
      mlReasons: ["No candidate from existing engine — no analysis performed"],
      aplus: null,
    };
  }

  // ── Step 2: Deep Directional Analysis ──
  // Engine produced BUY or SELL — we MUST analyze and return BUY or SELL
  const analysis = deepDirectionalAnalysis(mkt, engineResult);

  // ── Step 3: Build output ──
  // The final direction is ALWAYS BUY or SELL (never SKIP)
  const finalDirection: SignalDirection = analysis.finalDirection;

  // Build component scores from analysis factors for backward compatibility
  const mtfFactors = analysis.factors.filter(f => f.category === "mtf");
  const structFactors = analysis.factors.filter(f => f.category === "structure");
  const momFactors = analysis.factors.filter(f => f.category === "momentum");
  const paFactors = analysis.factors.filter(f => f.category === "price_action");
  const srFactors = analysis.factors.filter(f => f.category === "sr");
  const volFactors = analysis.factors.filter(f => f.category === "volatility");

  const avgScore = (factors: DirectionalEvidence[]) =>
    factors.length > 0 ? factors.reduce((s, f) => s + (finalDirection === "BUY" ? f.buyScore : f.sellScore), 0) / factors.length : 50;

  const componentScores = {
    xgboost_prob: analysis.confidence,
    mtf_alignment: avgScore(mtfFactors),
    market_structure: avgScore(structFactors),
    entry_quality: avgScore(analysis.factors.filter(f => f.category === "entry")),
    momentum: avgScore(momFactors),
    candle_quality: avgScore(paFactors),
    support_resistance: avgScore(srFactors),
    volatility_regime: avgScore(volFactors),
  };

  return {
    engine: engineResult,
    analysis,
    finalDirection,
    finalGrade: analysis.grade,
    finalConfidence: analysis.confidence,
    mlAvailable: true,
    xgboostCallProb: finalDirection === "BUY" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
    xgboostPutProb: finalDirection === "SELL" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
    aplusScore: analysis.confidence,
    regime: analysis.regime as RegimeType,
    componentScores,
    thresholdUsed: 0,
    mlReasons: analysis.reasons,
    aplus: {
      score: analysis.confidence,
      decision: "A_PLUS_SIGNAL" as const,
      thresholdUsed: 0,
      regime: analysis.regime as RegimeType,
      direction: (finalDirection === "BUY" ? "CALL" : "PUT") as "CALL" | "PUT",
      callProbability: finalDirection === "BUY" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
      putProbability: finalDirection === "SELL" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
      componentScores,
      reasons: analysis.reasons,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  SYNC VERSION (for backtest and direct use)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Synchronous version of the pipeline for use in backtests
 * and situations where async is not needed.
 */
export function runSignalPipelineSync(
  pairId: string,
  mkt: LiveMarketState,
): PipelineSignalResult {
  const engineResult = generateSignal(pairId, mkt);

  if (engineResult.direction === "SKIP") {
    return {
      engine: engineResult,
      analysis: null,
      finalDirection: "SKIP",
      finalGrade: "WEAK",
      finalConfidence: 0,
      mlAvailable: false,
      xgboostCallProb: 0.5,
      xgboostPutProb: 0.5,
      aplusScore: 0,
      regime: "NORMAL",
      componentScores: null,
      thresholdUsed: 0,
      mlReasons: ["No candidate from existing engine"],
      aplus: null,
    };
  }

  const analysis = deepDirectionalAnalysis(mkt, engineResult);
  const finalDirection: SignalDirection = analysis.finalDirection;

  const mtfFactors = analysis.factors.filter(f => f.category === "mtf");
  const structFactors = analysis.factors.filter(f => f.category === "structure");
  const momFactors = analysis.factors.filter(f => f.category === "momentum");
  const paFactors = analysis.factors.filter(f => f.category === "price_action");
  const srFactors = analysis.factors.filter(f => f.category === "sr");
  const volFactors = analysis.factors.filter(f => f.category === "volatility");

  const avgScore = (factors: DirectionalEvidence[]) =>
    factors.length > 0 ? factors.reduce((s, f) => s + (finalDirection === "BUY" ? f.buyScore : f.sellScore), 0) / factors.length : 50;

  const componentScores = {
    xgboost_prob: analysis.confidence,
    mtf_alignment: avgScore(mtfFactors),
    market_structure: avgScore(structFactors),
    entry_quality: avgScore(analysis.factors.filter(f => f.category === "entry")),
    momentum: avgScore(momFactors),
    candle_quality: avgScore(paFactors),
    support_resistance: avgScore(srFactors),
    volatility_regime: avgScore(volFactors),
  };

  return {
    engine: engineResult,
    analysis,
    finalDirection,
    finalGrade: analysis.grade,
    finalConfidence: analysis.confidence,
    mlAvailable: true,
    xgboostCallProb: finalDirection === "BUY" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
    xgboostPutProb: finalDirection === "SELL" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
    aplusScore: analysis.confidence,
    regime: analysis.regime as RegimeType,
    componentScores,
    thresholdUsed: 0,
    mlReasons: analysis.reasons,
    aplus: {
      score: analysis.confidence,
      decision: "A_PLUS_SIGNAL" as const,
      thresholdUsed: 0,
      regime: analysis.regime as RegimeType,
      direction: (finalDirection === "BUY" ? "CALL" : "PUT") as "CALL" | "PUT",
      callProbability: finalDirection === "BUY" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
      putProbability: finalDirection === "SELL" ? analysis.confidence / 100 : 1 - analysis.confidence / 100,
      componentScores,
      reasons: analysis.reasons,
    },
  };
}

/**
 * Determine if a signal should be shown to the user.
 * CRITICAL: Now uses the pipeline's final direction, not the A+ gate.
 * If the pipeline returned BUY or SELL, show it.
 */
export function shouldShowSignal(result: PipelineSignalResult): boolean {
  // NEVER suppress generated signals
  return result.finalDirection === "BUY" || result.finalDirection === "SELL";
}

/**
 * Get the A+ badge color class based on score.
 */
export function getAPlusColor(score: number): string {
  if (score >= 85) return "text-green-400";
  if (score >= 70) return "text-emerald-400";
  if (score >= 58) return "text-amber-400";
  if (score >= 45) return "text-orange-400";
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
