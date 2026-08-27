# Quotex Bridge

Small Python HTTP bridge that connects to **Quotex** using the
[**API-Quotex**](https://github.com/A11ksa/API-Quotex) library and serves live
OHLC candles to the rest of the app.

## Why

The React app (`artifacts/quantum-ai`) simulates market data by default. When
this bridge is running **and** Quotex credentials are configured, the API
server proxies `/api/quotex/market` to it and the app shows real Quotex data
(the header pill flips from "No Data" to "LIVE" with real prices).

## Setup

```bash
# from the repo root — create a venv inside this folder (gitignored)
python -m venv artifacts/quotex-bridge/.venv

# activate (Windows: artifacts/quotex-bridge/.venv/Scripts/activate)
source artifacts/quotex-bridge/.venv/bin/activate

pip install -r artifacts/quotex-bridge/requirements.txt
```

> Only needed for the email/password login path (Playwright):
> `python -m playwright install chromium`

## Run

Authentication — pick one:

| Env var              | Meaning                                                       |
| -------------------- | ------------------------------------------------------------- |
| `QUOTEX_SSID`        | Session token from a logged-in Quotex browser (no browser needed) |
| `QUOTEX_COOKIES`     | Optional `name=value; name2=value2` cookie string to pair with the SSID |
| `QUOTEX_EMAIL`       | Quotex login email (requires Chromium via Playwright)         |
| `QUOTEX_PASSWORD`    | Quotex login password                                          |

Then:

```bash
QUOTEX_SSID=... python artifacts/quotex-bridge/bridge.py
```

Other env vars:

* `QUOTEX_BRIDGE_PORT` — listen port (default `5001`)
* `QUOTEX_BRIDGE_HOST` — bind host (default `127.0.0.1`)
* `QUOTEX_ASSET_MAP` — JSON object of `pairId -> QuotexAsset` overrides

## Endpoints

* `GET /health` — `{ ok, configured, connected, assets }`
* `GET /market?asset=eur_usd_otc&period=60` — live candles
  `{ status, source, configured, message, asset, period, candles, updatedAt }`
  where each candle is `{ time, open, high, low, close, volume }` (unix seconds).

Without credentials the bridge still runs and reports `status: "unavailable"`,
so the app cleanly falls back to simulated data.

## One-time browser login (`login_helper.py`)

Want to log in visually instead of pasting tokens? Run:

```bash
python artifacts/quotex-bridge/login_helper.py
```

A Chromium window opens at Quotex's login page. Log in **inside that window**
(handle any 2FA/captcha there). The helper detects the real session token
(`window.settings.token` or a `session`/`ssid`/`qx_session` cookie — it ignores
boilerplate cookies like `laravel_session`) and writes `QUOTEX_SSID` +
`QUOTEX_COOKIES` to the gitignored `artifacts/quotex-bridge/.env`, then closes.
The browser profile lives at `.local/quotex-profile` (gitignored) so the login
survives restarts.

> If the profile's `Local State`/cache files get corrupted, delete
> `.local/quotex-profile/Default/Code Cache` (and `GPUCache`) and re-run.

## Permanent access (auto-refresh)

SSIDs expire, so the bridge can renew its own session. Two ways to make access
"set and forget":

1. **SSID + cookies (recommended, no browser):** provide both `QUOTEX_SSID` and
   `QUOTEX_COOKIES` (the browser `Cookie` string from the same logged-in session).
   The bridge then calls Quotex's `/api/v1/cabinets/digest` endpoint every
   `QUOTEX_REFRESH_INTERVAL` seconds (default 600 = 10 min) and writes the fresh
   token back to its local `.env`. The token stays young indefinitely, so you
   never have to refresh it manually.

2. **Email + password:** API-Quotex's Playwright login (`get_ssid`) extracts a
   fresh SSID automatically (requires Chromium).

When the refresh succeeds you'll see `[quotex-bridge] refreshed SSID (...)` in the
bridge log, and `/health` reports `connected: true`.

## Known library patches (websockets 17)

The vendored `api_quotex` package was installed from
`A11ksa/API-Quotex` and needed two small patches for `websockets>=14` (they're
applied directly in the venv at
`.venv/Lib/site-packages/api_quotex/websocket_client.py`):

1. **`extra_headers` was removed** in websockets 14 — the library now sends
   `additional_headers` on websockets >= 14 (keeps `extra_headers` for 8–13).
2. **`ClientConnection.closed` was removed** in websockets 17 — all three uses
   now go through a small `_ws_closed()` helper (falls back to `close_code`).
3. Removed the forced **TLS 1.3-only** SSL context options (relaxed to the
   system default so qxbroker's edge can negotiate).

If you ever reinstall the venv from scratch, re-apply the same edits or pin
`websockets<14` instead.

## How it maps assets

The React app's pair ids (e.g. `eur_usd_otc`, `btc_otc`) are translated to
Quotex instrument names (e.g. `EURUSD_otc`, `BTCUSD_otc`) using the table in
`bridge.py` plus the live asset list Quotex reports. Extend the table or set
`QUOTEX_ASSET_MAP` for anything that doesn't resolve.
