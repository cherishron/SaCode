/** Tauri WebView bridge — daemon HTTP/SSE never carry bearer token in the renderer. */

export interface SidecarHandleDto {
  host: string;
  port: number;
  base_url: string;
  pid: number;
  auth_required: boolean;
  version?: string;
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
    invoke?: InvokeFn;
    event?: { listen?: ListenFn };
  };
}

function tauriApi(): TauriGlobal['__TAURI__'] | null {
  return (globalThis as unknown as TauriGlobal).__TAURI__ ?? null;
}

function getInvoke(): InvokeFn | null {
  return tauriApi()?.invoke ?? null;
}

export function isTauri(): boolean {
  return getInvoke() !== null;
}

export async function startDaemon(workspace?: string): Promise<SidecarHandleDto> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('not running under Tauri');
  return (await invoke('start_daemon', workspace ? { workspace } : {})) as SidecarHandleDto;
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

export async function daemonProxy(
  method: 'GET' | 'POST',
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
