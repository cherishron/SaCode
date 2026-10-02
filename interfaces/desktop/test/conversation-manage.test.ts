import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveConversation,
  deleteConversation,
  readLocalArchived,
  renameConversation,
  restoreConversation,
} from '../src/ui/logic/conversation-manage.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  };
}

test('rename 无 API 时写 localStorage 兜底键', async () => {
  const storage = memoryStorage();
  const client = { deleteDesktopConversation: async () => {} };
  const result = await renameConversation(client, 'id-1', '新标题', storage);
  assert.equal(result.usedApi, false);
  assert.equal(storage.getItem('sacode.session.title.id-1'), '新标题');
});

test('rename 有 API 时走 API 并同步本地', async () => {
  const storage = memoryStorage();
  let called: [string, string] | null = null;
  const client = {
    deleteDesktopConversation: async () => {},
    renameDesktopConversation: async (id: string, title: string) => {
      called = [id, title];
    },
  };
  const result = await renameConversation(client, 'id-2', '  双边空白  ', storage);
  assert.equal(result.usedApi, true);
  assert.deepEqual(called, ['id-2', '双边空白']);
  assert.equal(storage.getItem('sacode.session.title.id-2'), '双边空白');
});

test('archive / restore 本地可逆且按 workspace 隔离', async () => {
  const storage = memoryStorage();
  const client = { deleteDesktopConversation: async () => {} };
  await archiveConversation(client, 'a', 'ws1', storage);
  await archiveConversation(client, 'a', 'ws2', storage);
  assert.deepEqual([...readLocalArchived('ws1', storage)], ['a']);
  assert.deepEqual([...readLocalArchived('ws2', storage)], ['a']);
  await restoreConversation(client, 'a', 'ws1', storage);
  assert.deepEqual([...readLocalArchived('ws1', storage)], []);
  assert.deepEqual([...readLocalArchived('ws2', storage)], ['a']);
});

test('archive / restore 有 API 时走 API 不写本地', async () => {
  const storage = memoryStorage();
  const calls: string[] = [];
  const client = {
    deleteDesktopConversation: async () => {},
    archiveDesktopConversation: async (id: string) => void calls.push(`archive:${id}`),
    restoreDesktopConversation: async (id: string) => void calls.push(`restore:${id}`),
  };
  await archiveConversation(client, 'x', 'ws', storage);
  await restoreConversation(client, 'x', 'ws', storage);
  assert.deepEqual(calls, ['archive:x', 'restore:x']);
  assert.deepEqual([...readLocalArchived('ws', storage)], []);
});

test('delete 委托给已有 API', async () => {
  let deleted = '';
  const client = {
    deleteDesktopConversation: async (id: string) => {
      deleted = id;
    },
  };
  await deleteConversation(client, 'gone');
  assert.equal(deleted, 'gone');
  await assert.rejects(() => deleteConversation(null, 'gone'));
});
