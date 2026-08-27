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
    const bridgeRes = await fetch(`${BRIDGE_URL}/payouts`, {
      signal: controller.signal,
      headers: { "bypass-tunnel-reminder": "true" },
    });
    clearTimeout(timer);
    if (!bridgeRes.ok) {
      return res.json({ status: "unavailable", source: "none", payouts: {} });
    }
    const body = await bridgeRes.json();
    return res.json({
      status: body.payouts && typeof body.payouts === "object" ? "ok" : "unavailable",
      source: body.payouts ? "quotex" : "none",
      payouts: body.payouts || {},
    });
  } catch {
    return res.json({ status: "unavailable", source: "none", payouts: {} });
  }
};
