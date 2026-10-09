// 桌面统一目标路由器：把本机 stdio NDJSON Host 与远程 HTTPS JSON-RPC/SSE
// 归到同一个 sendRequest/subscribe 接口下，renderer/preload 不需要知道差异。
//
// 硬约束（对应 docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md §2、§6）：
//   - 每个 target 一份独立状态：pending 请求、订阅、connectionEpoch。
//   - 切换 target 只改路由器当前的 default target；已在途请求仍归老 target，
//     回包按 targetId 匹配，绝不覆盖新 target 的页面状态。
//   - 路由器不"猜"目标；未知 targetId 直接抛错，不 fallback 到本机。
//   - 一个 target 关闭不影响另一个 target 上的任务。
//   - 目标路由只搬请求，不做业务授权（那是 daemon 端 authz 的责任）。

import { RemoteTransport } from "./remote-transport.mjs";

export class TargetBridge {
  constructor({ localBridgeFactory = null } = {}) {
    // targetId → { descriptor, transport | localBridge, connectionEpoch, subscribers }
    this.targets = new Map();
    this.defaultTargetId = null;
    this.localBridgeFactory = localBridgeFactory;   // 由外部注入 HostBridge 构造器，避免桌面依赖污染
  }

  register(descriptor, transport) {
    if (typeof descriptor?.targetId !== "string" || descriptor.targetId.length === 0) {
      throw new Error("target-id-required");
    }
    if (this.targets.has(descriptor.targetId)) {
      throw new Error(`target-duplicate: ${descriptor.targetId}`);
    }
    if (!transport || typeof transport.sendRequest !== "function") {
      throw new Error("transport-required");
    }
    const entry = { descriptor, transport, connectionEpoch: 0, subscribers: new Set() };
    this.targets.set(descriptor.targetId, entry);
    if (this.defaultTargetId === null) this.defaultTargetId = descriptor.targetId;
    return entry;
  }

  setDefault(targetId) {
    if (!this.targets.has(targetId)) throw new Error(`target-not-found: ${targetId}`);
    this.defaultTargetId = targetId;
    return this.targets.get(targetId).descriptor;
  }

  getDefault() {
    if (this.defaultTargetId === null) throw new Error("no-target-registered");
    return this.targets.get(this.defaultTargetId).descriptor;
  }

  listDescriptors() {
    return Array.from(this.targets.values()).map((e) => e.descriptor);
  }

  // 明确 targetId 的请求；上层 renderer 从当前页面上下文带 targetId 进来。
  // 未知 targetId 一律抛，不 fallback。
  async request(targetId, method, params) {
    const entry = this.targets.get(targetId);
    if (!entry) throw new Error(`target-not-found: ${targetId}`);
    const epochAtSend = entry.connectionEpoch;
    const result = await entry.transport.sendRequest(method, params);
    // 在途目标切换：transport 内部已按自己 epoch 丢，但一层再核一次，
    // 免得 remote transport 的 bumpEpoch 语义与这里不同步。
    if (entry.connectionEpoch !== epochAtSend) {
      throw new Error(`target-switched-during-request: ${targetId}`);
    }
    return result;
  }

  // 订阅目标通知；返回带 unsubscribe 的句柄。切换目标后旧订阅被 abort，
  // 上层重连新目标；不会跨目标串通知。
  async subscribe(targetId, onFrame) {
    const entry = this.targets.get(targetId);
    if (!entry) throw new Error(`target-not-found: ${targetId}`);
    const epochAtOpen = entry.connectionEpoch;
    const rawUnsub = await entry.transport.subscribeNotifications((frame, transportEpoch) => {
      // transportEpoch 由 remote-transport 传下来，与本地 connectionEpoch 对齐；
      // 若目标已切换（connectionEpoch 变化），直接丢弃帧。
      if (entry.connectionEpoch !== epochAtOpen) return;
      if (typeof transportEpoch === "number" && transportEpoch !== epochAtOpen) return;
      onFrame(frame);
    });
    const wrappedUnsub = () => {
      entry.subscribers.delete(wrappedUnsub);
      try { rawUnsub?.(); } catch (_e) {}
    };
    entry.subscribers.add(wrappedUnsub);
    return wrappedUnsub;
  }

  // 目标被"暂时不活跃"（如 renderer 切页面但不删目标）：不动订阅、不动在途请求。
  // 目标被"移除"：中止该目标的所有订阅，标记 transport 关闭。
  remove(targetId) {
    const entry = this.targets.get(targetId);
    if (!entry) throw new Error(`target-not-found: ${targetId}`);
    for (const unsub of entry.subscribers) { try { unsub(); } catch (_e) {} }
    entry.subscribers.clear();
    try { entry.transport.close?.(); } catch (_e) {}
    this.targets.delete(targetId);
    if (this.defaultTargetId === targetId) {
      const next = this.targets.keys().next();
      this.defaultTargetId = next.done ? null : next.value;
    }
  }

  // 显式"连接重置"：把当前 target 的 connectionEpoch 递增，中止所有订阅，
  // 让在途请求回包时被判 stale。不删除 target，不取消远程任务。
  resetConnection(targetId) {
    const entry = this.targets.get(targetId);
    if (!entry) throw new Error(`target-not-found: ${targetId}`);
    entry.connectionEpoch += 1;
    for (const unsub of entry.subscribers) { try { unsub(); } catch (_e) {} }
    entry.subscribers.clear();
    entry.transport.bumpEpoch?.();
    return entry.connectionEpoch;
  }

  // 拿一个当前活跃 connectionEpoch，供 renderer 判断"这帧还是不是当前视图的"。
  currentEpoch(targetId) {
    const entry = this.targets.get(targetId);
    return entry ? entry.connectionEpoch : null;
  }
}

export function makeRemoteTransportFor(descriptor, deps) {
  if (descriptor.kind !== "remote") throw new Error("not-a-remote-descriptor");
  return new RemoteTransport({
    baseUrl: descriptor.baseUrl,
    tokenProvider: deps.tokenProvider,
    fetchImpl: deps.fetchImpl,
  });
}
