const crypto = require('crypto');

/**
 * 生成 MD5 签名
 * 根据 pay.myzfw.com/doc_old.html#pay3 文档规范
 * 
 * 签名步骤：
 * 1. 收集所有非空请求参数，排除 sign 和 sign_type 字段
 * 2. 按照参数名的 ASCII 码顺序升序排序（字典序）
 * 3. 将每个参数和值组合为 key=value，然后用 & 连接成待签名字符串
 * 4. 在待签名字符串末尾直接拼接商户密钥（stringToSign + key）
 * 5. 对整个字符串进行 MD5 加密，结果转换为小写
 * 
 * @param {Object} params - 待签名的参数对象
 * @param {string} key - 商户密钥
 * @returns {string} MD5 签名字符串（小写）
 */
function generateMD5Sign(params, key) {
  // 第一步：筛选非空参数，排除 sign 和 sign_type
  const filtered = {};
  for (const keyName in params) {
    const val = params[keyName];
    
    // 排除 sign 和 sign_type 字段
    if (keyName === 'sign' || keyName === 'sign_type') {
      continue;
    }
    
    // 排除空值（null、undefined、空字符串）
    if (val === undefined || val === null || val === '') {
      continue;
    }
    
    // 排除数组和 Buffer 类型
    if (Array.isArray(val) || Buffer.isBuffer(val)) {
      continue;
    }
    
    // 将值转换为字符串（不进行 URL 编码）
    filtered[keyName] = String(val);
  }

  // 第二步：按照参数名的 ASCII 码顺序升序排序（字典序）
  const keys = Object.keys(filtered).sort();

  // 第三步：拼接成待签名字符串 key=value&key=value
  const stringToSign = keys
    .map(keyName => `${keyName}=${filtered[keyName]}`)
    .join('&');

  // 第四步：在末尾直接拼接商户密钥（不是 &key=密钥，而是直接拼接密钥）
  const signString = stringToSign + key;

  // 第五步：进行 MD5 加密并转换为小写
  const md5 = crypto.createHash('md5');
  md5.update(signString, 'utf8');
  const signature = md5.digest('hex').toLowerCase();

  return signature;
}

/**
 * 验证 MD5 签名
 * 根据 pay.myzfw.com/doc_old.html#pay3 文档规范验证返回数据的签名
 * 
 * @param {Object} params - 包含 sign 字段的参数对象（通常是回调或返回的数据）
 * @param {string} key - 商户密钥
 * @returns {boolean} 返回签名是否有效
 */
function verifyMD5Sign(params, key) {
  // 检查是否有 sign 字段
  if (!params.sign) {
    return false;
  }

  const signValue = params.sign;

  // 重复签名拼接步骤：排除 sign 和 sign_type，不含空值，排序 & 拼接
  const filtered = {};
  for (const keyName in params) {
    const val = params[keyName];
    
    // 排除 sign 和 sign_type 字段
    if (keyName === 'sign' || keyName === 'sign_type') {
      continue;
    }
    
    // 排除空值
    if (val === undefined || val === null || val === '') {
      continue;
    }
    
    // 排除数组和 Buffer 类型
    if (Array.isArray(val) || Buffer.isBuffer(val)) {
      continue;
    }
    
    filtered[keyName] = String(val);
  }

  // 按照参数名的 ASCII 码顺序升序排序
  const keys = Object.keys(filtered).sort();

  // 拼接成待签名字符串
  const stringToSign = keys
    .map(keyName => `${keyName}=${filtered[keyName]}`)
    .join('&');

  // 在末尾直接拼接商户密钥（不是 &key=密钥，而是直接拼接密钥）
  const signString = stringToSign + key;

  // 进行 MD5 加密并转换为小写
  const md5 = crypto.createHash('md5');
  md5.update(signString, 'utf8');
  const calculatedSign = md5.digest('hex').toLowerCase();

  // 比较签名（小写比较）
  return calculatedSign === signValue.toLowerCase();
}

/**
 * 生成签名
 * @param {Object} params - 待签名的参数对象
 * @param {string} key - 商户密钥（MD5）
 * @param {string} signType - 签名类型（仅支持 MD5，保留参数以兼容）
 * @returns {string} MD5 签名字符串（小写）
 */
function generateSign(params, key, signType = 'MD5') {
  return generateMD5Sign(params, key);
}

/**
 * 验证签名
 * @param {Object} params - 包含 sign 字段的参数对象
 * @param {string} key - 商户密钥（MD5）
 * @param {string} signType - 签名类型（仅支持 MD5，保留参数以兼容）
 * @returns {boolean} 返回签名是否有效
 */
function verifySign(params, key, signType = 'MD5') {
  return verifyMD5Sign(params, key);
}

module.exports = {
  generateSign,
  verifySign,
  generateMD5Sign,
  verifyMD5Sign
};
