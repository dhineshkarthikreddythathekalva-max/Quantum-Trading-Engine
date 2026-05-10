import { useState, useEffect, useRef } from "react";

export interface LiveMarketState {
  price: number;
  priceChange: number;       // % change vs last tick
  trend: "bullish" | "bearish";
  momentum: "strong" | "normal" | "weak";
  volatility: "high" | "medium" | "low";
  volumeSpike: boolean;
  sessionBias: "bullish" | "bearish" | "neutral";
  bbPosition: "above_upper" | "near_upper" | "middle" | "near_lower" | "below_lower";
  emaCross: "golden" | "death" | "none";
  roc: number;               // rate of change
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
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h);
}

export function computeMarketState(pairId: string, syncCount: number): Omit<LiveMarketState, "lastSync" | "syncCount"> {
  const base = BASE_PRICES[pairId] ?? BASE_PRICES.default;
  // Use overlapping windows so each tick builds on previous for continuity
  const seed1 = hashStr(pairId + "_tick_" + syncCount);
  const seed2 = hashStr(pairId + "_tick_" + (syncCount - 1));
  const r1 = seededRand(seed1);
  const r2 = seededRand(seed2);

  // Random walk price evolution
  const prevOffset = (r2() - 0.5) * 0.004;
  const currOffset = prevOffset + (r1() - 0.5) * 0.003;
  const price = +(base * (1 + currOffset)).toFixed(base > 100 ? 2 : 4);
  const priceChange = +((currOffset - prevOffset) * 100).toFixed(4);

  // Trend determined by direction of price over last 3 ticks
  const r3 = seededRand(hashStr(pairId + "_tick_" + (syncCount - 2)));
  const longOffset = (r3() - 0.5) * 0.006;
  const trend: LiveMarketState["trend"] = currOffset > longOffset ? "bullish" : "bearish";

  // Momentum
  const absChange = Math.abs(priceChange);
  const momentum: LiveMarketState["momentum"] = absChange > 0.08 ? "strong" : absChange > 0.03 ? "normal" : "weak";

  // Volatility based on recent range
  const volSeed = hashStr(pairId + "_vol_" + Math.floor(syncCount / 3));
  const vr = seededRand(volSeed)();
  const volatility: LiveMarketState["volatility"] = vr > 0.65 ? "high" : vr > 0.3 ? "medium" : "low";

  // Volume spike
  const volumeSpike = r1() > 0.62;

  // Session bias (simulate FX session effects)
  const hour = new Date().getUTCHours();
  let sessionBias: LiveMarketState["sessionBias"];
  const sessionRand = r1();
  if (hour >= 7 && hour < 17) {
    sessionBias = sessionRand > 0.45 ? trend : "neutral";
  } else if (hour >= 17 && hour < 22) {
    sessionBias = sessionRand > 0.5 ? trend : "neutral";
  } else {
    sessionBias = "neutral";
  }

  // Bollinger band position
  const bbRand = r1();
  const bbOptions: LiveMarketState["bbPosition"][] = ["above_upper", "near_upper", "middle", "near_lower", "below_lower"];
  const bbWeights = trend === "bullish"
    ? [0.05, 0.2, 0.4, 0.25, 0.1]
    : [0.1, 0.25, 0.4, 0.2, 0.05];
  let bbPos: LiveMarketState["bbPosition"] = "middle";
  let cumWeight = 0;
  for (let i = 0; i < bbWeights.length; i++) {
    cumWeight += bbWeights[i];
    if (bbRand < cumWeight) { bbPos = bbOptions[i]; break; }
  }

  // EMA cross
  const crossRand = r1();
  const emaCross: LiveMarketState["emaCross"] =
    crossRand > 0.88 ? (trend === "bullish" ? "golden" : "death") : "none";

  // Rate of change
  const roc = +((currOffset - longOffset) * 1000).toFixed(2);

  return { price, priceChange, trend, momentum, volatility, volumeSpike, sessionBias, bbPosition: bbPos, emaCross, roc };
}

export function useLiveMarket(pairId: string | null): LiveMarketState | null {
  const [state, setState] = useState<LiveMarketState | null>(null);
  const syncCountRef = useRef(0);

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
