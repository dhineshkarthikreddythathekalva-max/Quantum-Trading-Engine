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
import logging
import os
import sys
import threading
import time
import traceback
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

QX_BASE = "https://qxbroker.com"
CONNECT_TIMEOUT = 25
CANDLE_TIMEOUT = 15
ASSETS_TIMEOUT = 15
CONNECT_COOLDOWN = 20  # don't retry a failed connect within this many seconds

# The first connect is the slow one (WebSocket handshake + auth + asset table),
# so main() pays for it up front instead of making the first HTTP caller wait.
WARMUP_TIMEOUT = 45
# A dedicated thread re-checks the socket on this cadence, so a dropped
# connection is repaired in the background rather than by an HTTP handler.
WATCHDOG_INTERVAL = 15

# ── Logging: stdout plus a file next to this script ───────────────
LOG_FILE = Path(__file__).resolve().parent / "bridge-debug.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(threadName)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("quotex-bridge")


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
        """Get a fresh SSID via Playwright — custom login, not the broken library helper."""
        from playwright.async_api import async_playwright

        trade_url_pattern = "**/(trade|demo-trade|cabinet)**"
        ssid_token = None

        pw = await async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1920, "height": 1080},
        )
        page = await context.new_page()
        await page.add_init_script(
            'Object.defineProperty(navigator, "webdriver", {get: () => undefined})'
        )

        try:
            base = "https://qxbroker.com"
            sign_in_url = f"{base}/en/sign-in"
            print(f"[quotex-bridge] Playwright: navigating to {sign_in_url}", flush=True)
            await page.goto(sign_in_url, timeout=60000, wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)  # let JS hydrate

            # Fill email (sign-in form, not registration)
            email_input = page.locator('#emailInput, input[type="email"]').first
            await email_input.fill(EMAIL)
            print("[quotex-bridge] Playwright: email filled", flush=True)

            # Fill password (sign-in form uses id=password-input)
            pwd_input = page.locator('#password-input, input[type="password"]').first
            await pwd_input.fill(PASSWORD)
            print("[quotex-bridge] Playwright: password filled", flush=True)

            # Click sign in button
            sign_in_btn = page.locator('text="Sign in"').first
            await sign_in_btn.click()
            print("[quotex-bridge] Playwright: clicked sign in, waiting for trade page...", flush=True)

            # Wait for redirect to trade page (up to 45s)
            nav_task = page.wait_for_url(trade_url_pattern, timeout=45000)
            await nav_task
            print(f"[quotex-bridge] Playwright: redirected to {page.url}", flush=True)
            await page.wait_for_timeout(3000)  # let WS connect

            # Extract SSID from cookies (the API-Quotex library reads it from there)
            cookies = await context.cookies()
            # Try common cookie names for SSID
            for cookie in cookies:
                name = cookie.get("name", "").lower()
                value = cookie.get("value", "")
                if name in ("session_id", "ssid", "token", "session") and len(value) >= 16:
                    ssid_token = value
                    print(f"[quotex-bridge] Playwright: got SSID from cookie '{cookie["name"]}' ({len(value)} chars)", flush=True)
                    break

            # Fallback: intercept WebSocket URL to extract SSID
            if not ssid_token:
                ws_url = page.url
                # The SSID might be in the page's JS context
                ssid_token = await page.evaluate("""
                    () => {
                        // Try to find SSID in localStorage
                        const keys = ['ssid', 'token', 'session_id', 'session'];
                        for (const key of keys) {
                            const val = localStorage.getItem(key);
                            if (val && val.length >= 16) return val;
                        }
                        // Try sessionStorage
                        for (const key of keys) {
                            const val = sessionStorage.getItem(key);
                            if (val && val.length >= 16) return val;
                        }
                        return null;
                    }
                """)
                if ssid_token:
                    print(f"[quotex-bridge] Playwright: got SSID from localStorage ({len(ssid_token)} chars)", flush=True)

            # Last resort: intercept network requests for the SSID
            if not ssid_token:
                print("[quotex-bridge] Playwright: intercepting network for SSID...", flush=True)
                captured = []
                async def _on_response(response):
                    if "websocket" in response.url.lower() or "connect" in response.url.lower():
                        pass
                page.on("response", _on_response)
                # Try refreshing the page to trigger WS reconnect
                await page.reload(wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(5000)

            if not ssid_token:
                # Save all cookies for debug and raise
                all_cookies = {c["name"]: c["value"][:20] + "..." for c in cookies}
                raise RuntimeError(
                    f"Could not extract SSID from cookies or localStorage. "
                    f"Available cookies: {list(all_cookies.keys())}"
                )

            return ssid_token

        finally:
            try:
                await browser.close()
                await pw.stop()
            except BaseException:
                pass

    async def _ensure_client(self):
        if self._client is not None and self._client.is_connected:
            return self._client
        # Use SSID (manual or cookie-refreshed) — Playwright login is blocked by Cloudflare
        ssid = SSID
        if not ssid:
            raise RuntimeError("No QUOTEX_SSID set. Get a fresh SSID from your Quotex browser session.")
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
        """Mint a fresh SSID — tries cookies first, then cloudscraper login."""
        # ── Strategy 1: Cookie-based digest endpoint (fast, no browser) ──
        if COOKIES:
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
                            print(f"[quotex-bridge] refreshed SSID via cookies ({len(token)} chars)", flush=True)
                            return
                print("[quotex-bridge] cookie refresh failed, status=" + str(resp.status_code), flush=True)
            except BaseException as exc:
                print(f"[quotex-bridge] cookie refresh error: {exc}", flush=True)

        # ── Strategy 2: Cloudscraper login (bypasses Cloudflare, no browser) ──
        if EMAIL and PASSWORD:
            try:
                print("[quotex-bridge] falling back to cloudscraper login...", flush=True)
                new_ssid = self._cloudscraper_login()
                if new_ssid:
                    self._persist_ssid(new_ssid)
                    # Force reconnect with new SSID
                    old_client = self._client
                    self._client = None
                    print(f"[quotex-bridge] cloudscraper login successful, reconnecting...", flush=True)
                    return
            except BaseException as exc:
                print(f"[quotex-bridge] cloudscraper login failed: {exc}", flush=True)
                self._last_error = f"refresh cloudscraper: {exc}"

    def _reconnect_via_login(self):
        """Full reconnection: login via Playwright, get fresh SSID, reconnect."""
        import asyncio as _aio
        loop = self._loop
        # Login in the bridge's event loop
        future = asyncio.run_coroutine_threadsafe(self._login_ssid(), loop)
        try:
            new_ssid = future.result(timeout=30)
        except _aio.TimeoutError:
            future.cancel()
            raise RuntimeError("Playwright login timed out")

        if not new_ssid:
            raise RuntimeError("Playwright login returned empty SSID")

        # Persist the new SSID
        self._persist_ssid(new_ssid)

        # Disconnect old client and create new one
        old_client = self._client
        if old_client is not None:
            try:
                if old_client.is_connected:
                    self._submit(old_client.disconnect(), timeout=5)
            except BaseException:
                pass
            self._client = None

        # Connect fresh client
        client = AsyncQuotexClient(
            ssid=new_ssid,
            is_demo=IS_DEMO,
            enable_logging=False,
            persistent_connection=False,
            auto_reconnect=True,
        )
        ok = self._submit(client.connect(), timeout=CONNECT_TIMEOUT)
        if not ok:
            raise RuntimeError("Quotex rejected new SSID after Playwright login")

        self._client = client
        print(f"[quotex-bridge] reconnected via Playwright ({len(new_ssid)} chars)", flush=True)

    def _cloudscraper_login(self) -> str:
        """Login via cloudscraper (bypasses Cloudflare), returns new SSID string or None."""
        import re as _re
        import json as _json
        import cloudscraper as _cs
        from bs4 import BeautifulSoup as _BS

        scraper = _cs.create_scraper()
        login_url = f"{QX_BASE}/en/sign-in/"
        target_url = f"{QX_BASE}/en/demo-trade" if IS_DEMO else f"{QX_BASE}/en/trade"

        # 1. GET sign-in page, extract CSRF
        resp = scraper.get(login_url, timeout=30, headers={"Referer": login_url})
        soup = _BS(resp.text, "html.parser")
        form = soup.select_one('#tab-1 form[action$="/sign-in/"]')
        csrf = None
        if form:
            tok = form.select_one('input[name="_token"]')
            if tok and tok.get("value"):
                csrf = tok["value"]
        if not csrf:
            raise RuntimeError("cloudscraper: CSRF not found on sign-in page")

        # 2. POST login
        payload = {"_token": csrf, "email": EMAIL, "password": PASSWORD, "remember": "1"}
        resp2 = scraper.post(
            login_url, data=payload,
            headers={"Referer": login_url, "Content-Type": "application/x-www-form-urlencoded"},
            timeout=30, allow_redirects=False,
        )
        if resp2.status_code in (301, 302, 303, 307, 308):
            loc = resp2.headers.get("Location", "")
            if loc:
                next_url = loc if loc.startswith("http") else (QX_BASE + loc)
                try:
                    scraper.get(next_url, timeout=30)
                except Exception:
                    pass

        # 3. GET trade page, extract token
        resp3 = scraper.get(target_url, timeout=30, headers={"Referer": login_url})
        token = None
        for s in _BS(resp3.text, "html.parser").find_all("script"):
            txt = (s.get_text() or "").strip()
            if "window.settings" in txt:
                try:
                    j = _re.sub(r"^window\.settings\s*=\s*", "", txt.replace(";", ""))
                    token = _json.loads(j).get("token")
                    if token:
                        break
                except Exception:
                    continue

        # 4. Extract session cookie
        cookies_dict = scraper.cookies.get_dict()
        session_cookie = None
        for k, v in cookies_dict.items():
            if k.lower() in ("session", "ssid", "qx_session") and v:
                session_cookie = v
                break

        # 5. Build SSID (raw session token only — the client library handles the WS auth framing)
        ssid_source = session_cookie or token
        if not ssid_source:
            raise RuntimeError("cloudscraper: no token or session cookie after login")

        ssid = ssid_source

        # 6. Update cookies for future refresh attempts
        global COOKIES
        COOKIES = "; ".join(f"{k}={v}" for k, v in cookies_dict.items())
        print(f"[quotex-bridge] cloudscraper: got SSID ({len(ssid_source)} chars) and {len(cookies_dict)} cookies", flush=True)
        return ssid

    def _refresh_loop(self):
        while True:
            time.sleep(REFRESH_INTERVAL)
            try:
                # Check if connection is actually alive before refreshing
                client = self._client
                if client is not None and not client.is_connected:
                    print("[quotex-bridge] connection lost, forcing full re-login...", flush=True)
                    self._reconnect_via_login()
                else:
                    self._refresh_once()
            except BaseException as exc:
                print(f"[quotex-bridge] refresh loop error: {exc}", flush=True)
                self._last_error = str(exc)

    def ensure_connected(self):
        now = time.time()
        if self._client is not None and self._client.is_connected:
            return self._client
        if self._connect_fail_at and now - self._connect_fail_at < CONNECT_COOLDOWN:
            raise RuntimeError(self._connect_fail_msg or "Quotex connection recently failed.")
        try:
            log.info("connecting to Quotex (demo=%s)…", IS_DEMO)
            client = self._submit(self._ensure_client(), timeout=CONNECT_TIMEOUT)
            self._connect_fail_at = 0.0
            self._connect_fail_msg = ""
            log.info("connected to Quotex")
            # Kick off an immediate refresh so we always hold a young token.
            self._refresh_once()
            return client
        except BaseException as exc:
            self._client = None
            self._connect_fail_at = now
            # TimeoutError and CancelledError both stringify to "", which makes
            # downstream messages useless — fall back to the class name.
            self._connect_fail_msg = str(exc) or type(exc).__name__
            log.warning("connect failed: %s\n%s", self._connect_fail_msg, traceback.format_exc())
            raise

    # ── assets (best-effort, cached) ───────────────────────────────
    def _fetch_assets(self):
        if self._assets is None:
            try:
                client = self.ensure_connected()
                raw = self._submit(client.get_available_assets(), timeout=ASSETS_TIMEOUT)
                self._assets = dict(raw) if isinstance(raw, dict) else {}
                log.info("asset table loaded (%d instruments)", len(self._assets))
            except BaseException as exc:  # non-fatal: asset validation is best-effort
                self._last_error = f"assets: {exc or type(exc).__name__}"
                log.warning("asset fetch failed: %s\n%s", self._last_error, traceback.format_exc())
        return self._assets

    # ── keeping the socket warm ────────────────────────────────────
    def warmup(self):
        """Connect and load the asset table before the HTTP server accepts traffic."""
        try:
            self._submit(self._ensure_client(), timeout=WARMUP_TIMEOUT)
            self._connect_fail_at = 0.0
            self._connect_fail_msg = ""
            raw = self._submit(self._client.get_available_assets(), timeout=ASSETS_TIMEOUT)
            self._assets = dict(raw) if isinstance(raw, dict) else {}
            self._last_error = ""
            log.info("warmup complete — connected, %d instruments", len(self._assets))
            return True
        except BaseException as exc:
            self._last_error = f"warmup: {exc or type(exc).__name__}"
            log.warning("warmup failed: %s\n%s", self._last_error, traceback.format_exc())
            return False

    def watchdog_loop(self):
        """Repair a dropped connection from a dedicated thread.

        Without this, the first HTTP request after a drop pays the full connect
        cost (and trips the cooldown for every request behind it).
        """
        while True:
            time.sleep(WATCHDOG_INTERVAL)
            try:
                if self._client is None or not self._client.is_connected:
                    log.info("watchdog: socket down, reconnecting")
                    self._connect_fail_at = 0.0  # the interval is the rate limit
                    self._submit(self._ensure_client(), timeout=CONNECT_TIMEOUT)
                    self._assets = None
                    self._fetch_assets()
            except BaseException as exc:
                log.warning("watchdog reconnect failed: %s", exc or type(exc).__name__)

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
            # If no _otc suffix was in the original id, try _otc FIRST
            # (Quotex OTC markets are always open, even on weekends)
            if not otc:
                otc_candidates = [c + "_otc" for c in candidates]
                for candidate in otc_candidates:
                    key = normalize(candidate)
                    if key in norm:
                        return norm[key]
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
        log.warning("no QUOTEX_SSID and no QUOTEX_EMAIL/QUOTEX_PASSWORD set "
                    "- bridge will report 'unavailable'.")
    else:
        # Connect from the main thread before serving: this is the code path that
        # is known to work, and it means handler threads only ever see a live client.
        BRIDGE.warmup()
        threading.Thread(target=BRIDGE.watchdog_loop, name="quotex-watchdog",
                         daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("listening on http://%s:%s (logging to %s)", HOST, PORT, LOG_FILE.name)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
