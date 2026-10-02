import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSessionsByQuery } from '../src/ui/logic/session-search.ts';

const sessions = [
  { id: '1', title: '修复登录 Bug', preview: '改了 auth.ts' },
  { id: '2', title: '写周报', preview: '' },
  { id: '3', title: 'refactor', preview: 'Update TaskColumn.vue' },
];

test('空查询返回全部', () => {
  assert.equal(filterSessionsByQuery(sessions, '').length, 3);
  assert.equal(filterSessionsByQuery(sessions, '   ').length, 3);
});

test('子串匹配 title（大小写不敏感）', () => {
  assert.deepEqual(filterSessionsByQuery(sessions, '登录').map((s) => s.id), ['1']);
  assert.deepEqual(filterSessionsByQuery(sessions, 'REFACTOR').map((s) => s.id), ['3']);
});

test('子串匹配 preview', () => {
  assert.deepEqual(filterSessionsByQuery(sessions, 'auth.ts').map((s) => s.id), ['1']);
  assert.deepEqual(filterSessionsByQuery(sessions, 'taskcolumn').map((s) => s.id), ['3']);
});

test('无匹配返回空数组', () => {
  assert.deepEqual(filterSessionsByQuery(sessions, '不存在的串'), []);
});
