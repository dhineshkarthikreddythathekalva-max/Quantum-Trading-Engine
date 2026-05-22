import { useState, useEffect, useRef } from "react";

export interface MagicV {
  detected: boolean;
  direction: "bull" | "bear" | null;
  strength: "strong" | "moderate" | null;
  depth: number;
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
  type: "counter_bull" | "counter_bear" | null;
  consecutive: number;
  depth: number;
}

export interface LiveMarketState {
  price: number;
  priceChange: number;
  priceHistory: number[];
  trend: "bullish" | "bearish";
  trendStrength: number;        // 0–1, how consistent the trend is
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
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
function hashStr(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h = h & h; }
  return Math.abs(h);
}

/**
 * Build a price history with a PERSISTENT trend bias.
 * Each pair gets a slowly rotating market phase (bullish/bearish) that
 * lasts ~30 ticks so indicators consistently read the same direction.
 */
function buildPriceHistory(pairId: string, syncCount: number, count = 30): number[] {
  const base = BASE_PRICES[pairId] ?? BASE_PRICES.default;

  // Market phase rotates every 40 ticks — creates sustained trends
  const phaseSlot  = Math.floor(syncCount / 40);
  const phaseRand  = seededRand(hashStr(pairId + "_phase_" + phaseSlot));
  const trendBias  = (phaseRand() - 0.5) * 0.0006;   // persistent directional drift

  const history: number[] = [];
  let offset = 0;
  const start = Math.max(0, syncCount - count);

  // Replay from start so the walk is continuous
  for (let i = Math.max(0, start - 5); i <= syncCount; i++) {
    const r      = seededRand(hashStr(pairId + "_tick_" + i));
    const noise  = (r() - 0.5) * 0.0018;             // tighter noise
    offset       = offset * 0.92 + trendBias + noise; // high autocorrelation → trending
    if (i >= start) {
      const dec = base > 100 ? 2 : 4;
      history.push(parseFloat((base * (1 + offset)).toFixed(dec)));
    }
  }
  return history;
}

/** How consistent is the trend? Returns 0–1 */
function measureTrendStrength(history: number[]): number {
  if (history.length < 4) return 0;
  const deltas = history.slice(1).map((v, i) => v - history[i]);
  const pos    = deltas.filter(d => d > 0).length;
  return Math.abs(pos / deltas.length - 0.5) * 2; // 0 = random, 1 = all same direction
}

/** Magic V detection */
function detectMagicV(history: number[]): MagicV {
  if (history.length < 6) return { detected: false, direction: null, strength: null, depth: 0 };
  const recent = history.slice(-10);
  const n = recent.length;
  let bestBull = 0, bestBear = 0;
  for (let i = 2; i < n - 2; i++) {
    const leftHigh  = Math.max(...recent.slice(0, i));
    const low       = recent[i];
    const rightHigh = Math.max(...recent.slice(i + 1));
    const drop      = (leftHigh - low) / leftHigh;
    const recovery  = (rightHigh - low) / (low || 1);
    if (drop > 0.0008 && recovery > 0.0006) bestBull = Math.max(bestBull, (drop + recovery) / 2);

    const leftLow   = Math.min(...recent.slice(0, i));
    const high      = recent[i];
    const rightLow  = Math.min(...recent.slice(i + 1));
    const rise      = (high - leftLow) / (leftLow || 1);
    const collapse  = (high - rightLow) / (high || 1);
    if (rise > 0.0008 && collapse > 0.0006) bestBear = Math.max(bestBear, (rise + collapse) / 2);
  }
  const STRONG = 0.0025, MODERATE = 0.0008;
  if (bestBull > bestBear && bestBull > MODERATE)
    return { detected: true, direction: "bull", strength: bestBull > STRONG ? "strong" : "moderate", depth: +(bestBull * 100).toFixed(3) };
  if (bestBear > bestBull && bestBear > MODERATE)
    return { detected: true, direction: "bear", strength: bestBear > STRONG ? "strong" : "moderate", depth: +(bestBear * 100).toFixed(3) };
  return { detected: false, direction: null, strength: null, depth: 0 };
}

/** Error candle detection */
function detectErrorCandle(history: number[], trend: "bullish" | "bearish"): ErrorCandle {
  if (history.length < 5) return { detected: false, type: null, consecutive: 0, depth: 0 };
  const deltas = history.slice(1).map((v, i) => v - history[i]);
  const trendMove = Math.abs(history[history.length - 1] - history[0]);
  const last3 = deltas.slice(-3);
  let consecutive = 0, totalDepth = 0;
  for (let i = last3.length - 1; i >= 0; i--) {
    const isError = (trend === "bullish" && last3[i] < 0) || (trend === "bearish" && last3[i] > 0);
    if (isError) { consecutive++; totalDepth += Math.abs(last3[i]); } else break;
  }
  if (consecutive === 0) return { detected: false, type: null, consecutive: 0, depth: 0 };
  const depthPct = trendMove > 0 ? +(totalDepth / trendMove * 100).toFixed(2) : 0;
  return { detected: true, type: trend === "bullish" ? "counter_bull" : "counter_bear", consecutive, depth: depthPct };
}

/** Dynamic S/R from price history */
function calcSR(history: number[], price: number): SRZones {
  if (history.length < 4) return { support: price * 0.998, resistance: price * 1.002, nearSupport: false, nearResistance: false, bounceFromSupport: false, bounceFromResistance: false };
  const dec   = price > 100 ? 2 : 4;
  const support    = parseFloat(Math.min(...history).toFixed(dec));
  const resistance = parseFloat(Math.max(...history).toFixed(dec));
  const range      = resistance - support || 1;
  const threshold  = range * 0.12;
  const near_s     = price - support     < threshold;
  const near_r     = resistance - price  < threshold;
  const prev       = history[history.length - 2] ?? price;
  return {
    support, resistance,
    nearSupport: near_s, nearResistance: near_r,
    bounceFromSupport:    near_s && price > prev,
    bounceFromResistance: near_r && price < prev,
  };
}

export function computeMarketState(pairId: string, syncCount: number): Omit<LiveMarketState, "lastSync" | "syncCount"> {
  const history   = buildPriceHistory(pairId, syncCount, 30);
  const price     = history[history.length - 1];
  const prevPrice = history[history.length - 2] ?? price;
  const longPrice = history[0];

  const priceChange   = +((price - prevPrice) / prevPrice * 100).toFixed(4);
  const trend: LiveMarketState["trend"] = price > longPrice ? "bullish" : "bearish";
  const trendStrength = measureTrendStrength(history);

  const absChange = Math.abs(priceChange);
  const momentum: LiveMarketState["momentum"] = absChange > 0.07 ? "strong" : absChange > 0.025 ? "normal" : "weak";

  const r   = seededRand(hashStr(pairId + "_meta_" + syncCount));
  const vr  = r();
  const volatility: LiveMarketState["volatility"] = vr > 0.65 ? "high" : vr > 0.3 ? "medium" : "low";
  const volumeSpike = r() > 0.62;

  const hour = new Date().getUTCHours();
  const sr2  = r();
  const sessionBias: LiveMarketState["sessionBias"] =
    hour >= 7  && hour < 17 ? (sr2 > 0.45 ? trend : "neutral") :
    hour >= 17 && hour < 22 ? (sr2 > 0.5  ? trend : "neutral") : "neutral";

  // BB position from price percentile in history
  const hi  = Math.max(...history), lo = Math.min(...history);
  const pct = (price - lo) / ((hi - lo) || 1);
  const bbPosition: LiveMarketState["bbPosition"] =
    pct > 0.9 ? "above_upper" : pct > 0.7 ? "near_upper" :
    pct < 0.1 ? "below_lower" : pct < 0.3 ? "near_lower" : "middle";

  const earlyAvg = history.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
  const lateAvg  = history.slice(-8).reduce((a, b) => a + b, 0) / 8;
  const crossRand = r();
  const emaCross: LiveMarketState["emaCross"] =
    crossRand > 0.88 ? (lateAvg > earlyAvg ? "golden" : "death") : "none";

  const roc         = +((price - longPrice) / longPrice * 1000).toFixed(2);
  const magicV      = detectMagicV(history);
  const sr          = calcSR(history, price);
  const errorCandle = detectErrorCandle(history, trend);

  return { price, priceChange, priceHistory: history, trend, trendStrength, momentum, volatility, volumeSpike, sessionBias, bbPosition, emaCross, roc, magicV, sr, errorCandle };
}

export function useLiveMarket(pairId: string | null): LiveMarketState | null {
  const [state, setState] = useState<LiveMarketState | null>(null);
  const syncCountRef = useRef(30);
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
