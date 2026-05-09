export type PairCategory = "currencies" | "crypto" | "commodities" | "stocks";

export interface TradingPair {
  id: string;
  name: string;
  category: PairCategory;
  isOTC: boolean;
  profitability?: number;
}

export const PAIRS: TradingPair[] = [
  // ── CURRENCIES OTC ──
  { id: "usd_brl_otc", name: "USD/BRL", category: "currencies", isOTC: true, profitability: 95 },
  { id: "cad_chf_otc", name: "CAD/CHF", category: "currencies", isOTC: true, profitability: 95 },
  { id: "nzd_chf_otc", name: "NZD/CHF", category: "currencies", isOTC: true, profitability: 95 },
  { id: "nzd_jpy_otc", name: "NZD/JPY", category: "currencies", isOTC: true, profitability: 93 },
  { id: "usd_ars_otc", name: "USD/ARS", category: "currencies", isOTC: true, profitability: 93 },
  { id: "usd_bdt_otc", name: "USD/BDT", category: "currencies", isOTC: true, profitability: 93 },
  { id: "usd_mxn_otc", name: "USD/MXN", category: "currencies", isOTC: true, profitability: 92 },
  { id: "usd_pkr_otc", name: "USD/PKR", category: "currencies", isOTC: true, profitability: 92 },
  { id: "aud_nzd_otc", name: "AUD/NZD", category: "currencies", isOTC: true, profitability: 91 },
  { id: "eur_nzd_otc", name: "EUR/NZD", category: "currencies", isOTC: true, profitability: 90 },
  { id: "nzd_cad_otc", name: "NZD/CAD", category: "currencies", isOTC: true, profitability: 88 },
  { id: "usd_egp_otc", name: "USD/EGP", category: "currencies", isOTC: true, profitability: 87 },
  { id: "usd_idr_otc", name: "USD/IDR", category: "currencies", isOTC: true, profitability: 79 },
  { id: "usd_zar_otc", name: "USD/ZAR", category: "currencies", isOTC: true, profitability: 79 },
  { id: "usd_dzd_otc", name: "USD/DZD", category: "currencies", isOTC: true, profitability: 78 },
  { id: "usd_cop_otc", name: "USD/COP", category: "currencies", isOTC: true, profitability: 77 },
  { id: "usd_inr_otc", name: "USD/INR", category: "currencies", isOTC: true, profitability: 77 },
  { id: "usd_ngn_otc", name: "USD/NGN", category: "currencies", isOTC: true, profitability: 77 },
  { id: "usd_php_otc", name: "USD/PHP", category: "currencies", isOTC: true, profitability: 77 },
  { id: "gbp_nzd_otc", name: "GBP/NZD", category: "currencies", isOTC: true, profitability: 61 },
  { id: "nzd_usd_otc", name: "NZD/USD", category: "currencies", isOTC: true, profitability: 64 },

  // ── CURRENCIES LIVE ──
  { id: "eur_usd", name: "EUR/USD", category: "currencies", isOTC: false, profitability: 78 },
  { id: "gbp_usd", name: "GBP/USD", category: "currencies", isOTC: false, profitability: 65 },
  { id: "aud_usd", name: "AUD/USD", category: "currencies", isOTC: false, profitability: 67 },
  { id: "usd_jpy", name: "USD/JPY", category: "currencies", isOTC: false, profitability: 80 },
  { id: "eur_gbp", name: "EUR/GBP", category: "currencies", isOTC: false, profitability: 75 },
  { id: "aud_jpy", name: "AUD/JPY", category: "currencies", isOTC: false, profitability: 70 },
  { id: "cad_jpy", name: "CAD/JPY", category: "currencies", isOTC: false, profitability: 70 },
  { id: "gbp_jpy", name: "GBP/JPY", category: "currencies", isOTC: false, profitability: 64 },
  { id: "chf_jpy", name: "CHF/JPY", category: "currencies", isOTC: false, profitability: 63 },
  { id: "eur_jpy", name: "EUR/JPY", category: "currencies", isOTC: false, profitability: 86 },
  { id: "aud_cad", name: "AUD/CAD", category: "currencies", isOTC: false, profitability: 60 },
  { id: "eur_aud", name: "EUR/AUD", category: "currencies", isOTC: false, profitability: 60 },
  { id: "eur_cad", name: "EUR/CAD", category: "currencies", isOTC: false, profitability: 55 },
  { id: "gbp_aud", name: "GBP/AUD", category: "currencies", isOTC: false, profitability: 62 },
  { id: "gbp_cad", name: "GBP/CAD", category: "currencies", isOTC: false, profitability: 55 },
  { id: "gbp_chf", name: "GBP/CHF", category: "currencies", isOTC: false, profitability: 55 },
  { id: "eur_chf", name: "EUR/CHF", category: "currencies", isOTC: false, profitability: 62 },
  { id: "usd_cad", name: "USD/CAD", category: "currencies", isOTC: false, profitability: 55 },

  // ── CRYPTO OTC ──
  { id: "btc_otc", name: "Bitcoin", category: "crypto", isOTC: true, profitability: 74 },
  { id: "eth_otc", name: "Ethereum", category: "crypto", isOTC: true, profitability: 75 },
  { id: "xrp_otc", name: "Ripple", category: "crypto", isOTC: true, profitability: 92 },
  { id: "ltc_otc", name: "Litecoin", category: "crypto", isOTC: true, profitability: 64 },
  { id: "bch_otc", name: "Bitcoin Cash", category: "crypto", isOTC: true, profitability: 77 },
  { id: "bnb_otc", name: "Binance Coin", category: "crypto", isOTC: true, profitability: 80 },
  { id: "avax_otc", name: "Avalanche", category: "crypto", isOTC: true, profitability: 73 },
  { id: "zec_otc", name: "Zcash", category: "crypto", isOTC: true, profitability: 92 },
  { id: "atom_otc", name: "Cosmos", category: "crypto", isOTC: true, profitability: 68 },
  { id: "dash_otc", name: "Dash", category: "crypto", isOTC: true, profitability: 90 },
  { id: "sol_otc", name: "Solana", category: "crypto", isOTC: true, profitability: 71 },
  { id: "ton_otc", name: "Toncoin", category: "crypto", isOTC: true, profitability: 78 },
  { id: "etc_otc", name: "Ethereum Classic", category: "crypto", isOTC: true, profitability: 70 },
  { id: "dot_otc", name: "Polkadot", category: "crypto", isOTC: true, profitability: 77 },
  { id: "axs_otc", name: "Axie Infinity", category: "crypto", isOTC: true, profitability: 92 },
  { id: "trump_otc", name: "Trump", category: "crypto", isOTC: true, profitability: 83 },
  { id: "link_otc", name: "Chainlink", category: "crypto", isOTC: true, profitability: 92 },

  // ── COMMODITIES ──
  { id: "ukbrent_otc", name: "UKBrent", category: "commodities", isOTC: true, profitability: 92 },
  { id: "uscrude_otc", name: "USCrude", category: "commodities", isOTC: true, profitability: 91 },
  { id: "gold", name: "Gold", category: "commodities", isOTC: false, profitability: 40 },
  { id: "silver", name: "Silver", category: "commodities", isOTC: false, profitability: 20 },

  // ── STOCKS OTC ──
  { id: "intc_otc", name: "Intel", category: "stocks", isOTC: true, profitability: 92 },
  { id: "jnj_otc", name: "Johnson & Johnson", category: "stocks", isOTC: true, profitability: 91 },
  { id: "msft_otc", name: "Microsoft", category: "stocks", isOTC: true, profitability: 87 },
  { id: "mcd_otc", name: "McDonald's", category: "stocks", isOTC: true, profitability: 85 },
  { id: "ba_otc", name: "Boeing Company", category: "stocks", isOTC: true, profitability: 84 },
  { id: "axp_otc", name: "American Express", category: "stocks", isOTC: true, profitability: 81 },
  { id: "fb_otc", name: "FACEBOOK INC", category: "stocks", isOTC: true, profitability: 78 },
  { id: "pfe_otc", name: "Pfizer Inc", category: "stocks", isOTC: true, profitability: 77 },
  { id: "nikkei_otc", name: "Nikkei 225", category: "stocks", isOTC: false, profitability: 20 },
  { id: "asx_otc", name: "S&P/ASX 200", category: "stocks", isOTC: false, profitability: 20 },
];

export const CATEGORY_LABELS: Record<PairCategory, string> = {
  currencies: "Currencies",
  crypto: "Crypto",
  commodities: "Commodities",
  stocks: "Stocks",
};
