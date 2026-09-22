/** AppShell — 四段式布局容器：TopBar + Rail+Sidebar+Conversation+ContextPanel + StatusBar */

export interface AppShellState {
  sidebarOpen: boolean;
  contextOpen: boolean;
  connection: 'checking' | 'healthy' | 'error';
}

export function createAppShellState(): AppShellState {
  return {
    sidebarOpen: true,
    contextOpen: true,
    connection: 'checking',
  };
}
