// Bridge for Tauri WebView: invoke start_daemon / stop_daemon / daemon_info.
// In Vite-only mode this module is unused; main.ts uses __SACODE_ENV__.

export interface SidecarHandleDto {
  host: string;
  port: number;
  base_url: string;
  pid: number;
  auth_required: boolean;
  token?: string;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function getInvoke(): InvokeFn | null {
  const tauri = (globalThis as unknown as {
    __TAURI__?: { invoke?: InvokeFn };
  }).__TAURI__;
  return tauri?.invoke ?? null;
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
