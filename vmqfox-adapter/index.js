const express = require('express');
const axios = require('axios');
const VmqClient = require('./vmq');
const EpayAdapter = require('./epay');

const CONFIG = {
  port: parseInt(process.env.PORT || '8888', 10),
  vmqApiUrl: process.env.VMQ_API_URL || 'http://backend:8000',
  vmqKey: process.env.VMQ_KEY || '',
  epayPid: process.env.EPAY_PID || '1001',
  epayKey: process.env.EPAY_KEY || '',
  adapterInternalUrl: process.env.ADAPTER_INTERNAL_URL || 'http://adapter:8888',
};

if (!CONFIG.vmqKey) console.warn('[warn] VMQ_KEY is empty — set it once you generate the key in V免签 admin');
if (!CONFIG.epayKey) console.warn('[warn] EPAY_KEY is empty — set it to a strong secret used by Sum API');

const vmq = new VmqClient({ baseUrl: CONFIG.vmqApiUrl, key: CONFIG.vmqKey });
const adapter = new EpayAdapter({
  pid: CONFIG.epayPid,
  key: CONFIG.epayKey,
  vmqClient: vmq,
  adapterInternalUrl: CONFIG.adapterInternalUrl,
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function mergeParams(req) { return { ...req.query, ...req.body }; }

app.get('/health', (req, res) => res.json({ status: 'ok', config: { vmqApiUrl: CONFIG.vmqApiUrl, epayPid: CONFIG.epayPid, vmqKeyConfigured: !!CONFIG.vmqKey, epayKeyConfigured: !!CONFIG.epayKey } }));

// 易支付 前台提交 — Sum API 把用户浏览器导到这里
app.all('/submit.php', async (req, res) => {
  try {
    const params = mergeParams(req);
    const { redirectUrl } = await adapter.submitOrder(params);
    if (!redirectUrl) return res.status(502).send('vmq returned no redirectUrl');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${redirectUrl}"><title>跳转中…</title><body><script>location.replace(${JSON.stringify(redirectUrl)});</script><p>正在跳转到支付页面，如未跳转请<a href="${redirectUrl}">点此</a>。</p></body>`);
  } catch (err) {
    console.error('[submit.php]', err.message);
    res.status(400).send(`error: ${err.message}`);
  }
});

// 易支付 mapi (后端API) — 返回 JSON
app.all('/mapi.php', async (req, res) => {
  try {
    const { redirectUrl, vmqRes } = await adapter.submitOrder(mergeParams(req));
    res.json({ code: 1, msg: 'success', payurl: redirectUrl, out_trade_no: vmqRes.payId, trade_no: vmqRes.orderId });
  } catch (err) {
    console.error('[mapi.php]', err.message);
    res.json({ code: -1, msg: err.message });
  }
});

// 易支付 查询
app.all('/api.php', (req, res) => {
  const params = mergeParams(req);
  if (params.act !== 'order') return res.json({ code: -1, msg: `unsupported act: ${params.act}` });
  res.json(adapter.queryOrder(params));
});

// V免签 → 适配器 回调 (GET)
app.get('/vmq_notify', async (req, res) => {
  try {
    const result = await adapter.handleVmqNotify(req.query, axios);
    console.log('[vmq_notify]', req.query.payId, '→ merchant resp:', result.merchantResp);
    res.send(result.ok ? 'success' : `fail: merchant returned "${result.merchantResp}"`);
  } catch (err) {
    console.error('[vmq_notify]', err.message);
    res.send(`fail: ${err.message}`);
  }
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`[vmqfox-adapter] listening on :${CONFIG.port}`);
  console.log(`  VMQ API:           ${CONFIG.vmqApiUrl}`);
  console.log(`  Adapter internal:  ${CONFIG.adapterInternalUrl}`);
  console.log(`  Epay PID:          ${CONFIG.epayPid}`);
  // 仅在没有真实安卓 APK 监控端时才打开（设 FAKE_HEARTBEAT=1）。
  // 生产环境用 VmqApk 真心跳，这里必须关——否则两路心跳互相覆盖。
  if (CONFIG.vmqKey && process.env.FAKE_HEARTBEAT === '1') {
    vmq.startHeartbeatLoop(30000);
    console.log('  Heartbeat loop:    on (FAKE_HEARTBEAT=1, 30s interval)');
  } else {
    console.log('  Heartbeat loop:    off (expecting real APK heartbeat)');
  }
});
