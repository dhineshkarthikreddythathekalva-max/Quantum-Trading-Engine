import type { LiveMarketState } from "./liveMarket";

export type SignalDirection = "BUY" | "SELL" | "SKIP";
export type SignalGrade = "STRONG" | "MODERATE" | "WEAK";

export interface SignalFactor {
  label: string;
  direction: "BUY" | "SELL";
  weight: number;
  category: "trend" | "oscillator" | "pattern" | "structure" | "volume";
}

export interface SignalResult {
  direction: SignalDirection;
  grade: SignalGrade;
  confidence: number;
  skipReason: string;
  keyReason: string;
  factors: SignalFactor[];         // all confirmed factors
  highWeightCount: number;
  support: number;
  resistance: number;
  currentPrice: number;
  // indicator snapshot for UI
  rsi: number;
  stochK: number; stochD: number;
  adx: number;
  macdDir: "bullish" | "bearish";
  bbPct: number;
  patternNames: string[];
}

function skip(reason: string, mkt: LiveMarketState): SignalResult {
  return {
    direction: "SKIP", grade: "WEAK", confidence: 0,
    skipReason: reason, keyReason: "", factors: [],
    highWeightCount: 0,
    support: mkt.sr.support, resistance: mkt.sr.resistance,
    currentPrice: mkt.price,
    rsi: mkt.indicators.rsi14, stochK: mkt.indicators.stochK,
    stochD: mkt.indicators.stochD, adx: mkt.indicators.adx,
    macdDir: mkt.indicators.macdHist >= 0 ? "bullish" : "bearish",
    bbPct: mkt.indicators.bbPct, patternNames: [],
  };
}

/* ═══════════════════════════════════════════════════
   MAIN SIGNAL GENERATOR
   Uses ONLY real computed indicators — no random dice
   Binary options optimized: confluence + confirmation
═══════════════════════════════════════════════════ */
export function generateSignal(_pairId: string, mkt: LiveMarketState): SignalResult {
  const { indicators: ind, patterns: pat, structure: str, sr, volume } = mkt;

  // ── PRE-FILTERS (market must be tradeable) ──────────────────────────────

  // 1. Ranging / choppy market — ADX < 18 means no trend, binary options lose in ranging
  if (ind.adx < 18 && str.trend === "ranging") {
    return skip(`Market ranging — ADX ${ind.adx.toFixed(0)} too low. No clear trend direction.`, mkt);
  }

  // 2. RSI in no-man's land (40–60) with no fresh MACD cross — weak momentum
  const rsiNeutral = ind.rsi14 > 40 && ind.rsi14 < 60;
  if (rsiNeutral && ind.macdCross === "none" && !pat.engulfingBull && !pat.engulfingBear && !pat.pinBarBull && !pat.pinBarBear) {
    return skip(`RSI ${ind.rsi14.toFixed(0)} in neutral zone (40–60) with no momentum catalyst. Wait for a clear push.`, mkt);
  }

  // 3. EMA trend completely flat (ema10 ≈ ema21) — no bias
  const emaGap = Math.abs(ind.ema10 - ind.ema21) / ind.ema21;
  if (emaGap < 0.0003 && ind.adx < 22) {
    return skip("EMA trend flat — no directional bias. Price coiling for breakout, not yet.", mkt);
  }

  // ── VOTE ACCUMULATOR ────────────────────────────────────────────────────
  const factors: SignalFactor[] = [];

  function vote(
    dir: "BUY" | "SELL",
    weight: number,
    label: string,
    category: SignalFactor["category"],
  ) {
    factors.push({ direction: dir, weight, label, category });
  }

  // ── TREND LAYER (high weight) ─────────────────────────────────────────

  // EMA 10/21 cross direction (real computed EMAs)
  if (ind.emaTrend === "bullish") {
    vote("BUY", ind.adx > 30 ? 2.5 : 1.8, `EMA 10 > EMA 21 — bullish trend`, "trend");
  } else {
    vote("SELL", ind.adx > 30 ? 2.5 : 1.8, `EMA 10 < EMA 21 — bearish trend`, "trend");
  }

  // Price above/below EMA 50 (the key trend filter)
  if (ind.emaBias === "bullish") {
    vote("BUY", 1.8, `Price above EMA 50 — uptrend bias`, "trend");
  } else {
    vote("SELL", 1.8, `Price below EMA 50 — downtrend bias`, "trend");
  }

  // Market structure: Higher Highs / Lower Lows (most reliable structure signal)
  if (str.higherHighs && str.trend === "bullish") {
    vote("BUY", 2.0, `Higher Highs structure — active uptrend`, "structure");
  } else if (str.lowerLows && str.trend === "bearish") {
    vote("SELL", 2.0, `Lower Lows structure — active downtrend`, "structure");
  }

  // Strong momentum: ADX DI cross
  if (ind.plusDI > ind.minusDI && ind.adx > 25) {
    vote("BUY", 1.5, `+DI ${ind.plusDI.toFixed(0)} > -DI ${ind.minusDI.toFixed(0)} — bulls in control (ADX ${ind.adx.toFixed(0)})`, "trend");
  } else if (ind.minusDI > ind.plusDI && ind.adx > 25) {
    vote("SELL", 1.5, `-DI ${ind.minusDI.toFixed(0)} > +DI ${ind.plusDI.toFixed(0)} — bears in control (ADX ${ind.adx.toFixed(0)})`, "trend");
  }

  // ── MOMENTUM OSCILLATORS (real computed values) ───────────────────────

  // RSI
  if (ind.rsi14 < 30) {
    vote("BUY", 2.5, `RSI ${ind.rsi14.toFixed(0)} — deeply oversold reversal zone`, "oscillator");
  } else if (ind.rsi14 > 70) {
    vote("SELL", 2.5, `RSI ${ind.rsi14.toFixed(0)} — deeply overbought reversal zone`, "oscillator");
  } else if (ind.rsi14 < 38) {
    vote("BUY", 1.2, `RSI ${ind.rsi14.toFixed(0)} — approaching oversold`, "oscillator");
  } else if (ind.rsi14 > 62) {
    vote("SELL", 1.2, `RSI ${ind.rsi14.toFixed(0)} — approaching overbought`, "oscillator");
  } else if (ind.rsi14 > 50 && ind.emaTrend === "bullish") {
    vote("BUY", 0.6, `RSI ${ind.rsi14.toFixed(0)} — bullish mid-range momentum`, "oscillator");
  } else if (ind.rsi14 < 50 && ind.emaTrend === "bearish") {
    vote("SELL", 0.6, `RSI ${ind.rsi14.toFixed(0)} — bearish mid-range momentum`, "oscillator");
  }

  // MACD — real EMA crossovers, no random
  if (ind.macdCross === "bullish") {
    vote("BUY", 2.2, `MACD bullish crossover — momentum turning up`, "oscillator");
  } else if (ind.macdCross === "bearish") {
    vote("SELL", 2.2, `MACD bearish crossover — momentum turning down`, "oscillator");
  } else if (ind.macdHist > 0 && ind.macdLine > 0) {
    vote("BUY", 0.8, `MACD histogram positive and rising`, "oscillator");
  } else if (ind.macdHist < 0 && ind.macdLine < 0) {
    vote("SELL", 0.8, `MACD histogram negative and falling`, "oscillator");
  }

  // Stochastic — real OHLC based computation
  if (ind.stochSignal === "oversold" && ind.stochK > ind.stochD) {
    vote("BUY", 2.0, `Stoch ${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)} oversold + %K crossing %D up`, "oscillator");
  } else if (ind.stochSignal === "overbought" && ind.stochK < ind.stochD) {
    vote("SELL", 2.0, `Stoch ${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)} overbought + %K crossing %D down`, "oscillator");
  } else if (ind.stochK > ind.stochD && ind.stochK < 60) {
    vote("BUY", 0.7, `Stoch %K ${ind.stochK.toFixed(0)} crossing above %D — bullish`, "oscillator");
  } else if (ind.stochK < ind.stochD && ind.stochK > 40) {
    vote("SELL", 0.7, `Stoch %K ${ind.stochK.toFixed(0)} crossing below %D — bearish`, "oscillator");
  }

  // Bollinger Bands
  if (ind.bbPct < 0.08) {
    vote("BUY", 2.0, `Price at BB lower band — oversold squeeze reversal`, "oscillator");
  } else if (ind.bbPct > 0.92) {
    vote("SELL", 2.0, `Price at BB upper band — overbought squeeze reversal`, "oscillator");
  } else if (ind.bbPct < 0.25) {
    vote("BUY", 0.8, `Price near BB lower band — bullish mean reversion zone`, "oscillator");
  } else if (ind.bbPct > 0.75) {
    vote("SELL", 0.8, `Price near BB upper band — bearish mean reversion zone`, "oscillator");
  }

  // ── CANDLESTICK PATTERNS (world-class binary signals) ─────────────────

  // Engulfing patterns — strongest reversal/continuation signal
  if (pat.engulfingBull) {
    vote("BUY", 3.0, `Bullish engulfing candle — full reversal pattern`, "pattern");
  }
  if (pat.engulfingBear) {
    vote("SELL", 3.0, `Bearish engulfing candle — full reversal pattern`, "pattern");
  }

  // Pin bars — institutional rejection at key level
  if (pat.pinBarBull && (sr.nearSupport || sr.bounceFromSupport)) {
    vote("BUY", 2.8, `Bull pin bar at support — institutional rejection of lows`, "pattern");
  } else if (pat.pinBarBull) {
    vote("BUY", 1.8, `Bullish pin bar — long lower wick rejection`, "pattern");
  }
  if (pat.pinBarBear && (sr.nearResistance || sr.bounceFromResistance)) {
    vote("SELL", 2.8, `Bear pin bar at resistance — institutional rejection of highs`, "pattern");
  } else if (pat.pinBarBear) {
    vote("SELL", 1.8, `Bearish pin bar — long upper wick rejection`, "pattern");
  }

  // Hammer (at bottom of downtrend)
  if (pat.hammerBull) {
    vote("BUY", 2.5, `Hammer candle at trend low — strong reversal signal`, "pattern");
  }

  // Shooting star (at top of uptrend)
  if (pat.shootingStarBear) {
    vote("SELL", 2.5, `Shooting star at trend high — strong reversal signal`, "pattern");
  }

  // Tweezer tops/bottoms — high precision at key levels
  if (pat.tweezers === "bull") {
    vote("BUY", 2.2, `Tweezer bottom — double test of low with rejection`, "pattern");
  } else if (pat.tweezers === "bear") {
    vote("SELL", 2.2, `Tweezer top — double test of high with rejection`, "pattern");
  }

  // Inside bar breakout (trend continuation)
  if (pat.insideBarBreakout === "bull") {
    vote("BUY", 1.8, `Inside bar bull breakout — trend continuation`, "pattern");
  } else if (pat.insideBarBreakout === "bear") {
    vote("SELL", 1.8, `Inside bar bear breakout — trend continuation`, "pattern");
  }

  // Doji reversal at extreme
  if (pat.dojiReversal) {
    const dir: "BUY" | "SELL" = str.trend === "bearish" ? "BUY" : "SELL";
    vote(dir, 1.5, `Doji indecision candle — reversal signal at trend extreme`, "pattern");
  }

  // Strong momentum candles (trend continuation)
  if (pat.strongBullCandle && str.trend === "bullish") {
    vote("BUY", 1.5, `Strong bullish marubozu — momentum continuation`, "pattern");
  } else if (pat.strongBearCandle && str.trend === "bearish") {
    vote("SELL", 1.5, `Strong bearish marubozu — momentum continuation`, "pattern");
  }

  // ── S/R BOUNCE ─────────────────────────────────────────────────────────

  if (sr.bounceFromSupport) {
    vote("BUY", 2.2, `Price bouncing off key support zone`, "structure");
  } else if (sr.bounceFromResistance) {
    vote("SELL", 2.2, `Price rejected at key resistance zone`, "structure");
  } else if (sr.nearSupport) {
    vote("BUY", 0.8, `Price approaching support zone`, "structure");
  } else if (sr.nearResistance) {
    vote("SELL", 0.8, `Price approaching resistance zone`, "structure");
  }

  // ── VOLUME CONFIRMATION ─────────────────────────────────────────────────

  if (volume.spike && str.trend === "bullish") {
    vote("BUY", 1.2, `Volume spike confirms bullish move`, "volume");
  } else if (volume.spike && str.trend === "bearish") {
    vote("SELL", 1.2, `Volume spike confirms bearish move`, "volume");
  }
  if (volume.trend === "rising" && str.trend === "bullish") {
    vote("BUY", 0.6, `Rising volume — buyers increasing`, "volume");
  } else if (volume.trend === "rising" && str.trend === "bearish") {
    vote("SELL", 0.6, `Rising volume — sellers increasing`, "volume");
  }

  // ── TALLY ───────────────────────────────────────────────────────────────

  const buyFactors  = factors.filter(f => f.direction === "BUY");
  const sellFactors = factors.filter(f => f.direction === "SELL");
  const buyScore    = buyFactors.reduce((s, f)  => s + f.weight, 0);
  const sellScore   = sellFactors.reduce((s, f) => s + f.weight, 0);
  const totalScore  = buyScore + sellScore;

  const direction: "BUY" | "SELL" = buyScore >= sellScore ? "BUY" : "SELL";
  const activeScore  = direction === "BUY" ? buyScore  : sellScore;
  const oppScore     = direction === "BUY" ? sellScore : buyScore;
  const scorePct     = totalScore > 0 ? activeScore / totalScore : 0;
  const margin       = totalScore > 0 ? (activeScore - oppScore) / totalScore : 0;

  // High-weight factors (≥ 1.8) aligned with winning direction
  const hwFactors = factors.filter(f => f.direction === direction && f.weight >= 1.8);
  const highWeightCount = hwFactors.length;

  // Pattern factors confirmed
  const patternFactors = factors.filter(f => f.direction === direction && f.category === "pattern");

  // ── GATE 3: Score must clearly dominate ──────────────────────────────
  if (scorePct < 0.52) {
    return skip(
      `Indicators split — ${Math.round(scorePct * 100)}% consensus (need 52%+). BUY: ${buyScore.toFixed(1)} vs SELL: ${sellScore.toFixed(1)}. Market undecided.`,
      mkt,
    );
  }

  // ── GATE 4: Clear margin required ──────────────────────────────────
  if (margin < 0.15) {
    return skip(
      `${direction} lead too narrow (${Math.round(margin * 100)}% margin). Indicators too evenly split — wait for stronger alignment.`,
      mkt,
    );
  }

  // ── GATE 5: Need at least 2 high-weight confirmations ──────────────
  if (highWeightCount < 2) {
    return skip(
      `Only ${highWeightCount} major factor confirmed — need at least 2 strong signals to trade. Too risky without confluence.`,
      mkt,
    );
  }

  // ── GATE 6: EMA must agree with signal direction (trend filter) ─────
  // Exception: if there's a strong reversal pattern at S/R, allow counter-trend
  const strongReversalAtSR = (pat.engulfingBull || pat.engulfingBear || pat.hammerBull || pat.shootingStarBear || pat.tweezers !== "none") && sr.atKeyLevel;
  if (ind.emaBias !== direction.toLowerCase().replace("buy", "bullish").replace("sell", "bearish") as "bullish" | "bearish" && !strongReversalAtSR) {
    const emaDir = ind.emaBias === "bullish" ? "uptrend" : "downtrend";
    return skip(
      `${direction} signal against EMA 50 ${emaDir} — no reversal pattern at key level to justify counter-trend trade.`,
      mkt,
    );
  }

  // ── GRADE ────────────────────────────────────────────────────────────
  let grade: SignalGrade;
  if (scorePct >= 0.68 && highWeightCount >= 3 && patternFactors.length >= 1) {
    grade = "STRONG";
  } else if (scorePct >= 0.58 && highWeightCount >= 2) {
    grade = "MODERATE";
  } else {
    grade = "WEAK";
  }

  // ── CONFIDENCE (realistic, not inflated) ─────────────────────────────
  let conf = 55;
  conf += (scorePct - 0.52) * 60;           // 0–15 from score
  conf += highWeightCount * 4;               // up to +16 from HW factors
  conf += patternFactors.length * 3;        // up to +9 from patterns
  if (sr.bounceFromSupport || sr.bounceFromResistance) conf += 5;
  if (ind.macdCross !== "none") conf += 4;
  if (ind.adx > 30) conf += 3;
  conf = Math.min(89, Math.max(56, Math.round(conf)));

  // ── KEY REASON ───────────────────────────────────────────────────────
  // Pick the best factor to highlight
  const activeFactors = factors.filter(f => f.direction === direction).sort((a, b) => b.weight - a.weight);
  const topFactor     = activeFactors[0];
  let keyReason       = topFactor?.label ?? `${direction} confluence signal`;

  // Append the 2nd best if different category
  const second = activeFactors.find(f => f.category !== topFactor?.category);
  if (second && second.weight >= 1.5) {
    keyReason += ` + ${second.label.split("—")[0].trim()}`;
  }

  // ── PATTERN NAMES (for UI badges) ────────────────────────────────────
  const patternNames: string[] = [];
  if (pat.engulfingBull && direction === "BUY")  patternNames.push("Bullish Engulfing");
  if (pat.engulfingBear && direction === "SELL") patternNames.push("Bearish Engulfing");
  if (pat.pinBarBull && direction === "BUY")     patternNames.push("Bull Pin Bar");
  if (pat.pinBarBear && direction === "SELL")    patternNames.push("Bear Pin Bar");
  if (pat.hammerBull && direction === "BUY")     patternNames.push("Hammer");
  if (pat.shootingStarBear && direction === "SELL") patternNames.push("Shooting Star");
  if (pat.tweezers === "bull" && direction === "BUY") patternNames.push("Tweezer Bottom");
  if (pat.tweezers === "bear" && direction === "SELL") patternNames.push("Tweezer Top");
  if (pat.insideBarBreakout !== "none") patternNames.push("Inside Bar");
  if (pat.dojiReversal)                          patternNames.push("Doji Reversal");
  if (pat.strongBullCandle && direction === "BUY")  patternNames.push("Marubozu Bull");
  if (pat.strongBearCandle && direction === "SELL") patternNames.push("Marubozu Bear");

  return {
    direction,
    grade,
    confidence: conf,
    skipReason: "",
    keyReason,
    factors: activeFactors,
    highWeightCount,
    support: sr.support,
    resistance: sr.resistance,
    currentPrice: mkt.price,
    rsi: ind.rsi14,
    stochK: ind.stochK, stochD: ind.stochD,
    adx: ind.adx,
    macdDir: ind.macdHist >= 0 ? "bullish" : "bearish",
    bbPct: ind.bbPct,
    patternNames,
  };
}
