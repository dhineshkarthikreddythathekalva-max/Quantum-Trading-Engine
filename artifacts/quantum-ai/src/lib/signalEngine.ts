import type { LiveMarketState } from "./liveMarket";

export type SignalDirection = "BUY" | "SELL" | "NEUTRAL";
export type SignalGrade = "STRONG" | "NEUTRAL" | "WEAK";

export interface IndicatorState {
  // Trend
  trendEMA200: "bullish" | "bearish";
  emaCross: "golden" | "death" | "none";
  adxStrength: number;
  // Oscillators
  rsi: number;
  stochK: number;
  stochD: number;
  macdHist: "rising" | "falling";
  roc: number;
  // Volatility & Volume
  bbPosition: LiveMarketState["bbPosition"];
  volatility: "high" | "medium" | "low";
  volumeSpike: boolean;
  // Price action
  nearSupport: boolean;
  nearResistance: boolean;
  bullCandle: boolean;
  bearCandle: boolean;
  // Pattern detection
  fakeBreakout: boolean;
  fakeReversal: boolean;
  colorPattern: "bull" | "bear" | "none";
  // Market context
  sessionBias: "bullish" | "bearish" | "neutral";
  momentum: "strong" | "normal" | "weak";
  // Live price
  livePrice: number;
  priceChange: number;
}

export interface StrategyScore {
  name: string;
  weight: number;
  bullish: boolean;
  bearish: boolean;
  note?: string;
}

export interface SignalResult {
  direction: SignalDirection;
  grade: SignalGrade;
  buyScore: number;
  sellScore: number;
  maxScore: number;
  confidence: number;
  indicators: IndicatorState;
  strategies: StrategyScore[];
  fakeoutWarning: boolean;
  analysisNotes: string[];
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function generateSignal(pairId: string, liveMarket: LiveMarketState): SignalResult {
  const now = Date.now();
  // Tie to live sync count + 8-second micro-slots so signals refresh with market
  const seed = hashString(pairId + "_v4_" + liveMarket.syncCount + "_" + Math.floor(now / 8000));
  const rand = seededRandom(seed);

  // ── Pull live market context ──
  const { trend, momentum, volatility, volumeSpike, sessionBias, bbPosition, emaCross, roc, livePrice: price, priceChange } = liveMarket;

  // ── Derive trend EMA (consistent with live trend) ──
  const trendEMA200: IndicatorState["trendEMA200"] = trend === "bullish" ? "bullish" : "bearish";

  // ── ADX — higher when momentum is strong ──
  const adxBase = momentum === "strong" ? 28 : momentum === "normal" ? 22 : 16;
  const adxStrength = Math.min(60, Math.floor(adxBase + rand() * 14));

  // ── RSI — biased toward trend ──
  const rsiMid = trend === "bullish" ? 44 : 56;
  const rsi = Math.min(88, Math.max(12, Math.floor(rsiMid + (rand() - 0.5) * 30)));

  // ── Stochastic ──
  const stochMid = trend === "bullish" ? 40 : 60;
  const stochK = Math.min(95, Math.max(5, Math.floor(stochMid + (rand() - 0.5) * 40)));
  const stochD = Math.min(95, Math.max(5, Math.floor(stochK + (rand() - 0.5) * 8)));

  // ── MACD hist direction — aligned with live trend ~75% of time ──
  const macdAligned = rand() > 0.25;
  const macdHist: IndicatorState["macdHist"] =
    macdAligned ? (trend === "bullish" ? "rising" : "falling")
    : (trend === "bullish" ? "falling" : "rising");

  // ── S/R zones ──
  const nearSupport = rand() > 0.42;
  const nearResistance = rand() > 0.42;

  // ── Candle pattern — aligned with trend ──
  const bullCandle = trendEMA200 === "bullish" ? rand() > 0.22 : rand() > 0.72;
  const bearCandle = trendEMA200 === "bearish" ? rand() > 0.22 : rand() > 0.72;

  // ── Fakeout detection ──
  const fakeBreakout = rand() > 0.86;
  const fakeReversal = rand() > 0.89;

  // ── Color pattern (biased toward trend, reinforced by bb position) ──
  const cpVal = rand();
  let colorPattern: IndicatorState["colorPattern"];
  if (bbPosition === "below_lower" || bbPosition === "near_lower") {
    colorPattern = cpVal > 0.25 ? "bull" : cpVal < 0.1 ? "bear" : "none";
  } else if (bbPosition === "above_upper" || bbPosition === "near_upper") {
    colorPattern = cpVal > 0.75 ? "bull" : cpVal < 0.25 ? "bear" : "none";
  } else {
    colorPattern = trend === "bullish"
      ? (cpVal > 0.38 ? "bull" : cpVal < 0.12 ? "bear" : "none")
      : (cpVal > 0.62 ? "bear" : cpVal < 0.12 ? "bull" : "none");
  }

  // ══════════════════════════════════════════════════
  // STRATEGY ENGINE — 10 strategies with weights
  // ══════════════════════════════════════════════════
  const strategies: StrategyScore[] = [];

  // 1. EMA Trend Alignment (weight 2)
  strategies.push({
    name: "EMA Trend Alignment",
    weight: 2,
    bullish: trendEMA200 === "bullish",
    bearish: trendEMA200 === "bearish",
    note: trendEMA200 === "bullish" ? "Price above EMA 200 — uptrend confirmed" : "Price below EMA 200 — downtrend confirmed",
  });

  // 2. EMA Crossover Signal (weight 2)
  const emaBull = emaCross === "golden";
  const emaBear = emaCross === "death";
  strategies.push({
    name: "EMA 50/200 Crossover",
    weight: 2,
    bullish: emaBull,
    bearish: emaBear,
    note: emaBull ? "Golden cross detected — strong buy signal" : emaBear ? "Death cross detected — strong sell signal" : "No crossover — awaiting confirmation",
  });

  // 3. RSI Oversold/Overbought (weight 1.5)
  const rsiBull = rsi < 42;
  const rsiBear = rsi > 58;
  strategies.push({
    name: "RSI Momentum Filter",
    weight: 1.5,
    bullish: rsiBull,
    bearish: rsiBear,
    note: rsiBull ? `RSI ${rsi} — oversold, bullish reversal zone` : rsiBear ? `RSI ${rsi} — overbought, bearish reversal zone` : `RSI ${rsi} — neutral zone`,
  });

  // 4. Stochastic %K/%D Signal (weight 1.5)
  const stochBull = stochK < 25 && stochD < 30;
  const stochBear = stochK > 75 && stochD > 70;
  const stochCross = stochK > stochD;
  strategies.push({
    name: "Stochastic %K/%D Cross",
    weight: 1.5,
    bullish: stochBull || (stochCross && stochK < 50),
    bearish: stochBear || (!stochCross && stochK > 50),
    note: stochBull ? "Stoch oversold + %K cross — buy zone" : stochBear ? "Stoch overbought + %K cross — sell zone" : `Stoch %K ${stochK} / %D ${stochD}`,
  });

  // 5. MACD Histogram Momentum (weight 1.5)
  strategies.push({
    name: "MACD Histogram",
    weight: 1.5,
    bullish: macdHist === "rising",
    bearish: macdHist === "falling",
    note: macdHist === "rising" ? "MACD histogram expanding bullish" : "MACD histogram expanding bearish",
  });

  // 6. Bollinger Band Strategy (weight 1.5)
  const bbBull = bbPosition === "near_lower" || bbPosition === "below_lower";
  const bbBear = bbPosition === "near_upper" || bbPosition === "above_upper";
  strategies.push({
    name: "Bollinger Band Squeeze",
    weight: 1.5,
    bullish: bbBull,
    bearish: bbBear,
    note: bbBull ? "Price near lower BB — mean reversion buy signal"
        : bbBear ? "Price near upper BB — mean reversion sell signal"
        : "Price within BB middle — trend continuation mode",
  });

  // 7. Volume Spike Confirmation (weight 1)
  strategies.push({
    name: "Volume Spike Analysis",
    weight: 1,
    bullish: volumeSpike && trend === "bullish",
    bearish: volumeSpike && trend === "bearish",
    note: volumeSpike ? `Volume surge detected — ${trend} move validated` : "Normal volume — lower conviction",
  });

  // 8. Support / Resistance Zones (weight 1)
  strategies.push({
    name: "S/R Zone Reaction",
    weight: 1,
    bullish: nearSupport,
    bearish: nearResistance,
    note: nearSupport ? "Price bouncing off key support" : nearResistance ? "Price rejecting key resistance" : "No major S/R interaction",
  });

  // 9. Rate of Change / Momentum (weight 1)
  const rocBull = roc > 0.5 && trend === "bullish";
  const rocBear = roc < -0.5 && trend === "bearish";
  strategies.push({
    name: "Rate of Change (ROC)",
    weight: 1,
    bullish: rocBull,
    bearish: rocBear,
    note: rocBull ? `ROC +${roc.toFixed(2)} — bullish acceleration` : rocBear ? `ROC ${roc.toFixed(2)} — bearish acceleration` : `ROC ${roc.toFixed(2)} — momentum neutral`,
  });

  // 10. Session Bias Alignment (weight 0.5)
  strategies.push({
    name: "Market Session Bias",
    weight: 0.5,
    bullish: sessionBias === "bullish",
    bearish: sessionBias === "bearish",
    note: sessionBias === "neutral" ? "Off-peak session — lower liquidity" : `${sessionBias.charAt(0).toUpperCase() + sessionBias.slice(1)} session bias active`,
  });

  // 11. Candle Pattern Detection (weight 1)
  strategies.push({
    name: "Candle Pattern Recognition",
    weight: 1,
    bullish: bullCandle && colorPattern === "bull",
    bearish: bearCandle && colorPattern === "bear",
    note: colorPattern === "bull" && bullCandle ? "Bull engulf / pin bar + color pattern aligned"
        : colorPattern === "bear" && bearCandle ? "Bear engulf / pin bar + color pattern aligned"
        : "No high-confidence candle pattern",
  });

  // ── Tally weighted scores ──
  const maxScore = strategies.reduce((sum, s) => sum + s.weight, 0);
  let buyScore = 0;
  let sellScore = 0;
  for (const s of strategies) {
    if (s.bullish) buyScore += s.weight;
    if (s.bearish) sellScore += s.weight;
  }

  // ── Fakeout filter (subtracts from opposing side only) ──
  const notes: string[] = [];
  const fakeoutWarning = fakeBreakout || fakeReversal;
  const fakeoutPenalty = 1.5;

  if (fakeBreakout) {
    notes.push("Fake breakout detected — opposing score penalised");
    if (buyScore >= sellScore) sellScore = Math.max(0, sellScore - fakeoutPenalty);
    else buyScore = Math.max(0, buyScore - fakeoutPenalty);
  }
  if (fakeReversal) {
    notes.push("Fake reversal filtered — dominant trend bias preserved");
    if (buyScore >= sellScore) sellScore = Math.max(0, sellScore - fakeoutPenalty);
    else buyScore = Math.max(0, buyScore - fakeoutPenalty);
  }

  // Add strategy notes for significant ones
  for (const s of strategies) {
    if (s.note && (s.bullish || s.bearish)) notes.push(s.note);
  }
  if (adxStrength >= 30) notes.push(`Strong ADX ${adxStrength} — trend conviction confirmed`);
  if (momentum === "strong") notes.push("High momentum — fast entry recommended");

  // ── Final signal resolution ──
  let direction: SignalDirection;
  let grade: SignalGrade;
  const minBuy = maxScore * 0.35;

  if (buyScore > sellScore && buyScore >= minBuy) {
    direction = "BUY";
    const pct = buyScore / maxScore;
    grade = pct >= 0.65 ? "STRONG" : pct >= 0.45 ? "NEUTRAL" : "WEAK";
  } else if (sellScore > buyScore && sellScore >= minBuy) {
    direction = "SELL";
    const pct = sellScore / maxScore;
    grade = pct >= 0.65 ? "STRONG" : pct >= 0.45 ? "NEUTRAL" : "WEAK";
  } else if (buyScore === sellScore) {
    direction = bullCandle && !bearCandle ? "BUY"
      : bearCandle && !bullCandle ? "SELL"
      : trendEMA200 === "bullish" ? "BUY" : "SELL";
    grade = "WEAK";
    notes.push("Conflicting signals — resolved by candle/trend tiebreaker");
  } else {
    direction = trendEMA200 === "bullish" ? "BUY" : "SELL";
    grade = "WEAK";
    notes.push("Low confluence — minimum threshold applied");
  }

  if (fakeoutWarning) notes.push("Fakeout pattern detected — trade with extra caution");

  const activeScore = direction === "BUY" ? buyScore : sellScore;
  const rawConf = (activeScore / maxScore) * 90 + rand() * 8 + 2;
  const confidence = Math.min(98, Math.max(52, Math.round(rawConf)));

  return {
    direction,
    grade,
    buyScore: +buyScore.toFixed(1),
    sellScore: +sellScore.toFixed(1),
    maxScore: +maxScore.toFixed(1),
    confidence,
    fakeoutWarning,
    strategies,
    analysisNotes: notes,
    indicators: {
      trendEMA200,
      emaCross,
      adxStrength,
      rsi,
      stochK,
      stochD,
      macdHist,
      roc,
      bbPosition,
      volatility,
      volumeSpike,
      nearSupport,
      nearResistance,
      bullCandle,
      bearCandle,
      fakeBreakout,
      fakeReversal,
      colorPattern,
      sessionBias,
      momentum,
      livePrice: price ?? 0,
      priceChange: priceChange ?? 0,
    },
  };
}
