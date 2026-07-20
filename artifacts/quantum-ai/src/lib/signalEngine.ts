import type { LiveMarketState } from "./liveMarket";

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
  support: number;
  resistance: number;
  currentPrice: number;
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
    skipReason: reason, keyReason: "", factors: [], highWeightCount: 0,
    support: mkt.sr.support, resistance: mkt.sr.resistance, currentPrice: mkt.price,
    rsi: mkt.indicators.rsi14, stochK: mkt.indicators.stochK, stochD: mkt.indicators.stochD,
    adx: mkt.indicators.adx, macdDir: mkt.indicators.macdHist >= 0 ? "bullish" : "bearish",
    bbPct: mkt.indicators.bbPct, patternNames: [],
  };
}

/* ═══════════════════════════════════════════════════════════
   SIGNAL ENGINE v5 — 9-Year Professional Binary Trader Logic
   ─────────────────────────────────────────────────────────
   Core philosophy:
   • Confluence over noise — multiple independent signals must
     agree before any trade is taken
   • Trend is your friend — counter-trend signals need strong
     reversal confluence at a key S/R level
   • The SKIP is your best trade — refusing bad setups is how
     you protect your strike rate
   • Patterns at key levels are the bread and butter
   • 3-candle patterns (Morning Star, 3WS, 3BC) have highest
     single-pattern accuracy — weight accordingly
   • Session timing: London + NY opens give the best moves
═══════════════════════════════════════════════════════════ */
export function generateSignal(_pairId: string, mkt: LiveMarketState): SignalResult {
  const { indicators: ind, patterns: pat, structure: str, sr, volume } = mkt;

  // ── PRE-FILTER 1: Pure chop — ADX too weak, trend ranging ──────────────
  if (ind.adx < 16 && str.trend === "ranging") {
    return skip(`Market is ranging — ADX ${ind.adx.toFixed(0)} (need 16+). No directional edge. Wait for a breakout.`, mkt);
  }

  // ── PRE-FILTER 2: RSI no-man's-land with zero catalyst ─────────────────
  const rsiNeutral = ind.rsi14 > 42 && ind.rsi14 < 58;
  const hasPatternCatalyst =
    pat.engulfingBull || pat.engulfingBear || pat.pinBarBull || pat.pinBarBear ||
    pat.morningStar || pat.eveningStar || pat.hammerBull || pat.shootingStarBear ||
    pat.threeWhiteSoldiers || pat.threeBlackCrows || pat.bullishHarami || pat.bearishHarami ||
    pat.darkCloudCover || pat.piercingLine;
  if (rsiNeutral && ind.macdCross === "none" && !hasPatternCatalyst) {
    return skip(`RSI ${ind.rsi14.toFixed(0)} neutral (42–58), no MACD cross, no pattern catalyst. Indicators undecided — wait.`, mkt);
  }

  // ── PRE-FILTER 3: EMA completely flat — no bias ─────────────────────────
  const emaGap = Math.abs(ind.ema10 - ind.ema21) / (ind.ema21 || 1);
  if (emaGap < 0.0002 && ind.adx < 20) {
    return skip("EMAs flatlined — no directional bias. Price is coiling. Wait for the breakout candle.", mkt);
  }

  // ── VOTE ACCUMULATOR ────────────────────────────────────────────────────
  const factors: SignalFactor[] = [];

  function vote(dir: "BUY" | "SELL", weight: number, label: string, category: SignalFactor["category"]) {
    factors.push({ direction: dir, weight, label, category });
  }

  // Helper: apply S/R bonus multiplier — patterns at key levels deserve more weight
  function votePat(dir: "BUY" | "SELL", baseWeight: number, label: string, atKeyLevel: boolean) {
    const w = atKeyLevel ? baseWeight * 1.4 : baseWeight;
    vote(dir, w, atKeyLevel ? label + " at key S/R ⚡" : label, "pattern");
  }

  // ════════════════════════════════════════════════════════
  //  LAYER 1: TREND STRUCTURE
  // ════════════════════════════════════════════════════════

  // EMA 10/21 direction — primary trend filter
  if (ind.emaTrend === "bullish") {
    vote("BUY", ind.adx > 30 ? 2.5 : 1.8, `EMA 10 > EMA 21 — bullish trend (ADX ${ind.adx.toFixed(0)})`, "trend");
  } else {
    vote("SELL", ind.adx > 30 ? 2.5 : 1.8, `EMA 10 < EMA 21 — bearish trend (ADX ${ind.adx.toFixed(0)})`, "trend");
  }

  // EMA stack: when all 3 EMAs aligned like staircase — very high quality trend
  if (ind.emaStack === "bull_stack") {
    vote("BUY", 2.8, `EMA 10 > 21 > 50 — fully stacked bullish (institutional trend)`, "trend");
  } else if (ind.emaStack === "bear_stack") {
    vote("SELL", 2.8, `EMA 10 < 21 < 50 — fully stacked bearish (institutional trend)`, "trend");
  }

  // Price vs EMA 50 — the 50 is the macro trend dividing line
  if (ind.emaBias === "bullish") {
    vote("BUY", 1.8, `Price above EMA 50 — uptrend territory`, "trend");
  } else {
    vote("SELL", 1.8, `Price below EMA 50 — downtrend territory`, "trend");
  }

  // Market structure — HH/HL (most reliable structural signal)
  if (str.higherHighs && str.trend === "bullish") {
    vote("BUY", 2.2, `Higher Highs confirmed — bulls making progress`, "structure");
  } else if (str.lowerLows && str.trend === "bearish") {
    vote("SELL", 2.2, `Lower Lows confirmed — bears in control`, "structure");
  }

  // ADX directional index cross — real momentum direction
  if (ind.plusDI > ind.minusDI && ind.adx > 23) {
    vote("BUY", 1.6, `+DI ${ind.plusDI.toFixed(0)} > -DI ${ind.minusDI.toFixed(0)} — buying pressure dominant`, "trend");
  } else if (ind.minusDI > ind.plusDI && ind.adx > 23) {
    vote("SELL", 1.6, `-DI ${ind.minusDI.toFixed(0)} > +DI ${ind.plusDI.toFixed(0)} — selling pressure dominant`, "trend");
  }

  // ════════════════════════════════════════════════════════
  //  LAYER 2: OSCILLATORS
  // ════════════════════════════════════════════════════════

  // RSI — Wilder's method from real price data
  if (ind.rsi14 < 28)      vote("BUY",  2.8, `RSI ${ind.rsi14.toFixed(0)} — deeply oversold, extreme reversal zone`, "oscillator");
  else if (ind.rsi14 > 72) vote("SELL", 2.8, `RSI ${ind.rsi14.toFixed(0)} — deeply overbought, extreme reversal zone`, "oscillator");
  else if (ind.rsi14 < 36) vote("BUY",  1.4, `RSI ${ind.rsi14.toFixed(0)} — approaching oversold territory`, "oscillator");
  else if (ind.rsi14 > 64) vote("SELL", 1.4, `RSI ${ind.rsi14.toFixed(0)} — approaching overbought territory`, "oscillator");
  else if (ind.rsi14 > 50 && ind.emaTrend === "bullish") vote("BUY",  0.7, `RSI ${ind.rsi14.toFixed(0)} — bullish mid-range momentum`, "oscillator");
  else if (ind.rsi14 < 50 && ind.emaTrend === "bearish") vote("SELL", 0.7, `RSI ${ind.rsi14.toFixed(0)} — bearish mid-range momentum`, "oscillator");

  // MACD — EMA crossover (real, not random)
  if (ind.macdCross === "bullish") {
    vote("BUY",  2.4, `MACD bullish crossover — momentum turning upward`, "oscillator");
  } else if (ind.macdCross === "bearish") {
    vote("SELL", 2.4, `MACD bearish crossover — momentum turning downward`, "oscillator");
  } else if (ind.macdHist > 0 && ind.macdLine > 0) {
    vote("BUY",  0.9, `MACD above zero, histogram positive — bullish bias`, "oscillator");
  } else if (ind.macdHist < 0 && ind.macdLine < 0) {
    vote("SELL", 0.9, `MACD below zero, histogram negative — bearish bias`, "oscillator");
  }

  // Stochastic — real OHLC based
  if (ind.stochSignal === "oversold" && ind.stochK > ind.stochD) {
    vote("BUY",  2.2, `Stoch ${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)} oversold + %K crossing up — reversal loading`, "oscillator");
  } else if (ind.stochSignal === "overbought" && ind.stochK < ind.stochD) {
    vote("SELL", 2.2, `Stoch ${ind.stochK.toFixed(0)}/${ind.stochD.toFixed(0)} overbought + %K crossing down — reversal loading`, "oscillator");
  } else if (ind.stochK > ind.stochD && ind.stochK < 65) {
    vote("BUY",  0.8, `Stoch %K ${ind.stochK.toFixed(0)} crossing above %D`, "oscillator");
  } else if (ind.stochK < ind.stochD && ind.stochK > 35) {
    vote("SELL", 0.8, `Stoch %K ${ind.stochK.toFixed(0)} crossing below %D`, "oscillator");
  }

  // Bollinger Bands
  if      (ind.bbPct < 0.06) vote("BUY",  2.2, `Price at lower Bollinger Band — oversold squeeze`, "oscillator");
  else if (ind.bbPct > 0.94) vote("SELL", 2.2, `Price at upper Bollinger Band — overbought squeeze`, "oscillator");
  else if (ind.bbPct < 0.22) vote("BUY",  0.9, `Price near lower BB — bullish mean reversion zone`, "oscillator");
  else if (ind.bbPct > 0.78) vote("SELL", 0.9, `Price near upper BB — bearish mean reversion zone`, "oscillator");

  // ── TRIPLE OSCILLATOR CONFLUENCE (pro trader's golden signal) ──────────
  // When RSI + MACD + Stoch all agree simultaneously = extremely high quality
  const tripleOscBull = ind.rsi14 < 40 &&
    (ind.macdHist > 0 || ind.macdCross === "bullish") &&
    (ind.stochSignal === "oversold" || ind.stochK > ind.stochD);
  const tripleOscBear = ind.rsi14 > 60 &&
    (ind.macdHist < 0 || ind.macdCross === "bearish") &&
    (ind.stochSignal === "overbought" || ind.stochK < ind.stochD);
  if (tripleOscBull) vote("BUY",  2.5, `Triple oscillator confluence — RSI+MACD+Stoch all bullish`, "oscillator");
  if (tripleOscBear) vote("SELL", 2.5, `Triple oscillator confluence — RSI+MACD+Stoch all bearish`, "oscillator");

  // ════════════════════════════════════════════════════════
  //  LAYER 3: CANDLESTICK PATTERNS
  //  (The bread and butter of binary trading)
  // ════════════════════════════════════════════════════════

  // ── THREE-CANDLE PATTERNS (highest single-pattern accuracy) ──
  if (pat.morningStar) {
    votePat("BUY",  4.0, `Morning Star — 3-candle bullish reversal (strongest pattern)`, sr.atKeyLevel);
  }
  if (pat.eveningStar) {
    votePat("SELL", 4.0, `Evening Star — 3-candle bearish reversal (strongest pattern)`, sr.atKeyLevel);
  }
  if (pat.threeWhiteSoldiers) {
    vote("BUY",  3.5, `Three White Soldiers — institutional buyers stepping in`, "pattern");
  }
  if (pat.threeBlackCrows) {
    vote("SELL", 3.5, `Three Black Crows — institutional sellers stepping in`, "pattern");
  }

  // ── TWO-CANDLE PATTERNS ──
  if (pat.engulfingBull) votePat("BUY",  3.2, `Bullish Engulfing — full reversal candle`, sr.atKeyLevel);
  if (pat.engulfingBear) votePat("SELL", 3.2, `Bearish Engulfing — full reversal candle`, sr.atKeyLevel);

  if (pat.darkCloudCover) votePat("SELL", 2.8, `Dark Cloud Cover — bearish reversal from high`, sr.atKeyLevel);
  if (pat.piercingLine)   votePat("BUY",  2.8, `Piercing Line — bullish reversal from low`, sr.atKeyLevel);

  if (pat.bullishHarami) votePat("BUY",  2.2, `Bullish Harami — indecision inside bearish move`, sr.atKeyLevel);
  if (pat.bearishHarami) votePat("SELL", 2.2, `Bearish Harami — indecision inside bullish move`, sr.atKeyLevel);

  if (pat.tweezers === "bull") votePat("BUY",  2.4, `Tweezer Bottom — double test of low rejected`, sr.atKeyLevel);
  if (pat.tweezers === "bear") votePat("SELL", 2.4, `Tweezer Top — double test of high rejected`, sr.atKeyLevel);

  if (pat.insideBarBreakout === "bull") vote("BUY",  1.8, `Inside Bar bull breakout — trend continuation`, "pattern");
  if (pat.insideBarBreakout === "bear") vote("SELL", 1.8, `Inside Bar bear breakout — trend continuation`, "pattern");

  // ── ONE-CANDLE PATTERNS ──
  if (pat.hammerBull) votePat("BUY",  2.8, `Hammer — long tail rejection at trend low`, sr.atKeyLevel);
  if (pat.shootingStarBear) votePat("SELL", 2.8, `Shooting Star — long wick rejection at trend high`, sr.atKeyLevel);

  if (pat.pinBarBull && (sr.nearSupport || sr.bounceFromSupport)) {
    vote("BUY",  3.0, `Bull Pin Bar at support — institutional rejection of lows`, "pattern");
  } else if (pat.pinBarBull) {
    vote("BUY",  2.0, `Bullish Pin Bar — lower wick rejection`, "pattern");
  }
  if (pat.pinBarBear && (sr.nearResistance || sr.bounceFromResistance)) {
    vote("SELL", 3.0, `Bear Pin Bar at resistance — institutional rejection of highs`, "pattern");
  } else if (pat.pinBarBear) {
    vote("SELL", 2.0, `Bearish Pin Bar — upper wick rejection`, "pattern");
  }

  if (pat.dojiReversal) {
    const dir: "BUY" | "SELL" = str.trend === "bearish" ? "BUY" : "SELL";
    vote(dir, 1.6, `Doji at trend extreme — indecision signals reversal`, "pattern");
  }
  if (pat.strongBullCandle && str.trend === "bullish") {
    vote("BUY",  1.6, `Marubozu bull candle — strong momentum continuation`, "pattern");
  } else if (pat.strongBearCandle && str.trend === "bearish") {
    vote("SELL", 1.6, `Marubozu bear candle — strong momentum continuation`, "pattern");
  }

  // ════════════════════════════════════════════════════════
  //  LAYER 4: S/R ZONES
  // ════════════════════════════════════════════════════════
  if (sr.bounceFromSupport)    vote("BUY",  2.4, `Bouncing off key support zone — buyers defending the level`, "structure");
  else if (sr.bounceFromResistance) vote("SELL", 2.4, `Rejected at key resistance — sellers capping the move`, "structure");
  else if (sr.nearSupport)     vote("BUY",  0.9, `Approaching support zone`, "structure");
  else if (sr.nearResistance)  vote("SELL", 0.9, `Approaching resistance zone`, "structure");

  // ════════════════════════════════════════════════════════
  //  LAYER 5: VOLUME
  // ════════════════════════════════════════════════════════
  if (volume.spike && str.trend === "bullish") vote("BUY",  1.3, `Volume spike confirms bullish move`, "volume");
  if (volume.spike && str.trend === "bearish") vote("SELL", 1.3, `Volume spike confirms bearish move`, "volume");
  if (volume.trend === "rising" && str.trend === "bullish") vote("BUY",  0.7, `Rising volume — buyers increasing participation`, "volume");
  if (volume.trend === "rising" && str.trend === "bearish") vote("SELL", 0.7, `Rising volume — sellers increasing participation`, "volume");

  // ════════════════════════════════════════════════════════
  //  LAYER 6: SESSION QUALITY
  // ════════════════════════════════════════════════════════
  if (mkt.sessionBias === "bullish" && mkt.sessionName.includes("London")) {
    vote("BUY",  1.0, `${mkt.sessionName} — high volatility, directional moves`, "session");
  } else if (mkt.sessionBias === "bullish" && mkt.sessionName.includes("NY")) {
    vote("BUY",  1.0, `${mkt.sessionName} — strong institutional flow`, "session");
  }

  // ── TALLY ───────────────────────────────────────────────────────────────
  const buyFactors   = factors.filter(f => f.direction === "BUY");
  const sellFactors  = factors.filter(f => f.direction === "SELL");
  const buyScore     = buyFactors.reduce((s, f)  => s + f.weight, 0);
  const sellScore    = sellFactors.reduce((s, f) => s + f.weight, 0);
  const totalScore   = buyScore + sellScore;

  const direction: "BUY" | "SELL" = buyScore >= sellScore ? "BUY" : "SELL";
  const activeScore  = direction === "BUY" ? buyScore  : sellScore;
  const oppScore     = direction === "BUY" ? sellScore : buyScore;
  const scorePct     = totalScore > 0 ? activeScore / totalScore : 0;
  const margin       = totalScore > 0 ? (activeScore - oppScore) / totalScore : 0;

  const hwFactors     = factors.filter(f => f.direction === direction && f.weight >= 2.0);
  const highWeightCount = hwFactors.length;
  const patternFactors  = factors.filter(f => f.direction === direction && f.category === "pattern");

  // ── GATE 3: Score consensus ──────────────────────────────────────────
  if (scorePct < 0.53) {
    return skip(
      `Indicators split — ${Math.round(scorePct * 100)}% consensus (need 53%+). BUY: ${buyScore.toFixed(1)} vs SELL: ${sellScore.toFixed(1)}. No edge.`,
      mkt,
    );
  }

  // ── GATE 4: Margin — clear lead ──────────────────────────────────────
  if (margin < 0.14) {
    return skip(
      `${direction} lead too thin (${Math.round(margin * 100)}% margin). Too many conflicting signals — wait for cleaner setup.`,
      mkt,
    );
  }

  // ── GATE 5: Minimum 2 heavy hitters ──────────────────────────────────
  if (highWeightCount < 2) {
    return skip(
      `Only ${highWeightCount} major signal confirmed (need 2+). Not enough confluence — this is a coin flip setup.`,
      mkt,
    );
  }

  // ── GATE 6: EMA trend must agree OR strong reversal at S/R ───────────
  const strongReversalAtSR =
    (pat.morningStar || pat.eveningStar || pat.threeWhiteSoldiers || pat.threeBlackCrows ||
     pat.engulfingBull || pat.engulfingBear || pat.hammerBull || pat.shootingStarBear ||
     pat.tweezers !== "none" || pat.darkCloudCover || pat.piercingLine) && sr.atKeyLevel;

  const emaBiasDir = ind.emaBias === "bullish" ? "BUY" : "SELL";
  if (emaBiasDir !== direction && !strongReversalAtSR) {
    const emaDir = ind.emaBias === "bullish" ? "uptrend (EMA 50)" : "downtrend (EMA 50)";
    return skip(
      `${direction} signal against ${emaDir} — no strong reversal pattern at key S/R to justify counter-trend trade.`,
      mkt,
    );
  }

  // ── GRADE ────────────────────────────────────────────────────────────
  let grade: SignalGrade;
  const has3Candle = pat.morningStar || pat.eveningStar || pat.threeWhiteSoldiers || pat.threeBlackCrows;
  if      (scorePct >= 0.68 && highWeightCount >= 3 && (patternFactors.length >= 1 || has3Candle)) grade = "STRONG";
  else if (scorePct >= 0.58 && highWeightCount >= 2) grade = "MODERATE";
  else    grade = "WEAK";

  // ── CONFIDENCE (realistic 56–92%) ─────────────────────────────────────
  let conf = 56;
  conf += (scorePct - 0.53) * 65;
  conf += highWeightCount * 4;
  conf += patternFactors.length * 3;
  if (has3Candle) conf += 6;
  if (sr.bounceFromSupport || sr.bounceFromResistance) conf += 5;
  if (ind.macdCross !== "none") conf += 4;
  if (ind.adx > 30) conf += 3;
  if (tripleOscBull || tripleOscBear) conf += 5;
  if (ind.emaStack !== "mixed") conf += 4;
  conf = Math.min(92, Math.max(57, Math.round(conf)));

  // ── KEY REASON (top 2 non-overlapping factors) ─────────────────────────
  const activeFactors = factors.filter(f => f.direction === direction).sort((a, b) => b.weight - a.weight);
  const topFactor     = activeFactors[0];
  let keyReason       = topFactor?.label ?? `${direction} confluence`;
  const second = activeFactors.find(f => f.category !== topFactor?.category);
  if (second && second.weight >= 1.6) {
    keyReason += ` + ${second.label.split("—")[0].trim()}`;
  }

  // ── PATTERN NAMES (for UI badges) ────────────────────────────────────
  const patternNames: string[] = [];
  if (pat.morningStar && direction === "BUY")           patternNames.push("Morning Star ⭐");
  if (pat.eveningStar && direction === "SELL")           patternNames.push("Evening Star ⭐");
  if (pat.threeWhiteSoldiers && direction === "BUY")    patternNames.push("3 White Soldiers");
  if (pat.threeBlackCrows && direction === "SELL")      patternNames.push("3 Black Crows");
  if (pat.engulfingBull && direction === "BUY")         patternNames.push("Bullish Engulfing");
  if (pat.engulfingBear && direction === "SELL")        patternNames.push("Bearish Engulfing");
  if (pat.darkCloudCover && direction === "SELL")       patternNames.push("Dark Cloud Cover");
  if (pat.piercingLine && direction === "BUY")          patternNames.push("Piercing Line");
  if (pat.bullishHarami && direction === "BUY")         patternNames.push("Bullish Harami");
  if (pat.bearishHarami && direction === "SELL")        patternNames.push("Bearish Harami");
  if (pat.pinBarBull && direction === "BUY")            patternNames.push("Bull Pin Bar");
  if (pat.pinBarBear && direction === "SELL")           patternNames.push("Bear Pin Bar");
  if (pat.hammerBull && direction === "BUY")            patternNames.push("Hammer");
  if (pat.shootingStarBear && direction === "SELL")     patternNames.push("Shooting Star");
  if (pat.tweezers === "bull" && direction === "BUY")   patternNames.push("Tweezer Bottom");
  if (pat.tweezers === "bear" && direction === "SELL")  patternNames.push("Tweezer Top");
  if (pat.insideBarBreakout !== "none")                 patternNames.push("Inside Bar");
  if (pat.dojiReversal)                                 patternNames.push("Doji Reversal");
  if (pat.strongBullCandle && direction === "BUY")      patternNames.push("Marubozu Bull");
  if (pat.strongBearCandle && direction === "SELL")     patternNames.push("Marubozu Bear");
  if (ind.emaStack === "bull_stack" && direction === "BUY")  patternNames.push("EMA Stack ↑");
  if (ind.emaStack === "bear_stack" && direction === "SELL") patternNames.push("EMA Stack ↓");
  if (tripleOscBull && direction === "BUY")             patternNames.push("Triple OSC Confluence");
  if (tripleOscBear && direction === "SELL")            patternNames.push("Triple OSC Confluence");

  return {
    direction, grade, confidence: conf,
    skipReason: "", keyReason,
    factors: activeFactors,
    highWeightCount,
    support: sr.support, resistance: sr.resistance, currentPrice: mkt.price,
    rsi: ind.rsi14, stochK: ind.stochK, stochD: ind.stochD, adx: ind.adx,
    macdDir: ind.macdHist >= 0 ? "bullish" : "bearish",
    bbPct: ind.bbPct, patternNames,
  };
}
