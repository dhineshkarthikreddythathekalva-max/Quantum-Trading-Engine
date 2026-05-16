import { useState, useEffect, useRef } from "react";

export interface MagicV {
  detected: boolean;
  direction: "bull" | "bear" | null;
  strength: "strong" | "moderate" | null;
  depth: number;   // % depth of the V
}

export interface SRZones {
  support: number;
  resistance: number;
  nearSupport: boolean;
  nearResistance: boolean;
  bounceFromSupport: boolean;
  bounceFromResistance: boolean;
}

export interface ErrorCandle {
  detected: boolean;
  /** counter_bull = bearish candle inside uptrend → expect BUY continuation
   *  counter_bear = bullish candle inside downtrend → expect SELL continuation */
  type: "counter_bull" | "counter_bear" | null;
  consecutive: number;   // how many consecutive error candles
  depth: number;         // % size of the error candle vs trend move
}

export interface LiveMarketState {
  price: number;
  priceChange: number;
  priceHistory: number[];        // last 20 ticks
  trend: "bullish" | "bearish";
  momentum: "strong" | "normal" | "weak";
  volatility: "high" | "medium" | "low";
  volumeSpike: boolean;
  sessionBias: "bullish" | "bearish" | "neutral";
  bbPosition: "above_upper" | "near_upper" | "middle" | "near_lower" | "below_lower";
  emaCross: "golden" | "death" | "none";
  roc: number;
  magicV: MagicV;
  sr: SRZones;
  errorCandle: ErrorCandle;
  lastSync: Date;
  syncCount: number;
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

function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
function hashStr(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h = h & h; }
  return Math.abs(h);
}

/** Build a deterministic price history for a pair up to syncCount */
function buildPriceHistory(pairId: string, syncCount: number, count = 20): number[] {
  const base = BASE_PRICES[pairId] ?? BASE_PRICES.default;
  const history: number[] = [];
  let offset = 0;
  const start = Math.max(0, syncCount - count);
  for (let i = start; i <= syncCount; i++) {
    const r = seededRand(hashStr(pairId + "_tick_" + i));
    offset = offset * 0.8 + (r() - 0.5) * 0.003;  // mean-reverting random walk
    const decimals = base > 100 ? 2 : 4;
    history.push(parseFloat((base * (1 + offset)).toFixed(decimals)));
  }
  return history;
}

/** Detect Magic V patterns in price history */
function detectMagicV(history: number[]): MagicV {
  if (history.length < 5) return { detected: false, direction: null, strength: null, depth: 0 };

  const recent = history.slice(-8);
  const n = recent.length;
  let bestBull = 0;
  let bestBear = 0;

  // Scan all local minima (Bull V) and maxima (Bear V)
  for (let i = 1; i < n - 1; i++) {
    // Bull V: price falls to a low then bounces back up
    const leftHigh  = Math.max(...recent.slice(0, i));
    const low       = recent[i];
    const rightHigh = Math.max(...recent.slice(i + 1));
    const drop      = (leftHigh - low) / leftHigh;
    const recovery  = (rightHigh - low) / low;
    if (drop > 0.001 && recovery > 0.0008) {
      const strength = (drop + recovery) / 2;
      if (strength > bestBull) bestBull = strength;
    }

    // Bear V (inverted V): price rises to a high then drops back down
    const leftLow   = Math.min(...recent.slice(0, i));
    const high      = recent[i];
    const rightLow  = Math.min(...recent.slice(i + 1));
    const rise      = (high - leftLow) / leftLow;
    const collapse  = (high - rightLow) / high;
    if (rise > 0.001 && collapse > 0.0008) {
      const strength = (rise + collapse) / 2;
      if (strength > bestBear) bestBear = strength;
    }
  }

  const STRONG_THRESH   = 0.003;
  const MODERATE_THRESH = 0.001;

  if (bestBull > bestBear && bestBull > MODERATE_THRESH) {
    return {
      detected: true,
      direction: "bull",
      strength: bestBull > STRONG_THRESH ? "strong" : "moderate",
      depth: +(bestBull * 100).toFixed(3),
    };
  }
  if (bestBear > bestBull && bestBear > MODERATE_THRESH) {
    return {
      detected: true,
      direction: "bear",
      strength: bestBear > STRONG_THRESH ? "strong" : "moderate",
      depth: +(bestBear * 100).toFixed(3),
    };
  }
  return { detected: false, direction: null, strength: null, depth: 0 };
}

/** Detect error candles — counter-trend candles inside a dominant trend */
function detectErrorCandle(history: number[], trend: "bullish" | "bearish"): ErrorCandle {
  if (history.length < 4) return { detected: false, type: null, consecutive: 0, depth: 0 };

  // Each tick delta = a simulated "candle" direction
  const deltas: number[] = [];
  for (let i = 1; i < history.length; i++) deltas.push(history[i] - history[i - 1]);

  // Overall trend move for reference (depth calculation)
  const trendMove = Math.abs(history[history.length - 1] - history[0]);

  // Scan last 3 candles for counter-trend moves
  const last3 = deltas.slice(-3);
  let consecutive = 0;
  let totalErrorDepth = 0;

  for (let i = last3.length - 1; i >= 0; i--) {
    const delta = last3[i];
    const isError =
      (trend === "bullish" && delta < 0) ||  // bearish candle in uptrend
      (trend === "bearish" && delta > 0);     // bullish candle in downtrend
    if (isError) {
      consecutive++;
      totalErrorDepth += Math.abs(delta);
    } else {
      break; // stop at first non-error candle (must be consecutive from the end)
    }
  }

  if (consecutive === 0) return { detected: false, type: null, consecutive: 0, depth: 0 };

  const depthPct = trendMove > 0 ? +(totalErrorDepth / trendMove * 100).toFixed(2) : 0;
  const type: ErrorCandle["type"] = trend === "bullish" ? "counter_bull" : "counter_bear";

  return { detected: true, type, consecutive, depth: depthPct };
}

/** Calculate dynamic support and resistance from price history */
function calcSR(history: number[], currentPrice: number): SRZones {
  if (history.length < 3) {
    return { support: currentPrice * 0.998, resistance: currentPrice * 1.002, nearSupport: false, nearResistance: false, bounceFromSupport: false, bounceFromResistance: false };
  }
  const decimals = currentPrice > 100 ? 2 : 4;
  // Support = lowest recent price (potential floor)
  const support     = parseFloat(Math.min(...history).toFixed(decimals));
  // Resistance = highest recent price (potential ceiling)
  const resistance  = parseFloat(Math.max(...history).toFixed(decimals));
  const range       = resistance - support;
  const threshold   = range * 0.15;  // within 15% of range = "near"

  const nearSupport      = currentPrice - support    < threshold;
  const nearResistance   = resistance  - currentPrice < threshold;

  // Bounce = price was at the zone last tick and is now moving away
  const prevPrice = history[history.length - 2] ?? currentPrice;
  const bounceFromSupport    = nearSupport    && currentPrice > prevPrice;
  const bounceFromResistance = nearResistance && currentPrice < prevPrice;

  return { support, resistance, nearSupport, nearResistance, bounceFromSupport, bounceFromResistance };
}

export function computeMarketState(pairId: string, syncCount: number): Omit<LiveMarketState, "lastSync" | "syncCount"> {
  const base     = BASE_PRICES[pairId] ?? BASE_PRICES.default;
  const history  = buildPriceHistory(pairId, syncCount, 20);
  const price    = history[history.length - 1];
  const prevPrice = history[history.length - 2] ?? price;
  const longPrice = history[0];

  const priceChange = +((price - prevPrice) / prevPrice * 100).toFixed(4);
  const trend: LiveMarketState["trend"] = price > longPrice ? "bullish" : "bearish";

  const absChange = Math.abs(priceChange);
  const momentum: LiveMarketState["momentum"] = absChange > 0.08 ? "strong" : absChange > 0.03 ? "normal" : "weak";

  const r = seededRand(hashStr(pairId + "_meta_" + syncCount));
  const vr = r();
  const volatility: LiveMarketState["volatility"] = vr > 0.65 ? "high" : vr > 0.3 ? "medium" : "low";
  const volumeSpike = r() > 0.60;

  const hour = new Date().getUTCHours();
  let sessionBias: LiveMarketState["sessionBias"];
  const sr2 = r();
  if (hour >= 7 && hour < 17)      sessionBias = sr2 > 0.45 ? trend : "neutral";
  else if (hour >= 17 && hour < 22) sessionBias = sr2 > 0.5 ? trend : "neutral";
  else                               sessionBias = "neutral";

  // BB position from price relative to history range
  const hiPrice = Math.max(...history);
  const loPrice = Math.min(...history);
  const range   = hiPrice - loPrice || 1;
  const pct     = (price - loPrice) / range;
  const bbPosition: LiveMarketState["bbPosition"] =
    pct > 0.9 ? "above_upper" : pct > 0.7 ? "near_upper" :
    pct < 0.1 ? "below_lower" : pct < 0.3 ? "near_lower" : "middle";

  // EMA cross from mid-history trend shift
  const midPrice = history[Math.floor(history.length / 2)];
  const earlyAvg = history.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const lateAvg  = history.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const crossRand = r();
  const emaCross: LiveMarketState["emaCross"] =
    crossRand > 0.85 ? (lateAvg > earlyAvg ? "golden" : "death") : "none";

  void base; void midPrice;

  const roc = +((price - longPrice) / longPrice * 1000).toFixed(2);
  const magicV       = detectMagicV(history);
  const sr           = calcSR(history, price);
  const errorCandle  = detectErrorCandle(history, trend);

  return { price, priceChange, priceHistory: history, trend, momentum, volatility, volumeSpike, sessionBias, bbPosition, emaCross, roc, magicV, sr, errorCandle };
}

export function useLiveMarket(pairId: string | null): LiveMarketState | null {
  const [state, setState] = useState<LiveMarketState | null>(null);
  const syncCountRef = useRef(20); // start at 20 so we have history immediately

  useEffect(() => {
    if (!pairId) { setState(null); return; }
    function sync() {
      syncCountRef.current += 1;
      const mkt = computeMarketState(pairId!, syncCountRef.current);
      setState({ ...mkt, lastSync: new Date(), syncCount: syncCountRef.current });
    }
    sync();
    const interval = setInterval(sync, 3000);
    return () => clearInterval(interval);
  }, [pairId]);

  return state;
}
