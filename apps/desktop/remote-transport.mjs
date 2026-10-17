// 桌面远程传输：JSON-RPC 2.0 over HTTPS，SSE 通知扇出。
// 与本机 HostBridge（stdio NDJSON）实现同一个 sendRequest/subscribe 接口，
// 上层（renderer/preload/main）按 target.kind 选适配器；两者共用同一份
// targetId 与 connectionEpoch，切换目标不迁移会话也不取消旧任务。
//
// 硬约束（对应 docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md §5–§6）：
//   - 每请求都带 Authorization: Bearer <token>；token 从 OS 安全存储读，
//     本文件不落地任何凭据原文。
//   - 每个 target 有独立 epoch；请求发出时快照 epoch，回来时不匹配即丢弃。
//   - 每 target 至多 8 条并发 RPC、2 条 SSE；超限拒绝。
//   - RPC 30s 超时；SSE 空闲不关闭；服务端 keepalive 由 daemon 负责。
//   - 拒 batch 请求；拒无 id 的业务通知；请求体硬上限 1 MiB。
//   - TLS 侧：不 trust-all。caCertificates 非空即只信这些 CA；
//     instanceFingerprint 非空即在握手前再做一次证书指纹钉扎（tls-pin.cjs），
//     两个约束独立生效——没有 pin 也仍要过系统 CA 或自注入 CA 的链校验。

import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Agent, fetch: undiciFetch } = require("undici");
const { checkServerIdentity, FP_RE } = require("./tls-pin.cjs");

const MAX_CONCURRENT_RPC_PER_TARGET = 8;
const MAX_CONCURRENT_SSE_PER_TARGET = 2;
const RPC_TIMEOUT_MS = 30000;
const MAX_REQUEST_BODY_BYTES = 1048576;

class TransportError extends Error {
  constructor(code, reason) { super(reason); this.code = code; this.reason = reason; }
}

function jsonEncode(obj) {
  const s = JSON.stringify(obj);
  if (s === undefined) throw new TransportError("encode-failed", "json-encode-undefined");
  if (Buffer.byteLength(s, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new TransportError("payload-too-large", "request-body-exceeds-1mib");
  }
  return s;
}

// 每个 transport 一个 Agent：ca 与 pin 都是 per-target 状态，用一份共享的全局 Agent
// 会把上一台的 CA/pin 泄漏到下一台——正是「不允许 trust-all」要堵的口子。
function makePinnedAgent({ caCertificates, instanceFingerprint }) {
  const connectOpts = { timeout: 10000 };
  if (Array.isArray(caCertificates) && caCertificates.length > 0) {
    connectOpts.ca = caCertificates;
  }
  if (instanceFingerprint !== undefined && instanceFingerprint !== null && instanceFingerprint !== "") {
    if (!FP_RE.test(instanceFingerprint)) {
      throw new TransportError("bad-config", `pin-format-invalid: ${instanceFingerprint}`);
    }
    // 在 Node tls 的默认主机名校验之后再做一次指纹比较；两者都必须通过。
    // 返回 Error 会让 undici 在握手阶段直接失败，绝不落到 HTTP 层。
    connectOpts.checkServerIdentity = (hostname, cert) =>
      checkServerIdentity(hostname, cert, instanceFingerprint) ?? undefined;
  }
  return new Agent({ connect: connectOpts, pipelining: 0 });
}

export class RemoteTransport {
  constructor({ baseUrl, tokenProvider, fetchImpl, dispatcher, instanceFingerprint, caCertificates, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
    if (typeof baseUrl !== "string" || baseUrl.length === 0) throw new TransportError("bad-config", "base-url-required");
    if (typeof tokenProvider !== "function") throw new TransportError("bad-config", "token-provider-required");
    if (Array.isArray(caCertificates)) {
      for (const c of caCertificates) {
        if (typeof c !== "string" || c.length === 0) {
          throw new TransportError("bad-config", "ca-certificate-empty");
        }
      }
    } else if (caCertificates !== undefined && caCertificates !== null) {
      throw new TransportError("bad-config", "ca-certificates-must-be-array");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.tokenProvider = tokenProvider;
    if (dispatcher !== undefined) {
      if (typeof dispatcher.dispatch !== "function") {
        throw new TransportError("bad-config", "dispatcher-must-have-dispatch");
      }
    } else {
      dispatcher = makePinnedAgent({ caCertificates, instanceFingerprint });
    }
    this.dispatcher = dispatcher;
    this.fetch = typeof fetchImpl === "function" ? fetchImpl : undiciFetch;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.nextId = 1;
    this.inflightRpc = 0;
    this.inflightSse = 0;
    this.epoch = 0;           // 目标切换时上层调 bumpEpoch()
    this.closed = false;
    this.pendingSubscribers = new Set();
    this.lastEventId = null;
  }

  bumpEpoch() {
    this.epoch += 1;
    // 目标切换：拒收所有在途响应。不取消任务——只丢弃回包。
    for (const sub of this.pendingSubscribers) { try { sub.abort?.(); } catch (_e) {} }
    this.pendingSubscribers.clear();
  }

  currentEpoch() { return this.epoch; }

  async sendRequest(method, params, opts = {}) {
    if (this.closed) throw new TransportError("closed", "transport-closed");
    if (typeof method !== "string" || method.length === 0) throw new TransportError("bad-request", "method-required");
    if (this.inflightRpc >= MAX_CONCURRENT_RPC_PER_TARGET) throw new TransportError("backpressure", "rpc-concurrency-limit");
    const id = this.nextId++;
    const body = jsonEncode({ jsonrpc: "2.0", id, method, params: params ?? {} });
    const epochAtSend = this.epoch;
    this.inflightRpc += 1;
    const controller = new AbortController();
    const timer = this.setTimeoutImpl(() => controller.abort(), RPC_TIMEOUT_MS);
    const headers = {
      "Content-Type": "application/json",
    };
    if (opts.idempotencyKey !== undefined) {
      if (typeof opts.idempotencyKey !== "string" || opts.idempotencyKey.length === 0) {
        this.clearTimeoutImpl(timer);
        this.inflightRpc -= 1;
        throw new TransportError("bad-request", "idempotency-key-invalid");
      }
      if (opts.idempotencyKey.length > 200) {
        this.clearTimeoutImpl(timer);
        this.inflightRpc -= 1;
        throw new TransportError("bad-request", "idempotency-key-too-long");
      }
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }
    try {
      const token = await this.tokenProvider();
      if (typeof token !== "string" || token.length === 0) throw new TransportError("auth-missing", "token-empty");
      headers["Authorization"] = `Bearer ${token}`;
      const res = await this.fetch(`${this.baseUrl}/rpc`, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
        // 设计 §4.2「认证请求不跟随跨主机重定向」——redirect 默认 follow 会把
        // Bearer 头带到第三方主机；这里显式 manual，并把任何 3xx 归为拒因。
        redirect: "manual",
        dispatcher: this.dispatcher,
      });
      if (this.epoch !== epochAtSend) throw new TransportError("stale-epoch", "target-switched-before-response");
      if (res.status >= 300 && res.status < 400) {
        throw new TransportError("redirect", "redirect-not-allowed");
      }
      if (!res.ok && res.status >= 400 && res.status < 500) {
        // 4xx：客户端契约错——不自动重试，明确上抛
        throw new TransportError("http-client-error", `status-${res.status}`);
      }
      if (!res.ok) {
        throw new TransportError("http-server-error", `status-${res.status}`);
      }
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (_e) { throw new TransportError("malformed-response", "response-not-json"); }
      if (parsed.error) {
        // JSON-RPC error 与 HTTP error 分开：这里是业务/协议错，HTTP 层已经 200 OK。
        const err = new TransportError("jsonrpc-error", parsed.error.message ?? "unknown");
        err.jsonrpcCode = parsed.error.code;
        throw err;
      }
      if (parsed.id !== id) {
        // 不匹配 id：拒绝，绝不按到达顺序冒充配对。
        throw new TransportError("id-mismatch", "response-id-mismatch");
      }
      return parsed.result;
    } catch (e) {
      // undici 在 TLS 握手阶段失败的错是 TypeError('fetch failed')，真正原因（pin-mismatch、
      // 证书链、主机名）挂在 e.cause。这里把它归因透上来，别让上层只能看到 'fetch failed'。
      if (e instanceof TransportError) throw e;
      const cause = e && e.cause;
      const causeMsg = cause && (cause.message || String(cause));
      if (causeMsg && causeMsg.indexOf("pin-") === 0) {
        const wrapped = new TransportError("tls-pin", causeMsg);
        wrapped.cause = cause;
        throw wrapped;
      }
      throw new TransportError("tls-transport", causeMsg || (e && e.message) || "tls-or-transport-error");
    } finally {
      this.clearTimeoutImpl(timer);
      this.inflightRpc -= 1;
    }
  }

  async subscribeNotifications(onFrame, opts = {}) {
    if (this.closed) throw new TransportError("closed", "transport-closed");
    if (this.inflightSse >= MAX_CONCURRENT_SSE_PER_TARGET) throw new TransportError("backpressure", "sse-concurrency-limit");
    const token = await this.tokenProvider();
    if (typeof token !== "string" || token.length === 0) throw new TransportError("auth-missing", "token-empty");
    const controller = new AbortController();
    this.inflightSse += 1;
    this.pendingSubscribers.add(controller);
    const epochAtOpen = this.epoch;
    const headers = { "Authorization": `Bearer ${token}`, "Accept": "text/event-stream" };
    if (opts.resumeEventId !== undefined && opts.resumeEventId !== null) {
      const rid = String(opts.resumeEventId);
      if (rid.length === 0 || rid.length > 128) {
        this.inflightSse -= 1;
        this.pendingSubscribers.delete(controller);
        throw new TransportError("bad-request", "resume-event-id-invalid");
      }
      headers["Last-Event-ID"] = rid;
    }
    const res = await this.fetch(`${this.baseUrl}/sse`, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "manual",
      dispatcher: this.dispatcher,
    });
    if (this.epoch !== epochAtOpen) { controller.abort(); this.inflightSse -= 1; this.pendingSubscribers.delete(controller); throw new TransportError("stale-epoch", "target-switched-during-open"); }
    if (res.status >= 300 && res.status < 400) {
      controller.abort(); this.inflightSse -= 1; this.pendingSubscribers.delete(controller);
      throw new TransportError("redirect", "redirect-not-allowed");
    }
    if (!res.ok) { controller.abort(); this.inflightSse -= 1; this.pendingSubscribers.delete(controller); throw new TransportError("http-error", `status-${res.status}`); }
    // 逐 chunk 读 SSE，按 \n\n 分帧；: keepalive 或 : connected 忽略。
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "";
    const pump = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let dataStr = null;
            let eventId = null;
            for (const line of frame.split("\n")) {
              if (line.startsWith("data: ")) {
                dataStr = line.slice(6);
              } else if (line.startsWith("id:")) {
                eventId = line.slice(3).trim();
              }
            }
            if (eventId !== null) this.lastEventId = eventId;
            if (dataStr !== null) {
              try { onFrame(JSON.parse(dataStr), epochAtOpen); } catch (_e) { /* 忽略畸形帧 */ }
            }
          }
        }
      } catch (_e) {
        // 网络断或 abort；上层按持久游标重连与补读。
      } finally {
        this.inflightSse -= 1;
        this.pendingSubscribers.delete(controller);
      }
    };
    pump();
    return () => { try { controller.abort(); } catch (_e) {} };
  }

  getLastEventId() { return this.lastEventId; }

  close() {
    this.closed = true;
    for (const sub of this.pendingSubscribers) { try { sub.abort?.(); } catch (_e) {} }
    this.pendingSubscribers.clear();
    try { this.dispatcher?.close?.(); } catch (_e) {}
  }
}
