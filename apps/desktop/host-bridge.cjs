// Host 协议桥：一行一报文（NDJSON）的 JSON-RPC 2.0 客户端。
// Electron 主进程与纯 Node 测试共用同一份实现，避免两套通信代码。
const { spawn } = require("node:child_process");

class HostBridge {
  constructor(hostPath, env = process.env) {
    this.hostPath = hostPath;
    this.env = env;
    this.buf = "";
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.proc = null;
    this.failure = null;
  }

  start(cwd) {
    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null
      && (!this.failure || this.proc.pid != null)) {
      return Promise.reject(new Error("host-already-running"));
    }
    this.#fail(new Error("host-restarted"));
    this.failure = null;
    this.buf = "";
    this.notifications.length = 0;
    const proc = spawn(this.hostPath, [], { cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    const current = () => this.proc === proc;
    proc.stdin.on("error", (e) => { if (current()) this.#fail(new Error(`host-write-error: ${e.code || e.message}`)); });
    proc.stdout.on("data", (d) => { if (current()) this.#onData(d.toString("utf8")); });
    proc.stderr.on("data", (d) => { if (current()) process.stderr.write(`[host] ${d}`); });
    proc.on("exit", (code, signal) => {
      if (!current()) return;
      // 宿主进程退出时，所有在途请求必须立刻失败，不能让调用方等到超时
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.#fail(new Error(`host-gone: ${why}`));
    });
    proc.on("error", (e) => {
      if (!current()) return;
      this.#fail(new Error(`host-spawn-error: ${e.message}`));
    });
    return new Promise((res, rej) => {
      proc.once("spawn", () => res());
      proc.once("error", rej);
    });
  }

  #fail(error) {
    this.failure = error;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.rej(error); }
    this.pending.clear();
  }

  #onData(text) {
    this.buf += text;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id === undefined) { this.notifications.push(msg); continue; }
      const p = this.pending.get(String(msg.id));
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(String(msg.id));
        if (msg.error) {
          // error.data 是宿主给的结构化失败说明（比如 LSP 的 reason 与非语义回退线索）。
          // 只留 code+message 就等于把「没插件」和「插件报错了」压成同一句话，
          // 界面再也答不出该找谁。原来读 message 的调用方一字不改。
          const failure = new Error(`${msg.error.code} ${msg.error.message}`);
          if (msg.error.data !== undefined) failure.data = msg.error.data;
          p.rej(failure);
        } else {
          p.res(msg.result);
        }
      }
    }
  }

  // timeoutMs 默认 5 秒：常规投影/起轮类调用都在这个量级内该回。
  // 但有些调用天生更慢（worktree/enter 要走 git 建树，PR 入口按契约最长等 30 秒抓取），
  // 由调用方显式给一个有界值，而不是把全局默认抬高——全局默认抬高会同时把真卡死的调用放更久。
  request(method, params = {}, timeoutMs = 5000) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.proc || this.proc.exitCode !== null || this.proc.signalCode !== null || this.proc.stdin.destroyed || this.proc.stdin.writableEnded) {
      return Promise.reject(new Error("host-unavailable"));
    }
    const id = this.nextId++;
    const proc = this.proc;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((res, rej) => {
      // 非整数/非正数一律回到默认窗口，别让一个写坏的参数把请求变成「立刻超时」。
      const timer = setTimeout(() => {
        if (this.pending.delete(String(id))) rej(new Error(`timeout: ${method}`));
      }, Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000).unref();
      this.pending.set(String(id), { res, rej, timer });
      try {
        proc.stdin.write(body + "\n", (error) => {
          if (error && this.proc === proc) this.#fail(new Error(`host-write-error: ${error.code || error.message}`));
        });
      } catch (error) {
        this.#fail(new Error(`host-write-error: ${error.code || error.message}`));
      }
    });
  }

  // 优雅退出：关闭 stdin 触发 Host 的 EOF 结算路径（未 flush 的写入在此落盘并归还租约），
  // 等到进程真正退出；超时才强杀，并把强杀结果如实报出来。
  async stop(timeoutMs = 3000) {
    const p = this.proc;
    if (!p) return { code: null, signal: null, forced: false };
    const exited = new Promise((res) => p.once("exit", (code, signal) => res({ code, signal })));
    if (p.exitCode !== null || p.signalCode !== null) return { code: p.exitCode, signal: p.signalCode, forced: false };
    p.stdin.end();
    const win = await Promise.race([exited, new Promise((res) => setTimeout(() => res(null), timeoutMs))]);
    if (win !== null) return { ...win, forced: false };
    p.kill();
    const late = await exited;
    return { ...late, forced: true };
  }

  // 只给同步兜底用（process "exit" 里没法 await）：宁可强杀也不留孤儿宿主
  killNow() {
    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill();
  }
}

module.exports = { HostBridge };
