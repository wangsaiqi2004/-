const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

const db = new Database(path.join(DATA_DIR, 'adapter.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    out_trade_no TEXT PRIMARY KEY,
    pid          TEXT NOT NULL,
    notify_url   TEXT NOT NULL,
    return_url   TEXT,
    name         TEXT,
    money        TEXT NOT NULL,
    epay_type    TEXT NOT NULL,
    param        TEXT,
    vmq_order_id TEXT,
    created_at   INTEGER NOT NULL,
    notified     INTEGER NOT NULL DEFAULT 0
  )
`);

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO orders
    (out_trade_no, pid, notify_url, return_url, name, money, epay_type, param, vmq_order_id, created_at, notified)
  VALUES
    (@out_trade_no, @pid, @notify_url, @return_url, @name, @money, @epay_type, @param, @vmq_order_id, @created_at, 0)
`);

const updateVmqOrderIdStmt = db.prepare(`UPDATE orders SET vmq_order_id = @vmq_order_id WHERE out_trade_no = @out_trade_no`);
const findStmt = db.prepare(`SELECT * FROM orders WHERE out_trade_no = ?`);
const markNotifiedStmt = db.prepare(`UPDATE orders SET notified = 1 WHERE out_trade_no = ?`);

module.exports = {
  saveOrder(o) { insertStmt.run({ ...o, created_at: Date.now() }); },
  setVmqOrderId(out_trade_no, vmq_order_id) { updateVmqOrderIdStmt.run({ out_trade_no, vmq_order_id }); },
  findOrder(out_trade_no) { return findStmt.get(out_trade_no); },
  markNotified(out_trade_no) { markNotifiedStmt.run(out_trade_no); },
};
