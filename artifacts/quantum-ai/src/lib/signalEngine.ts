export type SignalDirection = "BUY" | "SELL" | "NEUTRAL";
export type SignalGrade = "A" | "B" | "C" | "NEUTRAL";

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
  const timeSlot = Math.floor(now / 8000);
  const seed = hashString(pairId + "_" + timeSlot);
  const rand = seededRandom(seed);

  const trendVal = rand();
  const trendEMA: IndicatorState["trendEMA"] =
    trendVal > 0.55 ? "bullish" : trendVal < 0.45 ? "bearish" : "neutral";

  const adxStrength = Math.floor(rand() * 40 + 12);
  const rsi = Math.floor(rand() * 70 + 15);
  const stochK = Math.floor(rand() * 80 + 10);
  const macdHist: IndicatorState["macdHist"] = rand() > 0.5 ? "rising" : "falling";
  const volumeHigh = rand() > 0.45;
  const nearSupport = rand() > 0.6;
  const nearResistance = rand() > 0.6;
  const bullCandle = rand() > 0.48;
  const bearCandle = !bullCandle && rand() > 0.1;

  const fakeBreakout = rand() > 0.78;
  const fakeReversal = rand() > 0.82;
  const colorPatternVal = rand();
  const colorPattern: IndicatorState["colorPattern"] =
    colorPatternVal > 0.65 ? "bull" : colorPatternVal < 0.35 ? "bear" : "none";

  let buyScore = 0;
  if (trendEMA === "bullish") buyScore += 1;
  if (adxStrength >= 20) buyScore += 1;
  if (rsi < 45 || stochK < 30) buyScore += 1;
  if (macdHist === "rising") buyScore += 1;
  if (nearSupport) buyScore += 1;
  if (volumeHigh) buyScore += 1;

  let sellScore = 0;
  if (trendEMA === "bearish") sellScore += 1;
  if (adxStrength >= 20) sellScore += 1;
  if (rsi > 55 || stochK > 70) sellScore += 1;
  if (macdHist === "falling") sellScore += 1;
  if (nearResistance) sellScore += 1;
  if (volumeHigh) sellScore += 1;

  if (colorPattern === "bull") buyScore = Math.min(6, buyScore + 1);
  if (colorPattern === "bear") sellScore = Math.min(6, sellScore + 1);

  const fakeoutWarning = fakeBreakout || fakeReversal;
  const notes: string[] = [];

  if (fakeBreakout) {
    notes.push("Fake breakout pattern detected — reducing opposing bias");
    if (buyScore > sellScore) sellScore = Math.max(0, sellScore - 1);
    else buyScore = Math.max(0, buyScore - 1);
  }

  if (fakeReversal) {
    notes.push("Fake reversal pattern detected — signal reliability reduced");
    if (buyScore > sellScore) buyScore = Math.max(0, buyScore - 1);
    else sellScore = Math.max(0, sellScore - 1);
  }

  if (colorPattern === "bull") notes.push("Bull color pattern confirmed — bias reinforced");
  if (colorPattern === "bear") notes.push("Bear color pattern confirmed — bias reinforced");
  if (volumeHigh) notes.push("High volume confirmation active");
  if (nearSupport && buyScore >= sellScore) notes.push("Price near key support zone");
  if (nearResistance && sellScore >= buyScore) notes.push("Price near key resistance zone");

  const minPoints = 3;
  const buySignal = buyScore >= minPoints && bullCandle;
  const sellSignal = sellScore >= minPoints && bearCandle;

  const conflicting = fakeoutWarning && Math.abs(buyScore - sellScore) <= 1;

  let direction: SignalDirection = "NEUTRAL";
  let grade: SignalGrade = "NEUTRAL";

  if (conflicting) {
    notes.push("Conflicting fakeout signals — downgraded to NEUTRAL");
    direction = "NEUTRAL";
    grade = "NEUTRAL";
  } else if (buySignal && buyScore > sellScore) {
    direction = "BUY";
    grade = buyScore >= 5 ? "A" : buyScore === 4 ? "B" : "C";
  } else if (sellSignal && sellScore > buyScore) {
    direction = "SELL";
    grade = sellScore >= 5 ? "A" : sellScore === 4 ? "B" : "C";
  } else {
    direction = "NEUTRAL";
    grade = "NEUTRAL";
  }

  const maxScore = Math.max(buyScore, sellScore);
  const confidence = Math.round((maxScore / 6) * 100);

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
