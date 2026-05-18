#!/usr/bin/env python3
"""模拟监控端 APP：调 V免签 /api/monitor/push 触发"收到 XX 元支付宝/微信"事件
   密钥从仓库根目录 .env 读取。"""
import hashlib
import os
import pathlib
import sys
import time
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


VMQ_KEY = load_env('VMQ_KEY')
if not VMQ_KEY:
    sys.exit('error: VMQ_KEY not found in env or ../.env')
VMQ_BASE = os.environ.get('VMQ_BASE', 'http://localhost:8000')

type_ = sys.argv[1] if len(sys.argv) > 1 else '2'      # 1=wx, 2=zfb
price = sys.argv[2] if len(sys.argv) > 2 else '0.01'
t = int(time.time())

# Monitor.php:107 — $_sign = $type . $price . $t . $systemKey
sign = hashlib.md5(f'{type_}{price}{t}{VMQ_KEY}'.encode()).hexdigest()

print(f'--- POST {VMQ_BASE}/api/monitor/push')
print(f'  t={t} type={type_} price={price} sign={sign}')

body = urllib.parse.urlencode({'t': t, 'type': type_, 'price': price, 'sign': sign}).encode()
req = urllib.request.Request(f'{VMQ_BASE}/api/monitor/push', data=body, method='POST')
try:
    resp = urllib.request.urlopen(req, timeout=15)
    print(f'\n--- V免签 push response ({resp.status}):')
    print(resp.read().decode('utf-8', errors='replace'))
except urllib.error.HTTPError as e:
    print(f'\n--- V免签 push HTTPError ({e.code}):')
    print(e.read().decode('utf-8', errors='replace'))
