/**
 * API Configuration — centralizes all backend URLs.
 *
 * In development: the Vite proxy handles /api/* → localhost:5000.
 * On Vercel (prod): serverless functions handle /api/* natively.
 *
 * Kimi (Moonshot AI) is called directly from the browser.
 */

/** Base URL for the api-server (Quotex data, ML proxy, assets, payouts). */
export const API_BASE: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_URL) || "";

/** Direct Quotex bridge URL — when set, the frontend talks to the bridge
 *  directly instead of going through the api-server. */
export const BRIDGE_BASE: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_BRIDGE_URL) || "";

/** Kimi (Moonshot AI) — called directly from the browser. */
export const KIMI_BASE = "https://api.moonshot.cn";

/** ML service is behind the api-server at /api/ml — no separate base needed. */
export const ML_BASE = API_BASE ? `${API_BASE}/api/ml` : "/api/ml";
