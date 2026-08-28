#!/usr/bin/env python3
"""Quotex live-data bridge.

Connects to Quotex via the **API-Quotex** library (https://github.com/A11ksa/API-Quotex)
and exposes real-time OHLC candles over a tiny HTTP API so the Node API server and the
React app can consume live market data.

Authentication:
  * ``QUOTEX_SSID``           — session token (preferred; no browser needed)
  * ``QUOTEX_COOKIES``        — browser Cookie string; enables SSID auto-refresh
  * ``QUOTEX_EMAIL`` + ``QUOTEX_PASSWORD`` — Playwright login (needs `python -m playwright install chromium`)

Run:
    pip install -r requirements.txt
    python bridge.py

Endpoints:
    GET /health
    GET /assets
    GET /market?asset=eur_usd_otc&period=60
"""

import asyncio
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from api_quotex import AsyncQuotexClient
from api_quotex.exceptions import AuthenticationError, QuotexError

# ── Load a gitignored .env file next to this script (if present) ──
def _load_dotenv():
    env_file = Path(__file__).resolve().parent / ".env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)

_load_dotenv()

HOST = os.environ.get("QUOTEX_BRIDGE_HOST", "0.0.0.0")
PORT = int(os.environ.get("QUOTEX_BRIDGE_PORT") or os.environ.get("PORT") or "5001")

SSID = os.environ.get("QUOTEX_SSID", "").strip()
COOKIES = os.environ.get("QUOTEX_COOKIES", "").strip()
EMAIL = os.environ.get("QUOTEX_EMAIL", "").strip()
PASSWORD = os.environ.get("QUOTEX_PASSWORD", "").strip()
IS_DEMO = os.environ.get("QUOTEX_IS_DEMO", "true").lower() not in ("0", "false", "no")
USER_AGENT = os.environ.get("QUOTEX_USER_AGENT", "").strip() or \
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

# Refresh interval: mints a fresh SSID via Quotex's digest endpoint before the
# current one expires (only works when QUOTEX_COOKIES is provided).
REFRESH_INTERVAL = int(os.environ.get("QUOTEX_REFRESH_INTERVAL", "600"))
ENV_FILE = Path(__file__).resolve().parent / ".env"

# Map our app pair ids -> Quotex instrument base names for assets where the
# naive uppercase translation would be wrong (crypto, indices, commodities…).
# Extend or override via the QUOTEX_ASSET_MAP env var (JSON object).
ASSET_BASE_OVERRIDES = {
    "btc": "BTCUSD", "eth": "ETHUSD", "xrp": "XRPUSD", "bnb": "BNBUSD",
    "sol": "SOLUSD", "ton": "TONUSD", "link": "LINKUSD", "avax": "AVAXUSD",
    "dot": "DOTUSD", "ltc": "LTCUSD", "bch": "BCHUSD", "atom": "ATOMUSD",
    "dash": "DASHUSD", "etc": "ETCUSD", "zec": "ZECUSD", "axs": "AXSUSD",
    "trump": "TRUMPUSD",
    "sp500": "SPX500", "dj30": "US30", "nasdaq": "NAS100", "dax": "DE30",
    "ftse": "UK100", "cac40": "FRA40", "nikkei": "JP225", "asx": "AUS200",
    "stoxx": "STOXX50", "hsi": "HK50",
    "ukbrent": "UKBRENT", "uscrude": "USCRUDE", "natgas": "NATGAS",
    "platinum": "PLATINUM", "copper": "COPPER",
    "aapl": "AAPL", "tsla": "TSLA", "amzn": "AMZN", "nflx": "NFLX",
    "googl": "GOOGL", "nvda": "NVDA", "msft": "MSFT", "meta": "META",
    "ko": "KO", "gs": "GS", "jpm": "JPM", "xom": "XOM", "dis": "DIS",
    "intc": "INTC", "jnj": "JNJ", "mcd": "MCD", "ba": "BA", "axp": "AXP",
    "pfe": "PFE",
}

try:
    _env_map = json.loads(os.environ.get("QUOTEX_ASSET_MAP", "{}"))
    if isinstance(_env_map, dict):
        ASSET_BASE_OVERRIDES.update({str(k).lower(): str(v) for k, v in _env_map.items()})
except Exception:  # pragma: no cover - bad env var should not kill the bridge
    pass

CONNECT_TIMEOUT = 25
CANDLE_TIMEOUT = 15
ASSETS_TIMEOUT = 15
CONNECT_COOLDOWN = 20  # don't retry a failed connect within this many seconds


def configured() -> bool:
    return bool(SSID or (EMAIL and PASSWORD))


def normalize(name: str) -> str:
    """Normalize an instrument name for fuzzy matching (lower, alnum only)."""
    return "".join(ch for ch in name.lower() if ch.isalnum())


class QuotexBridge:
    """Owns the API-Quotex client; runs its asyncio loop on a dedicated thread."""

    def __init__(self):
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._run_loop, name="quotex-loop", daemon=True).start()
        self._client = None
        self._lock = threading.Lock()
        self._assets = None
        self._last_error = ""
        self._connect_fail_at = 0.0
        self._connect_fail_msg = ""
        threading.Thread(target=self._refresh_loop, name="quotex-refresh", daemon=True).start()

    def _run_loop(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _submit(self, coro, timeout):
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        try:
            return future.result(timeout=timeout)
        except asyncio.TimeoutError:
            future.cancel()
            raise

    # ── connection ────────────────────────────────────────────────
    async def _login_ssid(self) -> str:
        """Get an SSID via API-Quotex's Playwright login helper."""
        from api_quotex import get_ssid
        success, data = await get_ssid(email=EMAIL, password=PASSWORD, is_demo=IS_DEMO)
        if not success:
            raise RuntimeError(f"Playwright login failed: {data}")
        if isinstance(data, dict):
            for key in ("demo", "live", "ssid", "token", "session"):
                value = data.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        raise RuntimeError("Playwright login did not return an SSID.")

    async def _ensure_client(self):
        if self._client is not None and self._client.is_connected:
            return self._client
        ssid = SSID
        if not ssid and EMAIL and PASSWORD:
            ssid = await self._login_ssid()
        if not ssid:
            raise RuntimeError("No Quotex credentials available (QUOTEX_SSID or email/password).")
        client = AsyncQuotexClient(
            ssid=ssid,
            is_demo=IS_DEMO,
            enable_logging=False,
            persistent_connection=False,
            auto_reconnect=True,
        )
        ok = await client.connect()
        if not ok:
            raise RuntimeError("Quotex rejected the connection (bad SSID or credentials).")
        self._client = client
        return client

    # ── permanent access: keep the SSID fresh ──────────────────────
    @staticmethod
    def _persist_ssid(token: str):
        """Write the refreshed SSID into the gitignored .env file."""
        global SSID
        SSID = token
        lines = []
        if ENV_FILE.is_file():
            lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
        replaced = False
        for i, line in enumerate(lines):
            if line.strip().startswith("QUOTEX_SSID="):
                lines[i] = f"QUOTEX_SSID={token}"
                replaced = True
                break
        if not replaced:
            lines.append(f"QUOTEX_SSID={token}")
        ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _refresh_once(self):
        """Mint a fresh SSID via Quotex's digest endpoint (needs cookies)."""
        if not COOKIES:
            return
        try:
            import requests
            with self._lock:
                resp = requests.get(
                    "https://qxbroker.com/api/v1/cabinets/digest",
                    headers={"User-Agent": USER_AGENT, "Cookie": COOKIES},
                    timeout=10,
                )
                if resp.status_code == 200:
                    token = (resp.json() or {}).get("data", {}).get("token")
                    if isinstance(token, str) and len(token) >= 16:
                        self._persist_ssid(token)
                        client = self._client
                        if client is not None:
                            client.session_id = token
                            client.raw_ssid = token
                        print(f"[quotex-bridge] refreshed SSID ({len(token)} chars)", flush=True)
        except BaseException as exc:
            self._last_error = f"refresh: {exc}"

    def _refresh_loop(self):
        while True:
            time.sleep(REFRESH_INTERVAL)
            self._refresh_once()

    def ensure_connected(self):
        now = time.time()
        if self._client is not None and self._client.is_connected:
            return self._client
        if self._connect_fail_at and now - self._connect_fail_at < CONNECT_COOLDOWN:
            raise RuntimeError(self._connect_fail_msg or "Quotex connection recently failed.")
        try:
            client = self._submit(self._ensure_client(), timeout=CONNECT_TIMEOUT)
            self._connect_fail_at = 0.0
            self._connect_fail_msg = ""
            # Kick off an immediate refresh so we always hold a young token.
            self._refresh_once()
            return client
        except BaseException as exc:
            self._client = None
            self._connect_fail_at = now
            self._connect_fail_msg = str(exc)
            raise

    # ── assets (best-effort, cached) ───────────────────────────────
    def _fetch_assets(self):
        if self._assets is None:
            try:
                client = self.ensure_connected()
                raw = self._submit(client.get_available_assets(), timeout=ASSETS_TIMEOUT)
                self._assets = dict(raw) if isinstance(raw, dict) else {}
            except BaseException as exc:  # non-fatal: asset validation is best-effort
                self._last_error = f"assets: {exc}"
        return self._assets

    def resolve_asset(self, asset_id: str) -> str:
        """Map our pair id (e.g. ``eur_usd_otc``) to a Quotex instrument name."""
        otc = asset_id.lower().endswith("_otc")
        base = asset_id[:-4] if otc else asset_id
        base = base.strip("_").lower()
        suffix = "_otc" if otc else ""

        candidates = []
        if base in ASSET_BASE_OVERRIDES:
            candidates.append(ASSET_BASE_OVERRIDES[base] + suffix)
        candidates.append(base.upper().replace("_", "") + suffix)
        candidates = list(dict.fromkeys(candidates))  # de-dup, keep order

        assets = self._fetch_assets() or {}
        if assets:
            norm = {normalize(key): key for key in assets}
            for candidate in candidates:
                key = normalize(candidate)
                if key in norm:
                    return norm[key]
            for candidate in candidates:
                key = normalize(candidate)
                for n_key, real in norm.items():
                    if n_key.startswith(key):
                        return real
            raise LookupError(
                f"asset '{asset_id}' not found on Quotex. Tried {candidates}. "
                f"Available examples: {', '.join(sorted(assets)[:8])}"
            )
        return candidates[0]

    # ── market data ───────────────────────────────────────────────
    def get_market(self, asset_id: str, period: int):
        if not configured():
            return self._response("unavailable", "none", False,
                                  "Quotex bridge is not configured. Set QUOTEX_SSID or QUOTEX_EMAIL/QUOTEX_PASSWORD.",
                                  asset_id, period)
        try:
            asset = self.resolve_asset(asset_id)
            client = self.ensure_connected()
            raw = self._submit(client.get_candles(asset, period, count=120), timeout=CANDLE_TIMEOUT)
            if not raw:
                return self._response("error", "quotex", True,
                                      f"No candles returned for {asset} ({period}s) — market may be closed.",
                                      asset_id, period)
            candles = []
            for c in raw:
                try:
                    candles.append({
                        "time": int(c.timestamp.timestamp()),
                        "open": float(c.open),
                        "high": float(c.high),
                        "low": float(c.low),
                        "close": float(c.close),
                        "volume": float(c.volume or 0),
                    })
                except (AttributeError, TypeError, ValueError):
                    continue
            candles.sort(key=lambda c: c["time"])
            if not candles:
                return self._response("error", "quotex", True,
                                      f"No valid candles for {asset} ({period}s).", asset_id, period)
            return self._response("live", "quotex", True,
                                  f"Live Quotex market data — {asset} ({period}s).",
                                  asset_id, period, candles)
        except asyncio.TimeoutError:
            return self._response("error", "quotex", True,
                                  "Timed out waiting for Quotex candles (is the market open?).", asset_id, period)
        except AuthenticationError as exc:
            return self._response("error", "quotex", True,
                                  f"Quotex authentication failed: {exc}", asset_id, period)
        except QuotexError as exc:
            return self._response("error", "quotex", True,
                                  f"Quotex error: {exc}", asset_id, period)
        except LookupError as exc:
            return self._response("error", "quotex", True, str(exc), asset_id, period)
        except BaseException as exc:
            self._last_error = str(exc)
            return self._response("error", "quotex", True,
                                  f"Quotex error: {exc}", asset_id, period)

    def get_assets(self):
        """Sorted list of instrument names Quotex reports as available."""
        raw = self._fetch_assets() or {}
        return sorted(raw.keys())

    def get_payouts(self):
        """Return {instrument: payout_percent} for all open assets."""
        try:
            client = self.ensure_connected()
            raw = self._submit(client.get_assets_and_payouts(), timeout=ASSETS_TIMEOUT)
            return dict(raw) if isinstance(raw, dict) else {}
        except BaseException as exc:
            self._last_error = f"payouts: {exc}"
            return {}

    def health(self):
        connected = bool(self._client is not None and self._client.is_connected)
        return {
            "ok": True,
            "configured": configured(),
            "connected": connected,
            "assets": len(self._assets) if self._assets else 0,
            "lastError": self._last_error or None,
        }

    @staticmethod
    def _response(status, source, is_configured, message, asset, period, candles=None):
        return {
            "status": status,
            "source": source,
            "configured": is_configured,
            "message": message,
            "asset": asset,
            "period": period,
            "candles": candles or [],
            "updatedAt": int(time.time() * 1000) if candles else None,
        }


BRIDGE = QuotexBridge()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logs
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path in ("/health", "/health/"):
                self._send(200, BRIDGE.health())
                return
            if parsed.path in ("/assets", "/assets/"):
                self._send(200, {"status": "ok", "source": "quotex", "assets": BRIDGE.get_assets()})
                return
            if parsed.path in ("/payouts", "/payouts/"):
                self._send(200, {"status": "ok", "payouts": BRIDGE.get_payouts()})
                return
            if parsed.path in ("/market", "/market/"):
                asset = (query.get("asset") or [""])[0].strip()
                period_raw = (query.get("period") or [""])[0].strip()
                if len(asset) < 2:
                    self._send(400, {"error": "Missing or invalid 'asset' query param."})
                    return
                try:
                    period = int(period_raw)
                except ValueError:
                    self._send(400, {"error": "Missing or invalid 'period' query param (seconds)."})
                    return
                result = BRIDGE.get_market(asset, period)
                self._send(200 if result["status"] == "live" else 503, result)
                return
            self._send(404, {"error": "Not found. Try /health or /market."})
        except BaseException as exc:
            self._send(500, {"error": str(exc)})


def main():
    if not configured():
        print("[quotex-bridge] WARNING: no QUOTEX_SSID and no QUOTEX_EMAIL/QUOTEX_PASSWORD set "
              "- bridge will report 'unavailable'.", flush=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[quotex-bridge] listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
