import sys
import asyncio
import threading
import time
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from api_quotex import AsyncQuotexClient

for raw in (Path('.env').read_text(encoding='utf-8')).splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, _, value = line.partition('=')
    key, value = key.strip(), value.strip().strip('"').strip("'")
    os.environ.setdefault(key, value)

SSID = os.environ.get('QUOTEX_SSID', '').strip()
IS_DEMO = os.environ.get('QUOTEX_IS_DEMO', 'true').lower() not in ('0', 'false', 'no')

class QuotexBridge:
    def __init__(self):
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._run_loop, name='quotex-loop', daemon=True).start()
        self._client = None
        self._lock = threading.Lock()
        self._assets = None
        self._last_error = ''
        self._connect_fail_at = 0.0
        self._connect_fail_msg = ''
        threading.Thread(target=self._refresh_loop, name='quotex-refresh', daemon=True).start()
        print('[BRIDGE] __init__ done', flush=True)

    def _run_loop(self):
        asyncio.set_event_loop(self._loop)
        print('[BRIDGE] loop running', flush=True)
        self._loop.run_forever()
        print('[BRIDGE] loop stopped', flush=True)

    def _submit(self, coro, timeout):
        print(f'[BRIDGE] _submit timeout={timeout}', flush=True)
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        try:
            result = future.result(timeout=timeout)
            print(f'[BRIDGE] _submit OK', flush=True)
            return result
        except Exception as e:
            print(f'[BRIDGE] _submit EXC: {type(e).__name__}: {e}', flush=True)
            raise

    async def _ensure_client(self):
        print('[BRIDGE] _ensure_client', flush=True)
        if self._client is not None and self._client.is_connected:
            print('[BRIDGE] returning existing client', flush=True)
            return self._client
        ssid = SSID
        if not ssid:
            raise RuntimeError('No SSID')
        client = AsyncQuotexClient(
            ssid=ssid,
            is_demo=IS_DEMO,
            enable_logging=False,
            persistent_connection=False,
            auto_reconnect=True,
        )
        print('[BRIDGE] connecting...', flush=True)
        ok = await asyncio.wait_for(client.connect(), timeout=25)
        print(f'[BRIDGE] connect ok={ok}', flush=True)
        if not ok:
            raise RuntimeError('Quotex rejected the connection.')
        self._client = client
        return client

    def _refresh_once(self):
        pass

    def _refresh_loop(self):
        while True:
            time.sleep(600)
            self._refresh_once()

    def ensure_connected(self):
        now = time.time()
        print(f'[BRIDGE] ensure_connected, _client={self._client is not None}, _connect_fail_at={self._connect_fail_at}', flush=True)
        if self._client is not None and self._client.is_connected:
            return self._client
        if self._connect_fail_at and now - self._connect_fail_at < 20:
            raise RuntimeError(self._connect_fail_msg or 'Quotex connection recently failed.')
        try:
            client = self._submit(self._ensure_client(), timeout=25)
            self._connect_fail_at = 0.0
            self._connect_fail_msg = ''
            return client
        except BaseException as exc:
            print(f'[BRIDGE] ensure_connected EXC: {exc}', flush=True)
            self._client = None
            self._connect_fail_at = now
            self._connect_fail_msg = str(exc)
            raise

    def _fetch_assets(self):
        print('[BRIDGE] _fetch_assets', flush=True)
        if self._assets is None:
            try:
                client = self.ensure_connected()
                raw = self._submit(client.get_available_assets(), timeout=15)
                print(f'[BRIDGE] got assets: {len(raw)}', flush=True)
                self._assets = dict(raw) if isinstance(raw, dict) else {}
            except BaseException as exc:
                print(f'[BRIDGE] _fetch_assets EXC: {exc}', flush=True)
                self._last_error = f'assets: {exc}'
        return self._assets

    def normalize(self, name):
        return ''.join(ch for ch in name.lower() if ch.isalnum())

    def resolve_asset(self, asset_id: str) -> str:
        print(f'[BRIDGE] resolve_asset {asset_id}', flush=True)
        otc = asset_id.lower().endswith('_otc')
        base = asset_id[:-4] if otc else asset_id
        base = base.strip('_').lower()
        suffix = '_otc' if otc else ''

        candidates = []
        ASSET_BASE_OVERRIDES = {}
        if base in ASSET_BASE_OVERRIDES:
            candidates.append(ASSET_BASE_OVERRIDES[base] + suffix)
        candidates.append(base.upper().replace('_', '') + suffix)
        candidates = list(dict.fromkeys(candidates))

        assets = self._fetch_assets() or {}
        print(f'[BRIDGE] resolve_asset got {len(assets)} assets', flush=True)
        if assets:
            norm = {self.normalize(key): key for key in assets}
            for candidate in candidates:
                key = self.normalize(candidate)
                if key in norm:
                    print(f'[BRIDGE] resolved to {norm[key]}', flush=True)
                    return norm[key]
            for candidate in candidates:
                key = self.normalize(candidate)
                for n_key, real in norm.items():
                    if n_key.startswith(key):
                        return real
            raise LookupError(f'asset {asset_id} not found')
        return candidates[0]

    def get_market(self, asset_id: str, period: int):
        print(f'[BRIDGE] get_market {asset_id} {period}', flush=True)
        try:
            asset = self.resolve_asset(asset_id)
            print(f'[BRIDGE] resolved asset: {asset}', flush=True)
            client = self.ensure_connected()
            raw = self._submit(client.get_candles(asset, period, count=120), timeout=15)
            print(f'[BRIDGE] got {len(raw)} candles', flush=True)
            return raw
        except Exception as e:
            print(f'[BRIDGE] get_market EXC: {type(e).__name__}: {e}', flush=True)
            raise

    def health(self):
        connected = bool(self._client is not None and self._client.is_connected)
        return {
            'ok': True,
            'configured': True,
            'connected': connected,
            'assets': len(self._assets) if self._assets else 0,
            'lastError': self._last_error or None,
        }

BRIDGE = QuotexBridge()
print('[MAIN] Bridge created', flush=True)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass
    def _send(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        print(f'[HTTP] {parsed.path}', flush=True)
        try:
            if parsed.path in ('/health', '/health/'):
                self._send(200, BRIDGE.health())
                return
            if parsed.path in ('/market', '/market/'):
                asset = (query.get('asset') or [''])[0].strip()
                period = int((query.get('period') or [''])[0].strip())
                print(f'[HTTP] market {asset} {period}', flush=True)
                try:
                    raw = BRIDGE.get_market(asset, period)
                    cs = []
                    for c in raw:
                        try:
                            cs.append({'time': int(c.timestamp.timestamp()), 'open': float(c.open), 'high': float(c.high), 'low': float(c.low), 'close': float(c.close), 'volume': float(c.volume or 0)})
                        except: pass
                    cs.sort(key=lambda c: c['time'])
                    self._send(200, {'status': 'live', 'source': 'quotex', 'configured': True, 'message': 'OK', 'asset': asset, 'period': period, 'candles': cs, 'updatedAt': int(time.time() * 1000)})
                except Exception as e:
                    self._send(503, {'status': 'error', 'message': str(e), 'asset': asset, 'period': period})
                return
            self._send(404, {'error': 'Not found'})
        except Exception as e:
            print(f'[HTTP] EXC: {e}', flush=True)
            self._send(500, {'error': str(e)})

print('[MAIN] Starting server', flush=True)
server = ThreadingHTTPServer(('127.0.0.1', 5001), Handler)
server.serve_forever()