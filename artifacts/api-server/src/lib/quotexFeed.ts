import { GetQuotexMarketResponse, type QuotexMarketResponse } from "@workspace/api-zod";
import { bridgeGetMarket } from "./quotexBridge";

/* ═══════════════════════════════════════════════════════════
   LIVE QUOTEX DATA — single source of truth
   ═══════════════════════════════════════════════════════════
   All live market data comes from the Python bridge
   (artifacts/quotex-bridge/bridge.py), which uses the
   API-Quotex library (github.com/A11ksa/API-Quotex).

   The bridge reports:
     • "live"        → real candles, proxied straight through
     • "unavailable" → bridge has no credentials configured
     • "error"       → credentials rejected / market closed

   When the bridge is unreachable the response is an
   "unavailable" shape so clients fall back to simulation.
═══════════════════════════════════════════════════════════ */
export const quotexFeed = {
  async getMarket(asset: string, period: number): Promise<QuotexMarketResponse> {
    const bridge = await bridgeGetMarket(asset, period);
    if (bridge) return bridge;

    // Bridge not running → degrade to "unavailable" (clients simulate).
    const unavailable: QuotexMarketResponse = GetQuotexMarketResponse.parse({
      status: "unavailable",
      source: "none",
      configured: false,
      message: "Quotex bridge is not running. Start artifacts/quotex-bridge/bridge.py",
      asset,
      period,
      candles: [],
      updatedAt: null,
    });
    return unavailable;
  },
};
