// TLS 证书指纹钉扎校验。与 apps/desktop/target-store.cjs 的
// instanceFingerprint（"sha256/<64hex>"）配合使用：
//   1. tlsPin.checkServerIdentity(hostname, cert, expectedFingerprint)
//      同时执行标准主机名校验（tls.checkServerIdentity）与钉扎指纹比较，
//      任一步失败即返回 Error——绝不返回 undefined 让握手「假装通过」。
//   2. 首次连接（expected 为空）不校验，由调用方在成功后 pinFingerprint
//      写入 target-store；本模块不改变存储。
//
// 硬约束：
//   - 指纹计算走 SHA-256(cert.raw)，输出统一 "sha256/<hex>"；不接受 PEM/DER
//     之外的形态（比如 fingerprint256 字段是 "AA:BB:..."，那是另一种编码，
//     不共用）。
//   - 比较用常数时间：Node 的 crypto.timingSafeEqual 要求等长；先比长度再
//     决定，避免长度本身成为侧信道（长度只在钉扎时对齐，不同即不匹配）。
//   - 绝不接受 trust-all：expectedFingerprint 一旦存在，任何不一致都拒。

const crypto = require("node:crypto");
const tls = require("node:tls");

const FP_RE = /^sha256\/[0-9a-f]{64}$/;

function certSha256Hex(cert) {
  if (!cert || !Buffer.isBuffer(cert.raw)) {
    throw new TypeError("cert.raw must be a Buffer (DER)");
  }
  return crypto.createHash("sha256").update(cert.raw).digest("hex");
}

function certFingerprintSha256(cert) {
  return `sha256/${certSha256Hex(cert)}`;
}

function constantTimeEqualHex(aHex, bHex) {
  if (aHex.length !== bHex.length) return false;
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  return crypto.timingSafeEqual(a, b);
}

// 返回 null 表示通过；返回 Error 表示拒。调用方（fetch/https.request 的
// checkServerIdentity hook）拿到 Error 会中断握手。
// hostnameVerifier 可注入（测试与自定义 CA 场景）；默认为 tls.checkServerIdentity。
function checkServerIdentity(hostname, cert, expectedFingerprint, hostnameVerifier = tls.checkServerIdentity) {
  const hostErr = hostnameVerifier(hostname, cert);
  if (hostErr) return hostErr;
  if (expectedFingerprint === "" || expectedFingerprint === null || expectedFingerprint === undefined) {
    // TOFU 首连：不钉、由上层记录；本函数放行。
    return null;
  }
  if (!FP_RE.test(expectedFingerprint)) {
    return new Error(`pin-format-invalid: ${expectedFingerprint}`);
  }
  let actual;
  try {
    actual = certFingerprintSha256(cert);
  } catch (e) {
    return new Error(`cert-fingerprint-unreadable: ${e.message}`);
  }
  const aHex = actual.slice("sha256/".length);
  const eHex = expectedFingerprint.slice("sha256/".length);
  if (!constantTimeEqualHex(aHex, eHex)) {
    return new Error("pin-mismatch");
  }
  return null;
}

module.exports = {
  checkServerIdentity,
  certFingerprintSha256,
  FP_RE,
};
