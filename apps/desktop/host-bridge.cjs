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
  }

  start(cwd) {
    this.proc = spawn(this.hostPath, [], { cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (d) => this.#onData(d.toString("utf8")));
    this.proc.stderr.on("data", (d) => process.stderr.write(`[host] ${d}`));
    this.proc.on("exit", (code, signal) => {
      // 宿主进程退出时，所有在途请求必须立刻失败，不能让调用方等到超时
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      for (const [, p] of this.pending) p.rej(new Error(`host-gone: ${why}`));
      this.pending.clear();
    });
    this.proc.on("error", (e) => {
      for (const [, p] of this.pending) p.rej(new Error(`host-spawn-error: ${e.message}`));
      this.pending.clear();
    });
    return new Promise((res, rej) => {
      this.proc.once("spawn", () => res());
      this.proc.once("error", rej);
    });
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
        this.pending.delete(String(msg.id));
        msg.error ? p.rej(new Error(`${msg.error.code} ${msg.error.message}`)) : p.res(msg.result);
      }
    }
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((res, rej) => {
      this.pending.set(String(id), { res, rej });
      this.proc.stdin.write(body + "\n");
      setTimeout(() => {
        if (this.pending.delete(String(id))) rej(new Error(`timeout: ${method}`));
      }, 5000).unref();
    });
  }

  stop() {
    if (this.proc && !this.proc.killed) this.proc.stdin.end(), this.proc.kill();
  }
}

module.exports = { HostBridge };
