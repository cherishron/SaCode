import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopApp } from '../src/app/service.ts';
import { conversationMessages } from '../src/app/conversation.ts';

const app = {
  conversationTurns: { id: 'conversation-a', turns: [
    { task_id: 'task-a', prompt: '你个', status: 'failed', error: 'provider unavailable' },
  ] },
  conversationDetails: new Map(),
  timeline: [
    { kind: 'user', text: '你个', taskId: 'task-a' },
    { kind: 'system', text: 'task created', taskId: 'task-a' },
    { kind: 'error', text: 'provider unavailable', taskId: 'task-a' },
  ],
} as unknown as DesktopApp;

test('empty split pane does not display messages from another conversation', () => {
  assert.deepEqual(conversationMessages(app, null), []);
  assert.deepEqual(conversationMessages(app, 'conversation-b'), []);
  assert.deepEqual(conversationMessages(app, 'conversation-a').map((item) => item.kind), ['user', 'system', 'error']);
});
