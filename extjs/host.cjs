// JS 扩展宿主：注册表 + 监听登记 + 在途调用结算。独立于任何桌面壳，可被 CLI 与 Host 复用。
"use strict";
const { resolve: jresolve, isAbsolute: jabs } = require("node:path");

class ExtHost {
  #tools = new Map();
  #listeners = new Map();
  #handles = new Map();
  #pending = new Map();
  // 外部 callId → 调用记录；记录包含所属扩展、abort 控制器、工作 promise 和结算状态。
  #byExt = new Map();
  #nextListener = 1;
  #nextCall = 1;
  #closed = false;

  async load(modulePath) {
    if (this.#closed) throw new Error("host-exiting");
    let mod;
    const abs = jabs(modulePath) ? modulePath : jresolve(__dirname, modulePath);
    try { mod = require(abs); }
    catch (e) { throw new Error(`load-error: ${e.message}`); }
    if (!mod || typeof mod.name !== "string" || !mod.name.trim() || typeof mod.handler !== "function") {
      throw new Error("load-error: extension must export {name, description, params, handler}");
    }
    // 初始化也占据名称；只有完整初始化成功后，工具才进入可调用目录。
    if (this.#handles.has(mod.name)) return false;
    const owner = { live: true, ids: [] };
    this.#handles.set(mod.name, owner);
    try {
      if (typeof mod.setup === "function") {
        await mod.setup({
          on: (event, cb) => {
            if (this.#closed) throw new Error("host-exiting");
            if (!owner.live || this.#handles.get(mod.name) !== owner) throw new Error("extension-disposed");
            if (typeof event !== "string" || typeof cb !== "function") throw new Error("invalid-listener");
            const id = this.#nextListener++;
            this.#listeners.set(id, { event, cb }); owner.ids.push(id);
            return id;
          },
        });
      }
      if (this.#closed) throw new Error("host-exiting");
      if (!owner.live || this.#handles.get(mod.name) !== owner) throw new Error("extension-disposed");
      this.#tools.set(mod.name, {
        name: mod.name, description: mod.description || "", params: mod.params || "", handler: mod.handler,
      });
      return true;
    } catch (error) {
      owner.live = false;
      for (const id of owner.ids) this.#listeners.delete(id);
      if (this.#handles.get(mod.name) === owner) this.#handles.delete(mod.name);
      throw error;
    }
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
    const ac = new AbortController();
    const record = { id, name, key, reject: rejectExiting, ac, work: null, settled: false };
    this.#pending.set(id, record);
    if (key !== null) this.#byExt.set(key, record);
    // 在受 finally 保护的 promise 内调用，同步异常同样释放所有账目。
    const work = record.work = Promise.resolve().then(() => {
      if (ac.signal.aborted) throw new Error("cancelled-before-handler");
      return t.handler(args || {}, { signal: ac.signal });
    });
    try {
      return await Promise.race([work, exiting]);
    } finally {
      this.#pending.delete(id);
      // 取消后调用方可能重用 callId；旧调用结算不能删除新调用的句柄。
      if (key !== null && this.#byExt.get(key) === record) this.#byExt.delete(key);
    }
  }

  #stop(record, reason, settleMs = 200) {
    if (record.settled) return;
    record.settled = true;
    if (record.key !== null && this.#byExt.get(record.key) === record) this.#byExt.delete(record.key);
    // 先拒绝等待者，再送达 abort，协作的迟到返回不能抢成成功。
    record.reject(new Error(reason));
    record.ac.abort();
    this.#watchSettle(record.key ?? `internal-${record.id}`, record.work, settleMs);
  }

  // 取消做两件事：给扩展发 abort，并结算等待者——然后如实记账「扩展到底停了没有」。
  // cancelled 的语义只有「这条在途调用被结算了」，它不代表副作用已停止：
  // 停止与否取决于扩展读不读 ctx.signal，所以收束情况单独记到诊断面，不塞进应答帧
  // （应答帧一旦要等收束观察，就会晚于那条 call 自己的结算帧，破坏既有帧序）。
  // 迟到的 handler 结果因为 race 已定而不会再补一帧。
  cancel(callId, opts = {}) {
    const key = callId === undefined || callId === null ? null : String(callId);
    if (key === null) return false;
    const record = this.#byExt.get(key);
    if (!record) return false;
    this.#stop(record, `cancelled: ${callId}`, opts.settleMs === undefined ? 200 : opts.settleMs);
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
    const owner = this.#handles.get(name);
    if (!owner) return false;
    owner.live = false;
    this.#tools.delete(name);
    for (const id of owner.ids) this.#listeners.delete(id);
    this.#handles.delete(name);
    for (const record of this.#pending.values()) {
      if (record.name === name) this.#stop(record, `extension-disposed: ${name}`);
    }
    return true;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const owner of this.#handles.values()) owner.live = false;
    for (const record of this.#pending.values()) this.#stop(record, "host-exiting");
    this.#pending.clear(); this.#byExt.clear(); this.#tools.clear();
    this.#listeners.clear(); this.#handles.clear();
  }

  listenerCount() {
    return this.#listeners.size;
  }

  pendingCount() {
    return this.#pending.size;
  }
}

module.exports = { ExtHost };
