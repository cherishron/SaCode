import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopApp } from '../src/app/service.ts';
import type { UiState } from '../src/app/ui.ts';
import { closePane, openTaskInActivePane, showNewTaskPage } from '../src/app/new-task-page.ts';

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
