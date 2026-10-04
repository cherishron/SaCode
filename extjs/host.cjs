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
  // 外部 callId → 该次的 abort 控制器与 handler promise：取消不只是放弃等待，
  // 还得把「可以停了」交给扩展，并且有机会如实回报它到底停没停。
  #signals = new Map();
  #work = new Map();
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
    // 第二参数是给扩展的协作面：不读 ctx 的旧扩展零改动，读得到的才能在取消前收手。
    const ac = new AbortController();
    const work = Promise.resolve(t.handler(args || {}, { signal: ac.signal }));
    if (key !== null) {
      this.#signals.set(key, ac);
      this.#work.set(key, work);
    }
    try {
      return await Promise.race([work, exiting]);
    } finally {
      this.#pending.delete(id);
      if (key !== null) {
        this.#byExt.delete(key);
        this.#signals.delete(key);
        this.#work.delete(key);
      }
    }
  }

  // 取消做两件事：给扩展发 abort，并结算等待者——然后如实记账「扩展到底停了没有」。
  // cancelled 的语义只有「这条在途调用被结算了」，它不代表副作用已停止：
  // 停止与否取决于扩展读不读 ctx.signal，所以收束情况单独记到诊断面，不塞进应答帧
  // （应答帧一旦要等收束观察，就会晚于那条 call 自己的结算帧，破坏既有帧序）。
  // 迟到的 handler 结果因为 race 已定而不会再补一帧。
  cancel(callId, opts = {}) {
    const key = callId === undefined || callId === null ? null : String(callId);
    if (key === null) return false;
    const rej = this.#byExt.get(key);
    if (!rej) return false;
    // 先取句柄再结算：等待者一被 reject，call() 的 finally 就会把这两条清掉
    const ac = this.#signals.get(key);
    const work = this.#work.get(key);
    this.#byExt.delete(key);
    if (ac) ac.abort();
    rej(new Error(`cancelled: ${callId}`));
    if (work) this.#watchSettle(key, work, opts.settleMs === undefined ? 200 : opts.settleMs);
    return true;
  }

  // 有界观察 handler 是否真收束了；不协作的扩展记成 still-running，而不是替它假定「已停止」。
  // 诊断走 stderr：stdout 只走协议帧。
  #watchSettle(key, work, settleMs) {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) process.stderr.write(`cancel-settle callId=${key} outcome=still-running\n`);
    }, settleMs);
    timer.unref();
    work.then(
      () => { done = true; process.stderr.write(`cancel-settle callId=${key} outcome=settled\n`); },
      () => { done = true; process.stderr.write(`cancel-settle callId=${key} outcome=settled\n`); }
    );
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
    this.#signals.clear();
    this.#work.clear();
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
