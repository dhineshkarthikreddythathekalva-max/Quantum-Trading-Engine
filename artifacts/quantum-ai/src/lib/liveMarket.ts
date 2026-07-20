import { useState, useEffect, useRef } from "react";

/* ── OHLC Candle ── */
export interface Candle {
  open: number; high: number; low: number; close: number; volume: number;
}

/* ── Computed Indicators ── */
export interface Indicators {
  rsi14: number;                  // 0–100, Wilder's RSI
  macdLine: number;               // MACD line value
  macdSignal: number;             // MACD signal EMA(9)
  macdHist: number;               // histogram = macdLine - macdSignal
  macdCross: "bullish" | "bearish" | "none"; // fresh crossover in last 2 bars
  stochK: number;                 // Stoch %K (0–100)
  stochD: number;                 // Stoch %D (0–100)
  stochSignal: "oversold" | "overbought" | "neutral";
  adx: number;                    // ADX strength (0–100)
  plusDI: number;
  minusDI: number;
  bbUpper: number;
  bbMid: number;
  bbLower: number;
  bbPct: number;                  // 0=at lower, 1=at upper
  ema10: number;
  ema21: number;
  ema50: number;
  ema200: number;
  emaTrend: "bullish" | "bearish";  // ema10 vs ema21
  emaBias: "bullish" | "bearish";   // price vs ema50
}

/* ── Candlestick Patterns ── */
export interface CandlePatterns {
  pinBarBull: boolean;         // long lower wick, small body — buy signal
  pinBarBear: boolean;         // long upper wick, small body — sell signal
  engulfingBull: boolean;      // bullish engulfing
  engulfingBear: boolean;      // bearish engulfing
  hammerBull: boolean;         // hammer at bottom of downtrend
  shootingStarBear: boolean;   // shooting star at top of uptrend
  dojiReversal: boolean;       // indecision at extreme → reversal
  insideBarBreakout: "bull" | "bear" | "none";
  tweezers: "bull" | "bear" | "none";  // tweezer top/bottom
  strongBullCandle: boolean;   // large full-body bull candle
  strongBearCandle: boolean;   // large full-body bear candle
}

/* ── Market Structure ── */
export interface MarketStructure {
  trend: "bullish" | "bearish" | "ranging";
  trendStrength: number;       // 0–1
  swingHigh: number;
  swingLow: number;
  higherHighs: boolean;
  lowerLows: boolean;
  momentum: "strong" | "normal" | "weak";
}

/* ── S/R Zones (swing-based) ── */
export interface SRZones {
  support: number;
  resistance: number;
  nearSupport: boolean;
  nearResistance: boolean;
  bounceFromSupport: boolean;
  bounceFromResistance: boolean;
  atKeyLevel: boolean;
}

/* ── Volume ── */
export interface VolumeData {
  current: number;
  avg20: number;
  spike: boolean;       // current > 1.5× avg
  trend: "rising" | "falling" | "neutral";
}

/* ── Full Live Market State ── */
export interface LiveMarketState {
  price: number;
  priceChange: number;
  candles: Candle[];            // last 80 OHLC candles
  indicators: Indicators;
  patterns: CandlePatterns;
  structure: MarketStructure;
  sr: SRZones;
  volume: VolumeData;
  sessionBias: "bullish" | "bearish" | "neutral";
  lastSync: Date;
  syncCount: number;
}

/* ═══════════════════════════════════════════
   SEEDED RNG — deterministic, pair+tick based
═══════════════════════════════════════════ */
function seededRand(seed: number) {
  let s = seed | 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
    s = Math.imul(s ^ (s >>> 12), 0x297a2d39);
    s = (s ^ (s >>> 15)) >>> 0;
    return s / 0x100000000;
  };
}
function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const BASE_PRICES: Record<string, number> = {
  default: 1.0,
  eur_usd: 1.0845, gbp_usd: 1.2720, aud_usd: 0.6540, usd_jpy: 154.20,
  eur_gbp: 0.8520, aud_jpy: 100.85, cad_jpy: 112.30, gbp_jpy: 196.40,
  chf_jpy: 170.20, eur_jpy: 167.50, aud_cad: 0.9010, eur_aud: 1.6580,
  eur_cad: 1.4840, gbp_aud: 1.9430, gbp_cad: 1.7280, gbp_chf: 1.1390,
  eur_chf: 0.9760, usd_cad: 1.3690, usd_brl_otc: 5.1250, nzd_jpy_otc: 91.40,
  usd_ars_otc: 870.50, usd_mxn_otc: 17.23, aud_nzd_otc: 1.0870, eur_nzd_otc: 1.8050,
  usd_egp_otc: 30.95, usd_idr_otc: 15820, usd_zar_otc: 18.65, usd_dzd_otc: 134.80,
  nzd_usd_otc: 0.6020, btc_otc: 67450, eth_otc: 3280, xrp_otc: 0.5820,
  ltc_otc: 82.50, bch_otc: 495.20, bnb_otc: 608.40, avax_otc: 38.70,
  zec_otc: 24.80, atom_otc: 9.45, dash_otc: 32.10, sol_otc: 178.50,
  ton_otc: 7.32, etc_otc: 28.90, dot_otc: 8.15, axs_otc: 7.85,
  trump_otc: 12.40, link_otc: 18.70, ukbrent_otc: 83.40, uscrude_otc: 79.20,
  gold: 2340, silver: 28.40, intc_otc: 30.25, jnj_otc: 148.60,
  msft_otc: 415.80, mcd_otc: 295.40, ba_otc: 178.90, axp_otc: 236.70,
  fb_otc: 512.30, pfe_otc: 28.60, nikkei_otc: 38750, asx_otc: 7820,
};

/* ═══════════════════════════════════════════
   OHLC CANDLE GENERATION
   Produces 80 candles with realistic structure:
   - Persistent trend phases (~25–40 candles)
   - Mean reversion pullbacks within trend
   - Realistic wick structures
═══════════════════════════════════════════ */
function buildCandles(pairId: string, syncCount: number, count = 80): Candle[] {
  const base = BASE_PRICES[pairId] ?? BASE_PRICES.default;
  const pip  = base > 100 ? 0.01 : base > 1 ? 0.0001 : 0.00001;
  const dec  = base > 100 ? 2 : 5;

  // Market phase: trend changes every 25–40 candles
  const phaseLen    = 30;
  const phaseSlot   = Math.floor(syncCount / phaseLen);
  const phaseRand   = seededRand(hashStr(pairId + "_phase_" + phaseSlot));
  const trendDir    = phaseRand() > 0.5 ? 1 : -1;
  const trendStrong = phaseRand() > 0.35;          // 65% chance of trending market
  const baseDrift   = trendDir * pip * (trendStrong ? 1.4 : 0.5);
  const volatMult   = 0.8 + phaseRand() * 1.2;

  // Within phase: position 0–1 (0=phase start, 1=phase end)
  const phasePos  = (syncCount % phaseLen) / phaseLen;

  const candles: Candle[] = [];
  let close = base;

  // Replay from far back so we have proper history for all indicators
  const startTick = Math.max(0, syncCount - count + 1);

  for (let tick = startTick; tick <= syncCount; tick++) {
    const r = seededRand(hashStr(pairId + "_c_" + tick));

    // Drift: main trend + small mean-reversion pull
    const meanRevert  = (base - close) / base * 0.4;
    const noise       = (r() - 0.5) * pip * 2.5 * volatMult;
    const closeChange = baseDrift + noise + meanRevert * pip;

    const open     = close;
    const newClose = parseFloat((open + closeChange).toFixed(dec));

    // Realistic wicks: bigger on reversal candles
    const bodySize  = Math.abs(newClose - open);
    const wickScale = 0.5 + r() * 1.5;
    const upperWick = bodySize * wickScale * r() * volatMult;
    const lowerWick = bodySize * wickScale * r() * volatMult;

    const high   = parseFloat((Math.max(open, newClose) + upperWick * pip * 2).toFixed(dec));
    const low    = parseFloat((Math.min(open, newClose) - lowerWick * pip * 2).toFixed(dec));
    const volume = parseFloat((100 + r() * 900 + (r() > 0.8 ? r() * 800 : 0)).toFixed(0));

    if (tick >= startTick) {
      candles.push({ open, high, low, close: newClose, volume });
    }
    close = newClose;
  }

  // Ensure we have exactly `count` candles
  while (candles.length < count) {
    const last = candles[0] ?? { open: base, high: base, low: base, close: base, volume: 200 };
    candles.unshift({ ...last });
  }

  // Phase-aware micro-structure: inject occasional pullbacks within trends
  // This creates realistic HH/HL structure in uptrends and LH/LL in downtrends
  if (trendStrong && phasePos > 0.15) {
    const r2 = seededRand(hashStr(pairId + "_micro_" + phaseSlot));
    for (let i = 5; i < candles.length - 3; i += Math.floor(5 + r2() * 6)) {
      // Insert a 1-2 candle pullback
      if (r2() > 0.5) {
        candles[i].close = parseFloat((candles[i].open - trendDir * pip * (0.5 + r2())).toFixed(dec));
        candles[i].low   = Math.min(candles[i].low, candles[i].close - pip * r2());
      }
    }
  }

  return candles;
}

/* ═══════════════════════════════════════════
   REAL INDICATOR COMPUTATIONS
═══════════════════════════════════════════ */

/** Exponential Moving Average */
function calcEMA(data: number[], period: number): number[] {
  if (data.length < period) return data.map(() => data[0] ?? 0);
  const k      = 2 / (period + 1);
  const result = new Array(data.length).fill(0);
  // Seed with SMA of first `period` values
  result[period - 1] = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/** Wilder's RSI (period=14) */
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

/** MACD (12,26,9) */
function calcMACD(closes: number[]): { line: number; signal: number; hist: number; prevLine: number; prevSignal: number } {
  if (closes.length < 35) return { line: 0, signal: 0, hist: 0, prevLine: 0, prevSignal: 0 };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdArr = ema12.map((v, i) => v - ema26[i]).slice(25);
  if (macdArr.length < 9) return { line: 0, signal: 0, hist: 0, prevLine: 0, prevSignal: 0 };
  const signalArr = calcEMA(macdArr, 9);
  const n = signalArr.length;
  const line   = macdArr[n - 1];
  const signal = signalArr[n - 1];
  return {
    line, signal, hist: line - signal,
    prevLine: macdArr[n - 2] ?? line,
    prevSignal: signalArr[n - 2] ?? signal,
  };
}

/** Stochastic %K and %D (14,3) */
function calcStochastic(candles: Candle[], k = 14, d = 3): { k: number; d: number } {
  if (candles.length < k + d) return { k: 50, d: 50 };
  const kArr: number[] = [];
  for (let i = k - 1; i < candles.length; i++) {
    const slice  = candles.slice(i - k + 1, i + 1);
    const hi     = Math.max(...slice.map(c => c.high));
    const lo     = Math.min(...slice.map(c => c.low));
    const kVal   = hi !== lo ? ((candles[i].close - lo) / (hi - lo)) * 100 : 50;
    kArr.push(kVal);
  }
  const dArr = calcEMA(kArr, d);
  return { k: kArr[kArr.length - 1], d: dArr[dArr.length - 1] };
}

/** Bollinger Bands (20, 2) */
function calcBB(closes: number[], period = 20, mult = 2): { upper: number; mid: number; lower: number; pct: number } {
  if (closes.length < period) return { upper: closes[closes.length - 1] * 1.002, mid: closes[closes.length - 1], lower: closes[closes.length - 1] * 0.998, pct: 0.5 };
  const slice  = closes.slice(-period);
  const mid    = slice.reduce((a, b) => a + b, 0) / period;
  const std    = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper  = mid + mult * std;
  const lower  = mid - mult * std;
  const price  = closes[closes.length - 1];
  const pct    = upper !== lower ? (price - lower) / (upper - lower) : 0.5;
  return { upper, mid, lower, pct: Math.max(0, Math.min(1, pct)) };
}

/** ADX (14) — from true range + directional movement */
function calcADX(candles: Candle[], period = 14): { adx: number; pdi: number; mdi: number } {
  if (candles.length < period * 2) return { adx: 25, pdi: 25, mdi: 25 };

  const trArr: number[]   = [];
  const pdmArr: number[]  = [];
  const mdmArr: number[]  = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr  = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const pdm = c.high - p.high > p.low - c.low ? Math.max(c.high - p.high, 0) : 0;
    const mdm = p.low - c.low > c.high - p.high ? Math.max(p.low - c.low, 0) : 0;
    trArr.push(tr); pdmArr.push(pdm); mdmArr.push(mdm);
  }

  // Wilder smoothing
  let atr  = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let apdm = pdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  let amdm = mdmArr.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArr: number[] = [];
  for (let i = period; i < trArr.length; i++) {
    atr  = atr  - atr  / period + trArr[i];
    apdm = apdm - apdm / period + pdmArr[i];
    amdm = amdm - amdm / period + mdmArr[i];
    const pdi = atr > 0 ? (apdm / atr) * 100 : 0;
    const mdi = atr > 0 ? (amdm / atr) * 100 : 0;
    const dx  = pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
    dxArr.push(dx);
  }

  if (dxArr.length < period) return { adx: 25, pdi: 25, mdi: 25 };

  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
  }

  // Get last pdi/mdi
  const n    = trArr.length;
  let atr2   = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let apdm2  = pdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  let amdm2  = mdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  for (let i = period; i < n; i++) {
    atr2  = atr2  - atr2  / period + trArr[i];
    apdm2 = apdm2 - apdm2 / period + pdmArr[i];
    amdm2 = amdm2 - amdm2 / period + mdmArr[i];
  }
  const finalPDI = atr2 > 0 ? (apdm2 / atr2) * 100 : 0;
  const finalMDI = atr2 > 0 ? (amdm2 / atr2) * 100 : 0;

  return { adx: adxVal, pdi: finalPDI, mdi: finalMDI };
}

/* ═══════════════════════════════════════════
   CANDLESTICK PATTERN DETECTION
   Uses last 3 candles (c2=oldest, c1=prev, c0=latest)
═══════════════════════════════════════════ */
function detectPatterns(candles: Candle[], trend: "bullish" | "bearish" | "ranging"): CandlePatterns {
  const n = candles.length;
  if (n < 3) return {
    pinBarBull: false, pinBarBear: false, engulfingBull: false, engulfingBear: false,
    hammerBull: false, shootingStarBear: false, dojiReversal: false,
    insideBarBreakout: "none", tweezers: "none", strongBullCandle: false, strongBearCandle: false,
  };

  const c0 = candles[n - 1];  // current/latest candle
  const c1 = candles[n - 2];  // previous candle
  const c2 = candles[n - 3];  // 2 candles ago

  const body0   = Math.abs(c0.close - c0.open);
  const range0  = c0.high - c0.low || 0.000001;
  const upper0  = (c0.close >= c0.open ? c0.high - c0.close : c0.high - c0.open);
  const lower0  = (c0.close >= c0.open ? c0.open - c0.low  : c0.close - c0.low);

  const body1   = Math.abs(c1.close - c1.open);
  const range1  = c1.high - c1.low || 0.000001;
  const isBull0 = c0.close > c0.open;
  const isBull1 = c1.close > c1.open;

  // Pin bar: body < 30% of range, wick on one side > 60%
  const pinBarBull = lower0 / range0 > 0.60 && body0 / range0 < 0.35 && !isBull0 === false || (lower0 / range0 > 0.55 && body0 / range0 < 0.30);
  const pinBarBear = upper0 / range0 > 0.60 && body0 / range0 < 0.35 || (upper0 / range0 > 0.55 && body0 / range0 < 0.30);

  // Hammer: long lower wick (≥2× body), small upper wick, in downtrend
  const hammerBull = lower0 >= body0 * 2.0 && upper0 < body0 * 0.5 && trend === "bearish";

  // Shooting star: long upper wick (≥2× body), small lower wick, in uptrend
  const shootingStarBear = upper0 >= body0 * 2.0 && lower0 < body0 * 0.5 && trend === "bullish";

  // Bullish engulfing: c1 bearish, c0 bullish and fully engulfs c1
  const engulfingBull = !isBull1 && isBull0 && c0.open < c1.close && c0.close > c1.open;
  // Bearish engulfing: c1 bullish, c0 bearish and fully engulfs c1
  const engulfingBear = isBull1 && !isBull0 && c0.open > c1.close && c0.close < c1.open;

  // Doji: body < 10% of range — reversal signal if at extreme
  const isDoji     = body0 / range0 < 0.10;
  const dojiReversal = isDoji && (trend !== "ranging");

  // Inside bar: c0 inside c1's range → breakout direction
  const insideBar = c0.high < c1.high && c0.low > c1.low;
  const insideBarBreakout: "bull" | "bear" | "none" = insideBar
    ? (trend === "bullish" ? "bull" : trend === "bearish" ? "bear" : "none") : "none";

  // Tweezer tops/bottoms
  const tweezersTop    = Math.abs(c0.high - c1.high) / (c0.high || 1) < 0.001 && isBull1 && !isBull0;
  const tweezersBottom = Math.abs(c0.low - c1.low) / (c0.low || 1) < 0.001 && !isBull1 && isBull0;
  const tweezers: "bull" | "bear" | "none" = tweezersBottom ? "bull" : tweezersTop ? "bear" : "none";

  // Strong body candle: body > 60% of range
  const strongBullCandle = isBull0 && body0 / range0 > 0.60;
  const strongBearCandle = !isBull0 && body0 / range0 > 0.60;

  // Avoid false pins — pin bar must have real body size relative to recent candles
  const avgRange = (range0 + range1 + (c2.high - c2.low)) / 3;
  const validPinSize = range0 > avgRange * 0.5;

  return {
    pinBarBull: pinBarBull && validPinSize,
    pinBarBear: pinBarBear && validPinSize,
    engulfingBull, engulfingBear,
    hammerBull, shootingStarBear,
    dojiReversal,
    insideBarBreakout,
    tweezers,
    strongBullCandle, strongBearCandle,
  };
}

/* ═══════════════════════════════════════════
   MARKET STRUCTURE (Swing H/L based)
═══════════════════════════════════════════ */
function analyzeStructure(candles: Candle[]): MarketStructure {
  if (candles.length < 10) return { trend: "ranging", trendStrength: 0, swingHigh: 0, swingLow: 0, higherHighs: false, lowerLows: false, momentum: "weak" };

  const n = candles.length;

  // Find swing highs/lows in last 20 candles
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 2; i < Math.min(n, 20) - 2; i++) {
    const idx = n - 1 - i;
    if (candles[idx].high > candles[idx - 1].high && candles[idx].high > candles[idx - 2].high &&
        candles[idx].high > candles[idx + 1].high && candles[idx].high > candles[idx + 2].high) {
      swingHighs.push(candles[idx].high);
    }
    if (candles[idx].low < candles[idx - 1].low && candles[idx].low < candles[idx - 2].low &&
        candles[idx].low < candles[idx + 1].low && candles[idx].low < candles[idx + 2].low) {
      swingLows.push(candles[idx].low);
    }
  }

  const swingHigh = swingHighs.length ? swingHighs[0] : candles[n - 1].high;
  const swingLow  = swingLows.length ? swingLows[0] : candles[n - 1].low;

  // Higher highs / lower lows
  const higherHighs = swingHighs.length >= 2 && swingHighs[0] > swingHighs[1];
  const lowerLows   = swingLows.length >= 2 && swingLows[0] < swingLows[1];

  // Trend strength: % of candles closing in trend direction
  const closes = candles.slice(-20).map(c => c.close);
  const bullish = closes.filter((c, i) => i > 0 && c > closes[i - 1]).length;
  const trendPct = bullish / (closes.length - 1);
  const trendStrength = Math.abs(trendPct - 0.5) * 2;

  const trend: "bullish" | "bearish" | "ranging" =
    higherHighs && trendPct > 0.55 ? "bullish" :
    lowerLows && trendPct < 0.45 ? "bearish" :
    trendStrength < 0.25 ? "ranging" :
    trendPct > 0.55 ? "bullish" : "bearish";

  // Momentum: rate of change of last 5 candles
  const roc5 = Math.abs(candles[n - 1].close - candles[n - 5].close) / candles[n - 5].close * 100;
  const momentum: "strong" | "normal" | "weak" = roc5 > 0.08 ? "strong" : roc5 > 0.03 ? "normal" : "weak";

  return { trend, trendStrength, swingHigh, swingLow, higherHighs, lowerLows, momentum };
}

/* ═══════════════════════════════════════════
   S/R FROM SWING POINTS (more accurate)
═══════════════════════════════════════════ */
function calcSR(candles: Candle[], price: number): SRZones {
  if (candles.length < 10) {
    return { support: price * 0.998, resistance: price * 1.002, nearSupport: false, nearResistance: false, bounceFromSupport: false, bounceFromResistance: false, atKeyLevel: false };
  }

  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const n      = candles.length;

  // Most significant level = most tested price zone
  const resistance = Math.max(...highs.slice(-30));
  const support    = Math.min(...lows.slice(-30));

  const range     = resistance - support || price * 0.01;
  const threshold = range * 0.08;
  const prevClose = candles[n - 2]?.close ?? price;

  const nearS  = price - support     < threshold;
  const nearR  = resistance - price  < threshold;

  return {
    support, resistance,
    nearSupport: nearS, nearResistance: nearR,
    bounceFromSupport:    nearS && price > prevClose,
    bounceFromResistance: nearR && price < prevClose,
    atKeyLevel: nearS || nearR,
  };
}

/* ═══════════════════════════════════════════
   VOLUME ANALYSIS
═══════════════════════════════════════════ */
function analyzeVolume(candles: Candle[]): VolumeData {
  if (candles.length < 5) return { current: 200, avg20: 200, spike: false, trend: "neutral" };
  const n       = candles.length;
  const current = candles[n - 1].volume;
  const avg20   = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / Math.min(20, candles.length);
  const avg5    = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
  const prev5   = candles.slice(-10, -5).reduce((a, c) => a + c.volume, 0) / 5;
  return {
    current, avg20,
    spike: current > avg20 * 1.5,
    trend: avg5 > prev5 * 1.1 ? "rising" : avg5 < prev5 * 0.9 ? "falling" : "neutral",
  };
}

/* ═══════════════════════════════════════════
   MASTER COMPUTE FUNCTION
═══════════════════════════════════════════ */
export function computeMarketState(pairId: string, syncCount: number): Omit<LiveMarketState, "lastSync" | "syncCount"> {
  const candles  = buildCandles(pairId, syncCount, 80);
  const n        = candles.length;
  const price    = candles[n - 1].close;
  const prevClose = candles[n - 2]?.close ?? price;
  const priceChange = +((price - prevClose) / prevClose * 100).toFixed(4);
  const closes   = candles.map(c => c.close);

  // Real indicators
  const rsi14  = +calcRSI(closes, 14).toFixed(2);
  const macdR  = calcMACD(closes);
  const stochR = calcStochastic(candles, 14, 3);
  const bbR    = calcBB(closes, 20, 2);
  const adxR   = calcADX(candles, 14);

  const ema10Arr  = calcEMA(closes, 10);
  const ema21Arr  = calcEMA(closes, 21);
  const ema50Arr  = calcEMA(closes, 50);
  const ema200Arr = calcEMA(closes, 200);

  const ema10  = ema10Arr[n - 1];
  const ema21  = ema21Arr[n - 1];
  const ema50  = ema50Arr[n - 1] ?? closes[0];
  const ema200 = ema200Arr[n - 1] ?? closes[0];

  const prevMacd   = macdR.prevLine;
  const prevSig    = macdR.prevSignal;
  const macdCross: "bullish" | "bearish" | "none" =
    prevMacd < prevSig && macdR.line >= macdR.signal ? "bullish" :
    prevMacd > prevSig && macdR.line <= macdR.signal ? "bearish" : "none";

  const stochSignal: "oversold" | "overbought" | "neutral" =
    stochR.k < 20 && stochR.d < 25 ? "oversold" :
    stochR.k > 80 && stochR.d > 75 ? "overbought" : "neutral";

  const indicators: Indicators = {
    rsi14, macdLine: macdR.line, macdSignal: macdR.signal, macdHist: macdR.hist,
    macdCross, stochK: +stochR.k.toFixed(1), stochD: +stochR.d.toFixed(1), stochSignal,
    adx: +adxR.adx.toFixed(1), plusDI: +adxR.pdi.toFixed(1), minusDI: +adxR.mdi.toFixed(1),
    bbUpper: bbR.upper, bbMid: bbR.mid, bbLower: bbR.lower, bbPct: bbR.pct,
    ema10, ema21, ema50, ema200,
    emaTrend: ema10 > ema21 ? "bullish" : "bearish",
    emaBias: price > ema50 ? "bullish" : "bearish",
  };

  const structure = analyzeStructure(candles);
  const patterns  = detectPatterns(candles, structure.trend);
  const sr        = calcSR(candles, price);
  const volume    = analyzeVolume(candles);

  // Session bias (real UTC hours)
  const hour = new Date().getUTCHours();
  const sessionBias: LiveMarketState["sessionBias"] =
    (hour >= 7 && hour < 9) || (hour >= 12 && hour < 16) ? (structure.trend === "bullish" ? "bullish" : "bearish") :
    (hour >= 0 && hour < 3) ? "neutral" : "neutral";

  return { price, priceChange, candles, indicators, patterns, structure, sr, volume, sessionBias };
}

export function useLiveMarket(pairId: string | null): LiveMarketState | null {
  const [state, setState] = useState<LiveMarketState | null>(null);
  const syncCountRef = useRef(80);

  useEffect(() => {
    if (!pairId) { setState(null); return; }
    const sync = () => {
      syncCountRef.current += 1;
      const mkt = computeMarketState(pairId!, syncCountRef.current);
      setState({ ...mkt, lastSync: new Date(), syncCount: syncCountRef.current });
    };
    sync();
    const t = setInterval(sync, 3000);
    return () => clearInterval(t);
  }, [pairId]);

  return state;
}
