import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopApp } from '../src/app/service.ts';
import type { UiState } from '../src/app/ui.ts';
import { closePane, closeSessionView, openTaskInActivePane, showNewTaskPage } from '../src/app/new-task-page.ts';

function uiState(): UiState {
  return {
    activeView: 'agent', activePane: 0, activeTaskFilter: 'task-a',
    panes: [{ taskId: 'task-a' }, { taskId: 'task-b' }],
    sidebar: { activeSessionId: 'task-a' },
    newTaskDialog: { open: true },
  } as UiState;
}

test('closing every session opens the new task page', () => {
  const state = uiState();
  const app = { currentTaskId: 'task-a' } as DesktopApp;
  closePane(state, app, 0);
  assert.equal(showNewTaskPage(state), false);
  closePane(state, app, 0);
  assert.equal(showNewTaskPage(state), true);
  assert.equal(state.sidebar.activeSessionId, null);
  assert.equal(app.currentTaskId, null);
});

test('closing a visible session preserves history and switches to the remaining view', () => {
  const state = uiState();
  const conversations = [{ id: 'task-a' }, { id: 'task-b' }];
  const app = {
    currentConversationId: 'task-a', currentTaskId: 'turn-a',
    conversationTurns: { id: 'task-a', turns: [] }, desktopConversations: conversations,
  } as unknown as DesktopApp;
  const nextId = closeSessionView(state, app, 'task-a');
  assert.equal(nextId, 'task-b');
  assert.deepEqual(state.panes.map((pane) => pane.taskId), [null, 'task-b']);
  assert.equal(state.activePane, 1);
  assert.equal(state.sidebar.activeSessionId, 'task-b');
  assert.equal(state.activeTaskFilter, 'task-b');
  assert.equal(app.currentConversationId, null);
  assert.equal(app.currentTaskId, null);
  assert.equal(app.conversationTurns, null);
  assert.equal(app.desktopConversations, conversations);
});

test('closing a pane syncs the surviving session selection', () => {
  const state = uiState();
  const app = { currentConversationId: 'task-a', currentTaskId: 'turn-a' } as DesktopApp;
  assert.equal(closePane(state, app, 0), 'task-b');
  assert.equal(state.sidebar.activeSessionId, 'task-b');
  assert.equal(state.activeTaskFilter, 'task-b');
  assert.equal(app.currentConversationId, null);
});

test('closing the last view leaves its session available in history', () => {
  const state = uiState();
  state.panes = [{ taskId: 'task-a' }];
  const conversations = [{ id: 'task-a' }];
  const app = { currentConversationId: 'task-a', desktopConversations: conversations } as unknown as DesktopApp;
  assert.equal(closeSessionView(state, app, 'task-a'), null);
  assert.equal(showNewTaskPage(state), true);
  assert.equal(app.desktopConversations, conversations);
});

test('creating a task opens its conversation in the active pane', () => {
  const state = uiState();
  state.panes[0].taskId = null;
  state.panes[1].taskId = null;
  const app = { currentTaskId: null } as DesktopApp;
  assert.equal(showNewTaskPage(state), true);
  openTaskInActivePane(state, app, 'task-new');
  assert.equal(showNewTaskPage(state), false);
  assert.equal(state.panes[0].taskId, 'task-new');
  assert.equal(state.sidebar.activeSessionId, 'task-new');
  assert.equal(state.activeTaskFilter, 'task-new');
  assert.equal(app.currentTaskId, 'task-new');
  assert.equal(state.newTaskDialog.open, false);
});
