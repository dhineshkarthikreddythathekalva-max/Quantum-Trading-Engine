const BRIDGE_URL = process.env.QUOTEX_BRIDGE_URL || "http://127.0.0.1:5001";
const BRIDGE_TIMEOUT_MS = 15000;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
    const bridgeRes = await fetch(`${BRIDGE_URL}/assets`, {
      signal: controller.signal,
      headers: { "bypass-tunnel-reminder": "true" },
    });
    clearTimeout(timer);
    if (!bridgeRes.ok) {
      return res.json({ status: "unavailable", source: "none", assets: [] });
    }
    const body = await bridgeRes.json();
    const assets = Array.isArray(body.assets) ? body.assets : [];
    return res.json({
      status: assets.length > 0 ? "ok" : "unavailable",
      source: assets.length > 0 ? "quotex" : "none",
      assets,
    });
  } catch {
    return res.json({ status: "unavailable", source: "none", assets: [] });
  }
};
