# vmqfox-epay-adapter

让 [NewAPI](https://github.com/QuantumNous/new-api) / Sum API 等使用**易支付协议**的应用，无需修改源码，对接 [V免签fox](https://github.com/hulisang/vmqfox-backend) 个人收款方案。

## 解决什么问题

- NewAPI / Sum API 内置只支持**易支付协议**（pid + key + MD5 签名 + GET 通知）
- V免签fox 是国内流行的开源个人收款方案，但使用**自己的 RESTful API**（与易支付协议不兼容）
- 商业易支付平台（如 zpayz、payjs）手续费 2-3%

本项目作为**协议翻译网关**，让两者无缝对接，自建零手续费个人收款。

## 架构

```
┌─────────────┐ 易支付协议(GET/POST submit.php) ┌──────────────┐  REST  ┌───────────┐
│ NewAPI/     │ ─────────────────────────────► │   adapter    │ ─────► │ V免签fox  │
│ Sum API     │ ◄────── GET notify_url ─────── │   :8888      │        │ :3006/:8000│
└─────────────┘   (易支付协议 + sign)            └──────────────┘        └─────┬─────┘
                                                                              │
                                                              真实付款 ───────┤
                                                              安卓 APK 监听   │
                                                              通知栏推送   ───┘
```

## 一键部署

要求：Linux 服务器 + Docker + Docker Compose plugin + git + openssl + curl

```bash
git clone https://github.com/wangsaiqi2004/-.git
cd -
bash deploy.sh
```

部署脚本会自动：
1. clone `hulisang/vmqfox-backend` 源码
2. 生成随机密钥写入 `.env`
3. 启动 MySQL 并同步通讯密钥到 V免签 数据库
4. 构建 adapter 镜像并启动所有 5 个容器
5. 输出 Sum API 后台要填的 pid / key / 支付地址

## 部署完成后必做的事

### 1. Sum API / NewAPI 后台「易支付设置」填这三项

| 字段 | 值 |
|---|---|
| 支付地址 | `http://<你服务器IP>:8888` |
| 商户 ID | `.env` 里的 `EPAY_PID`（默认 1001） |
| API 密钥 | `.env` 里的 `EPAY_KEY`（脚本随机生成） |

### 2. 上传真实收款码

`deploy.sh` 用占位符填了微信/支付宝收款码字段，**收不到真实付款**。登录 V免签 后台（`http://<IP>:3006`，默认 admin/admin），在「系统设置」上传你自己的微信/支付宝收款二维码。

### 3. 配置监控端 APK（生产环境必需）

V免签 收款依赖一台 **24 小时在线的安卓手机**监听通知栏推送：

1. 下载 APK：https://github.com/szvone/vmqApk/releases
2. 安装到一台备用安卓手机
3. 配置：
   - 服务器地址 = `http://<你的服务器IP>:8000`
   - 通讯密钥 = `.env` 里的 `VMQ_KEY`
4. 给 APK 开启「通知栏读取」权限、加入电池白名单、关闭省电策略
5. 手机微信/支付宝必须开启「收款到账提醒」（公众号「微信收款助手」+ 支付宝「支付助手」）

### 4. 关闭 adapter 内置的心跳循环（装了真实 APK 之后）

为方便测试，adapter 内置了模拟 V免签 监控端心跳的定时器（每 30 秒）。装了真实 APK 之后，APK 会自己心跳，这个循环可以关掉：

编辑 `vmqfox-adapter/index.js`，注释掉这段：

```js
if (CONFIG.vmqKey) {
  vmq.startHeartbeatLoop(30000);   // ← 注释掉这行
  console.log('  Heartbeat loop:    on (30s interval)');
}
```

然后 `docker compose up -d --build adapter` 重建。

## 项目结构

```
.
├── docker-compose.yml         # 5 个容器编排：frontend + backend + mysql + redis + adapter
├── deploy.sh                  # 一键部署脚本
├── .env.example               # 配置模板（真实 .env 不进仓库）
├── vmqfox-adapter/            # 适配器（Node.js）
│   ├── index.js               # 路由：/submit.php /mapi.php /api.php /vmq_notify /health
│   ├── epay.js                # 易支付协议处理（参考 KitfoxPay 实现）
│   ├── newpay.js              # 易支付签名 生成/验证
│   ├── vmq.js                 # V免签 客户端 + 心跳循环
│   ├── db.js                  # SQLite 订单映射存储
│   ├── Dockerfile             # Node 20 alpine
│   ├── test_submit.py         # NewAPI 端模拟器
│   ├── test_push.py           # V免签 监控端 push 模拟器
│   └── mock_merchant.py       # 商户 notify_url 验签接收器
└── vmqfox-backend/            # 由 deploy.sh 自动 clone（不进仓库）
```

## 协议要点

### 易支付签名算法（NewAPI / Sum API 端）

```
1. 过滤参数：剔除 sign、sign_type、空值字段
2. 按 key ASCII 升序排序
3. 拼成 k1=v1&k2=v2&...&kn=vn
4. 末尾【直接】拼接 key（不是 &key=xxx）
5. MD5 取小写 hex
```

来源：[Calcium-Ion/go-epay/util.go](https://github.com/Calcium-Ion/go-epay/blob/main/epay/util.go) + [KitfoxPay newpay.js](https://github.com/kitfoxai/kitfoxpay/blob/main/newpay.js)

### V免签 创建订单签名

```
md5("payId=X&param=Y&type=Z&price=W&key=K")
```

注意是 `k=v&k=v` 格式（hulisang/vmqfox-backend 在升级到 ThinkPHP 8 时改的新格式，与旧版 vmqphp 1.81 不兼容）。

### V免签 通知签名

```
md5(payId + param + type + price + reallyPrice + key)
```

纯字符串拼接，无 `key=` 前缀，跟创建端不一样。

### 异步通知

- V免签 → adapter：GET 请求到 `/vmq_notify`
- adapter → 商户：GET 请求到 `notify_url`（参数按易支付协议构造）
- 商户必须返回字符串 `"success"`，否则 V免签 会把订单标记为 `state=2` 通知失败

## 自测脚本（不需要真实付款）

```bash
# 1. 启动 mock 商户（一个终端）
cd vmqfox-adapter && python3 mock_merchant.py

# 2. 模拟 Sum API 提交订单（另一个终端）
cd vmqfox-adapter && python3 test_submit.py alipay ORDER_$(date +%s)

# 3. 模拟监控端 APK 收款 push
cd vmqfox-adapter && python3 test_push.py 2 0.01
```

测试脚本会自动从根目录 `.env` 读取密钥。预期：mock 商户控制台打印「✓ all checks pass, returning success」。

## 常用运维

| 命令 | 说明 |
|---|---|
| `docker compose ps` | 看容器状态 |
| `docker compose logs -f adapter` | 看 adapter 实时日志 |
| `docker compose restart adapter` | 重启 adapter |
| `docker compose down` | 停止所有服务（保留数据） |
| `docker compose down -v` | 停止并清空数据卷 |

## 安全建议

- 上云前**必须**修改 V免签 后台默认密码 `admin/admin`
- `EPAY_KEY` 和 `VMQ_KEY` 由 deploy.sh 随机生成，无需手改
- 防火墙只对外开放 `3006`（V免签 前端）+ `8888`（adapter），其他端口（MySQL/Redis/backend）不要对公网暴露
- 生产环境建议在 adapter 前加 nginx + HTTPS（Let's Encrypt）

## 致谢

- [hulisang/vmqfox-backend](https://github.com/hulisang/vmqfox-backend) — V免签fox 现代化二开版本
- [szvone/Vmq](https://github.com/szvone/Vmq) + [szvone/vmqApk](https://github.com/szvone/vmqApk) — V免签 原版与监控端
- [kitfoxai/kitfoxpay](https://github.com/kitfoxai/kitfoxpay) — 易支付协议处理参考实现（`newpay.js` 直接复用）
- [Calcium-Ion/go-epay](https://github.com/Calcium-Ion/go-epay) — NewAPI 用的易支付客户端，参考了它的签名算法

## License

MIT（与 V免签 / KitfoxPay 一致）

## 风险提示

- 个人免签收款方案不适合大规模商用，存在被微信/支付宝风控冻结的风险
- 仅供个人开发者**小额测试和小规模业务**使用
- 项目作者不对资金损失负责，使用前请评估业务量级
