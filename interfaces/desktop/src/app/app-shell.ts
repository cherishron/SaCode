/** AppShell — 布局状态 */

export interface AppShellState {
  sidebarOpen: boolean;
  contextOpen: boolean;
  connection: 'starting' | 'healthy' | 'error';
}

export function createAppShellState(): AppShellState {
  return {
    sidebarOpen: true,
    contextOpen: true,
    connection: 'starting',
  };
}
