import { GetQuotexMarketResponse, type QuotexMarketResponse } from "@workspace/api-zod";
import { logger } from "./logger";

/**
 * Client for the Python Quotex bridge (`artifacts/quotex-bridge/bridge.py`),
 * which uses the quotexpy library (github.com/zagmi/qxbroker) to stream live
 * Quotex candles.
 */
const BRIDGE_URL = process.env["QUOTEX_BRIDGE_URL"]?.trim() || "http://127.0.0.1:5001";
// The bridge can take ~25s to answer /market when it retries slow candle
// fetches upstream; a shorter timeout aborts live-but-slow responses and
// misreports the bridge as not running.
const BRIDGE_TIMEOUT_MS = Number(process.env["QUOTEX_BRIDGE_TIMEOUT_MS"] ?? 35_000);

export function bridgeConfigured(): boolean {
  // The bridge only serves live data when it has credentials, but it is still
  // worth probing: it may be running with creds even when this server isn't.
  return true;
}

/**
 * Fetch live market data from the Python bridge.
 *
 * Returns `null` when the bridge is unreachable (not running), so callers can
 * fall back to another provider. Otherwise returns the bridge's response,
 * which may still report `status: "unavailable"` when it has no credentials.
 */
export async function bridgeGetMarket(
  asset: string,
  period: number,
): Promise<QuotexMarketResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const url = `${BRIDGE_URL}/market?asset=${encodeURIComponent(asset)}&period=${period}`;
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.json();
    return GetQuotexMarketResponse.parse(body);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.debug({ reason, url: `${BRIDGE_URL}/market` }, "Quotex bridge unreachable");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the list of instrument names Quotex currently reports as available
 * (via the bridge's `GET /assets`). Returns `null` when the bridge is
 * unreachable, so callers can fall back to a local pair list.
 */
export async function bridgeGetAssets(): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${BRIDGE_URL}/assets`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; assets?: unknown };
    return Array.isArray(body.assets) ? (body.assets as string[]) : null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.debug({ reason, url: `${BRIDGE_URL}/assets` }, "Quotex bridge unreachable");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch payout percentages for all open Quotex instruments
 * (via the bridge's `GET /payouts`).
 * Returns `null` when the bridge is unreachable.
 */
export async function bridgeGetPayouts(): Promise<Record<string, number> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${BRIDGE_URL}/payouts`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; payouts?: unknown };
    return body.payouts && typeof body.payouts === "object" ? (body.payouts as Record<string, number>) : null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.debug({ reason, url: `${BRIDGE_URL}/payouts` }, "Quotex bridge unreachable");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
