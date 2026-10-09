// 桌面多目标连接存储：target descriptor 的持久化与校验。
// 每个 target 描述"一台可被连接的 SaCode 服务端实例"（本机或远程），
// 客户端在多个 target 间切换；target 的会话/工作区互不迁移。
//
// 硬约束（对应 docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md §4）：
//   - 本文件不落任何凭据原文，只落 credentialRef（平台安全存储里的指针）；
//     真凭据由 OS keychain/凭据管理器保管，读出来用后即弃。
//   - remote baseUrl 强制 https（或回环 http）；禁止 URL 里携带 user:pass 或 fragment。
//   - targetId 全局唯一；displayName 非空。
//   - 撤销 target 不删除它上面的历史 operation 记录，也不取消远程任务。
//
// 桌面进程只在启动时读一次这个存储；运行期状态由 target-bridge 的
// ConnectionState 承担，本文件不承担在途状态。

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

class TargetValidationError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function validateBaseUrl(kind, url) {
  if (typeof url !== "string" || url.length === 0) throw new TargetValidationError("base-url-empty");
  // 拒 @ ? # —— 用户信息、query、fragment 都不该出现在服务端地址里。
  if (url.includes("@") || url.includes("?") || url.includes("#")) {
    throw new TargetValidationError("base-url-forbidden-character");
  }
  let parsed;
  try { parsed = new URL(url); } catch (_e) { throw new TargetValidationError("base-url-malformed"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TargetValidationError("base-url-scheme-not-http-or-https");
  }
  if (parsed.protocol === "http:") {
    // 远程目标一律要求 https，先于回环检查——远程语义下不存在「http 打回环」这种形态。
    if (kind === "remote") {
      throw new TargetValidationError("remote-target-requires-https");
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new TargetValidationError("base-url-plaintext-requires-loopback");
    }
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new TargetValidationError("base-url-must-not-have-path");
  }
  return parsed.origin;
}

function validateInstanceFingerprint(fp) {
  // 期望格式：sha256/<64 hex>。生产证书绑定用；测试允许空串（未绑定）。
  if (fp === "") return true;
  if (typeof fp !== "string") throw new TargetValidationError("fingerprint-must-be-string");
  if (!/^sha256\/[0-9a-f]{64}$/.test(fp)) throw new TargetValidationError("fingerprint-must-be-sha256-hex");
  return true;
}

class TargetStore {
  constructor() {
    this.targets = new Map();  // targetId → descriptor
    this.activeTargetId = null;
  }

  add(spec) {
    if (typeof spec !== "object" || spec === null) throw new TargetValidationError("spec-not-object");
    const { targetId, displayName, kind, baseUrl, instanceFingerprint = "", credentialRef = "" } = spec;
    if (typeof targetId !== "string" || targetId.length === 0) throw new TargetValidationError("target-id-empty");
    if (this.targets.has(targetId)) throw new TargetValidationError("target-id-duplicate");
    if (typeof displayName !== "string" || displayName.length === 0) throw new TargetValidationError("display-name-empty");
    if (kind !== "local" && kind !== "remote") throw new TargetValidationError("kind-must-be-local-or-remote");
    const origin = validateBaseUrl(kind, baseUrl);
    validateInstanceFingerprint(instanceFingerprint);
    if (typeof credentialRef !== "string") throw new TargetValidationError("credential-ref-must-be-string");
    const descriptor = { targetId, displayName, kind, baseUrl: origin, instanceFingerprint, credentialRef };
    this.targets.set(targetId, descriptor);
    if (this.activeTargetId === null) this.activeTargetId = targetId;
    return descriptor;
  }

  list() { return Array.from(this.targets.values()); }

  get(targetId) { return this.targets.get(targetId) || null; }

  setActive(targetId) {
    if (!this.targets.has(targetId)) throw new TargetValidationError("target-not-found");
    this.activeTargetId = targetId;
    return this.targets.get(targetId);
  }

  active() { return this.activeTargetId ? this.targets.get(this.activeTargetId) : null; }

  remove(targetId) {
    if (!this.targets.has(targetId)) throw new TargetValidationError("target-not-found");
    this.targets.delete(targetId);
    if (this.activeTargetId === targetId) {
      const next = this.targets.keys().next();
      this.activeTargetId = next.done ? null : next.value;
    }
  }
}

module.exports = { TargetStore, TargetValidationError, validateBaseUrl, validateInstanceFingerprint };
