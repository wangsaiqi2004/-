const fs = require('fs');
const path = require('path');

// 简单的文件 JSON 存储。订单映射量很小（一台机器一天最多几千条），
// 完全不需要 SQLite——纯文件读写更省心，零编译依赖。
const DATA_DIR = process.env.DATA_DIR || '/data';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

const FILE = path.join(DATA_DIR, 'orders.json');

let orders = {};
try {
  if (fs.existsSync(FILE)) {
    orders = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    console.log(`[db] loaded ${Object.keys(orders).length} orders from ${FILE}`);
  }
} catch (e) {
  console.warn(`[db] failed to load ${FILE}, starting fresh:`, e.message);
  orders = {};
}

function persist() {
  // 原子写：先写 .tmp 再 rename，避免进程崩溃时文件半残
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = {
  saveOrder(o) {
    orders[o.out_trade_no] = { ...o, created_at: Date.now(), notified: 0 };
    persist();
  },
  setVmqOrderId(out_trade_no, vmq_order_id) {
    if (orders[out_trade_no]) {
      orders[out_trade_no].vmq_order_id = vmq_order_id;
      persist();
    }
  },
  findOrder(out_trade_no) {
    return orders[out_trade_no] || null;
  },
  markNotified(out_trade_no) {
    if (orders[out_trade_no]) {
      orders[out_trade_no].notified = 1;
      persist();
    }
  },
};
