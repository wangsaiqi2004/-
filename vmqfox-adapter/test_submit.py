#!/usr/bin/env python3
"""模拟 NewAPI/Sum API 调用适配器：算正确的易支付签名，POST /submit.php
   密钥从仓库根目录 .env 读取（不进 git）。"""
import hashlib
import os
import pathlib
import sys
import urllib.parse
import urllib.request


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


EPAY_PID = load_env('EPAY_PID') or '1001'
EPAY_KEY = load_env('EPAY_KEY')
if not EPAY_KEY:
    sys.exit('error: EPAY_KEY not found in env or ../.env')
ADAPTER = os.environ.get('ADAPTER_URL', 'http://localhost:8888')


def epay_sign(params: dict, key: str) -> str:
    filtered = {k: str(v) for k, v in params.items()
                if k not in ('sign', 'sign_type') and v not in (None, '', [])}
    ordered = sorted(filtered.items())
    to_sign = '&'.join(f'{k}={v}' for k, v in ordered) + key
    return hashlib.md5(to_sign.encode('utf-8')).hexdigest()


params = {
    'pid': EPAY_PID,
    'type': sys.argv[1] if len(sys.argv) > 1 else 'alipay',
    'out_trade_no': sys.argv[2] if len(sys.argv) > 2 else 'TEST_SUBMIT_001',
    'notify_url': os.environ.get('NOTIFY_URL', 'http://host.docker.internal:8889/mock_notify'),
    'return_url': os.environ.get('RETURN_URL', 'http://example.com/return'),
    'name': 'TestProduct',
    'money': os.environ.get('MONEY', '0.01'),
}
params['sign'] = epay_sign(params, EPAY_KEY)
params['sign_type'] = 'MD5'

print(f'--- POST {ADAPTER}/submit.php')
for k, v in params.items():
    print(f'  {k} = {v}')

body = urllib.parse.urlencode(params).encode()
req = urllib.request.Request(f'{ADAPTER}/submit.php', data=body, method='POST')
try:
    resp = urllib.request.urlopen(req, timeout=15)
    text = resp.read().decode('utf-8', errors='replace')
    print(f'\n--- HTTP {resp.status} ---')
    print(text[:600])
except urllib.error.HTTPError as e:
    print(f'\n--- HTTP {e.code} ---')
    print(e.read().decode('utf-8', errors='replace')[:600])
