import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { TargetStore, TargetValidationError, validateBaseUrl } = require("../target-store.cjs");

test("target store：合法本机 http 回环通过", () => {
  const s = new TargetStore();
  const t = s.add({ targetId: "local-1", displayName: "本机", kind: "local", baseUrl: "http://127.0.0.1:18937", instanceFingerprint: "", credentialRef: "" });
  assert.equal(t.baseUrl, "http://127.0.0.1:18937");
  assert.equal(s.active().targetId, "local-1");
});

test("target store：合法远程 https 通过", () => {
  const s = new TargetStore();
  const t = s.add({ targetId: "srv", displayName: "服务器", kind: "remote", baseUrl: "https://example.com", instanceFingerprint: "sha256/" + "a".repeat(64), credentialRef: "keychain:srv" });
  assert.equal(t.baseUrl, "https://example.com");
  assert.equal(t.credentialRef, "keychain:srv");
});

test("target store：远程 http 一律拒（要求 https）", () => {
  const s = new TargetStore();
  assert.throws(() => s.add({ targetId: "bad", displayName: "x", kind: "remote", baseUrl: "http://10.0.0.5:8080", instanceFingerprint: "", credentialRef: "" }), (e) => e instanceof TargetValidationError && e.reason === "remote-target-requires-https");
});

test("target store：本机 http 非回环一律拒", () => {
  const s = new TargetStore();
  assert.throws(() => s.add({ targetId: "bad", displayName: "x", kind: "local", baseUrl: "http://10.0.0.5:8080", instanceFingerprint: "", credentialRef: "" }), (e) => e.reason === "base-url-plaintext-requires-loopback");
});

test("target store：URL 禁 @ ? # 用户信息与 fragment", () => {
  assert.throws(() => validateBaseUrl("remote", "https://user:***@example.com"), (e) => e.reason === "base-url-forbidden-character");
  assert.throws(() => validateBaseUrl("remote", "https://example.com?x=1"), (e) => e.reason === "base-url-forbidden-character");
  assert.throws(() => validateBaseUrl("remote", "https://example.com#frag"), (e) => e.reason === "base-url-forbidden-character");
});

test("target store：URL 禁尾路径（不接受 /prefix 形式的挂载点）", () => {
  assert.throws(() => validateBaseUrl("remote", "https://example.com/api"), (e) => e.reason === "base-url-must-not-have-path");
});

test("target store：非 http/https scheme 一律拒（file: 等）", () => {
  assert.throws(() => validateBaseUrl("remote", "file:///etc/passwd"), (e) => e.reason === "base-url-scheme-not-http-or-https");
});

test("target store：targetId 重复拒", () => {
  const s = new TargetStore();
  s.add({ targetId: "dup", displayName: "一", kind: "local", baseUrl: "http://localhost:1", instanceFingerprint: "", credentialRef: "" });
  assert.throws(() => s.add({ targetId: "dup", displayName: "二", kind: "local", baseUrl: "http://localhost:2", instanceFingerprint: "", credentialRef: "" }), (e) => e.reason === "target-id-duplicate");
});

test("target store：kind 只能是 local 或 remote", () => {
  const s = new TargetStore();
  assert.throws(() => s.add({ targetId: "x", displayName: "y", kind: "cloud", baseUrl: "https://example.com", instanceFingerprint: "", credentialRef: "" }), (e) => e.reason === "kind-must-be-local-or-remote");
});

test("target store：fingerprint 必须是 sha256/64hex 或空", () => {
  const s = new TargetStore();
  assert.throws(() => s.add({ targetId: "x", displayName: "y", kind: "remote", baseUrl: "https://example.com", instanceFingerprint: "md5/abc", credentialRef: "" }), (e) => e.reason === "fingerprint-must-be-sha256-hex");
  assert.throws(() => s.add({ targetId: "y", displayName: "z", kind: "remote", baseUrl: "https://example.com", instanceFingerprint: "sha256/" + "g".repeat(64), credentialRef: "" }), (e) => e.reason === "fingerprint-must-be-sha256-hex");
});

test("target store：切换 active 不改动列表内容", () => {
  const s = new TargetStore();
  s.add({ targetId: "a", displayName: "A", kind: "local", baseUrl: "http://localhost:1", instanceFingerprint: "", credentialRef: "" });
  s.add({ targetId: "b", displayName: "B", kind: "remote", baseUrl: "https://x.example", instanceFingerprint: "", credentialRef: "ref-b" });
  const before = s.list().map(t => t.targetId).join(",");
  s.setActive("b");
  const after = s.list().map(t => t.targetId).join(",");
  assert.equal(before, after);
  assert.equal(s.active().targetId, "b");
});

test("target store：移除当前 active 后自动切到剩余首个", () => {
  const s = new TargetStore();
  s.add({ targetId: "first", displayName: "F", kind: "local", baseUrl: "http://localhost:1", instanceFingerprint: "", credentialRef: "" });
  s.add({ targetId: "second", displayName: "S", kind: "local", baseUrl: "http://localhost:2", instanceFingerprint: "", credentialRef: "" });
  s.remove("first");
  assert.equal(s.active().targetId, "second");
});

test("target store：清空后 active 为 null", () => {
  const s = new TargetStore();
  s.add({ targetId: "only", displayName: "O", kind: "local", baseUrl: "http://localhost:1", instanceFingerprint: "", credentialRef: "" });
  s.remove("only");
  assert.equal(s.active(), null);
});

test("target store：setActive 未知 targetId 抛错", () => {
  const s = new TargetStore();
  assert.throws(() => s.setActive("nope"), (e) => e.reason === "target-not-found");
});

test("target store：descriptor 里绝不出现凭据原文（credentialRef 是外部指针）", () => {
  const s = new TargetStore();
  s.add({ targetId: "srv", displayName: "S", kind: "remote", baseUrl: "https://srv.example", instanceFingerprint: "", credentialRef: "keychain:srv-token-ref" });
  const t = s.get("srv");
  // descriptor 里只有 credentialRef，没有 credential/token/secret 字段。
  const keys = Object.keys(t).sort();
  assert.deepEqual(keys, ["baseUrl", "credentialRef", "displayName", "instanceFingerprint", "kind", "targetId"]);
  // credentialRef 允许非空但不等于凭据原文；本文件只负责指针的存储，不管理原文。
  assert.equal(t.credentialRef, "keychain:srv-token-ref");
});
