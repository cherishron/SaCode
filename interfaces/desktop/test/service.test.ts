import assert from 'node:assert/strict';
import test from 'node:test';
import type { DaemonClient, TaskFileChange, TaskListItem } from '@cherishron/sacode-client-core';
import { DesktopApp } from '../src/app/service.ts';

function completedTask(): TaskListItem {
  return {
    task_id: 'task-history',
    prompt: '恢复之前的任务',
    mode: 'build',
    created_at: '2026-09-22T10:00:00Z',
    status: 'completed',
    queue_status: 'completed',
    output: '历史结果',
  };
}

function sampleChange(): TaskFileChange {
  return {
    path: 'src/demo.ts',
    kind: 'modified',
    additions: 2,
    deletions: 1,
    binary: false,
    diff: '@@ -1 +1 @@\n-old\n+new\n+second',
  };
}

test('task creation rejects server error without selecting a phantom task', async () => {
  const app = new DesktopApp();
  app.client = {
    sendDesktopMessage: async () => ({ task_id: 'rejected-id', status: 'error', message: 'skill not available: gone' }),
  } as unknown as DaemonClient;
  const created = await app.runTask({ prompt: 'hello', mode: 'build', backendId: 'sacode', skill: 'gone' });
  assert.equal(created, false);
  assert.equal(app.currentTaskId, null);
  assert.match(app.lastTaskCreateError || '', /skill not available: gone/);
});

test('selectDesktopConversation restores latest task and previous turns', async () => {
  const app = new DesktopApp();
  app.client = {
    getDesktopConversation: async () => ({ id: 'conversation-1', turns: [
      { task_id: 'task-1', prompt: 'first', status: 'completed', output: 'answer', created_at: 'today' },
      { task_id: 'task-2', prompt: 'second', status: 'completed', output: 'next', created_at: 'today' },
    ] }),
    getTaskStatus: async () => ({ task_id: 'task-2', status: 'completed', queue_status: 'completed' }),
    getTaskResult: async () => ({ task_id: 'task-2', status: 'completed', response: 'next', learned_facts: [] }),
    listApprovals: async () => [],
    getTaskChanges: async () => ({ changes: [] }),
  } as unknown as DaemonClient;
  await app.selectDesktopConversation('conversation-1');
  assert.equal(app.currentConversationId, 'conversation-1');
  assert.equal(app.currentTaskId, 'task-2');
  assert.equal(app.conversationTurns?.turns.length, 2);
});

test('failed task shows provider error without an empty assistant response', async () => {
  const app = new DesktopApp();
  app.client = {
    getTaskStatus: async () => ({
      task_id: 'task-failed',
      status: 'failed',
      queue_status: 'failed',
      error: 'provider/service: The provider returned HTTP 404 Not Found.',
    }),
    getTaskResult: async () => ({
      task_id: 'task-failed', status: 'failed', response: '', learned_facts: [],
    }),
  } as unknown as DaemonClient;

  await app.refreshStatus('task-failed', true);
  assert.equal(app.timeline.filter((item) => item.taskId === 'task-failed' && item.kind === 'error').length, 1);
  assert.equal(app.timeline.filter((item) => item.taskId === 'task-failed' && item.kind === 'assistant').length, 0);
});

test('selectTask restores persisted prompt, output and current task', async () => {
  const app = new DesktopApp();
  app.tasks = [completedTask()];
  app.client = {
    getTaskStatus: async () => ({
      task_id: 'task-history',
      status: 'completed',
      queue_status: 'completed',
      output: '历史结果',
    }),
    getTaskResult: async () => ({
      task_id: 'task-history',
      status: 'completed',
      response: '历史结果',
      learned_facts: [],
    }),
    getTaskChanges: async () => ({
      protocol_version: 1,
      task_id: 'task-history',
      status: 'final',
      changes: [sampleChange()],
    }),
    listApprovals: async () => [],
  } as unknown as DaemonClient;

  await app.selectTask('task-history');
  await app.selectTask('task-history');

  assert.equal(app.currentTaskId, 'task-history');
  assert.equal(
    app.timeline.filter((item) => item.kind === 'user' && item.taskId === 'task-history').length,
    1,
  );
  assert.equal(
    app.timeline.filter((item) => item.kind === 'assistant' && item.text === '历史结果').length,
    1,
  );
  assert.equal(app.changes.length, 1);
  assert.equal(app.changes[0].path, 'src/demo.ts');
  assert.equal(app.changes[0].additions, 2);
});
