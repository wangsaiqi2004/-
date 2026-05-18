const crypto = require('crypto');
const axios = require('axios');

/**
 * V免签fox (VMQ) 客户端。
 * 协议参考: vmqfox-backend/app/controller/api/Order.php & Monitor.php
 */
class VmqClient {
  constructor({ baseUrl, key }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.key = key;
  }

  /**
   * 创建订单。V免签 期望参数（POST x-www-form-urlencoded）:
   *   payId, param, type(1=wx,2=zfb), price, sign, notifyUrl, returnUrl, isHtml
   * sign 规则: md5("payId={payId}&param={param}&type={type}&price={price}&key={vmq_key}")
   */
  async createOrder({ payId, param, type, price, notifyUrl, returnUrl }) {
    if (![1, 2].includes(type)) {
      throw new Error(`invalid vmq type: ${type}, expected 1(wx) or 2(zfb)`);
    }
    const priceStr = Number(price).toFixed(2);
    const paramStr = param || '';
    const signSrc = `payId=${payId}&param=${paramStr}&type=${type}&price=${priceStr}&key=${this.key}`;
    const sign = crypto.createHash('md5').update(signSrc).digest('hex');

    const form = new URLSearchParams();
    form.set('payId', payId);
    form.set('param', paramStr);
    form.set('type', String(type));
    form.set('price', priceStr);
    form.set('sign', sign);
    if (notifyUrl) form.set('notifyUrl', notifyUrl);
    if (returnUrl) form.set('returnUrl', returnUrl);

    const resp = await axios.post(`${this.baseUrl}/api/order/create`, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
      validateStatus: () => true,
    });
    const body = resp.data;
    if (!body || body.code !== 200) {
      throw new Error(`vmq createOrder failed: ${body && body.msg ? body.msg : JSON.stringify(body)}`);
    }
    return body.data;
  }

  /**
   * 验证 V免签 异步通知签名。
   * 通知是 GET，参数: payId, param, type, price, reallyPrice, sign
   * sign 规则 (Monitor.php:152): md5(payId + param + type + price + reallyPrice + key)
   * 注意: V免签 这里**不带 key= 前缀**，是原始字符串直接拼。
   */
  verifyNotify({ payId, param, type, price, reallyPrice, sign }) {
    if (!sign) return false;
    const signSrc = `${payId}${param || ''}${type}${price}${reallyPrice}${this.key}`;
    const calc = crypto.createHash('md5').update(signSrc).digest('hex');
    return calc === String(sign).toLowerCase();
  }

  /**
   * 发送监控端心跳，激活 V免签 的 jkstate=1。
   * 心跳签名 (Monitor.php:28): md5(t + key), t 为秒级时间戳
   * 测试场景下用 adapter 模拟监控端心跳；生产部署要么装真实 APK，要么沿用此机制。
   */
  async sendHeartbeat() {
    const t = Math.floor(Date.now() / 1000);
    const sign = crypto.createHash('md5').update(`${t}${this.key}`).digest('hex');
    const resp = await axios.post(`${this.baseUrl}/api/monitor/heart`,
      new URLSearchParams({ t: String(t), sign }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000, validateStatus: () => true });
    return resp.data;
  }

  startHeartbeatLoop(intervalMs = 30000) {
    const tick = async () => {
      try {
        await this.sendHeartbeat();
      } catch (err) {
        console.warn('[vmq heartbeat]', err.message);
      }
    };
    tick();
    return setInterval(tick, intervalMs);
  }

  /**
   * VMQ type → 易支付 type 映射。
   *   1 (微信) → wxpay
   *   2 (支付宝) → alipay
   */
  static vmqTypeToEpay(vmqType) {
    return String(vmqType) === '1' ? 'wxpay' : 'alipay';
  }

  /**
   * 易支付 type → VMQ type 映射。
   *   alipay / aliweb / aliwap → 2
   *   wxpay / wechat → 1
   */
  static epayTypeToVmq(epayType) {
    const t = String(epayType || '').toLowerCase();
    if (t.includes('ali')) return 2;
    if (t.includes('wx') || t.includes('wechat')) return 1;
    return null;
  }
}

module.exports = VmqClient;
