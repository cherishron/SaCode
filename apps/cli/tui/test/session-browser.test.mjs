import assert from 'node:assert/strict';
import test from 'node:test';
import { browserItems, metadataConfirmation, mutateSessionMetadata, sessionEntries, validateSessionTitle } from '../src/session-browser.mjs';

const entry = { id: 's2', title: '旧标题', durable: 3, current: false, archived: false, workspaceDirectory: 'D:/project' };

test('会话目录：未落盘current仅接受Host精确空投影，不猜修订或冒用别会话', async () => {
  let projection = { sessionId: 'current', events: 0, durable: 0 };
  const client = { async request(method) { return method === 'session/catalog' ? { entries: [] } : projection; } };
  assert.equal((await sessionEntries(client, 'current'))[0].durable, 0);
  for (const value of [{ ...projection, sessionId: 'other' }, { ...projection, durable: undefined }, { ...projection, events: 1 }]) {
    projection = value;
    await assert.rejects(sessionEntries(client, 'current'), /目录与持久投影不一致/);
  }
});

test('会话浏览：标题/ID/目录过滤，归档分开，归档列表不包括当前会话', () => {
  const entries = [entry, { ...entry, id: 's1', current: true }, { ...entry, id: 'archived', archived: true }];
  assert.equal(browserItems(entries, 'PROJECT').length, 2);
  assert.equal(browserItems(entries, 's2').length, 1);
  assert.equal(browserItems(entries, '', true)[0].id, 'archived');
  assert.deepEqual(browserItems(entries, '', false, 'archive').map((item) => item.id), ['s2']);
});

test('会话确认：标题控制字节/UTF8预算、缺修订/归档当前会话均拒绝', () => {
  assert.equal(validateSessionTitle('  新标题  '), '新标题');
  for (const title of ['', 'x\ny', '中'.repeat(200)]) assert.throws(() => validateSessionTitle(title));
  assert.throws(() => metadataConfirmation({ ...entry, durable: undefined }, 'rename', '新标题'));
  assert.throws(() => metadataConfirmation({ ...entry, current: true }, 'archive'));
});

test('元信息：旧修订确认不能自动替换新修订；成功必须核身份和回读', async () => {
  const confirmation = metadataConfirmation(entry, 'rename', '新标题');
  const calls = [];
  let current = { ...entry };
  const client = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'session/catalog') return { entries: [current] };
    current = { ...current, title: params.title, durable: 4 };
    return { saved: true, sessionId: 's2', revision: 4 };
  } };
  assert.equal((await mutateSessionMetadata(client, confirmation)).title, '新标题');
  assert.deepEqual(calls[1], { method: 'session/rename', params: { sessionId: 's2', expectedRevision: 3, title: '新标题' } });
  calls.length = 0;
  await assert.rejects(mutateSessionMetadata(client, confirmation), /会话已变化/);
  assert.deepEqual(calls.map((call) => call.method), ['session/catalog']);
});

test('元信息：归档/恢复不删除记录，未知结果仅一次写、不伪装回滚', async () => {
  let current = { ...entry };
  let writes = 0;
  const client = { async request(method, params) {
    if (method === 'session/catalog') return { entries: [current] };
    assert.equal(method, 'session/archive'); writes++;
    current = { ...current, archived: params.archived, durable: current.durable + 1 };
    return { saved: true, sessionId: current.id, revision: current.durable };
  } };
  assert.equal((await mutateSessionMetadata(client, metadataConfirmation(current, 'archive'))).archived, true);
  assert.equal((await mutateSessionMetadata(client, metadataConfirmation(current, 'restore'))).archived, false);
  assert.equal(writes, 2);
  client.request = async (method) => {
    if (method === 'session/catalog') return { entries: [current] };
    writes++; throw new Error('timeout');
  };
  await assert.rejects(mutateSessionMetadata(client, metadataConfirmation(current, 'archive')), (error) => error.outcomeUnknown === true);
  assert.equal(writes, 3);
});

test('元信息：宿主修订冲突是确定拒绝，身份或最终回读错误保持未知', async () => {
  const confirmation = metadataConfirmation(entry, 'rename', '新标题');
  const client = { async request(method) {
    if (method === 'session/catalog') return { entries: [entry] };
    throw new Error('-32004 session-revision-conflict');
  } };
  await assert.rejects(mutateSessionMetadata(client, confirmation), (error) => error.outcomeUnknown === false && /宿主拒绝/.test(error.message));
  for (const receipt of [
    { saved: true, sessionId: 'other', revision: 4 },
    { saved: true, sessionId: 's2', revision: 3 },
    { saved: true, sessionId: 's2', revision: 4 },
  ]) {
    client.request = async (method) => method === 'session/catalog' ? { entries: [entry] } : receipt;
    await assert.rejects(mutateSessionMetadata(client, confirmation), (error) => error.outcomeUnknown === true);
  }
});
