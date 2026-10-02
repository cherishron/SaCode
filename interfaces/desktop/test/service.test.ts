import assert from 'node:assert/strict';
import test from 'node:test';
import type { DaemonClient, TaskFileChange, TaskListItem } from '@cherishron/sacode-client-core';
import { DesktopApp } from '../src/ui/logic/services.ts';

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

test('queued message waits for the previous turn and sends once after completion', async () => {
  const app = new DesktopApp();
  app.mode = 'vite';
  Object.defineProperty(app, 'startViteStream', { value: () => {} });
  app.refreshTasks = async () => {};
  let sends = 0;
  let status = 'running';
  app.client = {
    sendDesktopMessage: async () => { sends += 1; status = 'running'; return { task_id: 'next', status: 'pending', conversation_id: 'conversation' }; },
    listDesktopConversations: async () => [{ id: 'conversation', title: 'task', created_at: 'today', latest_task_id: 'next', status }],
    getDesktopConversation: async () => ({ id: 'conversation', turns: [{ task_id: 'next', prompt: 'queued', created_at: 'today', status: 'running' }] }),
  } as unknown as DaemonClient;
  app.desktopConversations = [{ id: 'conversation', title: 'task', created_at: 'today', latest_task_id: 'previous', status: 'running' }];
  app.queuedMessages.set('conversation', [{ id: 'queued-1', prompt: 'queued', mode: 'build', backendId: 'sacode', contextPaths: [] }]);
  await app.flushQueuedMessages();
  assert.equal(sends, 0);
  app.desktopConversations[0]!.status = 'completed';
  await app.flushQueuedMessages();
  assert.equal(sends, 1);
  assert.equal(app.queuedMessages.has('conversation'), false);
});

test('failed queued send keeps the message for explicit retry', async () => {
  const app = new DesktopApp();
  app.client = { sendDesktopMessage: async () => { throw new Error('network unavailable'); } } as unknown as DaemonClient;
  app.desktopConversations = [{ id: 'conversation', title: 'task', created_at: 'today', latest_task_id: 'previous', status: 'completed' }];
  app.queuedMessages.set('conversation', [{ id: 'queued-1', prompt: 'queued', mode: 'build', backendId: 'sacode', contextPaths: [] }]);
  await app.flushQueuedMessages();
  assert.match(app.queuedMessages.get('conversation')?.[0]?.error || '', /network unavailable/);
});

test('approvals stay associated with their task and resolve through that task', async () => {
  const app = new DesktopApp();
  app.currentTaskId = 'task-a';
  const approval = {
    approval_id: 'approval-b', task_id: 'task-b', tool_name: 'fs.write',
    side_effect_level: 'medium', args: { path: 'demo.txt' }, waited_secs: 0,
    timeout_secs: 60, expires_in_secs: 60,
  };
  let resolvedTask = '';
  let pending = [approval];
  app.client = {
    listApprovals: async () => pending,
    resolveApproval: async (taskId: string) => { resolvedTask = taskId; pending = []; return {}; },
  } as unknown as DaemonClient;
  await app.refreshApprovals('task-b');
  assert.deepEqual(app.approvalsByTask.get('task-b'), [approval]);
  assert.deepEqual(app.approvals, []);
  assert.equal(await app.resolveApproval('task-b', 'approval-b', true), true);
  assert.equal(resolvedTask, 'task-b');
  assert.deepEqual(app.approvalsByTask.get('task-b'), []);
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

test('loading another pane conversation preserves the active selection', async () => {
  const app = new DesktopApp();
  const detail = { id: 'conversation-other', turns: [
    { task_id: 'task-other', prompt: 'other pane', status: 'completed', output: 'answer', created_at: 'today' },
  ] };
  app.client = {
    getDesktopConversation: async () => detail,
  } as unknown as DaemonClient;
  app.currentConversationId = 'conversation-current';
  await app.loadDesktopConversationDetail('conversation-other');
  assert.equal(app.conversationDetails.get('conversation-other'), detail);
  assert.equal(app.currentConversationId, 'conversation-current');
  assert.equal(app.conversationTurns, null);
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
