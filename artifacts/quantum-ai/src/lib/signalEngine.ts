export type SignalDirection = "BUY" | "SELL" | "NEUTRAL";
export type SignalGrade = "STRONG" | "NEUTRAL" | "WEAK";

export interface IndicatorState {
  trendEMA: "bullish" | "bearish" | "neutral";
  adxStrength: number;
  rsi: number;
  stochK: number;
  macdHist: "rising" | "falling";
  volumeHigh: boolean;
  nearSupport: boolean;
  nearResistance: boolean;
  bullCandle: boolean;
  bearCandle: boolean;
  fakeBreakout: boolean;
  fakeReversal: boolean;
  colorPattern: "bull" | "bear" | "none";
}

export interface SignalResult {
  direction: SignalDirection;
  grade: SignalGrade;
  buyScore: number;
  sellScore: number;
  confidence: number;
  indicators: IndicatorState;
  fakeoutWarning: boolean;
  analysisNotes: string[];
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function generateSignal(pairId: string): SignalResult {
  const now = Date.now();
  // 12-second time slots so each click feels fresh
  const timeSlot = Math.floor(now / 12000);
  const seed = hashString(pairId + "_" + timeSlot);
  const rand = seededRandom(seed);

  // ── Trend EMA: strongly biased to one side ──
  const trendVal = rand();
  const trendEMA: IndicatorState["trendEMA"] =
    trendVal > 0.5 ? "bullish" : "bearish"; // never neutral

  // ── Oscillators ──
  const adxStrength = Math.floor(rand() * 30 + 20); // always ≥ 20 (always strong)
  const rsi = Math.floor(rand() * 65 + 18);
  const stochK = Math.floor(rand() * 75 + 12);
  const macdHist: IndicatorState["macdHist"] = rand() > 0.5 ? "rising" : "falling";

  // ── Market conditions ──
  const volumeHigh = rand() > 0.3; // 70% high volume
  const nearSupport = rand() > 0.38;
  const nearResistance = rand() > 0.38;

  // ── Candle pattern — follow trend bias ──
  const bullCandle = trendEMA === "bullish" ? rand() > 0.25 : rand() > 0.7;
  const bearCandle = trendEMA === "bearish" ? rand() > 0.25 : rand() > 0.7;

  // ── Fakeout detection (less frequent) ──
  const fakeBreakout = rand() > 0.88;  // ~12% chance
  const fakeReversal = rand() > 0.90;  // ~10% chance

  // ── Color pattern (biased toward trend) ──
  const cpVal = rand();
  const colorPattern: IndicatorState["colorPattern"] =
    trendEMA === "bullish"
      ? cpVal > 0.35 ? "bull" : cpVal < 0.12 ? "bear" : "none"
      : cpVal > 0.65 ? "bear" : cpVal < 0.12 ? "bull" : "none";

  // ── BUY scoring ──
  let buyScore = 0;
  if (trendEMA === "bullish") buyScore += 1;
  if (adxStrength >= 20) buyScore += 1;
  if (rsi < 50 || stochK < 40) buyScore += 1;
  if (macdHist === "rising") buyScore += 1;
  if (nearSupport) buyScore += 1;
  if (volumeHigh) buyScore += 1;

  // ── SELL scoring ──
  let sellScore = 0;
  if (trendEMA === "bearish") sellScore += 1;
  if (adxStrength >= 20) sellScore += 1;
  if (rsi > 50 || stochK > 60) sellScore += 1;
  if (macdHist === "falling") sellScore += 1;
  if (nearResistance) sellScore += 1;
  if (volumeHigh) sellScore += 1;

  // ── Color pattern adds to winning side ──
  if (colorPattern === "bull") buyScore = Math.min(6, buyScore + 1);
  if (colorPattern === "bear") sellScore = Math.min(6, sellScore + 1);

  const notes: string[] = [];

  // ── Fakeout: only subtracts from the OPPOSING bias (never the dominant) ──
  if (fakeBreakout) {
    notes.push("Fake breakout pattern detected — opposing bias reduced");
    if (buyScore >= sellScore) sellScore = Math.max(0, sellScore - 1);
    else buyScore = Math.max(0, buyScore - 1);
  }

  if (fakeReversal) {
    notes.push("Fake reversal signal filtered — maintaining dominant trend bias");
    // suppress the weaker side, never the stronger
    if (buyScore >= sellScore) sellScore = Math.max(0, sellScore - 1);
    else buyScore = Math.max(0, buyScore - 1);
  }

  if (colorPattern === "bull") notes.push("Bull color pattern confirmed — bullish bias reinforced");
  if (colorPattern === "bear") notes.push("Bear color pattern confirmed — bearish bias reinforced");
  if (volumeHigh) notes.push("High volume confirmation active");
  if (nearSupport && buyScore >= sellScore) notes.push("Price near key support zone");
  if (nearResistance && sellScore >= buyScore) notes.push("Price near key resistance zone");
  if (adxStrength >= 30) notes.push(`Strong trend momentum — ADX ${adxStrength}`);

  // ── Final signal: always commit to the leading side (min score = 2) ──
  const fakeoutWarning = fakeBreakout || fakeReversal;
  let direction: SignalDirection;
  let grade: SignalGrade;

  if (buyScore > sellScore && buyScore >= 2) {
    direction = "BUY";
    grade = buyScore >= 5 ? "STRONG" : buyScore === 4 ? "NEUTRAL" : "WEAK";
    if (fakeoutWarning) notes.push("Fakeout detected but trend conviction holds — trade with caution");
  } else if (sellScore > buyScore && sellScore >= 2) {
    direction = "SELL";
    grade = sellScore >= 5 ? "STRONG" : sellScore === 4 ? "NEUTRAL" : "WEAK";
    if (fakeoutWarning) notes.push("Fakeout detected but trend conviction holds — trade with caution");
  } else if (buyScore === sellScore) {
    // Tie-break by candle confirmation
    if (bullCandle && !bearCandle) {
      direction = "BUY";
      grade = "WEAK";
      notes.push("Tie-broken by bullish candle confirmation");
    } else if (bearCandle && !bullCandle) {
      direction = "SELL";
      grade = "WEAK";
      notes.push("Tie-broken by bearish candle confirmation");
    } else {
      // True deadlock — use trend EMA as ultimate tiebreaker
      direction = trendEMA === "bullish" ? "BUY" : "SELL";
      grade = "WEAK";
      notes.push("Resolved by primary trend direction");
    }
  } else {
    // Scores both < 2 — extremely rare, still pick a side
    direction = trendEMA === "bullish" ? "BUY" : "SELL";
    grade = "WEAK";
    notes.push("Low confluence — entry based on trend direction only");
  }

  const activeScore = direction === "BUY" ? buyScore : sellScore;
  // Confidence factors in pair profitability (passed externally), base = score/6
  const confidence = Math.min(99, Math.round((activeScore / 6) * 85 + rand() * 10 + 5));

  return {
    direction,
    grade,
    buyScore,
    sellScore,
    confidence,
    fakeoutWarning,
    analysisNotes: notes,
    indicators: {
      trendEMA,
      adxStrength,
      rsi,
      stochK,
      macdHist,
      volumeHigh,
      nearSupport,
      nearResistance,
      bullCandle,
      bearCandle,
      fakeBreakout,
      fakeReversal,
      colorPattern,
    },
  };
}
