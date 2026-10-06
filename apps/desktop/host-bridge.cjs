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
    this.failure = null;
    this.buf = "";
    this.proc = spawn(this.hostPath, [], { cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdin.on("error", (e) => this.#fail(new Error(`host-write-error: ${e.code || e.message}`)));
    this.proc.stdout.on("data", (d) => this.#onData(d.toString("utf8")));
    this.proc.stderr.on("data", (d) => process.stderr.write(`[host] ${d}`));
    this.proc.on("exit", (code, signal) => {
      // 宿主进程退出时，所有在途请求必须立刻失败，不能让调用方等到超时
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.#fail(new Error(`host-gone: ${why}`));
    });
    this.proc.on("error", (e) => {
      this.#fail(new Error(`host-spawn-error: ${e.message}`));
    });
    return new Promise((res, rej) => {
      this.proc.once("spawn", () => res());
      this.proc.once("error", rej);
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
        msg.error ? p.rej(new Error(`${msg.error.code} ${msg.error.message}`)) : p.res(msg.result);
      }
    }
  }

  request(method, params = {}) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.proc || this.proc.exitCode !== null || this.proc.signalCode !== null || this.proc.stdin.destroyed || this.proc.stdin.writableEnded) {
      return Promise.reject(new Error("host-unavailable"));
    }
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(String(id))) rej(new Error(`timeout: ${method}`));
      }, 5000).unref();
      this.pending.set(String(id), { res, rej, timer });
      try {
        this.proc.stdin.write(body + "\n", (error) => {
          if (error) this.#fail(new Error(`host-write-error: ${error.code || error.message}`));
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
