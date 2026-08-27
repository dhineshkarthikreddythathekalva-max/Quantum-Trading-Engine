/* ══════════════════════════════════════════════
   QUOTEX PAYOUT PERCENTAGES
   Pulls payout % for all open instruments
   (via bridge /payouts → api-server /api/quotex/payouts)
═══════════════════════════════════════════════ */

import { API_BASE } from "./apiConfig";

/**
 * Fetch payout percentages from Quotex.
 * Returns `{ instrumentName: payoutPercent }` or null when unreachable.
 */
export async function fetchQuotexPayouts(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`${API_BASE}/api/quotex/payouts`);
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string; payouts?: Record<string, number> };
    if (data.status !== "ok" || !data.payouts || typeof data.payouts !== "object") {
      return null;
    }
    return data.payouts;
  } catch {
    return null;
  }
}
