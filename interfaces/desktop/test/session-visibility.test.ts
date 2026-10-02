import assert from 'node:assert/strict';
import test from 'node:test';
import { readArchivedSessions, setSessionArchived, updateUnreadSessions } from '../src/ui/logic/session-visibility.ts';

test('archiving is scoped to workspace and reversible', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  setSessionArchived(storage, 'one', 'task', true);
  assert.deepEqual([...readArchivedSessions(storage, 'one')], ['task']);
  assert.deepEqual([...readArchivedSessions(storage, 'two')], []);
  setSessionArchived(storage, 'one', 'task', false);
  assert.deepEqual([...readArchivedSessions(storage, 'one')], []);
});

test('unread starts only when an inactive running task completes', () => {
  const previous = new Map<string, string>();
  const unread = new Set<string>();
  updateUnreadSessions(previous, unread, [{ id: 'a', status: 'completed' }, { id: 'b', status: 'running' }], new Set());
  assert.deepEqual([...unread], []);
  updateUnreadSessions(previous, unread, [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }], new Set(['a']));
  assert.deepEqual([...unread], ['b']);
  updateUnreadSessions(previous, unread, [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }], new Set(['b']));
  assert.deepEqual([...unread], []);
});

test('a task visible in another pane does not become unread', () => {
  const previous = new Map([['task', 'running']]);
  const unread = new Set<string>();
  updateUnreadSessions(previous, unread, [{ id: 'task', status: 'completed' }], new Set(['task']));
  assert.equal(unread.size, 0);
});
