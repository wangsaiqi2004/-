const { generateSign, verifySign } = require('./newpay');
const VmqClient = require('./vmq');
const store = require('./db');

/**
 * 易支付协议适配器 (NewAPI / Sum API ← → V免签fox)
 *
 * 协议要点 (来自 KitfoxPay newpay.js + Calcium-Ion/go-epay util.go):
 *  - sign: 过滤 sign/sign_type/空值 → 按 key ASCII 升序 → 拼 k1=v1&k2=v2 → 末尾直接拼 key → MD5 小写
 *  - 通知方向: GET，参数在 query string；商户必须返回字符串 "success"
 *  - trade_status=TRADE_SUCCESS 表示支付成功
 */
class EpayAdapter {
  constructor({ pid, key, vmqClient, adapterInternalUrl }) {
    this.pid = pid;
    this.key = key;
    this.vmq = vmqClient;
    this.adapterInternalUrl = adapterInternalUrl.replace(/\/$/, '');
    this.signType = 'MD5';
  }

  _sign(params) { return generateSign(params, this.key, this.signType); }
  _verify(params) { return verifySign(params, this.key, this.signType); }

  /**
   * /submit.php: NewAPI 前台支付提交 (浏览器跳转)
   * 入参: pid, type(alipay/wxpay), out_trade_no, notify_url, return_url, name, money, [param], [device], sign, sign_type
   * 出参: HTML (302/meta-refresh 跳到 V免签 支付页面)
   */
  async submitOrder(params) {
    if (String(params.pid) !== String(this.pid)) {
      throw new Error(`pid mismatch: got ${params.pid}, expected ${this.pid}`);
    }
    if (!this._verify(params)) {
      throw new Error('sign verify failed');
    }
    const vmqType = VmqClient.epayTypeToVmq(params.type);
    if (!vmqType) {
      throw new Error(`unsupported type: ${params.type}`);
    }
    if (!params.out_trade_no || !params.money || !params.notify_url) {
      throw new Error('missing required fields: out_trade_no / money / notify_url');
    }

    store.saveOrder({
      out_trade_no: params.out_trade_no,
      pid: params.pid,
      notify_url: params.notify_url,
      return_url: params.return_url || '',
      name: params.name || '',
      money: Number(params.money).toFixed(2),
      epay_type: params.type,
      param: params.param || '',
      vmq_order_id: null,
    });

    const vmqRes = await this.vmq.createOrder({
      payId: params.out_trade_no,
      param: params.out_trade_no,
      type: vmqType,
      price: Number(params.money).toFixed(2),
      notifyUrl: `${this.adapterInternalUrl}/vmq_notify`,
      returnUrl: params.return_url || '',
    });

    if (vmqRes.orderId) {
      store.setVmqOrderId(params.out_trade_no, vmqRes.orderId);
    }
    return { redirectUrl: vmqRes.redirectUrl, vmqRes };
  }

  /**
   * /api.php?act=order: 查询订单
   */
  queryOrder(params) {
    if (String(params.pid) !== String(this.pid) || params.key !== this.key) {
      return { code: -1, msg: 'invalid pid/key' };
    }
    const out_trade_no = params.out_trade_no || params.trade_no;
    if (!out_trade_no) return { code: -1, msg: 'missing out_trade_no' };
    const local = store.findOrder(out_trade_no);
    if (!local) return { code: -1, msg: 'order not found' };

    return {
      code: 1,
      msg: 'success',
      trade_no: local.vmq_order_id || out_trade_no,
      out_trade_no: local.out_trade_no,
      type: local.epay_type,
      pid: local.pid,
      addtime: new Date(local.created_at).toISOString().slice(0, 19).replace('T', ' '),
      endtime: '',
      name: local.name,
      money: local.money,
      status: local.notified ? 1 : 0,
      param: local.param || '',
    };
  }

  /**
   * /vmq_notify: V免签 → 适配器 (GET)
   * 入参: payId, param, type(1/2), price, reallyPrice, sign
   * 处理: 验证 V免签 sign → 查本地映射 → 构造易支付通知 GET → 发给商户 notify_url
   * 返回: "success" 给 V免签 (V免签 收到非 "success" 会把订单标记为 state=2 通知失败)
   */
  async handleVmqNotify(query, axios) {
    if (!this.vmq.verifyNotify(query)) {
      throw new Error('vmq sign verify failed');
    }
    const out_trade_no = query.payId;
    const local = store.findOrder(out_trade_no);
    if (!local) throw new Error(`order not found: ${out_trade_no}`);

    const epayNotify = {
      pid: String(local.pid),
      trade_no: local.vmq_order_id || out_trade_no,
      out_trade_no: local.out_trade_no,
      type: VmqClient.vmqTypeToEpay(query.type),
      name: local.name || '商品',
      money: local.money,
      trade_status: 'TRADE_SUCCESS',
      param: local.param || '',
    };
    epayNotify.sign = this._sign(epayNotify);
    epayNotify.sign_type = this.signType;

    const resp = await axios.get(local.notify_url, {
      params: epayNotify,
      timeout: 10000,
      validateStatus: () => true,
    });
    const body = typeof resp.data === 'string' ? resp.data.trim() : String(resp.data);
    if (body === 'success') {
      store.markNotified(out_trade_no);
      return { ok: true, merchantResp: body };
    }
    return { ok: false, merchantResp: body };
  }
}

module.exports = EpayAdapter;
