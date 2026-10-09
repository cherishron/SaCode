import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { checkServerIdentity, certFingerprintSha256, FP_RE } = require("../tls-pin.cjs");

// 构造只带 raw 的假证书对象（DER 用任意 32 字节即可，因为模块只算 SHA-256）。
function mkCert(rawBytes) {
  return { raw: Buffer.from(rawBytes), subject: { CN: "x" }, subjectAltName: "DNS:x" };
}
function fpOf(rawBytes) {
  return `sha256/${crypto.createHash("sha256").update(Buffer.from(rawBytes)).digest("hex")}`;
}
// 主机名校验注入恒通过，本文件只测 pin 面。
const okHost = () => null;
const failHost = () => new Error("hostname-mismatch");

test("tls-pin：expected 为空 → 首连放行（TOFU）", () => {
  const cert = mkCert([1, 2, 3]);
  assert.equal(checkServerIdentity("x", cert, "", okHost), null);
  assert.equal(checkServerIdentity("x", cert, null, okHost), null);
  assert.equal(checkServerIdentity("x", cert, undefined, okHost), null);
});

test("tls-pin：expected 与实际一致 → 放行", () => {
  const cert = mkCert([4, 5, 6]);
  const fp = fpOf([4, 5, 6]);
  assert.equal(checkServerIdentity("x", cert, fp, okHost), null);
});

test("tls-pin：expected 与实际不一致 → pin-mismatch", () => {
  const cert = mkCert([7, 8, 9]);
  const wrong = `sha256/${"0".repeat(64)}`;
  const err = checkServerIdentity("x", cert, wrong, okHost);
  assert.ok(err instanceof Error);
  assert.equal(err.message, "pin-mismatch");
});

test("tls-pin：expected 格式非 sha256/<hex> → pin-format-invalid", () => {
  const cert = mkCert([1]);
  const err = checkServerIdentity("x", cert, "not-a-fp", okHost);
  assert.equal(err.message, "pin-format-invalid: not-a-fp");
});

test("tls-pin：主机名校验不过优先返回，pin 不覆盖主机错", () => {
  const cert = mkCert([2]);
  const fp = fpOf([2]);
  const err = checkServerIdentity("wrong.host", cert, fp, failHost);
  assert.equal(err.message, "hostname-mismatch");
});

test("tls-pin：cert.raw 非 Buffer → cert-fingerprint-unreadable", () => {
  const err = checkServerIdentity("x", { subject: {}, subjectAltName: "DNS:x" }, `sha256/${"1".repeat(64)}`, okHost);
  assert.match(err.message, /^cert-fingerprint-unreadable/);
});

test("tls-pin：certFingerprintSha256 输出严格 sha256/<64hex>", () => {
  const cert = mkCert([10, 20, 30]);
  const fp = certFingerprintSha256(cert);
  assert.match(fp, FP_RE);
});

test("tls-pin：不同 raw 生成不同指纹（不是 hash 冲突）", () => {
  const a = fpOf([1]);
  const b = fpOf([2]);
  assert.notEqual(a, b);
});

test("tls-pin：默认主机校验用 tls.checkServerIdentity（san 不含 host 时拒）", () => {
  // 不注入 hostnameVerifier，走默认：Node 内置校验，san 只 DNS:x 而 hostname=evil。
  const cert = mkCert([9]);
  const fp = fpOf([9]);
  const err = checkServerIdentity("evil.example", cert, fp);
  assert.ok(err instanceof Error);
});
