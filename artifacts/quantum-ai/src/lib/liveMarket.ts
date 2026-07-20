import { useState, useEffect, useRef } from "react";

export interface Candle {
  open: number; high: number; low: number; close: number; volume: number;
}

export interface Indicators {
  rsi14: number;
  macdLine: number; macdSignal: number; macdHist: number;
  macdCross: "bullish" | "bearish" | "none";
  stochK: number; stochD: number;
  stochSignal: "oversold" | "overbought" | "neutral";
  adx: number; plusDI: number; minusDI: number;
  bbUpper: number; bbMid: number; bbLower: number; bbPct: number;
  ema10: number; ema21: number; ema50: number; ema200: number;
  emaTrend: "bullish" | "bearish";
  emaBias: "bullish" | "bearish";
  emaStack: "bull_stack" | "bear_stack" | "mixed"; // EMA 10>21>50 = bull_stack
  atr14: number;  // Average True Range for volatility
}

export interface CandlePatterns {
  // ── 1-candle patterns ──
  pinBarBull: boolean;
  pinBarBear: boolean;
  hammerBull: boolean;
  shootingStarBear: boolean;
  dojiReversal: boolean;
  strongBullCandle: boolean;
  strongBearCandle: boolean;
  // ── 2-candle patterns ──
  engulfingBull: boolean;
  engulfingBear: boolean;
  bullishHarami: boolean;
  bearishHarami: boolean;
  darkCloudCover: boolean;
  piercingLine: boolean;
  tweezers: "bull" | "bear" | "none";
  insideBarBreakout: "bull" | "bear" | "none";
  // ── 3-candle patterns (most reliable for binary) ──
  morningStar: boolean;
  eveningStar: boolean;
  threeWhiteSoldiers: boolean;
  threeBlackCrows: boolean;
}

export interface MarketStructure {
  trend: "bullish" | "bearish" | "ranging";
  trendStrength: number;
  swingHigh: number; swingLow: number;
  higherHighs: boolean; lowerLows: boolean;
  momentum: "strong" | "normal" | "weak";
}

export interface SRZones {
  support: number; resistance: number;
  nearSupport: boolean; nearResistance: boolean;
  bounceFromSupport: boolean; bounceFromResistance: boolean;
  atKeyLevel: boolean;
}

export interface VolumeData {
  current: number; avg20: number;
  spike: boolean;
  trend: "rising" | "falling" | "neutral";
}

export interface LiveMarketState {
  price: number; priceChange: number;
  candles: Candle[];
  indicators: Indicators;
  patterns: CandlePatterns;
  structure: MarketStructure;
  sr: SRZones;
  volume: VolumeData;
  sessionBias: "bullish" | "bearish" | "neutral";
  sessionName: string;
  lastSync: Date; syncCount: number;
}

/* ══════════════════════════════════════════════
   SEEDED RNG
══════════════════════════════════════════════ */
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
  // Currencies
  eur_usd: 1.0845, eur_usd_otc: 1.0845,
  gbp_usd: 1.2720, gbp_usd_otc: 1.2720,
  aud_usd: 0.6540, aud_usd_otc: 0.6540,
  usd_jpy: 154.20, usd_jpy_otc: 154.20,
  usd_chf: 0.9120, usd_chf_otc: 0.9120,
  usd_cad: 1.3690, usd_cad_otc: 1.3690,
  nzd_usd: 0.6020, nzd_usd_otc: 0.6020,
  eur_gbp: 0.8520, eur_gbp_otc: 0.8520,
  eur_jpy: 167.50, eur_jpy_otc: 167.50,
  gbp_jpy: 196.40, gbp_jpy_otc: 196.40,
  aud_jpy: 100.85, aud_jpy_otc: 100.85,
  cad_jpy: 112.30, cad_jpy_otc: 112.30,
  chf_jpy: 170.20, chf_jpy_otc: 170.20,
  eur_aud: 1.6580, eur_aud_otc: 1.6580,
  eur_cad: 1.4840, eur_cad_otc: 1.4840,
  eur_chf: 0.9760, eur_chf_otc: 0.9760,
  gbp_aud: 1.9430, gbp_aud_otc: 1.9430,
  gbp_cad: 1.7280, gbp_cad_otc: 1.7280,
  gbp_chf: 1.1390, gbp_chf_otc: 1.1390,
  gbp_nzd: 2.0950, gbp_nzd_otc: 2.0950,
  aud_cad: 0.9010, aud_cad_otc: 0.9010,
  aud_nzd_otc: 1.0870, eur_nzd_otc: 1.8050,
  nzd_cad_otc: 0.8140, nzd_jpy_otc: 91.40,
  nzd_chf_otc: 0.5510, cad_chf_otc: 0.6650,
  usd_brl_otc: 5.1250, usd_ars_otc: 870.50,
  usd_mxn_otc: 17.23, usd_egp_otc: 30.95,
  usd_idr_otc: 15820, usd_zar_otc: 18.65,
  usd_inr_otc: 83.50, usd_ngn_otc: 1380,
  usd_pkr_otc: 278.50, usd_bdt_otc: 109.80,
  usd_dzd_otc: 134.80, usd_cop_otc: 3900,
  usd_php_otc: 56.40, usd_nok_otc: 10.72,
  usd_sek_otc: 10.58, usd_try_otc: 32.15,
  usd_sgd_otc: 1.3560, usd_hkd_otc: 7.8200,
  // Crypto
  btc_otc: 67450, eth_otc: 3280, xrp_otc: 0.5820,
  bnb_otc: 608.40, sol_otc: 178.50, ton_otc: 7.32,
  link_otc: 18.70, avax_otc: 38.70, dot_otc: 8.15,
  ltc_otc: 82.50, bch_otc: 495.20, atom_otc: 9.45,
  dash_otc: 32.10, etc_otc: 28.90, zec_otc: 24.80,
  axs_otc: 7.85, trump_otc: 12.40,
  // Indices
  sp500_otc: 5250, dj30_otc: 39500, nasdaq_otc: 18200,
  dax_otc: 18800, ftse_otc: 8300, cac40_otc: 8100,
  nikkei_otc: 38750, asx_otc: 7820, stoxx_otc: 5050,
  hsi_otc: 18200,
  // Commodities
  gold: 2340, silver: 28.40,
  ukbrent_otc: 83.40, uscrude_otc: 79.20,
  natgas_otc: 2.80, platinum_otc: 980, copper_otc: 4.50,
  // Stocks
  aapl_otc: 213, tsla_otc: 182, amzn_otc: 191,
  nflx_otc: 648, googl_otc: 176, nvda_otc: 128,
  msft_otc: 415.80, meta_otc: 512, ko_otc: 62.50,
  gs_otc: 460, jpm_otc: 198, xom_otc: 115,
  dis_otc: 100, intc_otc: 30.25, jnj_otc: 148.60,
  mcd_otc: 295.40, ba_otc: 178.90, axp_otc: 236.70,
  pfe_otc: 28.60,
};

/* ══════════════════════════════════════════════
   OHLC CANDLE GENERATION — 80 candles
══════════════════════════════════════════════ */
function buildCandles(pairId: string, syncCount: number, count = 80): Candle[] {
  const base = BASE_PRICES[pairId] ?? BASE_PRICES.default;
  const pip  = base > 1000 ? 1 : base > 100 ? 0.01 : base > 1 ? 0.0001 : 0.00001;
  const dec  = base > 1000 ? 0 : base > 100 ? 2 : 5;

  const phaseLen   = 30;
  const phaseSlot  = Math.floor(syncCount / phaseLen);
  const phaseRand  = seededRand(hashStr(pairId + "_phase_" + phaseSlot));
  const trendDir   = phaseRand() > 0.5 ? 1 : -1;
  const trendStrong = phaseRand() > 0.30;
  const baseDrift  = trendDir * pip * (trendStrong ? 1.5 : 0.4);
  const volatMult  = 0.7 + phaseRand() * 1.4;
  const phasePos   = (syncCount % phaseLen) / phaseLen;

  const candles: Candle[] = [];
  let close = base;
  const startTick = Math.max(0, syncCount - count + 1);

  for (let tick = startTick; tick <= syncCount; tick++) {
    const r = seededRand(hashStr(pairId + "_c_" + tick));
    const meanRevert = (base - close) / base * 0.35;
    const noise      = (r() - 0.5) * pip * 2.2 * volatMult;
    const closeChange = baseDrift + noise + meanRevert * pip;

    const open     = close;
    const newClose = parseFloat((open + closeChange).toFixed(dec));

    const bodySize  = Math.abs(newClose - open);
    const wickScale = 0.4 + r() * 1.6;
    const upperWick = bodySize * wickScale * r() * volatMult;
    const lowerWick = bodySize * wickScale * r() * volatMult;

    const high   = parseFloat((Math.max(open, newClose) + upperWick * pip * 2).toFixed(dec));
    const low    = parseFloat((Math.min(open, newClose) - lowerWick * pip * 2).toFixed(dec));
    const volume = parseFloat((100 + r() * 900 + (r() > 0.82 ? r() * 700 : 0)).toFixed(0));

    if (tick >= startTick) candles.push({ open, high, low, close: newClose, volume });
    close = newClose;
  }

  while (candles.length < count) {
    const last = candles[0] ?? { open: base, high: base, low: base, close: base, volume: 200 };
    candles.unshift({ ...last });
  }

  // Inject micro-structure pullbacks in strong trends
  if (trendStrong && phasePos > 0.15) {
    const r2 = seededRand(hashStr(pairId + "_micro_" + phaseSlot));
    for (let i = 5; i < candles.length - 3; i += Math.floor(5 + r2() * 6)) {
      if (r2() > 0.5) {
        candles[i].close = parseFloat((candles[i].open - trendDir * pip * (0.4 + r2())).toFixed(dec));
        candles[i].low   = Math.min(candles[i].low, candles[i].close - pip * r2());
      }
    }
  }

  return candles;
}

/* ══════════════════════════════════════════════
   INDICATOR COMPUTATIONS
══════════════════════════════════════════════ */
function calcEMA(data: number[], period: number): number[] {
  if (data.length < period) return data.map(() => data[0] ?? 0);
  const k      = 2 / (period + 1);
  const result = new Array(data.length).fill(0);
  result[period - 1] = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function calcRSI(closes: number[], period = 14): number {
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
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function calcMACD(closes: number[]): { line: number; signal: number; hist: number; prevLine: number; prevSignal: number } {
  if (closes.length < 35) return { line: 0, signal: 0, hist: 0, prevLine: 0, prevSignal: 0 };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdArr = ema12.map((v, i) => v - ema26[i]).slice(25);
  if (macdArr.length < 9) return { line: 0, signal: 0, hist: 0, prevLine: 0, prevSignal: 0 };
  const signalArr = calcEMA(macdArr, 9);
  const n = signalArr.length;
  return {
    line: macdArr[n - 1], signal: signalArr[n - 1],
    hist: macdArr[n - 1] - signalArr[n - 1],
    prevLine: macdArr[n - 2] ?? macdArr[n - 1],
    prevSignal: signalArr[n - 2] ?? signalArr[n - 1],
  };
}

function calcStochastic(candles: Candle[], k = 14, d = 3): { k: number; d: number } {
  if (candles.length < k + d) return { k: 50, d: 50 };
  const kArr: number[] = [];
  for (let i = k - 1; i < candles.length; i++) {
    const sl = candles.slice(i - k + 1, i + 1);
    const hi = Math.max(...sl.map(c => c.high));
    const lo = Math.min(...sl.map(c => c.low));
    kArr.push(hi !== lo ? ((candles[i].close - lo) / (hi - lo)) * 100 : 50);
  }
  const dArr = calcEMA(kArr, d);
  return { k: kArr[kArr.length - 1], d: dArr[dArr.length - 1] };
}

function calcBB(closes: number[], period = 20, mult = 2): { upper: number; mid: number; lower: number; pct: number } {
  if (closes.length < period) {
    const p = closes[closes.length - 1];
    return { upper: p * 1.002, mid: p, lower: p * 0.998, pct: 0.5 };
  }
  const slice = closes.slice(-period);
  const mid   = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper = mid + mult * std;
  const lower = mid - mult * std;
  const price = closes[closes.length - 1];
  return { upper, mid, lower, pct: upper !== lower ? Math.max(0, Math.min(1, (price - lower) / (upper - lower))) : 0.5 };
}

function calcADX(candles: Candle[], period = 14): { adx: number; pdi: number; mdi: number } {
  if (candles.length < period * 2) return { adx: 25, pdi: 25, mdi: 25 };
  const trArr: number[] = [], pdmArr: number[] = [], mdmArr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trArr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    pdmArr.push(c.high - p.high > p.low - c.low ? Math.max(c.high - p.high, 0) : 0);
    mdmArr.push(p.low - c.low > c.high - p.high ? Math.max(p.low - c.low, 0) : 0);
  }
  let atr = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let apdm = pdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  let amdm = mdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  const dxArr: number[] = [];
  for (let i = period; i < trArr.length; i++) {
    atr = atr - atr / period + trArr[i];
    apdm = apdm - apdm / period + pdmArr[i];
    amdm = amdm - amdm / period + mdmArr[i];
    const pdi = atr > 0 ? (apdm / atr) * 100 : 0;
    const mdi = atr > 0 ? (amdm / atr) * 100 : 0;
    dxArr.push(pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0);
  }
  if (dxArr.length < period) return { adx: 25, pdi: 25, mdi: 25 };
  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
  // Recompute last pdi/mdi
  let atr2 = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let apdm2 = pdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  let amdm2 = mdmArr.slice(0, period).reduce((a, b) => a + b, 0);
  for (let i = period; i < trArr.length; i++) {
    atr2 = atr2 - atr2 / period + trArr[i];
    apdm2 = apdm2 - apdm2 / period + pdmArr[i];
    amdm2 = amdm2 - amdm2 / period + mdmArr[i];
  }
  return { adx: adxVal, pdi: atr2 > 0 ? (apdm2 / atr2) * 100 : 0, mdi: atr2 > 0 ? (amdm2 / atr2) * 100 : 0 };
}

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/* ══════════════════════════════════════════════
   CANDLESTICK PATTERN DETECTION
   Uses last 3 candles: c2=oldest c1=prev c0=latest
   9-year binary trader patterns
══════════════════════════════════════════════ */
function detectPatterns(candles: Candle[], trend: "bullish" | "bearish" | "ranging"): CandlePatterns {
  const n = candles.length;
  const blank: CandlePatterns = {
    pinBarBull: false, pinBarBear: false, hammerBull: false, shootingStarBear: false,
    dojiReversal: false, strongBullCandle: false, strongBearCandle: false,
    engulfingBull: false, engulfingBear: false, bullishHarami: false, bearishHarami: false,
    darkCloudCover: false, piercingLine: false, tweezers: "none", insideBarBreakout: "none",
    morningStar: false, eveningStar: false, threeWhiteSoldiers: false, threeBlackCrows: false,
  };
  if (n < 3) return blank;

  const c0 = candles[n - 1];
  const c1 = candles[n - 2];
  const c2 = candles[n - 3];

  const body0 = Math.abs(c0.close - c0.open);
  const range0 = c0.high - c0.low || 0.000001;
  const upper0 = c0.close >= c0.open ? c0.high - c0.close : c0.high - c0.open;
  const lower0 = c0.close >= c0.open ? c0.open - c0.low  : c0.close - c0.low;
  const isBull0 = c0.close > c0.open;

  const body1 = Math.abs(c1.close - c1.open);
  const range1 = c1.high - c1.low || 0.000001;
  const isBull1 = c1.close > c1.open;

  const body2 = Math.abs(c2.close - c2.open);
  const range2 = c2.high - c2.low || 0.000001;
  const isBull2 = c2.close > c2.open;

  const avgRange = (range0 + range1 + range2) / 3;
  const avgBody  = (body0 + body1 + body2) / 3 || 0.000001;

  // ── 1-candle ──
  const pinBarBullRaw = lower0 / range0 > 0.55 && body0 / range0 < 0.35;
  const pinBarBearRaw = upper0 / range0 > 0.55 && body0 / range0 < 0.35;
  const validPinSize  = range0 > avgRange * 0.5;

  const hammerBull       = lower0 >= body0 * 2.0 && upper0 < body0 * 0.5 && trend === "bearish" && !isBull1;
  const shootingStarBear = upper0 >= body0 * 2.0 && lower0 < body0 * 0.5 && trend === "bullish" && isBull1;
  const isDoji           = body0 / range0 < 0.10;
  const dojiReversal     = isDoji && trend !== "ranging";
  const strongBullCandle = isBull0 && body0 / range0 > 0.65;
  const strongBearCandle = !isBull0 && body0 / range0 > 0.65;

  // ── 2-candle ──
  const engulfingBull = !isBull1 && isBull0 && c0.open <= c1.close && c0.close >= c1.open && body0 > body1 * 0.9;
  const engulfingBear = isBull1 && !isBull0 && c0.open >= c1.close && c0.close <= c1.open && body0 > body1 * 0.9;

  // Harami: small body inside previous large body
  const bullishHarami = !isBull1 && isBull0 && body1 > avgBody * 1.3 &&
    c0.open > Math.min(c1.open, c1.close) && c0.close < Math.max(c1.open, c1.close) &&
    body0 < body1 * 0.55;
  const bearishHarami = isBull1 && !isBull0 && body1 > avgBody * 1.3 &&
    c0.open < Math.max(c1.open, c1.close) && c0.close > Math.min(c1.open, c1.close) &&
    body0 < body1 * 0.55;

  // Dark Cloud Cover: c1 bull, c0 bear opens above c1.high, closes below c1 midpoint
  const c1MidUp  = (c1.open + c1.close) / 2;
  const darkCloudCover = isBull1 && !isBull0 && body1 > avgBody &&
    c0.open > c1.high && c0.close < c1MidUp && c0.close > c1.open;

  // Piercing Line: c1 bear, c0 bull opens below c1.low, closes above c1 midpoint
  const c1MidDn  = (c1.open + c1.close) / 2;
  const piercingLine = !isBull1 && isBull0 && body1 > avgBody &&
    c0.open < c1.low && c0.close > c1MidDn && c0.close < c1.open;

  // Tweezers
  const tweezersTop    = Math.abs(c0.high - c1.high) / (c0.high || 1) < 0.0012 && isBull1 && !isBull0;
  const tweezersBottom = Math.abs(c0.low  - c1.low)  / (c0.low  || 1) < 0.0012 && !isBull1 && isBull0;
  const tweezers: "bull" | "bear" | "none" = tweezersBottom ? "bull" : tweezersTop ? "bear" : "none";

  // Inside bar breakout
  const insideBar = c0.high < c1.high && c0.low > c1.low;
  const insideBarBreakout: "bull" | "bear" | "none" = insideBar
    ? (trend === "bullish" ? "bull" : trend === "bearish" ? "bear" : "none") : "none";

  // ── 3-candle (most reliable for binary options) ──

  // Morning Star: c2 bearish big body | c1 small body (gap/overlap OK) | c0 bullish closing > c2 midpoint
  const c2MidBear = (c2.open + c2.close) / 2;
  const morningStar = !isBull2 && body2 > avgBody * 0.8 &&
    body1 < avgBody * 0.55 &&
    isBull0 && body0 > avgBody * 0.75 &&
    c0.close > c2MidBear && trend === "bearish";

  // Evening Star: c2 bullish big body | c1 small body | c0 bearish closing < c2 midpoint
  const c2MidBull = (c2.open + c2.close) / 2;
  const eveningStar = isBull2 && body2 > avgBody * 0.8 &&
    body1 < avgBody * 0.55 &&
    !isBull0 && body0 > avgBody * 0.75 &&
    c0.close < c2MidBull && trend === "bullish";

  // Three White Soldiers: 3 consecutive bullish candles, each opening inside prev body
  const threeWhiteSoldiers = isBull0 && isBull1 && isBull2 &&
    body0 > avgRange * 0.45 && body1 > avgRange * 0.45 && body2 > avgRange * 0.45 &&
    c1.open > c2.open && c1.close > c2.close &&
    c0.open > c1.open && c0.close > c1.close &&
    c0.close > c0.open * 0.998;  // closing near high

  // Three Black Crows: 3 consecutive bearish candles
  const threeBlackCrows = !isBull0 && !isBull1 && !isBull2 &&
    body0 > avgRange * 0.45 && body1 > avgRange * 0.45 && body2 > avgRange * 0.45 &&
    c1.open < c2.open && c1.close < c2.close &&
    c0.open < c1.open && c0.close < c1.close;

  return {
    pinBarBull: pinBarBullRaw && validPinSize, pinBarBear: pinBarBearRaw && validPinSize,
    hammerBull, shootingStarBear, dojiReversal, strongBullCandle, strongBearCandle,
    engulfingBull, engulfingBear, bullishHarami, bearishHarami, darkCloudCover, piercingLine,
    tweezers, insideBarBreakout, morningStar, eveningStar, threeWhiteSoldiers, threeBlackCrows,
  };
}

/* ══════════════════════════════════════════════
   MARKET STRUCTURE
══════════════════════════════════════════════ */
function analyzeStructure(candles: Candle[]): MarketStructure {
  if (candles.length < 10) return { trend: "ranging", trendStrength: 0, swingHigh: 0, swingLow: 0, higherHighs: false, lowerLows: false, momentum: "weak" };
  const n = candles.length;
  const swingHighs: number[] = [], swingLows: number[] = [];
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
  const swingHigh  = swingHighs.length ? swingHighs[0] : candles[n - 1].high;
  const swingLow   = swingLows.length ? swingLows[0] : candles[n - 1].low;
  const higherHighs = swingHighs.length >= 2 && swingHighs[0] > swingHighs[1];
  const lowerLows   = swingLows.length >= 2 && swingLows[0] < swingLows[1];
  const closes = candles.slice(-20).map(c => c.close);
  const bullish = closes.filter((c, i) => i > 0 && c > closes[i - 1]).length;
  const trendPct = bullish / (closes.length - 1);
  const trendStrength = Math.abs(trendPct - 0.5) * 2;
  const trend: "bullish" | "bearish" | "ranging" =
    higherHighs && trendPct > 0.55 ? "bullish" :
    lowerLows && trendPct < 0.45 ? "bearish" :
    trendStrength < 0.25 ? "ranging" :
    trendPct > 0.55 ? "bullish" : "bearish";
  const roc5 = Math.abs(candles[n - 1].close - candles[n - 5].close) / (candles[n - 5].close || 1) * 100;
  const momentum: "strong" | "normal" | "weak" = roc5 > 0.08 ? "strong" : roc5 > 0.03 ? "normal" : "weak";
  return { trend, trendStrength, swingHigh, swingLow, higherHighs, lowerLows, momentum };
}

/* ══════════════════════════════════════════════
   S/R FROM SWING POINTS
══════════════════════════════════════════════ */
function calcSR(candles: Candle[], price: number): SRZones {
  if (candles.length < 10) return { support: price * 0.998, resistance: price * 1.002, nearSupport: false, nearResistance: false, bounceFromSupport: false, bounceFromResistance: false, atKeyLevel: false };
  const n = candles.length;
  const resistance = Math.max(...candles.map(c => c.high).slice(-30));
  const support    = Math.min(...candles.map(c => c.low).slice(-30));
  const range = resistance - support || price * 0.01;
  const threshold = range * 0.07;
  const prevClose = candles[n - 2]?.close ?? price;
  const nearS = price - support < threshold;
  const nearR = resistance - price < threshold;
  return {
    support, resistance, nearSupport: nearS, nearResistance: nearR,
    bounceFromSupport: nearS && price > prevClose,
    bounceFromResistance: nearR && price < prevClose,
    atKeyLevel: nearS || nearR,
  };
}

/* ══════════════════════════════════════════════
   VOLUME ANALYSIS
══════════════════════════════════════════════ */
function analyzeVolume(candles: Candle[]): VolumeData {
  if (candles.length < 5) return { current: 200, avg20: 200, spike: false, trend: "neutral" };
  const n = candles.length;
  const current = candles[n - 1].volume;
  const avg20   = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / Math.min(20, candles.length);
  const avg5    = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
  const prev5   = candles.slice(-10, -5).reduce((a, c) => a + c.volume, 0) / 5;
  return { current, avg20, spike: current > avg20 * 1.5, trend: avg5 > prev5 * 1.1 ? "rising" : avg5 < prev5 * 0.9 ? "falling" : "neutral" };
}

/* ══════════════════════════════════════════════
   SESSION NAME
══════════════════════════════════════════════ */
function getSession(hour: number): { name: string; bias: "bullish" | "bearish" | "neutral" } {
  if (hour >= 7 && hour < 10)  return { name: "London Open",   bias: "bullish" };
  if (hour >= 10 && hour < 13) return { name: "London Mid",    bias: "neutral"  };
  if (hour >= 13 && hour < 17) return { name: "NY Session",    bias: "bullish"  };
  if (hour >= 17 && hour < 21) return { name: "NY Close",      bias: "neutral"  };
  if (hour >= 21 || hour < 2)  return { name: "Tokyo Open",    bias: "neutral"  };
  return { name: "Asian Session", bias: "neutral" };
}

/* ══════════════════════════════════════════════
   MASTER COMPUTE
══════════════════════════════════════════════ */
export function computeMarketState(pairId: string, syncCount: number): Omit<LiveMarketState, "lastSync" | "syncCount"> {
  const candles   = buildCandles(pairId, syncCount, 80);
  const n         = candles.length;
  const price     = candles[n - 1].close;
  const prevClose = candles[n - 2]?.close ?? price;
  const priceChange = +((price - prevClose) / prevClose * 100).toFixed(4);
  const closes    = candles.map(c => c.close);

  const rsi14  = +calcRSI(closes, 14).toFixed(2);
  const macdR  = calcMACD(closes);
  const stochR = calcStochastic(candles, 14, 3);
  const bbR    = calcBB(closes, 20, 2);
  const adxR   = calcADX(candles, 14);
  const atr14  = calcATR(candles, 14);

  const ema10Arr  = calcEMA(closes, 10);
  const ema21Arr  = calcEMA(closes, 21);
  const ema50Arr  = calcEMA(closes, 50);
  const ema200Arr = calcEMA(closes, 200);
  const ema10  = ema10Arr[n - 1];
  const ema21  = ema21Arr[n - 1];
  const ema50  = ema50Arr[n - 1] ?? closes[0];
  const ema200 = ema200Arr[n - 1] ?? closes[0];

  const macdCross: "bullish" | "bearish" | "none" =
    macdR.prevLine < macdR.prevSignal && macdR.line >= macdR.signal ? "bullish" :
    macdR.prevLine > macdR.prevSignal && macdR.line <= macdR.signal ? "bearish" : "none";

  const stochSignal: "oversold" | "overbought" | "neutral" =
    stochR.k < 20 && stochR.d < 25 ? "oversold" :
    stochR.k > 80 && stochR.d > 75 ? "overbought" : "neutral";

  // EMA stack: 10 > 21 > 50 = fully bullish stacked
  const emaStack: "bull_stack" | "bear_stack" | "mixed" =
    ema10 > ema21 && ema21 > ema50 ? "bull_stack" :
    ema10 < ema21 && ema21 < ema50 ? "bear_stack" : "mixed";

  const indicators: Indicators = {
    rsi14, macdLine: macdR.line, macdSignal: macdR.signal, macdHist: macdR.hist,
    macdCross, stochK: +stochR.k.toFixed(1), stochD: +stochR.d.toFixed(1), stochSignal,
    adx: +adxR.adx.toFixed(1), plusDI: +adxR.pdi.toFixed(1), minusDI: +adxR.mdi.toFixed(1),
    bbUpper: bbR.upper, bbMid: bbR.mid, bbLower: bbR.lower, bbPct: bbR.pct,
    ema10, ema21, ema50, ema200, emaStack,
    emaTrend: ema10 > ema21 ? "bullish" : "bearish",
    emaBias:  price > ema50 ? "bullish" : "bearish",
    atr14,
  };

  const structure = analyzeStructure(candles);
  const patterns  = detectPatterns(candles, structure.trend);
  const sr        = calcSR(candles, price);
  const volume    = analyzeVolume(candles);
  const hour      = new Date().getUTCHours();
  const session   = getSession(hour);

  return { price, priceChange, candles, indicators, patterns, structure, sr, volume, sessionBias: session.bias, sessionName: session.name };
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
