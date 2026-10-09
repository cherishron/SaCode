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

import { Buffer } from "node:buffer";

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

export class RemoteTransport {
  constructor({ baseUrl, tokenProvider, fetchImpl = globalThis.fetch, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
    if (typeof baseUrl !== "string" || baseUrl.length === 0) throw new TransportError("bad-config", "base-url-required");
    if (typeof tokenProvider !== "function") throw new TransportError("bad-config", "token-provider-required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.tokenProvider = tokenProvider;
    this.fetch = fetchImpl;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.nextId = 1;
    this.inflightRpc = 0;
    this.inflightSse = 0;
    this.epoch = 0;           // 目标切换时上层调 bumpEpoch()
    this.closed = false;
    this.pendingSubscribers = new Set();
  }

  bumpEpoch() {
    this.epoch += 1;
    // 目标切换：拒收所有在途响应。不取消任务——只丢弃回包。
    for (const sub of this.pendingSubscribers) { try { sub.abort?.(); } catch (_e) {} }
    this.pendingSubscribers.clear();
  }

  currentEpoch() { return this.epoch; }

  async sendRequest(method, params) {
    if (this.closed) throw new TransportError("closed", "transport-closed");
    if (typeof method !== "string" || method.length === 0) throw new TransportError("bad-request", "method-required");
    if (this.inflightRpc >= MAX_CONCURRENT_RPC_PER_TARGET) throw new TransportError("backpressure", "rpc-concurrency-limit");
    const id = this.nextId++;
    const body = jsonEncode({ jsonrpc: "2.0", id, method, params: params ?? {} });
    const epochAtSend = this.epoch;
    this.inflightRpc += 1;
    const controller = new AbortController();
    const timer = this.setTimeoutImpl(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const token = await this.tokenProvider();
      if (typeof token !== "string" || token.length === 0) throw new TransportError("auth-missing", "token-empty");
      const res = await this.fetch(`${this.baseUrl}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body,
        signal: controller.signal,
      });
      if (this.epoch !== epochAtSend) throw new TransportError("stale-epoch", "target-switched-before-response");
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
    } finally {
      this.clearTimeoutImpl(timer);
      this.inflightRpc -= 1;
    }
  }

  async subscribeNotifications(onFrame) {
    if (this.closed) throw new TransportError("closed", "transport-closed");
    if (this.inflightSse >= MAX_CONCURRENT_SSE_PER_TARGET) throw new TransportError("backpressure", "sse-concurrency-limit");
    const token = await this.tokenProvider();
    if (typeof token !== "string" || token.length === 0) throw new TransportError("auth-missing", "token-empty");
    const controller = new AbortController();
    this.inflightSse += 1;
    this.pendingSubscribers.add(controller);
    const epochAtOpen = this.epoch;
    const res = await this.fetch(`${this.baseUrl}/sse`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}`, "Accept": "text/event-stream" },
      signal: controller.signal,
    });
    if (this.epoch !== epochAtOpen) { controller.abort(); this.inflightSse -= 1; this.pendingSubscribers.delete(controller); throw new TransportError("stale-epoch", "target-switched-during-open"); }
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
            for (const line of frame.split("\n")) {
              if (line.startsWith("data: ")) {
                const dataStr = line.slice(6);
                try { onFrame(JSON.parse(dataStr), epochAtOpen); } catch (_e) { /* 忽略畸形帧 */ }
              }
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

  close() {
    this.closed = true;
    for (const sub of this.pendingSubscribers) { try { sub.abort?.(); } catch (_e) {} }
    this.pendingSubscribers.clear();
  }
}
