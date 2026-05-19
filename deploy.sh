#!/usr/bin/env bash
# vmqfox-epay-adapter 一键部署脚本
# 用法：bash deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}▶${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }

# ------ 1. 环境检查 ------
log "检查 Docker 环境..."
command -v docker >/dev/null 2>&1 || { err "Docker 未安装。请先安装 Docker Engine。"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "Docker Compose plugin 未安装。"; exit 1; }
command -v git >/dev/null 2>&1 || { err "git 未安装。"; exit 1; }

# ------ 2. 拉取 V免签fox 源码 ------
if [ ! -d vmqfox-backend ]; then
  log "克隆 vmqfox-backend (hulisang/vmqfox-backend)..."
  git clone --depth 1 https://github.com/hulisang/vmqfox-backend.git
else
  log "vmqfox-backend 已存在，跳过克隆"
fi

# ------ 3. 生成 .env（如不存在则随机密钥） ------
if [ ! -f .env ]; then
  log "生成 .env（随机密钥）..."
  if ! command -v openssl >/dev/null 2>&1; then
    err "openssl 未安装，无法生成密钥。请安装 openssl 后重试。"
    exit 1
  fi
  VMQ_KEY=$(openssl rand -hex 16)
  EPAY_KEY=$(openssl rand -hex 16)
  cp .env.example .env
  # 用 | 当分隔符，避免密钥含 / 误伤
  sed -i.bak "s|^VMQ_KEY=.*|VMQ_KEY=$VMQ_KEY|" .env
  sed -i.bak "s|^EPAY_KEY=.*|EPAY_KEY=$EPAY_KEY|" .env
  rm -f .env.bak
  log ".env 已生成（密钥已随机化）"
else
  warn ".env 已存在，沿用现有密钥"
fi

# 读取 .env 到 shell 变量
set -a; source .env; set +a

if [ -z "${VMQ_KEY:-}" ] || [ -z "${EPAY_KEY:-}" ]; then
  err "VMQ_KEY 或 EPAY_KEY 为空，请检查 .env"
  exit 1
fi

# ------ 4. 先启动 MySQL 让它初始化 ------
log "启动 MySQL 容器..."
docker compose up -d mysql

log "等待 MySQL 真正就绪（root 密码生效 + vmq.sql 导入完成，最长 120s）..."
# 注意: mysqladmin ping 在 MySQL 5.7 初始化阶段就会返回 OK（无密码临时端口），
# 但此时 root 密码和 docker-entrypoint-initdb.d 里的 vmq.sql 都还没执行完。
# 所以这里改用真实查询 setting 表来判断就绪。
MYSQL_READY=0
for i in $(seq 1 60); do
  if docker exec vmqfox-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-vmqfox123}" vmq -e "SELECT 1 FROM setting LIMIT 1" >/dev/null 2>&1; then
    MYSQL_READY=1
    log "MySQL 就绪（数据库已初始化）"
    break
  fi
  sleep 2
done
if [ "$MYSQL_READY" = "0" ]; then
  err "MySQL 启动超时，查看 'docker logs vmqfox-mysql'"
  exit 1
fi

# ------ 5. 同步通讯密钥与测试配置到 V免签 ------
log "同步 VMQ_KEY 到 V免签 数据库..."
docker exec vmqfox-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-vmqfox123}" vmq -e "
UPDATE setting SET vvalue='$VMQ_KEY' WHERE vkey='key';
UPDATE setting SET vvalue='1' WHERE vkey='jkstate';
-- 占位收款码：用户必须在 V免签 后台替换为真实二维码！
UPDATE setting SET vvalue='wxp://placeholder-replace-in-vmq-admin' WHERE vkey='wxpay' AND (vvalue='' OR vvalue IS NULL);
UPDATE setting SET vvalue='https://qr.alipay.com/placeholder-replace-in-vmq-admin' WHERE vkey='zfbpay' AND (vvalue='' OR vvalue IS NULL);
" 2>&1 | grep -v "Warning" || true

# ------ 6. 启动所有服务 ------
log "构建并启动所有服务..."
docker compose up -d --build

log "等待 adapter 健康..."
ADAPTER_OK=0
for i in $(seq 1 15); do
  if curl -sf "http://localhost:${ADAPTER_PORT:-8888}/health" >/dev/null 2>&1; then
    ADAPTER_OK=1
    break
  fi
  sleep 2
done

echo
echo "=================================================================="
if [ "$ADAPTER_OK" = "1" ]; then
  echo -e "${GREEN}✓ 部署完成${NC}"
else
  echo -e "${YELLOW}⚠ Adapter 健康检查未通过，查看 'docker logs vmqfox-adapter'${NC}"
fi
echo "=================================================================="
echo
PUBLIC_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "<本机公网IP>")
echo "Sum API / NewAPI 易支付设置填这些："
echo "  支付地址 = http://${PUBLIC_IP}:${ADAPTER_PORT:-8888}"
echo "  商户 ID  = ${EPAY_PID}"
echo "  API 密钥 = ${EPAY_KEY}"
echo
echo "V免签 管理后台："
echo "  地址 = http://${PUBLIC_IP}:${FRONTEND_PORT:-3006}"
echo "  默认账号 = admin / 密码 = admin    ← 登录后立即修改！"
echo
echo "下一步必做的事："
echo "  1. 登录 V免签 后台，把占位收款码替换为你的真实微信/支付宝收款码"
echo "  2. 准备一台 24h 在线的安卓手机，装监控端 APK（VmqApk）"
echo "     APK 下载：https://github.com/szvone/vmqApk/releases"
echo "     在 APK 里配置：服务器地址 + 上面这个 VMQ_KEY"
echo "  3. 如果有真实 APK，把 vmqfox-adapter/index.js 的心跳循环关掉（注释 startHeartbeatLoop）"
echo
echo "常用运维："
echo "  docker compose logs -f adapter   # 看 adapter 日志"
echo "  docker compose ps                # 看容器状态"
echo "  docker compose restart adapter   # 重启 adapter"
echo "  docker compose down              # 停止所有服务（保留数据）"
echo "  docker compose down -v           # 停止并清空数据卷"
echo
