/**
 * Signal Notification System — triggers browser notifications for A+ signals.
 *
 * Sends browser notification when an A+ signal is generated.
 * Optionally sends to a webhook (e.g., Telegram bot via the Python bridge).
 */

import type { PipelineSignalResult } from "./signalPipeline";

// ─────────────────────────────────────────────
// Browser Notifications
// ─────────────────────────────────────────────

let _permissionGranted = false;

/**
 * Request notification permission from the browser.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    _permissionGranted = true;
    return true;
  }
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  _permissionGranted = result === "granted";
  return _permissionGranted;
}

/**
 * Check if notifications are supported and enabled.
 */
export function notificationsEnabled(): boolean {
  if (typeof Notification === "undefined") return false;
  return Notification.permission === "granted";
}

// ─────────────────────────────────────────────
// A+ Signal Notification
// ─────────────────────────────────────────────

/**
 * Send a browser notification for an A+ signal.
 */
export function notifyASignal(
  pipeline: PipelineSignalResult,
  pairName: string,
): void {
  if (!notificationsEnabled()) return;
  if (!pipeline.aplus || pipeline.aplus.decision !== "A_PLUS_SIGNAL") return;

  const direction = pipeline.engine.direction === "BUY" ? "🟢 CALL" : "🔴 PUT";
  const score = pipeline.aplusScore.toFixed(1);
  const regime = pipeline.regime;
  const prob = pipeline.engine.direction === "BUY"
    ? `${(pipeline.xgboostCallProb * 100).toFixed(1)}%`
    : `${(pipeline.xgboostPutProb * 100).toFixed(1)}%`;

  const title = `🚀 A+ SIGNAL — ${pairName}`;
  const body = [
    `${direction} | Score: ${score}`,
    `XGBoost: ${prob} | Regime: ${regime}`,
    `Grade: ${pipeline.engine.grade} | Conf: ${pipeline.engine.confidence}%`,
  ].join("\n");

  try {
    new Notification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: `aplus-${pairName}-${Date.now()}`,
      requireInteraction: false,
      silent: false,
    } as NotificationOptions);
  } catch {
    // Notification API not available or blocked
  }
}

/**
 * Show a toast-style notification in the app (non-browser).
 * Returns a dismiss function.
 */
export function showToastNotification(
  pipeline: PipelineSignalResult,
  pairName: string,
): () => void {
  if (!pipeline.aplus || pipeline.aplus.decision !== "A_PLUS_SIGNAL") {
    return () => {};
  }

  // Create a DOM element for the toast
  const toast = document.createElement("div");
  toast.className = [
    "fixed top-4 right-4 z-[9999] max-w-sm",
    "bg-green-500/20 border border-green-500/40 rounded-2xl",
    "px-4 py-3 shadow-[0_0_30px_hsl(142_70%_45%/0.3)]",
    "animate-slide-up backdrop-blur-xl",
  ].join(" ");

  const direction = pipeline.engine.direction === "BUY" ? "🟢 CALL" : "🔴 PUT";
  const score = pipeline.aplusScore.toFixed(1);

  toast.innerHTML = `
    <div class="flex items-center gap-2 mb-1">
      <span class="text-xs font-black text-green-400">🚀 A+ SIGNAL</span>
      <span class="text-[9px] font-mono text-green-600">|</span>
      <span class="text-xs font-bold text-white">${pairName}</span>
    </div>
    <div class="text-sm font-black text-green-300">${direction} — Score: ${score}</div>
    <div class="text-[9px] font-mono text-slate-400 mt-1">
      XGBoost: ${pipeline.engine.direction === "BUY" ? (pipeline.xgboostCallProb * 100).toFixed(1) : (pipeline.xgboostPutProb * 100).toFixed(1)}%
      | Regime: ${pipeline.regime}
    </div>
  `;

  document.body.appendChild(toast);

  // Auto-dismiss after 8 seconds
  const timer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 8000);

  return () => {
    clearTimeout(timer);
    toast.remove();
  };
}
