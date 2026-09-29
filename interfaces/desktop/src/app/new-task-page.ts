import type { DesktopApp } from './service.ts';
import type { UiState } from './ui.ts';
import { closePaneLayout } from './split-layout.ts';

export function showNewTaskPage(state: UiState): boolean {
  return state.activeView === 'agent' && state.panes.every((pane) => !pane.taskId);
}

export function openTaskInActivePane(state: UiState, app: DesktopApp, taskId: string) {
  const conversationId = app.currentConversationId || taskId;
  state.panes[state.activePane].taskId = conversationId;
  state.sidebar.activeSessionId = conversationId;
  state.activeTaskFilter = conversationId;
  state.activeView = 'agent';
  app.currentTaskId = taskId;
  state.newTaskDialog.open = false;
}

export function closePane(state: UiState, app: DesktopApp, index: number): string | null {
  if (state.panes.length > 1) {
    state.layout = closePaneLayout(state.layout, index);
    state.panes.splice(index, 1);
    state.activePane = Math.min(state.activePane > index ? state.activePane - 1 : state.activePane, state.panes.length - 1);
    if (state.maximizedPane !== null) {
      state.maximizedPane = state.maximizedPane === index ? null
        : state.maximizedPane > index ? state.maximizedPane - 1 : state.maximizedPane;
    }
  } else {
    state.panes[index].taskId = null;
  }
  return syncOpenConversation(state, app);
}

/** 关闭会话视图，不删除 daemon 中的历史会话或任务。 */
export function closeSessionView(state: UiState, app: DesktopApp, sessionId: string): string | null {
  for (const pane of state.panes) {
    if (pane.taskId === sessionId) pane.taskId = null;
  }
  if (!state.panes[state.activePane]?.taskId) {
    const next = state.panes.findIndex((pane) => pane.taskId);
    if (next >= 0) state.activePane = next;
  }
  return syncOpenConversation(state, app);
}

function syncOpenConversation(state: UiState, app: DesktopApp): string | null {
  const nextId = state.panes[state.activePane]?.taskId ?? null;
  state.sidebar.activeSessionId = nextId;
  state.activeTaskFilter = nextId;
  if (app.currentConversationId !== nextId) {
    app.currentTaskId = null;
    app.currentConversationId = null;
    app.conversationTurns = null;
  }
  return nextId;
}
