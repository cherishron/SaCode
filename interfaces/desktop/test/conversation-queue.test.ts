import assert from 'node:assert/strict';
import test from 'node:test';
import { moveQueuedMessage, restoreQueuedMessages, type QueuedMessage } from '../src/app/conversation-queue.ts';

test('queue reordering preserves all message payloads', () => {
  const queue: QueuedMessage[] = ['a', 'b', 'c'].map((id) => ({ id, prompt: id, mode: 'build', backendId: 'sacode', contextPaths: [] }));
  assert.deepEqual(moveQueuedMessage(queue, 'b', -1).map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(moveQueuedMessage(queue, 'b', 1).map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(queue.map((item) => item.id), ['a', 'b', 'c']);
  assert.equal(moveQueuedMessage(queue, 'a', -1), queue);
});

test('restored queue holds uncertain sends for explicit retry', () => {
  const message: QueuedMessage = {
    id: 'one', prompt: 'check status', mode: 'auto', backendId: 'sacode',
    contextPaths: [], sending: true,
  };
  const restored = restoreQueuedMessages(JSON.stringify([['conversation', [message]]]));
  assert.equal(restored.get('conversation')?.[0]?.sending, false);
  assert.match(restored.get('conversation')?.[0]?.error || '', /状态不确定/);
  assert.equal(restoreQueuedMessages('corrupted').size, 0);
});
