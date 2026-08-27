import type { SignalResult } from "./signalEngine";
import type { LiveMarketState } from "./liveMarket";
import { KIMI_BASE } from "./apiConfig";

/* ══════════════════════════════════════════════
   KIMI (Moonshot AI) MARKET ANALYST
   Calls Kimi's chat completions API directly.
   In dev, the Vite proxy rewrites /kimi → moonshot.
   In prod (Vercel), we call the API directly via KIMI_BASE.
══════════════════════════════════════════════ */

// Kimi API key (Moonshot) — provided at build/dev time via VITE_KIMI_API_KEY.
// No key is baked into the bundle; without it Kimi analysis is disabled.
const KIMI_API_KEY = import.meta.env.VITE_KIMI_API_KEY ?? "";
const KIMI_MODEL = "moonshot-v1-8k";
const KIMI_TIMEOUT_MS = 12000;

export interface KimiVerdict {
  direction: "BUY" | "SELL" | "SKIP";
  confidence: number; // 0-100
  reason: string;
  raw: string;
}

interface KimiSnapshot {
  pair: string;
  price: number;
  changePct: number;
  rsi14: number;
  adx: number;
  macdHist: number;
  macdCross: string;
  stochK: number;
  stochD: number;
  bbPct: number;
  emaTrend: string;
  emaStack: string;
  trend: string;
  patterns: string[];
  session: string;
  engineDirection: string;
  engineConfidence: number;
}

function buildPrompt(snap: KimiSnapshot): string {
  return [
    "You are a professional binary options market analyst for Quotex (1-minute candles).",
    "Analyze the market snapshot below and decide BUY, SELL, or SKIP.",
    "Rules:",
    "- Only give a direction when there is REAL confluence (ADX 16+ with a clear trend, plus at least 3 supporting indicators).",
    "- Prefer SKIP when the market is ranging, conflicting, or low conviction — skipping is your best trade.",
    "- Confidence must be between 0 and 100 and reflect how strongly the evidence agrees.",
    "- Answer with STRICT JSON only, no markdown, no commentary, in this exact shape:",
    '{"direction":"BUY","confidence":78,"reason":"one short sentence"}',
    "",
    "MARKET SNAPSHOT (JSON):",
    JSON.stringify(snap),
  ].join("\n");
}

function parseVerdict(content: string): KimiVerdict | null {
  let text = content.trim();
  // Strip markdown code fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Fall back to the first {...} block if the model added prose
  if (!text.startsWith("{")) {
    const obj = text.match(/\{[\s\S]*\}/);
    if (obj) text = obj[0];
  }
  let parsed: { direction?: unknown; confidence?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const dir = String(parsed.direction ?? "").toUpperCase();
  if (!["BUY", "SELL", "SKIP"].includes(dir)) return null;
  const conf = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));
  const reason = String(parsed.reason ?? "").trim();
  if (!reason) return null;
  return { direction: dir as KimiVerdict["direction"], confidence: conf, reason, raw: content };
}

export function marketSnapshot(
  pairName: string,
  mkt: LiveMarketState,
  engine: SignalResult | null,
): KimiSnapshot {
  return {
    pair: pairName,
    price: mkt.price,
    changePct: mkt.priceChange,
    rsi14: mkt.indicators.rsi14,
    adx: mkt.indicators.adx,
    macdHist: mkt.indicators.macdHist,
    macdCross: mkt.indicators.macdCross,
    stochK: mkt.indicators.stochK,
    stochD: mkt.indicators.stochD,
    bbPct: mkt.indicators.bbPct,
    emaTrend: mkt.indicators.emaTrend,
    emaStack: mkt.indicators.emaStack,
    trend: mkt.structure.trend,
    patterns: engine?.patternNames ?? [],
    session: mkt.sessionName,
    engineDirection: engine?.direction ?? "none",
    engineConfidence: engine?.confidence ?? 0,
  };
}

/**
 * Ask Kimi to analyze a market snapshot. Returns a verdict or null when the
 * API is unreachable / quota exhausted / response unparsable (caller falls
 * back to the local confluence engine).
 */
export async function analyzeWithKimi(
  pairName: string,
  mkt: LiveMarketState,
  engine: SignalResult | null,
): Promise<KimiVerdict | null> {
  if (!KIMI_API_KEY) {
    throw new Error("Kimi not configured — set VITE_KIMI_API_KEY to enable.");
  }
  const snap = marketSnapshot(pairName, mkt, engine);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KIMI_TIMEOUT_MS);
  try {
    const res = await fetch(`${KIMI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: "system", content: "You are a precise, conservative binary options market analyst." },
          { role: "user", content: buildPrompt(snap) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Distinguish auth/quota failures from transient network issues.
      const status = res.status;
      throw new Error(
        status === 401 || status === 402 || status === 429
          ? `Kimi API ${status} — check key / account balance.`
          : `Kimi API ${status}`,
      );
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return parseVerdict(content);
  } catch (err) {
    const msg = err instanceof Error && err.message.startsWith("Kimi API")
      ? err.message
      : null;
    if (msg) throw new Error(msg);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
