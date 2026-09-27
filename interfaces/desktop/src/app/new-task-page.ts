import type { DesktopApp } from './service.ts';
import type { UiState } from './ui.ts';

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

export function closePane(state: UiState, app: DesktopApp, index: number) {
  if (state.panes.length > 1) {
    state.panes.splice(index, 1);
    state.activePane = 0;
    if (state.panes.every((pane) => !pane.taskId)) {
      state.sidebar.activeSessionId = null;
      state.activeTaskFilter = null;
      app.currentTaskId = null;
      app.currentConversationId = null;
      app.conversationTurns = null;
    }
    return;
  }
  state.panes[index].taskId = null;
  state.sidebar.activeSessionId = null;
  state.activeTaskFilter = null;
  app.currentTaskId = null;
  app.currentConversationId = null;
  app.conversationTurns = null;
}
