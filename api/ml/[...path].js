const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!ML_SERVICE_URL) {
    return res.status(503).json({
      ok: false,
      message: "ML_SERVICE_URL not configured. Set it in Vercel env vars.",
    });
  }

  // Extract the path after /api/ml/
  const pathParts = req.query.path || [];
  const path = Array.isArray(pathParts) ? pathParts.join("/") : pathParts;
  const url = `${ML_SERVICE_URL.replace(/\/$/, "")}/${path}`;
  const fullUrl = req.url ? `${url}${new URL(req.url, "http://x").search || ""}` : url;

  try {
    const init = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = JSON.stringify(req.body);
    }
    const mlRes = await fetch(fullUrl, init);
    const data = await mlRes.json();
    return res.status(mlRes.status).json(data);
  } catch {
    return res.status(503).json({
      ok: false,
      message: "ML service unreachable. Check ML_SERVICE_URL.",
    });
  }
};
