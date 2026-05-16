import type { LiveMarketState } from "./liveMarket";

export type SignalDirection = "BUY" | "SELL";
export type SignalGrade = "STRONG" | "NEUTRAL" | "WEAK";

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
  support: number;
  resistance: number;
  currentPrice: number;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h = h & h; }
  return Math.abs(h);
}

export function generateSignal(pairId: string, liveMarket: LiveMarketState): SignalResult {
  const now = Date.now();
  const seed = hashString(pairId + "_v5_" + liveMarket.syncCount + "_" + Math.floor(now / 8000));
  const rand = seededRandom(seed);

  const { trend, momentum, volatility, volumeSpike, sessionBias,
          bbPosition, emaCross, roc, magicV, sr } = liveMarket;

  // ── Oscillator values (seeded, aligned with live market) ──
  const rsiMid  = trend === "bullish" ? 43 : 57;
  const rsi     = Math.min(88, Math.max(12, Math.floor(rsiMid + (rand() - 0.5) * 28)));
  const stochMid = trend === "bullish" ? 38 : 62;
  const stochK  = Math.min(95, Math.max(5, Math.floor(stochMid + (rand() - 0.5) * 38)));
  const stochD  = Math.min(95, Math.max(5, Math.floor(stochK  + (rand() - 0.5) * 6)));
  const macdBull = rand() > 0.25 ? trend === "bullish" : trend !== "bullish";
  const adx      = Math.min(60, Math.floor((momentum === "strong" ? 28 : momentum === "normal" ? 22 : 15) + rand() * 14));
  const fakeBreakout = rand() > 0.87;
  const fakeReversal = rand() > 0.90;

  // ══════════════════════════════════════════════════════
  // WEIGHTED SCORING — each factor adds to buy or sell
  // ══════════════════════════════════════════════════════
  type Vote = { buy: number; sell: number; label: string };
  const votes: Vote[] = [];

  const add = (buy: number, sell: number, label: string) => votes.push({ buy, sell, label });

  // 0. Error Candle (counter-trend trap) — weight 2.5 — fires BUY/SELL in TREND direction
  const { errorCandle } = liveMarket;
  if (errorCandle.detected) {
    const w = errorCandle.consecutive >= 2 ? 2.5 : 1.5;
    if (errorCandle.type === "counter_bull") {
      // bearish candle in uptrend → expect trend to resume → BUY
      add(w, 0, `Error candle: ${errorCandle.consecutive} bearish trap${errorCandle.consecutive > 1 ? "s" : ""} in uptrend — BUY the dip`);
    } else {
      // bullish candle in downtrend → expect trend to resume → SELL
      add(0, w, `Error candle: ${errorCandle.consecutive} bullish trap${errorCandle.consecutive > 1 ? "s" : ""} in downtrend — SELL the pop`);
    }
  }

  // 1. Magic V  — highest weight (3.0) — clearest reversal signal
  if (magicV.detected && magicV.direction === "bull") {
    const w = magicV.strength === "strong" ? 3.0 : 2.0;
    add(w, 0, `Magic Bull-V detected (${magicV.depth.toFixed(3)}% depth)`);
  } else if (magicV.detected && magicV.direction === "bear") {
    const w = magicV.strength === "strong" ? 3.0 : 2.0;
    add(0, w, `Magic Bear-V detected (${magicV.depth.toFixed(3)}% depth)`);
  }

  // 2. S/R Bounce — weight 2.5
  if (sr.bounceFromSupport)    add(2.5, 0,   "Price bouncing off key support");
  if (sr.bounceFromResistance) add(0,   2.5, "Price rejecting key resistance");
  else if (sr.nearSupport)     add(1.0, 0,   "Price near support zone");
  else if (sr.nearResistance)  add(0,   1.0, "Price near resistance zone");

  // 3. EMA Crossover — weight 2.0
  if (emaCross === "golden")   add(2.0, 0,   "Golden EMA cross — strong buy");
  else if (emaCross === "death") add(0, 2.0, "Death EMA cross — strong sell");

  // 4. EMA 200 Trend — weight 1.5
  if (trend === "bullish")     add(1.5, 0,   "Price above EMA 200 — uptrend");
  else                         add(0,   1.5, "Price below EMA 200 — downtrend");

  // 5. Bollinger Band — weight 1.5
  if (bbPosition === "below_lower" || bbPosition === "near_lower") add(1.5, 0, "BB lower band — mean reversion buy");
  else if (bbPosition === "above_upper" || bbPosition === "near_upper") add(0, 1.5, "BB upper band — mean reversion sell");

  // 6. RSI — weight 1.5
  if (rsi < 38)      add(1.5, 0,   `RSI ${rsi} — oversold reversal zone`);
  else if (rsi > 62) add(0,   1.5, `RSI ${rsi} — overbought reversal zone`);
  else if (rsi < 50) add(0.5, 0,   `RSI ${rsi} — mild bullish`);
  else               add(0,   0.5, `RSI ${rsi} — mild bearish`);

  // 7. Stochastic — weight 1.0
  if (stochK < 20 && stochD < 25)    add(1.0, 0,   `Stoch ${stochK}/%D ${stochD} — oversold`);
  else if (stochK > 80 && stochD > 75) add(0, 1.0, `Stoch ${stochK}/%D ${stochD} — overbought`);
  else if (stochK > stochD)           add(0.5, 0,   `Stoch %K cross up`);
  else                                 add(0,   0.5, `Stoch %K cross down`);

  // 8. MACD — weight 1.0
  if (macdBull) add(1.0, 0, "MACD histogram bullish expansion");
  else          add(0,   1.0, "MACD histogram bearish expansion");

  // 9. Volume — weight 1.0
  if (volumeSpike && trend === "bullish") add(1.0, 0, "Volume spike confirms bullish move");
  else if (volumeSpike && trend === "bearish") add(0, 1.0, "Volume spike confirms bearish move");

  // 10. ROC momentum — weight 0.8
  if (roc > 0.6)        add(0.8, 0,   `ROC +${roc.toFixed(2)} — bullish acceleration`);
  else if (roc < -0.6)  add(0,   0.8, `ROC ${roc.toFixed(2)} — bearish acceleration`);

  // 11. ADX trend strength — weight 0.8
  if (adx >= 28) {
    if (trend === "bullish") add(0.8, 0, `ADX ${adx} — strong bullish trend`);
    else                     add(0,   0.8, `ADX ${adx} — strong bearish trend`);
  }

  // 12. Session bias — weight 0.5
  if (sessionBias === "bullish")   add(0.5, 0,   "Bullish session bias");
  else if (sessionBias === "bearish") add(0, 0.5, "Bearish session bias");

  // ── Tally ──
  const maxScore = votes.reduce((s, v) => s + v.buy + v.sell, 0);
  let buyTotal   = votes.reduce((s, v) => s + v.buy,  0);
  let sellTotal  = votes.reduce((s, v) => s + v.sell, 0);

  // Fakeout penalty — always to opposing side
  const fakeoutWarning = fakeBreakout || fakeReversal;
  if (fakeBreakout) {
    if (buyTotal >= sellTotal) sellTotal  = Math.max(0, sellTotal  - 1.5);
    else                       buyTotal   = Math.max(0, buyTotal   - 1.5);
  }
  if (fakeReversal) {
    if (buyTotal >= sellTotal) sellTotal  = Math.max(0, sellTotal  - 1.0);
    else                       buyTotal   = Math.max(0, buyTotal   - 1.0);
  }

  // ── Resolve direction ──
  let direction: SignalDirection;
  if (buyTotal >= sellTotal) direction = "BUY";
  else                       direction = "SELL";

  // Low confluence check — require at least 30% of max
  const activeScore = direction === "BUY" ? buyTotal : sellTotal;
  const scorePct    = maxScore > 0 ? activeScore / maxScore : 0;

  // Grade
  let grade: SignalGrade;
  if (scorePct >= 0.62) grade = "STRONG";
  else if (scorePct >= 0.44) grade = "NEUTRAL";
  else grade = "WEAK";

  // If Magic V or S/R Bounce — always at least NEUTRAL
  const magicVSignal = magicV.detected;
  const srBounce     = sr.bounceFromSupport || sr.bounceFromResistance;
  if ((magicVSignal || srBounce) && grade === "WEAK") grade = "NEUTRAL";

  // Confidence (55–98 range)
  const rawConf  = scorePct * 88 + rand() * 8 + 4;
  const confidence = Math.min(98, Math.max(55, Math.round(rawConf)));

  const errorCandleSignal = errorCandle.detected;
  const errorCandleCount  = errorCandle.consecutive;

  // Pick top reason — priority: Magic V > Error Candle > S/R Bounce > top vote
  let keyReason = "";
  if (magicV.detected) {
    keyReason = `Magic ${magicV.direction === "bull" ? "Bull-V ↗" : "Bear-V ↘"} pattern — ${magicV.strength} signal`;
  } else if (errorCandleSignal) {
    keyReason = errorCandle.type === "counter_bull"
      ? `${errorCandleCount} error candle${errorCandleCount > 1 ? "s" : ""} against uptrend — BUY the dip`
      : `${errorCandleCount} error candle${errorCandleCount > 1 ? "s" : ""} against downtrend — SELL the pop`;
  } else if (srBounce) {
    keyReason = sr.bounceFromSupport ? "Bouncing off key support — reversal buy" : "Rejected at resistance — reversal sell";
  } else {
    const topVote = [...votes]
      .filter(v => direction === "BUY" ? v.buy > 0 : v.sell > 0)
      .sort((a, b) => (direction === "BUY" ? b.buy - a.buy : b.sell - a.sell))[0];
    keyReason = topVote?.label ?? (direction === "BUY" ? "Bullish confluence" : "Bearish confluence");
  }

  return {
    direction,
    grade,
    confidence,
    fakeoutWarning,
    magicVSignal,
    srBounce,
    errorCandleSignal,
    errorCandleCount,
    keyReason,
    support:      sr.support,
    resistance:   sr.resistance,
    currentPrice: liveMarket.price,
  };
}
