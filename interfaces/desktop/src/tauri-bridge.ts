/** Tauri WebView bridge — daemon HTTP/SSE never carry bearer token in the renderer. */

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

/** 切换开机自启动。非 Tauri 环境为静默 no-op。 */
export async function setAutostart(enabled: boolean): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) return;
  await invoke('set_autostart', { enabled });
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

export async function listenDaemonEvents(
  handler: (payload: DaemonEventPayload) => void,
): Promise<() => void> {
  const listen = tauriApi()?.event?.listen;
  if (!listen) throw new Error('Tauri event.listen unavailable');
  return listen('daemon-event', (event) => {
    handler(event.payload as DaemonEventPayload);
  });
}
