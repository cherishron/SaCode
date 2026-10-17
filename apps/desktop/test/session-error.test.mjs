import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context={};
vm.runInNewContext(readFileSync(new URL('../renderer/session-catalog.js',import.meta.url),'utf8'),context);
const {catalogError}=context.SaCodeSessionCatalog;

test('会话存储失败不冒充另一写者，中文提示保留当前会话',()=>{
  const text=catalogError(Error('-32003 session-storage-unavailable'));
  assert.match(text,/写入/);
  assert.match(text,/保留/);
  assert.doesNotMatch(text,/另一写者/);
});

test('会话真实占用与身份不明的提示区分',()=>{
  assert.match(catalogError(Error('-32001 already-owned')),/另一写者/);
  assert.match(catalogError(Error('-32001 session-owner-unknown')),/无法确认/);
});
