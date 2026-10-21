// F09 交互终端 PTY 状态机。
// 纯逻辑，不依赖 Vue；与 terminal-output-state.ts 同构但管理的是 PTY 生命周期，
// 不是只读回放。三车道：本文件管 terminal/* 交互通道，terminal-output-state.ts
// 管 session/terminal-output 只读回放，execution/* 一次性执行不在此。
//
// 关键约束（对齐 docs/plans/2026-10-20-terminal-interactive-design.md §3–§4）：
// - close ≠ kill：close 只拆视图，kill 停进程树
// - 断连不重发 input：input 失败不排队，直接报错
// - 退出码只在 exitObserved=true 时填，未观测禁止用 -1 冒充
// - workspaceRevision 在 create 时冻结；目录变了拒绝继续 input

export type TerminalPhase = 'idle' | 'creating' | 'running' | 'exiting' | 'exited' | 'unknown' | 'view-closed';

export type TerminalChunk = { seq: number; data: string; truncated: boolean };

export type TerminalState = {
  // Host PTY 标识，与 create 请求携带的聊天会话 ID 不同。
  sessionId: string | null;
  phase: TerminalPhase;
  cwd: string;
  workspaceRevision: string;
  cols: number;
  rows: number;
  pid: number | null;
  exitCode: number | null;
  exitObserved: boolean;
  interruptObserved: boolean;
  truncated: boolean;
  ringChunks: TerminalChunk[];
  ringCursor: number;
  more: boolean;
  busy: boolean;
  error: string;
};

// Host 回执形状（与后端设计文档 §3.1 对齐，实现时冻结 JSON shape）
export type TerminalReply = {
  sessionId?: string;
  phase?: TerminalPhase;
  cwd?: string;
  workspaceRevision?: string;
  cols?: number;
  rows?: number;
  pid?: number | null;
  exitCode?: number | null;
  exitObserved?: boolean;
  interruptObserved?: boolean;
  truncated?: boolean;
  // terminal/output 直播环分页
  chunks?: TerminalChunk[];
  nextCursor?: number;
  more?: boolean;
  failure?: string;
  diagnostic?: string;
};

export type TerminalCreateOpts = {
  sessionId: string;
  cwd: string;
  cols: number;
  rows: number;
  workspaceRevision: string;
};

// 通道函数类型（由 preload.cjs 后续提供，本文件只定接口）
export type TerminalChannels = {
  create: (opts: TerminalCreateOpts) => Promise<TerminalReply>;
  input: (sessionId: string, data: string, bytes: number) => Promise<TerminalReply>;
  resize: (sessionId: string, cols: number, rows: number) => Promise<TerminalReply>;
  interrupt: (sessionId: string) => Promise<TerminalReply>;
  describe: (sessionId: string) => Promise<TerminalReply>;
  output: (sessionId: string, cursor: number) => Promise<TerminalReply>;
  close: (sessionId: string) => Promise<TerminalReply>;
  kill: (sessionId: string) => Promise<TerminalReply>;
};

function validPhase(p: unknown): p is TerminalPhase {
  return p === 'idle' || p === 'creating' || p === 'running' || p === 'exiting' || p === 'exited' || p === 'unknown' || p === 'view-closed';
}

function applyReply(state: TerminalState, reply: TerminalReply): void {
  if (reply.phase && validPhase(reply.phase)) state.phase = reply.phase;
  if (typeof reply.cwd === 'string') state.cwd = reply.cwd;
  if (typeof reply.workspaceRevision === 'string') state.workspaceRevision = reply.workspaceRevision;
  if (Number.isInteger(reply.cols) && reply.cols! > 0) state.cols = reply.cols!;
  if (Number.isInteger(reply.rows) && reply.rows! > 0) state.rows = reply.rows!;
  if (reply.pid === null || Number.isInteger(reply.pid)) state.pid = reply.pid ?? null;
  if (reply.exitObserved === true) {
    state.exitObserved = true;
    if (Number.isInteger(reply.exitCode)) state.exitCode = reply.exitCode;
  }
  if (reply.interruptObserved === true) state.interruptObserved = true;
  if (reply.truncated === true) state.truncated = true;
}

export function createTerminalInteractive(channels: TerminalChannels, session: () => string, changed: () => void) {
  const state: TerminalState = {
    sessionId: null, phase: 'idle', cwd: '', workspaceRevision: '',
    cols: 80, rows: 24, pid: null, exitCode: null,
    exitObserved: false, interruptObserved: false, truncated: false,
    ringChunks: [], ringCursor: 0, more: false, busy: false, error: '',
  };
  let epoch = 0, disposed = false;
  const notify = () => { if (!disposed) changed(); };

  function reset(): void {
    ++epoch;
    Object.assign(state, {
      sessionId: null, phase: 'idle', cwd: '', workspaceRevision: '',
      cols: 80, rows: 24, pid: null, exitCode: null,
      exitObserved: false, interruptObserved: false, truncated: false,
      ringChunks: [], ringCursor: 0, more: false, busy: false, error: '',
    });
    notify();
  }

  // terminal/create：授权后 spawn PTY
  async function create(cols: number, rows: number, directory: string, workspaceRevision: string): Promise<void> {
    if (disposed || state.busy) return;
    if (state.phase !== 'idle' && state.phase !== 'exited' && state.phase !== 'unknown' && state.phase !== 'view-closed') {
      state.error = '当前终端仍在运行，不能重复 create。'; notify(); return;
    }
    if (!Number.isInteger(cols) || cols < 1 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) {
      state.error = '终端尺寸无效；cols 1–500，rows 1–200。'; notify(); return;
    }
    const ticket = ++epoch, sid = session();
    state.busy = true; state.error = ''; state.phase = 'creating';
    state.cols = cols; state.rows = rows;
    notify();
    try {
      const reply = await channels.create({ sessionId: sid, cwd: directory, cols, rows, workspaceRevision });
      if (disposed || ticket !== epoch) return;
      if (reply.failure) throw Error(reply.failure || reply.diagnostic || 'terminal/create 失败。');
      if (typeof reply.sessionId !== 'string' || !reply.sessionId.trim()) throw Error('Host 未返回有效的 PTY sessionId。');
      state.sessionId = reply.sessionId;
      state.phase = 'running';
      state.cwd = reply.cwd || directory;
      state.workspaceRevision = reply.workspaceRevision || workspaceRevision;
      state.exitObserved = false; state.exitCode = null; state.interruptObserved = false;
      state.truncated = false; state.ringChunks = []; state.ringCursor = 0; state.more = false;
      applyReply(state, reply);
    } catch (e) {
      if (ticket === epoch && !disposed) { state.error = String((e as Error).message || e); state.phase = 'idle'; }
    } finally {
      if (ticket === epoch && !disposed) { state.busy = false; notify(); }
    }
  }

  // terminal/input：写入字节（含 Ctrl 字符）。断连不重发，失败不排队。
  async function writeInput(data: string): Promise<void> {
    if (disposed || !state.sessionId || state.phase !== 'running') return;
    if (!data) return;
    // 单帧上限 4 KiB（后端设计文档 §3.3）
    const bytes = new TextEncoder().encode(data).length;
    if (bytes > 4096) { state.error = '单帧输入超过 4 KiB 限制。'; notify(); return; }
    try {
      const reply = await channels.input(state.sessionId, data, bytes);
      if (disposed) return;
      if (reply.failure) { state.error = reply.failure || reply.diagnostic || 'terminal/input 失败。'; notify(); }
    } catch (e) {
      if (!disposed) { state.error = String((e as Error).message || e); notify(); }
    }
  }

  // terminal/resize：cols/rows → 内核 winsize。仅 running 时有效。
  async function resize(cols: number, rows: number): Promise<void> {
    if (disposed || !state.sessionId || state.phase !== 'running') return;
    if (!Number.isInteger(cols) || cols < 1 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) return;
    if (cols === state.cols && rows === state.rows) return;
    try {
      const reply = await channels.resize(state.sessionId, cols, rows);
      if (disposed) return;
      if (reply.failure) { state.error = reply.failure || reply.diagnostic || 'terminal/resize 失败。'; notify(); return; }
      state.cols = cols; state.rows = rows;
      applyReply(state, reply);
      notify();
    } catch (e) {
      if (!disposed) { state.error = String((e as Error).message || e); notify(); }
    }
  }

  // terminal/interrupt：向进程组发中断。回执是 interrupt-requested，是否退出看后续 describe。
  async function interrupt(): Promise<void> {
    if (disposed || !state.sessionId || state.phase !== 'running') return;
    try {
      const reply = await channels.interrupt(state.sessionId);
      if (disposed) return;
      if (reply.failure) { state.error = reply.failure || reply.diagnostic || 'terminal/interrupt 失败。'; notify(); return; }
      state.interruptObserved = true;
      applyReply(state, reply);
      notify();
    } catch (e) {
      if (!disposed) { state.error = String((e as Error).message || e); notify(); }
    }
  }

  // terminal/describe：查 cwd、尺寸、相位、pid、exit 事实
  async function describe(): Promise<void> {
    if (disposed || !state.sessionId) return;
    try {
      const reply = await channels.describe(state.sessionId);
      if (disposed) return;
      if (reply.failure) { state.error = reply.failure || reply.diagnostic || 'terminal/describe 失败。'; notify(); return; }
      applyReply(state, reply);
      notify();
    } catch (e) {
      if (!disposed) { state.error = String((e as Error).message || e); notify(); }
    }
  }

  // terminal/output：直播环分页（cursor=字节或序号）。与 turn/poll 同构，防 notify 丢。
  async function pollOutput(): Promise<void> {
    if (disposed || !state.sessionId || state.phase !== 'running') return;
    if (state.busy) return;
    const ticket = epoch;
    try {
      const reply = await channels.output(state.sessionId, state.ringCursor);
      if (disposed || ticket !== epoch) return;
      if (reply.failure) return; // poll 失败不报错，下次重试
      if (!Array.isArray(reply.chunks)) return;
      // seq 单调校验
      let prev = state.ringCursor - 1;
      for (const chunk of reply.chunks) {
        if (!Number.isSafeInteger(chunk.seq) || chunk.seq <= prev) return;
        prev = chunk.seq;
      }
      if (reply.chunks.length) {
        state.ringChunks = [...state.ringChunks, ...reply.chunks].slice(-512); // 前端环保留最近 512 块
      }
      if (Number.isSafeInteger(reply.nextCursor) && reply.nextCursor > state.ringCursor) {
        state.ringCursor = reply.nextCursor;
      }
      state.more = !!reply.more;
      if (reply.truncated) state.truncated = true;
      applyReply(state, reply);
      notify();
    } catch {
      // poll 失败静默，不设 error（避免刷屏）
    }
  }

  // terminal/close：只拆订阅/渲染，不 kill。phase → view-closed
  async function closeView(): Promise<void> {
    if (disposed || !state.sessionId) return;
    const id = state.sessionId;
    try {
      const reply = await channels.close(id);
      if (disposed) return;
      if (reply.failure) { state.error = reply.failure || reply.diagnostic || 'terminal/close 失败。'; notify(); return; }
      state.phase = 'view-closed';
      notify();
    } catch (e) {
      if (!disposed) { state.error = String((e as Error).message || e); notify(); }
    }
  }

  // terminal/kill：停自有进程树。phase → exiting，等 describe 确认 exited。
  async function kill(): Promise<void> {
    if (disposed || !state.sessionId) return;
    if (state.phase === 'exited' || state.phase === 'view-closed') return;
    const id = state.sessionId;
    state.phase = 'exiting';
    notify();
    try {
      const reply = await channels.kill(id);
      if (disposed) return;
      if (reply.failure) { state.error = reply.failure || reply.diagnostic || 'terminal/kill 失败。'; notify(); return; }
      applyReply(state, reply);
      // kill 回执可能直接带 exitObserved
      if (state.exitObserved) state.phase = 'exited';
      notify();
    } catch (e) {
      if (!disposed) { state.error = String((e as Error).message || e); notify(); }
    }
  }

  // 消费并清空已缓冲的 chunks（xterm.write 后调用）
  function consumeChunks(): TerminalChunk[] {
    const chunks = state.ringChunks;
    state.ringChunks = [];
    return chunks;
  }

  function dispose(): void {
    disposed = true;
    ++epoch;
  }

  return { state, reset, create, writeInput, resize, interrupt, describe, pollOutput, closeView, kill, consumeChunks, dispose };
}
