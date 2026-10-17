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

test("target store：spec 非对象抛 spec-not-object", () => {
  const s = new TargetStore();
  assert.throws(() => s.add(null), (e) => e.reason === "spec-not-object");
  assert.throws(() => s.add("string"), (e) => e.reason === "spec-not-object");
  assert.throws(() => s.add(undefined), (e) => e.reason === "spec-not-object");
});

test("target store：displayName 空抛 display-name-empty", () => {
  const s = new TargetStore();
  assert.throws(
    () => s.add({ targetId: "x", displayName: "", kind: "local", baseUrl: "http://localhost:1", instanceFingerprint: "", credentialRef: "" }),
    (e) => e.reason === "display-name-empty"
  );
});

test("target store：IPv6 回环 [::1] 允许本机 http", () => {
  const s = new TargetStore();
  const t = s.add({ targetId: "v6", displayName: "v6", kind: "local", baseUrl: "http://[::1]:18937", instanceFingerprint: "", credentialRef: "" });
  assert.equal(t.baseUrl, "http://[::1]:18937");
});

test("target store：非字符串 credentialRef 拒", () => {
  const s = new TargetStore();
  assert.throws(
    () => s.add({ targetId: "x", displayName: "x", kind: "local", baseUrl: "http://localhost:1", instanceFingerprint: "", credentialRef: 42 }),
    (e) => e.reason === "credential-ref-must-be-string"
  );
});

test("target store：remove 非 active target 时 active 保持不变", () => {
  const s = new TargetStore();
  s.add({ targetId: "a", displayName: "A", kind: "local", baseUrl: "http://localhost:1", instanceFingerprint: "", credentialRef: "" });
  s.add({ targetId: "b", displayName: "B", kind: "local", baseUrl: "http://localhost:2", instanceFingerprint: "", credentialRef: "" });
  s.setActive("b");
  s.remove("a");
  assert.equal(s.active().targetId, "b");
});

test("target store：baseUrl 空/非字符串拒 base-url-empty", () => {
  assert.throws(() => validateBaseUrl("local", ""), (e) => e.reason === "base-url-empty");
  assert.throws(() => validateBaseUrl("local", null), (e) => e.reason === "base-url-empty");
  assert.throws(() => validateBaseUrl("local", 123), (e) => e.reason === "base-url-empty");
});

test("TOFU：首次连接钉入指纹（当前为空）", () => {
  const s = new TargetStore();
  s.add({ targetId: "srv", displayName: "S", kind: "remote", baseUrl: "https://srv.example", instanceFingerprint: "", credentialRef: "k" });
  const fp = "sha256/" + "a".repeat(64);
  const t = s.pinFingerprint("srv", fp);
  assert.equal(t.instanceFingerprint, fp);
});

test("TOFU：钉入相同指纹幂等，不报错", () => {
  const s = new TargetStore();
  const fp = "sha256/" + "b".repeat(64);
  s.add({ targetId: "srv", displayName: "S", kind: "remote", baseUrl: "https://srv.example", instanceFingerprint: fp, credentialRef: "k" });
  const t = s.pinFingerprint("srv", fp);
  assert.equal(t.instanceFingerprint, fp);
});

test("TOFU：已钉另一枚指纹必须拒，不能静默换", () => {
  const s = new TargetStore();
  const old = "sha256/" + "c".repeat(64);
  const evil = "sha256/" + "d".repeat(64);
  s.add({ targetId: "srv", displayName: "S", kind: "remote", baseUrl: "https://srv.example", instanceFingerprint: old, credentialRef: "k" });
  assert.throws(() => s.pinFingerprint("srv", evil), (e) => e.reason === "fingerprint-mismatch");
  assert.equal(s.get("srv").instanceFingerprint, old);
});

test("TOFU：pinFingerprint 空串与非法格式各自拒", () => {
  const s = new TargetStore();
  s.add({ targetId: "srv", displayName: "S", kind: "remote", baseUrl: "https://srv.example", instanceFingerprint: "", credentialRef: "k" });
  assert.throws(() => s.pinFingerprint("srv", ""), (e) => e.reason === "fingerprint-empty");
  assert.throws(() => s.pinFingerprint("srv", "not-a-sha"), (e) => e.reason === "fingerprint-must-be-sha256-hex");
});

test("TOFU：pinFingerprint 未知 targetId 抛 target-not-found", () => {
  const s = new TargetStore();
  assert.throws(() => s.pinFingerprint("nope", "sha256/" + "a".repeat(64)), (e) => e.reason === "target-not-found");
});

test("rotate：不带 confirm='rotate' 一律拒", () => {
  const s = new TargetStore();
  const old = "sha256/" + "e".repeat(64);
  const neu = "sha256/" + "f".repeat(64);
  s.add({ targetId: "srv", displayName: "S", kind: "remote", baseUrl: "https://srv.example", instanceFingerprint: old, credentialRef: "k" });
  assert.throws(() => s.rotateFingerprint("srv", neu), (e) => e.reason === "rotate-requires-confirm");
  assert.throws(() => s.rotateFingerprint("srv", neu, "yes"), (e) => e.reason === "rotate-requires-confirm");
  assert.equal(s.get("srv").instanceFingerprint, old, "误调不得改钉");
});

test("rotate：带 confirm='rotate' 才允许覆盖已钉指纹", () => {
  const s = new TargetStore();
  const old = "sha256/" + "1".repeat(64);
  const neu = "sha256/" + "2".repeat(64);
  s.add({ targetId: "srv", displayName: "S", kind: "remote", baseUrl: "https://srv.example", instanceFingerprint: old, credentialRef: "k" });
  const t = s.rotateFingerprint("srv", neu, "rotate");
  assert.equal(t.instanceFingerprint, neu);
});


