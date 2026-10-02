// JS 扩展宿主：注册表 + 监听登记 + 在途调用结算。独立于任何桌面壳，可被 CLI 与 Host 复用。
"use strict";
const { resolve: jresolve, isAbsolute: jabs } = require("node:path");

class ExtHost {
  #tools = new Map();
  #listeners = new Map();
  #handles = new Map();
  #pending = new Map();
  // 外部 callId → 结算函数：取消要落在「那一次调用」上，所以按调用方给的键另建一张表。
  #byExt = new Map();
  #nextListener = 1;
  #nextCall = 1;
  #closed = false;

  async load(modulePath) {
    let mod;
    const abs = jabs(modulePath) ? modulePath : jresolve(__dirname, modulePath);
    try {
      mod = require(abs);
    } catch (e) {
      throw new Error(`load-error: ${e.message}`);
    }
    if (!mod || typeof mod.name !== "string" || typeof mod.handler !== "function") {
      throw new Error("load-error: extension must export {name, description, params, handler}");
    }
    if (this.#tools.has(mod.name)) return false;
    this.#tools.set(mod.name, {
      name: mod.name,
      description: mod.description || "",
      params: mod.params || "",
      handler: mod.handler,
    });
    this.#handles.set(mod.name, []);
    if (typeof mod.setup === "function") {
      mod.setup({
        on: (event, cb) => {
          const id = this.#nextListener++;
          this.#listeners.set(id, { event, cb });
          this.#handles.get(mod.name).push(id);
          return id;
        },
      });
    }
    return true;
  }

  list() {
    return [...this.#tools.keys()];
  }

  describe(name) {
    const t = this.#tools.get(name);
    if (!t) return null;
    return { name: t.name, description: t.description, params: t.params };
  }

  async call(name, args, callId) {
    const t = this.#tools.get(name);
    if (!t) throw new Error(`unknown-tool: ${name}`);
    if (this.#closed) throw new Error("host-exiting");
    const key = callId === undefined || callId === null ? null : String(callId);
    // 同一 callId 两笔在途 = 调用方配对逻辑已经错了，明确拒绝，不把两笔混成一笔
    if (key !== null && this.#byExt.has(key)) throw new Error(`duplicate-callId: ${callId}`);
    const id = this.#nextCall++;
    let rejectExiting;
    const exiting = new Promise((_, rej) => {
      rejectExiting = rej;
    });
    this.#pending.set(id, rejectExiting);
    if (key !== null) this.#byExt.set(key, rejectExiting);
    try {
      return await Promise.race([Promise.resolve(t.handler(args || {})), exiting]);
    } finally {
      this.#pending.delete(id);
      if (key !== null) this.#byExt.delete(key);
    }
  }

  // 只结算仍在这条 callId 上的在途调用；已经结算或从来没登记过都回 false，
  // 绝不假装「取消成功了」。迟到的 handler 结果因为 race 已定而不会再补一帧。
  cancel(callId) {
    const key = callId === undefined || callId === null ? null : String(callId);
    if (key === null) return false;
    const rej = this.#byExt.get(key);
    if (!rej) return false;
    this.#byExt.delete(key);
    rej(new Error(`cancelled: ${callId}`));
    return true;
  }

  dispose(name) {
    if (!this.#tools.has(name)) return false;
    this.#tools.delete(name);
    for (const id of this.#handles.get(name) || []) this.#listeners.delete(id);
    this.#handles.delete(name);
    return true;
  }

  close() {
    this.#closed = true;
    for (const reject of this.#pending.values()) reject(new Error("host-exiting"));
    this.#pending.clear();
    this.#byExt.clear();
    this.#listeners.clear();
    this.#handles.clear();
  }

  listenerCount() {
    return this.#listeners.size;
  }

  pendingCount() {
    return this.#pending.size;
  }
}

module.exports = { ExtHost };
