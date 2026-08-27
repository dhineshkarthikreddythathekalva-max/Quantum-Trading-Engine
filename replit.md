# Quantum AI Engine — Trading Signal Bot

A dark-themed trading signal dashboard (React/Vite app in `artifacts/quantum-ai`):
configure an asset + timeframe + AI model, generate BUY/SELL/SKIP signals from a
multi-indicator confluence engine (RSI, MACD, Stochastic, Bollinger, ADX, EMA
structure, candlestick patterns, S/R zones), track wins/losses, and — when Quotex
credentials are configured — stream **live Quotex market data**.

## Run & Operate

- `pnpm --filter @workspace/quantum-ai run dev` — the React app (Vite; needs `PORT` + `BASE_PATH` env)
- `pnpm --filter @workspace/api-server run dev` — the API server (needs `PORT`)
- `python artifacts/quotex-bridge/bridge.py` — live Quotex data bridge (see `artifacts/quotex-bridge/README.md`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

### Live Quotex data

The app simulates market data by default. For live Quotex data:

1. Install the bridge deps: `python -m venv artifacts/quotex-bridge/.venv && artifacts/quotex-bridge/.venv/Scripts/pip install -r artifacts/quotex-bridge/requirements.txt`
2. Set `QUOTEX_SSID` (session token from a logged-in Quotex browser — no Chrome needed) **or** `QUOTEX_EMAIL`/`QUOTEX_PASSWORD` (headless Chrome login)
3. Start the bridge, then the API server (`PORT=5000`), then the app.

The bridge uses the [`API-Quotex`](https://github.com/A11ksa/API-Quotex) library.
`GET /api/quotex/market?asset=<pairId>&period=<seconds>` proxies bridge → app.
Without credentials the whole chain reports `unavailable` and the app falls back to simulation.

**Permanent access:** pair `QUOTEX_SSID` with `QUOTEX_COOKIES` and the bridge
auto-refreshes the token every 10 min via Quotex's digest endpoint (writes it
back to `artifacts/quotex-bridge/.env`) — no manual refreshes. Alternatively use
`QUOTEX_EMAIL`/`QUOTEX_PASSWORD` for Playwright-based re-login (needs Chromium:
`python -m playwright install chromium`).

**One-time browser login:** `python artifacts/quotex-bridge/login_helper.py` opens
Chromium at Quotex's login page; log in visually and it captures the session
(SSID + cookies) into the gitignored `.env` automatically. Profile persists in
`.local/quotex-profile`.

**Gotcha:** the vendored `api_quotex` needs the websockets-17 patches noted in
`artifacts/quotex-bridge/README.md` (they live in the gitignored venv — re-apply
if you recreate it, or pin `websockets<14`). Also avoid hammering the bridge with
rapid reconnect attempts: qxbroker's Cloudflare rate-limits the WS endpoint
(HTTP 429) for a minute or two.

Required env (production): `DATABASE_URL` — Postgres connection string.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
