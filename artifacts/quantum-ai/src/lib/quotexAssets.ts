import type { PairCategory, TradingPair } from "@/data/pairs";
import { API_BASE } from "./apiConfig";

/* ══════════════════════════════════════════════
   QUOTEX AVAILABLE ASSETS
   Pulls the instrument list Quotex actually
   reports (via bridge /assets → api-server
   /api/quotex/assets) and maps each instrument
   name (e.g. "EURUSD_otc", "BTCUSD_otc",
   "SPX500") to our TradingPair shape so the
   pair selector + scanners show only assets
   that really exist on Quotex.
══════════════════════════════════════════════ */

const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", XRP: "Ripple", SOL: "Solana",
  BNB: "Binance Coin", LTC: "Litecoin", DOT: "Polkadot",
  TON: "Toncoin", AXS: "Axie Infinity", BCH: "Bitcoin Cash",
  ETC: "Ethereum Classic", ZEC: "Zcash",
  ATO: "Cosmos", AVA: "Avalanche", DAS: "Dash", LIN: "Chainlink",
  TRU: "Trump",
};

const INDEX_NAMES: Record<string, string> = {
  CHIA50: "China A50", F40EUR: "CAC 40", FTSGBP: "FTSE 100",
  HSIHKD: "Hang Seng", IBXEUR: "IBEX 35", JPXJPY: "Nikkei 225",
  STXEUR: "Euro Stoxx 50", AXJAUD: "Asia ex-Japan (AXJ)",
};

const COMMODITY_NAMES: Record<string, string> = {
  XAUUSD: "Gold", XAGUSD: "Silver", UKBRENT: "UK Brent",
  USCRUDE: "US Crude", NATGAS: "Natural Gas", NATURALGAS: "Natural Gas",
  COPPER: "Copper", PLATINUM: "Platinum", PALLADIUM: "Palladium",
  WHEAT: "Wheat", CORN: "Corn", SOYBEAN: "Soybean",
  SUGAR: "Sugar", COFFEE: "Coffee", COCOA: "Cocoa",
};

const STOCK_NAMES: Record<string, string> = {
  AAPL: "Apple Inc", TSLA: "Tesla", AMZN: "Amazon", NFLX: "Netflix",
  GOOGL: "Alphabet (Google)", NVDA: "NVIDIA", MSFT: "Microsoft",
  META: "Meta (Facebook)", KO: "Coca-Cola", GS: "Goldman Sachs",
  JPM: "JP Morgan", XOM: "ExxonMobil", DIS: "Disney", INTC: "Intel",
  JNJ: "Johnson & Johnson", MCD: "McDonald's", BA: "Boeing",
  AXP: "American Express", PFE: "Pfizer Inc",
};

export function quotexInstrumentToPair(instrument: string): TradingPair {
  const isOTC = /_otc$/i.test(instrument);
  const base  = instrument.replace(/_otc$/i, "");
  const upper = base.toUpperCase();
  const id    = instrument.toLowerCase().replace(/[^a-z0-9]/g, "");

  let name: string;
  let category: PairCategory;

  if (INDEX_NAMES[upper]) {
    name = INDEX_NAMES[upper]; category = "indices";
  } else if (COMMODITY_NAMES[upper]) {
    name = COMMODITY_NAMES[upper]; category = "commodities";
  } else if (STOCK_NAMES[upper]) {
    name = STOCK_NAMES[upper]; category = "stocks";
  } else if (CRYPTO_NAMES[upper.slice(0, 3)]) {
    name = CRYPTO_NAMES[upper.slice(0, 3)]; category = "crypto";
  } else if (/^[A-Z]{6}$/.test(upper)) {
    // Pure 6-letter instrument (e.g. EURUSD, USDZAR) → forex pair
    name = `${upper.slice(0, 3)}/${upper.slice(3)}`; category = "currencies";
  } else {
    name = upper; category = "indices";
  }

  return { id, name, category, isOTC };
}

/**
 * Fetch the instruments Quotex currently reports as available.
 * Returns `null` when the bridge/api-server is unreachable or reports none,
 * so callers can fall back to the local pair list.
 */
export async function fetchQuotexAssets(): Promise<TradingPair[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/quotex/assets`);
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string; assets?: string[] };
    if (data.status !== "ok" || !Array.isArray(data.assets) || data.assets.length === 0) {
      return null;
    }
    const seen = new Set<string>();
    const pairs: TradingPair[] = [];
    for (const instrument of data.assets) {
      const pair = quotexInstrumentToPair(instrument);
      if (seen.has(pair.id)) continue;
      seen.add(pair.id);
      pairs.push(pair);
    }
    return pairs;
  } catch {
    return null;
  }
}
