/**
 * Vercel serverless proxy → Quotex bridge /market endpoint.
 *
 * Set QUOTEX_BRIDGE_URL on Vercel to your cloudflare tunnel URL, e.g.:
 *   https://lightning-demonstration-carter-subjects.trycloudflare.com
 */
const BRIDGE = process.env.QUOTEX_BRIDGE_URL?.trim() || "http://127.0.0.1:5001";

function json(res: any, code: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url || "", "http://localhost");
  const asset = url.searchParams.get("asset");
  const period = url.searchParams.get("period");
  if (!asset || !period) {
    return json(res, 400, { error: "Missing asset or period query param." });
  }

  try {
    const upstream = await fetch(
      `${BRIDGE}/market?asset=${encodeURIComponent(asset)}&period=${encodeURIComponent(period)}`,
      { signal: AbortSignal.timeout(18000), headers: { "bypass-tunnel-reminder": "true" } },
    );
    const data = await upstream.json();
    json(res, upstream.ok ? 200 : 503, data);
  } catch (err: any) {
    console.error("[/api/quotex/market] bridge error:", err?.message || err);
    json(res, 502, {
      status: "error",
      source: "proxy",
      configured: true,
      message: `Bridge unreachable. ${err?.message || ""}`,
      candles: [],
    });
  }
}
