#!/usr/bin/env python3
"""One-time login helper.

Opens a real Chromium window at Quotex's login page so you can log in manually.
Once a session token appears (cookie or storage), the script captures it
(SSID + full cookie string) and writes it to the gitignored .env file next to
this script, then closes the browser.

The browser uses a PERSISTENT profile (.local/quotex-profile) so the login
survives restarts — the bridge and future re-logins reuse it.

Run:
    python login_helper.py
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
PROFILE_DIR = HERE / ".." / ".." / ".local" / "quotex-profile"
LOGIN_URL = os.environ.get("QUOTEX_LOGIN_URL", "https://qxbroker.com/en/sign-in/")
LOGIN_TIMEOUT_S = int(os.environ.get("QUOTEX_LOGIN_TIMEOUT", "600"))  # 10 minutes


def _log(msg: str) -> None:
    print(f"[login-helper] {msg}", flush=True)


def _write_env(ssid: str, cookie_str: str) -> None:
    lines = []
    if ENV_FILE.is_file():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()

    def upsert(key: str, value: str):
        nonlocal lines
        for i, line in enumerate(lines):
            if line.strip().startswith(f"{key}="):
                lines[i] = f"{key}={value}"
                return
        lines.append(f"{key}={value}")

    upsert("QUOTEX_SSID", ssid)
    upsert("QUOTEX_COOKIES", cookie_str)
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def _extract_ssid(page) -> tuple[str, str]:
    """Return (real_ssid, cookie_string).

    Mirrors the library's own logic: the session token lives in
    `window.settings.token` on the logged-in SPA, or in a cookie named
    `session` / `ssid` / `qx_session`. Boilerplate cookies like
    `laravel_session` are NOT session tokens.
    """
    cookies = await page.context.cookies()
    cookie_map = {c["name"]: c["value"] for c in cookies}
    cookie_str = "; ".join(f"{name}={value}" for name, value in cookie_map.items())

    ssid = ""
    # 1) SPA global — set after a successful login.
    try:
        ssid = await page.evaluate("() => window?.settings?.token ?? null")
    except Exception:
        ssid = None
    if not ssid:
        # 2) Dedicated session cookies only.
        for name in ("session", "ssid", "qx_session"):
            v = cookie_map.get(name) or cookie_map.get(name.upper())
            if v:
                ssid = v
                break

    return (ssid or ""), cookie_str


def _clear_env_session() -> None:
    """Remove stale session values so a bad capture never lingers."""
    if not ENV_FILE.is_file():
        return
    keep = []
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(("QUOTEX_SSID=", "QUOTEX_COOKIES=")):
            continue
        keep.append(line)
    ENV_FILE.write_text("\n".join(keep).rstrip() + "\n", encoding="utf-8")


async def main() -> int:
    _clear_env_session()
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    _log(f"Launching Chromium (persistent profile: {PROFILE_DIR})…")
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1280, "height": 800},
            args=[
                "--disable-blink-features=AutomationControlled",
                "--start-maximized",
            ],
        )
        page = context.pages[0] if context.pages else await context.new_page()
        try:
            await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=45_000)
        except Exception as exc:
            _log(f"Could not open the login page: {exc}")
            await context.close()
            return 1

        _log(
            "Chrome is open — log in to Quotex in THIS window "
            f"(not your own browser). You have {LOGIN_TIMEOUT_S // 60} minutes. "
            "Handle any 2FA/captcha there."
        )

        deadline = time.monotonic() + LOGIN_TIMEOUT_S
        last_beat = 0.0
        while time.monotonic() < deadline:
            try:
                url = page.url
            except Exception:
                url = "?"
            ssid, cookie_str = await _extract_ssid(page)

            now = time.monotonic()
            if now - last_beat >= 15:
                last_beat = now
                _log(
                    f"watching… url={url} | cookies={len(cookie_str)} chars | "
                    f"ssid={'found' if ssid else 'none'} | "
                    f"{int(deadline - now)}s left"
                )

            if ssid:
                _write_env(ssid, cookie_str)
                _log(
                    f"Session captured and saved to .env "
                    f"(SSID {len(ssid)} chars, cookies {len(cookie_str)} chars)."
                )
                _log("Restart the bridge:  python bridge.py")
                await context.close()
                return 0

            await asyncio.sleep(2)

        _log("Timed out waiting for you to log in. Closing.")
        await context.close()
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
