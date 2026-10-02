/** Tauri WebView bridge — daemon HTTP/SSE never carry bearer token in the renderer. */

import { terminalDimensions } from '../logic/terminal-input.ts';

export interface SidecarHandleDto {
  host: string;
  port: number;
  base_url: string;
  pid: number;
  auth_required: boolean;
  version?: string;
  workspace: string;
}

export interface DaemonProxyResponse {
  status: number;
  ok: boolean;
  body: string;
}

export interface DaemonEventPayload {
  event: string;
  id?: string;
  task_id?: string;
  data: unknown;
}

export interface TerminalStartDto {
  terminal_id: string;
  shell: string;
  workspace: string;
  pid: number | null;
}

export interface TerminalOutputPayload {
  terminal_id: string;
  /** Raw PTY output — ANSI/CSI escapes included. Never stripped at this layer. */
  data: string;
}

export interface TerminalExitPayload {
  terminal_id: string;
  code: number | null;
  signal: string | null;
  reason: 'exited' | 'closed' | 'error';
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

type ListenFn = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

interface TauriGlobal {
  __TAURI__?: {
    // Tauri v2 exposes invoke under `core`; keep the top-level fallback for
    // compatibility with older global API shapes.
    core?: { invoke?: InvokeFn };
    invoke?: InvokeFn;
    event?: { listen?: ListenFn };
  };
}

function tauriApi(): TauriGlobal['__TAURI__'] | null {
  return (globalThis as unknown as TauriGlobal).__TAURI__ ?? null;
}

function getInvoke(): InvokeFn | null {
  const api = tauriApi();
  return api?.core?.invoke ?? api?.invoke ?? null;
}

export function isTauri(): boolean {
  return getInvoke() !== null;
}

/** Native PTY requires both IPC commands and the Tauri event stream. */
export function isNativeTerminalAvailable(): boolean {
  return getInvoke() !== null && typeof tauriApi()?.event?.listen === 'function';
}

/** Returns null in browser-only development, where no native PTY exists. */
export async function startTerminal(rows = 24, cols = 80, cwd?: string): Promise<TerminalStartDto | null> {
  if (!isNativeTerminalAvailable()) return null;
  return (await getInvoke()!('terminal_start', {
    rows, cols, ...(cwd !== undefined ? { cwd } : {}),
  })) as TerminalStartDto;
}

export async function writeTerminal(terminalId: string, data: string): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  await invoke('terminal_write', { terminalId, data });
  return true;
}

export async function resizeTerminal(
  terminalId: string,
  rows: number,
  cols: number,
): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  await invoke('terminal_resize', { terminalId, rows, cols });
  return true;
}

export async function closeTerminal(terminalId: string): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  await invoke('terminal_close', { terminalId });
  return true;
}

/**
 * Push a pixel-box size to the native PTY. Call this from panel/container
 * resize. `charWidth`/`lineHeight` are font metrics in CSS pixels.
 */
export async function syncTerminalSize(
  terminalId: string,
  widthPx: number,
  heightPx: number,
  charWidth: number,
  lineHeight: number,
): Promise<boolean> {
  const { cols, rows } = terminalDimensions(widthPx, heightPx, charWidth, lineHeight);
  return resizeTerminal(terminalId, rows, cols);
}

/**
 * Subscribe to raw PTY output. Pass `terminalId` to receive only that
 * session's events (multi-instance routing); omit to receive all.
 */
export async function listenTerminalOutput(
  handler: (payload: TerminalOutputPayload) => void,
  terminalId?: string,
): Promise<() => void> {
  const listen = tauriApi()?.event?.listen;
  if (!listen) return () => {};
  return listen('terminal-output', (event) => {
    const payload = event.payload as TerminalOutputPayload;
    if (terminalId !== undefined && payload.terminal_id !== terminalId) return;
    handler(payload);
  });
}

/**
 * Subscribe to PTY exit events. Pass `terminalId` to receive only that
 * session's events; omit to receive all.
 */
export async function listenTerminalExit(
  handler: (payload: TerminalExitPayload) => void,
  terminalId?: string,
): Promise<() => void> {
  const listen = tauriApi()?.event?.listen;
  if (!listen) return () => {};
  return listen('terminal-exit', (event) => {
    const payload = event.payload as TerminalExitPayload;
    if (terminalId !== undefined && payload.terminal_id !== terminalId) return;
    handler(payload);
  });
}

export async function startDaemon(workspace?: string): Promise<SidecarHandleDto> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('not running under Tauri');
  return (await invoke('start_daemon', workspace ? { workspace } : {})) as SidecarHandleDto;
}

export async function selectWorkspaceFolder(): Promise<string | null> {
  const invoke = getInvoke();
  if (!invoke) return window.prompt('输入项目文件夹绝对路径')?.trim() || null;
  return (await invoke('select_workspace_folder')) as string | null;
}

export async function stopDaemon(): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('not running under Tauri');
  await invoke('stop_daemon');
}

export async function daemonInfo(): Promise<SidecarHandleDto | null> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('not running under Tauri');
  return (await invoke('daemon_info')) as SidecarHandleDto | null;
}

/** 切换系统托盘（关闭窗口时隐藏到托盘而非退出）。非 Tauri 环境返回 false。 */
export async function setTrayEnabled(enabled: boolean): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  return (await invoke('set_tray_enabled', { enabled })) as boolean;
}

/** 切换开机自启动。非 Tauri 环境为静默 no-op。返回壳侧真实结果；失败抛错。 */
export async function setAutostart(enabled: boolean): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  return (await invoke('set_autostart', { enabled })) as boolean;
}

export interface SystemIntegrationStatus {
  tray_enabled: boolean;
  autostart_enabled: boolean;
}

/** 查询托盘 / 自启的壳侧真实状态；非 Tauri 返回 null。 */
export async function getSystemIntegrationStatus(): Promise<SystemIntegrationStatus | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    return (await invoke('system_integration_status')) as SystemIntegrationStatus;
  } catch {
    return null;
  }
}

export async function daemonProxy(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: string,
): Promise<DaemonProxyResponse> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('not running under Tauri');
  return (await invoke('daemon_proxy', {
    method,
    path,
    ...(body !== undefined ? { body } : {}),
  })) as DaemonProxyResponse;
}

export async function startEventBridge(taskId?: string): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('not running under Tauri');
  await invoke('start_event_bridge', taskId ? { taskId } : {});
}

/** `git_workspace_status` 返回结构：分支名 + porcelain -z 原始字节 */
export interface GitWorkspaceStatus {
  branch: string | null;
  porcelain: string;
}

/**
 * 获取工作区 git 状态（`git status --porcelain=v1 -z --branch` 原始输出）。
 * 非 Tauri 环境返回 null；git 不可用 / 非 git 仓库时抛错（调用方降级展示）。
 */
export async function gitWorkspaceStatus(): Promise<GitWorkspaceStatus | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  return (await invoke('git_workspace_status')) as GitWorkspaceStatus;
}

/**
 * 获取工作区 unified diff 文本。
 * @param cached true = `git diff --cached`（暂存区 vs HEAD）
 * @param path 可选，仅取单个文件的 diff
 */
export async function gitWorkspaceDiff(
  cached = false,
  path?: string,
): Promise<string | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  return (await invoke('git_workspace_diff', { cached, ...(path ? { path } : {}) })) as string;
}

export async function listenDaemonEvents(
  handler: (payload: DaemonEventPayload) => void,
): Promise<() => void> {
  const listen = tauriApi()?.event?.listen;
  if (!listen) throw new Error('Tauri event.listen unavailable');
  return listen('daemon-event', (event) => {
    handler(event.payload as DaemonEventPayload);
  });
}
