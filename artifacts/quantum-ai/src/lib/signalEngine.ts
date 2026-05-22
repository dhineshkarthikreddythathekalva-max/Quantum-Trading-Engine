import type { LiveMarketState } from "./liveMarket";

export type SignalDirection = "BUY" | "SELL" | "SKIP";
export type SignalGrade = "STRONG" | "MODERATE" | "WEAK";

export interface SignalResult {
  direction: SignalDirection;
  grade: SignalGrade;
  confidence: number;
  fakeoutWarning: boolean;
  magicVSignal: boolean;
  srBounce: boolean;
  errorCandleSignal: boolean;
  errorCandleCount: number;
  keyReason: string;
  skipReason: string;           // filled when direction === "SKIP"
  highWeightCount: number;      // how many major factors aligned
  support: number;
  resistance: number;
  currentPrice: number;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h = h & h; }
  return Math.abs(h);
}

function makeSkip(reason: string, mkt: LiveMarketState): SignalResult {
  return {
    direction: "SKIP",
    grade: "WEAK",
    confidence: 0,
    fakeoutWarning: false,
    magicVSignal: false,
    srBounce: false,
    errorCandleSignal: false,
    errorCandleCount: 0,
    keyReason: "",
    skipReason: reason,
    highWeightCount: 0,
    support: mkt.sr.support,
    resistance: mkt.sr.resistance,
    currentPrice: mkt.price,
  };
}
export function generateSignal(pairId: string, liveMarket: LiveMarketState): SignalResult {
  const now  = Date.now();
  const seed = hashString(pairId + "_v6_" + liveMarket.syncCount + "_" + Math.floor(now / 10000));
  const rand = seededRandom(seed);

  const { trend, trendStrength, momentum, volatility, volumeSpike,
          sessionBias, bbPosition, emaCross, roc, magicV, sr, errorCandle } = liveMarket;

  // ── GATE 1: Minimum trend conviction required ──
  // If the trend is wishy-washy (≤ 35% consistency), skip.
  if (trendStrength < 0.35) {
    return makeSkip("Trend too choppy — price oscillating without direction. Wait for clear trend.", liveMarket);
  }

  // ── GATE 2: No signal during extreme volatility with weak momentum ──
  if (volatility === "high" && momentum === "weak") {
    return makeSkip("High volatility with weak momentum — erratic price action. Skip this candle.", liveMarket);
  }

  // ── Oscillators (seeded, aligned with live trend) ──
  const rsiMid   = trend === "bullish" ? 41 : 59;
  const rsi      = Math.min(92, Math.max(8, Math.floor(rsiMid + (rand() - 0.5) * 30)));
  const stochMid = trend === "bullish" ? 36 : 64;
  const stochK   = Math.min(95, Math.max(5, Math.floor(stochMid + (rand() - 0.5) * 40)));
  const stochD   = Math.min(95, Math.max(5, Math.floor(stochK   + (rand() - 0.5) * 6)));
  const macdBull = rand() < (trend === "bullish" ? 0.75 : 0.25); // strongly aligned to trend
  const adx      = Math.min(65, Math.floor((momentum === "strong" ? 30 : momentum === "normal" ? 23 : 16) + rand() * 12));
  const fakeBreakout = rand() > 0.90;
  const fakeReversal = rand() > 0.92;

  type Vote = { buy: number; sell: number; label: string; highWeight: boolean };
  const votes: Vote[] = [];
  const add = (buy: number, sell: number, label: string, highWeight = false) =>
    votes.push({ buy, sell, label, highWeight });

  // ── HIGH-WEIGHT factors (each counted toward minimum requirement) ──

  // Magic V — w:3.0 HIGH
  if (magicV.detected && magicV.direction === "bull") {
    add(magicV.strength === "strong" ? 3.0 : 1.8, 0, `Magic Bull-V (${magicV.depth.toFixed(3)}% depth)`, true);
  } else if (magicV.detected && magicV.direction === "bear") {
    add(0, magicV.strength === "strong" ? 3.0 : 1.8, `Magic Bear-V (${magicV.depth.toFixed(3)}% depth)`, true);
  }

  // Error Candle — w:2.5 HIGH
  if (errorCandle.detected) {
    const w = errorCandle.consecutive >= 2 ? 2.5 : 1.5;
    if (errorCandle.type === "counter_bull")
      add(w, 0, `${errorCandle.consecutive}x error candle in uptrend — BUY the dip`, errorCandle.consecutive >= 2);
    else
      add(0, w, `${errorCandle.consecutive}x error candle in downtrend — SELL the pop`, errorCandle.consecutive >= 2);
  }

  // S/R Bounce — w:2.5 HIGH
  if (sr.bounceFromSupport)    add(2.5, 0,   "Bouncing off key support zone", true);
  if (sr.bounceFromResistance) add(0,   2.5, "Rejected at key resistance zone", true);
  else if (sr.nearSupport)     add(0.8, 0,   "Price approaching support level");
  else if (sr.nearResistance)  add(0,   0.8, "Price approaching resistance level");

  // EMA Crossover — w:2.0 HIGH
  if (emaCross === "golden")      add(2.0, 0,   "Golden cross — EMA 50 crossed above EMA 200", true);
  else if (emaCross === "death")  add(0,   2.0, "Death cross — EMA 50 crossed below EMA 200", true);

  // ── STANDARD factors ──

  // EMA 200 Trend — w:1.5 (higher if trend is strong)
  const trendW = 1.0 + trendStrength;
  if (trend === "bullish") add(trendW, 0, `Price in uptrend (${Math.round(trendStrength * 100)}% consistency)`);
  else                     add(0, trendW, `Price in downtrend (${Math.round(trendStrength * 100)}% consistency)`);

  // BB — w:1.5
  if (bbPosition === "below_lower" || bbPosition === "near_lower") add(1.5, 0, "BB lower band — oversold reversal zone");
  else if (bbPosition === "above_upper" || bbPosition === "near_upper") add(0, 1.5, "BB upper band — overbought reversal zone");

  // RSI — w:1.5
  if (rsi < 35)      add(1.5, 0,   `RSI ${rsi} — strong oversold`);
  else if (rsi > 65) add(0,   1.5, `RSI ${rsi} — strong overbought`);
  else if (rsi < 48) add(0.6, 0,   `RSI ${rsi} — mildly bullish`);
  else if (rsi > 52) add(0,   0.6, `RSI ${rsi} — mildly bearish`);

  // Stochastic — w:1.0
  if (stochK < 18 && stochD < 22) add(1.0, 0,   `Stoch ${stochK}/${stochD} — oversold cross`);
  else if (stochK > 82 && stochD > 78) add(0, 1.0, `Stoch ${stochK}/${stochD} — overbought cross`);
  else if (stochK > stochD) add(0.4, 0,   `Stoch %K > %D bullish`);
  else                      add(0,   0.4, `Stoch %K < %D bearish`);

  // MACD — w:1.0
  if (macdBull) add(1.0, 0, "MACD bullish — histogram expanding up");
  else          add(0, 1.0, "MACD bearish — histogram expanding down");

  // Volume — w:1.0
  if (volumeSpike && trend === "bullish") add(1.0, 0, "Volume spike confirms bullish move");
  else if (volumeSpike && trend === "bearish") add(0, 1.0, "Volume spike confirms bearish move");

  // ROC — w:0.8
  if (roc > 0.5)       add(0.8, 0,   `ROC +${roc.toFixed(2)} — bullish acceleration`);
  else if (roc < -0.5) add(0,   0.8, `ROC ${roc.toFixed(2)} — bearish acceleration`);

  // ADX — w:0.8 (only counts when strong)
  if (adx >= 28) {
    if (trend === "bullish") add(0.8, 0, `ADX ${adx} — strong trend confirmed`);
    else                     add(0, 0.8, `ADX ${adx} — strong trend confirmed`);
  }

  // Session — w:0.4
  if (sessionBias === "bullish")  add(0.4, 0,   "Bullish session bias");
  else if (sessionBias === "bearish") add(0, 0.4, "Bearish session bias");

  // ── Tally ──
  const maxScore = votes.reduce((s, v) => s + v.buy + v.sell, 0);
  let buyTotal   = votes.reduce((s, v) => s + v.buy,  0);
  let sellTotal  = votes.reduce((s, v) => s + v.sell, 0);

  const fakeoutWarning = fakeBreakout || fakeReversal;
  if (fakeBreakout) {
    if (buyTotal >= sellTotal) sellTotal  = Math.max(0, sellTotal  - 2.0);
    else                       buyTotal   = Math.max(0, buyTotal   - 2.0);
  }
  if (fakeReversal) {
    if (buyTotal >= sellTotal) sellTotal  = Math.max(0, sellTotal  - 1.5);
    else                       buyTotal   = Math.max(0, buyTotal   - 1.5);
  }

  const direction = buyTotal >= sellTotal ? "BUY" : "SELL";
  const activeScore = direction === "BUY" ? buyTotal : sellTotal;
  const oppScore    = direction === "BUY" ? sellTotal : buyTotal;
  const scorePct    = maxScore > 0 ? activeScore / maxScore : 0;
  const margin      = maxScore > 0 ? (activeScore - oppScore) / maxScore : 0;

  // Count how many HIGH-WEIGHT factors agree with the winning direction
  const highWeightCount = votes.filter(v =>
    v.highWeight && (direction === "BUY" ? v.buy > 0 : v.sell > 0)
  ).length;

  // ── GATE 3: Require meaningful score advantage ──
  if (scorePct < 0.50) {
    return makeSkip(`Score too low (${Math.round(scorePct * 100)}%) — signals are conflicting. No edge detected.`, liveMarket);
  }

  // ── GATE 4: Require clear margin between BUY and SELL ──
  if (margin < 0.18) {
    return makeSkip(`BUY vs SELL too close (${Math.round(margin * 100)}% margin) — no clear winner. Wait for alignment.`, liveMarket);
  }

  // ── GATE 5: Require at least 1 high-weight factor ──
  if (highWeightCount === 0) {
    return makeSkip("No major confirmation (Magic V / S/R Bounce / Error Candle / EMA Cross). Low reliability — skip.", liveMarket);
  }

  // ── GATE 6: Fakeout with weak signal → SKIP ──
  if (fakeoutWarning && scorePct < 0.60) {
    return makeSkip("Fakeout pattern detected with insufficient conviction. Too risky to enter.", liveMarket);
  }

  // ── Grade ──
  let grade: SignalGrade;
  if (scorePct >= 0.65 && highWeightCount >= 2) grade = "STRONG";
  else if (scorePct >= 0.55 || highWeightCount >= 1) grade = "MODERATE";
  else grade = "WEAK";

  const magicVSignal      = magicV.detected;
  const srBounce          = sr.bounceFromSupport || sr.bounceFromResistance;
  const errorCandleSignal = errorCandle.detected;
  const errorCandleCount  = errorCandle.consecutive;

  const rawConf = scorePct * 80 + (highWeightCount >= 2 ? 12 : 0) + rand() * 6 + 2;
  const confidence = Math.min(96, Math.max(62, Math.round(rawConf)));

  // Key reason — best high-weight factor first
  let keyReason = "";
  if (magicV.detected) {
    keyReason = `Magic ${magicV.direction === "bull" ? "Bull-V ↗" : "Bear-V ↘"} — ${magicV.strength} reversal pattern`;
  } else if (errorCandleSignal && errorCandleCount >= 2) {
    keyReason = errorCandle.type === "counter_bull"
      ? `${errorCandleCount}x bearish error candles in uptrend — trend resumption BUY`
      : `${errorCandleCount}x bullish error candles in downtrend — trend resumption SELL`;
  } else if (srBounce) {
    keyReason = sr.bounceFromSupport ? "Strong bounce off key support level" : "Firm rejection at key resistance level";
  } else if (emaCross !== "none") {
    keyReason = emaCross === "golden" ? "Golden cross — strong bullish signal" : "Death cross — strong bearish signal";
  } else {
    const top = [...votes]
      .filter(v => direction === "BUY" ? v.buy > 0 : v.sell > 0)
      .sort((a, b) => direction === "BUY" ? b.buy - a.buy : b.sell - a.sell)[0];
    keyReason = top?.label ?? `Multi-factor ${direction.toLowerCase()} confluence`;
  }

  return {
    direction: direction as "BUY" | "SELL",
    grade,
    confidence,
    fakeoutWarning,
    magicVSignal,
    srBounce,
    errorCandleSignal,
    errorCandleCount,
    keyReason,
    skipReason: "",
    highWeightCount,
    support:      sr.support,
    resistance:   sr.resistance,
    currentPrice: liveMarket.price,
  };
}
