/**
 * ML Client — TypeScript API bridge to the Python ML service.
 *
 * Communicates with the ML service (port 5002) for:
 * - XGBoost predictions
 * - A+ quality evaluation
 * - Signal storage
 * - Training triggers
 * - Performance analytics
 *
 * Gracefully degrades when ML service is unreachable.
 */

import type { Candle, LiveMarketState } from "./liveMarket";
import type { SignalDirection } from "./signalEngine";
import { API_BASE } from "./apiConfig";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface MLPredictRequest {
  candles: Candle[];
  direction: "CALL" | "PUT";
  expiry: string;
  strategy_score?: number;
  strategy_direction?: number;
  strategy_confirmations?: number;
}

export interface MLPredictResponse {
  call_probability: number;
  put_probability: number;
  direction: string;
  expiry: string;
  model_trained: boolean;
}

export interface MLEvaluateRequest {
  candles: Candle[];
  direction: "CALL" | "PUT";
  expiry: string;
  asset?: string;
  timeframe?: string;
  entry_price?: number;
  strategy_score?: number;
  strategy_direction?: number;
  strategy_confirmations?: number;
  store?: boolean;
}

export interface APlusComponentScores {
  xgboost_prob: number;
  mtf_alignment: number;
  market_structure: number;
  entry_quality: number;
  momentum: number;
  candle_quality: number;
  support_resistance: number;
  volatility_regime: number;
}

export interface MLEvaluateResponse {
  score: number;
  decision: "A_PLUS_SIGNAL" | "REJECTED";
  threshold_used: number;
  regime: string;
  direction: string;
  call_probability: number;
  put_probability: number;
  component_scores: APlusComponentScores;
  reasons: string[];
  signal_id: number | null;
}

export interface MLModelStatus {
  trained: boolean;
  version: number;
  metrics: Record<string, unknown>;
}

export interface MLHealthResponse {
  ok: boolean;
  models_trained: boolean;
  model_status: Record<string, MLModelStatus>;
}

export interface SignalStats {
  total_signals: number;
  decided: number;
  wins: number;
  losses: number;
  pending: number;
  win_rate: number;
  signals_per_day: number;
  signals_per_hour: number;
  aplus_stats: {
    total: number;
    wins: number;
    losses: number;
    win_rate: number;
  };
  by_asset: Record<string, { total: number; wins: number; losses: number; win_rate: number }>;
  by_expiry: Record<string, { total: number; wins: number; losses: number; win_rate: number }>;
  by_regime: Record<string, { total: number; wins: number; losses: number; win_rate: number }>;
}

export interface MLConfig {
  weights: Record<string, number>;
  thresholds: Record<string, number>;
}

// ─────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────

const ML_SERVICE_URL = API_BASE ? `${API_BASE}/api/ml` : "/api/ml";

let _healthy: boolean | null = null;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30_000; // 30s

async function _fetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(`${ML_SERVICE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    _healthy = true;
    return res;
  } catch {
    _healthy = false;
    return null;
  }
}

/**
 * Check if the ML service is reachable.
 * Caches result for 30s to avoid hammering.
 */
export async function checkMLHealth(): Promise<boolean> {
  const now = Date.now();
  if (_healthy !== null && now - _lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return _healthy;
  }
  _lastHealthCheck = now;
  const res = await _fetch("/health");
  if (!res) return false;
  try {
    const data = (await res.json()) as MLHealthResponse;
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Get ML service health status.
 */
export async function getMLHealth(): Promise<MLHealthResponse | null> {
  const res = await _fetch("/health");
  if (!res) return null;
  try {
    return (await res.json()) as MLHealthResponse;
  } catch {
    return null;
  }
}

/**
 * Get XGBoost prediction for a candidate.
 */
export async function predict(req: MLPredictRequest): Promise<MLPredictResponse | null> {
  const res = await _fetch("/predict", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as MLPredictResponse;
  } catch {
    return null;
  }
}

/**
 * Full A+ quality evaluation of a candidate signal.
 * This is the main endpoint used by the signal pipeline.
 */
export async function evaluate(req: MLEvaluateRequest): Promise<MLEvaluateResponse | null> {
  const res = await _fetch("/evaluate", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as MLEvaluateResponse;
  } catch {
    return null;
  }
}

/**
 * Store a signal in the database.
 */
export async function storeSignal(data: Record<string, unknown>): Promise<number | null> {
  const res = await _fetch("/store-signal", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res || !res.ok) return null;
  try {
    const result = (await res.json()) as { signal_id: number };
    return result.signal_id;
  } catch {
    return null;
  }
}

/**
 * Update signal outcome (win/loss).
 */
export async function updateSignalResult(
  signalId: number,
  result: "win" | "loss",
  expiryPrice: number = 0,
): Promise<boolean> {
  const res = await _fetch(`/update-result/${signalId}`, {
    method: "PUT",
    body: JSON.stringify({ result, expiry_price: expiryPrice }),
  });
  return res !== null && res.ok;
}

/**
 * Trigger model training.
 */
export async function trainModels(
  expiry?: string,
  minSamples?: number,
): Promise<Record<string, unknown> | null> {
  const res = await _fetch("/train", {
    method: "POST",
    body: JSON.stringify({ expiry, min_samples: minSamples }),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Get model training status.
 */
export async function getModelStatus(): Promise<Record<string, MLModelStatus> | null> {
  const res = await _fetch("/model-status");
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, MLModelStatus>;
  } catch {
    return null;
  }
}

/**
 * Get performance report (baseline vs A+ filtered).
 */
export async function getReport(): Promise<Record<string, unknown> | null> {
  const res = await _fetch("/report");
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Get signal statistics.
 */
export async function getStats(): Promise<SignalStats | null> {
  const res = await _fetch("/stats");
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as SignalStats;
  } catch {
    return null;
  }
}

/**
 * Get recent signals.
 */
export async function getRecentSignals(
  limit: number = 50,
): Promise<Record<string, unknown>[] | null> {
  const res = await _fetch(`/recent?limit=${limit}`);
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { signals: Record<string, unknown>[] };
    return data.signals;
  } catch {
    return null;
  }
}

/**
 * Get current A+ scorer configuration.
 */
export async function getConfig(): Promise<MLConfig | null> {
  const res = await _fetch("/config");
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as MLConfig;
  } catch {
    return null;
  }
}

/**
 * Update A+ scorer configuration (weights/thresholds).
 */
export async function updateConfig(config: Partial<MLConfig>): Promise<MLConfig | null> {
  const res = await _fetch("/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as MLConfig;
  } catch {
    return null;
  }
}
