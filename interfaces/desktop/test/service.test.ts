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
