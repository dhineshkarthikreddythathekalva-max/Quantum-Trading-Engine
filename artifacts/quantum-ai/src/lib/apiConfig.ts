/**
 * API Configuration — centralizes all backend URLs.
 *
 * On Replit (dev): the Vite proxy handles /api/* → localhost:5000, so no base URL needed.
 * On Vercel (prod): set VITE_API_URL to the Replit backend URL (e.g. https://your-app.replit.app).
 *
 * Kimi (Moonshot AI) is called directly — the Vite dev proxy is not available in production.
 */

/** Base URL for the api-server (Quotex data, ML proxy, assets, payouts). */
export const API_BASE: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_URL) || "";

/** Kimi (Moonshot AI) — called directly from the browser. */
export const KIMI_BASE = "https://api.moonshot.cn";

/** ML service is behind the api-server at /api/ml — no separate base needed. */
export const ML_BASE = API_BASE ? `${API_BASE}/api/ml` : "/api/ml";
