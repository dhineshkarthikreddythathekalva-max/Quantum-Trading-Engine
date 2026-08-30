const BRIDGE = process.env.QUOTEX_BRIDGE_URL?.trim() || "http://127.0.0.1:5001";

function json(res: any, code: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }
  try {
    const upstream = await fetch(`${BRIDGE}/assets`, { signal: AbortSignal.timeout(15000) });
    const data = await upstream.json();
    json(res, upstream.ok ? 200 : 503, data);
  } catch (err: any) {
    json(res, 502, { status: "error", assets: [], message: err?.message });
  }
}
