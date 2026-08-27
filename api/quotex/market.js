const BRIDGE_URL = process.env.QUOTEX_BRIDGE_URL || "http://127.0.0.1:5001";
const BRIDGE_TIMEOUT_MS = 30000;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { asset, period } = req.query;
  if (!asset || !period) {
    return res.status(400).json({ error: "asset and period are required" });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
    const url = `${BRIDGE_URL}/market?asset=${encodeURIComponent(asset)}&period=${period}`;
    const bridgeRes = await fetch(url, {
      signal: controller.signal,
      headers: { "bypass-tunnel-reminder": "true" },
    });
    clearTimeout(timer);
    const data = await bridgeRes.json();
    return res.status(bridgeRes.ok ? 200 : 503).json(data);
  } catch {
    return res.status(503).json({
      status: "unavailable",
      source: "none",
      configured: false,
      message: "Quotex bridge is not running. Start the bridge and set QUOTEX_BRIDGE_URL.",
      asset,
      period: Number(period),
      candles: [],
      updatedAt: null,
    });
  }
};
