#!/usr/bin/env python3
"""Mock 商户：模拟 NewAPI 的 notify_url 端点，验证签名后返回 success。
   密钥从仓库根目录 .env 读取。"""
import hashlib
import json
import os
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


def load_env(name):
    val = os.environ.get(name)
    if val:
        return val
    env_file = pathlib.Path(__file__).resolve().parent.parent / '.env'
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line.startswith(f'{name}='):
                return line.split('=', 1)[1].strip()
    return None


EPAY_KEY = load_env('EPAY_KEY')
EPAY_PID = load_env('EPAY_PID') or '1001'
if not EPAY_KEY:
    sys.exit('error: EPAY_KEY not found in env or ../.env')


def epay_sign(params, key):
    filtered = {k: str(v) for k, v in params.items()
                if k not in ('sign', 'sign_type') and v not in (None, '', [])}
    ordered = sorted(filtered.items())
    to_sign = '&'.join(f'{k}={v}' for k, v in ordered) + key
    return hashlib.md5(to_sign.encode('utf-8')).hexdigest()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return  # silence default access log

    def do_GET(self):
        u = urlparse(self.path)
        params = {k: v[0] for k, v in parse_qs(u.query).items()}
        print(f'\n[mock_notify] GET {u.path}')
        print(f'  params: {json.dumps(params, ensure_ascii=False, indent=2)}')
        incoming = params.get('sign', '')
        expected = epay_sign(params, EPAY_KEY)
        sign_ok = incoming == expected
        pid_ok = params.get('pid') == EPAY_PID
        status_ok = params.get('trade_status') == 'TRADE_SUCCESS'
        print(f'  sign_ok    = {sign_ok}  (got={incoming}, expected={expected})')
        print(f'  pid_ok     = {pid_ok}')
        print(f'  status_ok  = {status_ok}')
        if sign_ok and pid_ok and status_ok:
            print("  → all checks pass, returning 'success'")
            resp = b'success'
        else:
            print("  → checks FAILED, returning 'fail'")
            resp = b'fail'
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(resp)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8889
    print(f'[mock_merchant] listening on :{port}, EPAY_PID={EPAY_PID}')
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()
