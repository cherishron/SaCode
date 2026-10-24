// Host NDJSON JSON-RPC 客户端（TUI 版）。
// 与 apps/desktop/host-bridge.cjs 同协议、同错误语义；差别只有三点：
//   1. 通知走监听器，不再只往数组里堆；
//   2. 宿主的 stderr 只留尾部，不直接写终端（否则会撕坏 Ink 画面）；
//   3. 面向终端用户把可操作的失败原因带在 Error.message 里。
import { spawn } from "node:child_process";
import { hostSpawnEnv } from "./host-path.mjs";

const STDERR_TAIL_LINES = 40;

export class HostClient {
  constructor(hostPath, { cwd = process.cwd(), env = process.env, args = [] } = {}) {
    this.hostPath = hostPath;
    this.cwd = cwd;
    this.env = env;
    this.args = args;
    this.buf = "";
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.stderrTail = [];
    this.proc = null;
    this.failure = null;
  }

  start() {
    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) {
      return Promise.reject(new Error("host-already-running"));
    }
    this.#fail(new Error("host-restarted"));
    this.failure = null;
    this.buf = "";
    this.stderrTail.length = 0;
    const proc = spawn(this.hostPath, this.args, {
      cwd: this.cwd,
      env: hostSpawnEnv(this.env, this.hostPath),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;
    // 由流的增量解码器保留跨块 UTF-8 字节；不能逐块 Buffer.toString，
    // 否则中文正文/路径被切开时会变成替换字符，甚至改变审批参数展示。
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    const current = () => this.proc === proc;
    proc.stdin.on("error", (error) => {
      if (current()) this.#fail(new Error(`host-write-error: ${error.code || error.message}`));
    });
    proc.stdout.on("data", (data) => {
      if (current()) this.#onData(data);
    });
    proc.stderr.on("data", (data) => {
      if (!current()) return;
      for (const line of data.split(/\r?\n/)) {
        if (!line) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
      }
    });
    proc.on("exit", (code, signal) => {
      if (!current()) return;
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.#fail(new Error(`host-gone: ${why}`));
    });
    proc.on("error", (error) => {
      if (!current()) return;
      this.#fail(new Error(`host-spawn-error: ${error.message}`));
    });
    return new Promise((res, rej) => {
      proc.once("spawn", () => res());
      proc.once("error", rej);
    });
  }

  #fail(error) {
    this.failure = error;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  #onData(text) {
    this.buf += text;
    let index;
    while ((index = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, index).trim();
      this.buf = this.buf.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined) {
        for (const listener of this.listeners) {
          try {
            listener(message);
          } catch {
            // 单个监听器出错不能拖垮协议读循环。
          }
        }
        continue;
      }
      const pending = this.pending.get(String(message.id));
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error) {
        const error = new Error(`${message.error.code} ${message.error.message}`);
        if (message.error.data !== undefined) error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    }
  }

  // timeoutMs 默认 5 秒；起轮/结算这类天生更慢的调用由调用方显式给有界值。
  request(method, params = {}, timeoutMs = 5000) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.proc || this.proc.exitCode !== null || this.proc.signalCode !== null
      || this.proc.stdin.destroyed || this.proc.stdin.writableEnded) {
      return Promise.reject(new Error("host-unavailable"));
    }
    const id = this.nextId++;
    const proc = this.proc;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const window = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
      const timer = setTimeout(() => {
        if (this.pending.delete(String(id))) reject(new Error(`timeout: ${method}`));
      }, window);
      timer.unref?.();
      this.pending.set(String(id), { resolve, reject, timer });
      try {
        proc.stdin.write(body + "\n", (error) => {
          if (error && this.proc === proc) this.#fail(new Error(`host-write-error: ${error.code || error.message}`));
        });
      } catch (error) {
        this.#fail(new Error(`host-write-error: ${error.code || error.message}`));
      }
    });
  }

  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 优雅退出：关闭 stdin 触发宿主 EOF 结算路径（未 flush 的写入落盘并归还租约）。
  async stop(timeoutMs = 10000) {
    const proc = this.proc;
    if (!proc) return { code: null, signal: null, forced: false };
    const exited = new Promise((resolve) => proc.once("exit", (code, signal) => resolve({ code, signal })));
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return { code: proc.exitCode, signal: proc.signalCode, forced: false };
    }
    proc.stdin.end();
    let timer;
    const win = await Promise.race([
      exited,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (win !== null) return { ...win, forced: false };
    proc.kill();
    const late = await exited;
    return { ...late, forced: true };
  }

  // process "exit" 里没法 await：宁可强杀也不留孤儿宿主。
  killNow() {
    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill();
  }

  get stderrText() {
    return this.stderrTail.join("\n");
  }
}
