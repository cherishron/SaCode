import assert from 'node:assert/strict';
import test from 'node:test';
import { appendKvRow, dropKvRow, kvToRecord, recordToKv } from '../src/ui/logic/kv-rows.ts';

test('recordToKv 保序展开，空对象给一行空位', () => {
  assert.deepEqual(recordToKv({ A: '1', B: '2' }), [
    { key: 'A', value: '1' },
    { key: 'B', value: '2' },
  ]);
  assert.deepEqual(recordToKv({}), [{ key: '', value: '' }]);
  assert.deepEqual(recordToKv(undefined), [{ key: '', value: '' }]);
});

test('kvToRecord 忽略空 key，后者覆盖重复 key', () => {
  assert.deepEqual(
    kvToRecord([
      { key: 'A', value: '1' },
      { key: '  ', value: 'x' },
      { key: 'B', value: '2' },
      { key: 'A', value: '9' },
    ]),
    { A: '9', B: '2' },
  );
});

test('appendKvRow / dropKvRow 保持至少一行', () => {
  const rows = [{ key: 'A', value: '1' }];
  const added = appendKvRow(rows);
  assert.equal(added.length, 2);
  assert.deepEqual(added[1], { key: '', value: '' });
  assert.deepEqual(dropKvRow(added, 0), [{ key: '', value: '' }]);
  assert.deepEqual(dropKvRow([{ key: '', value: '' }], 0), [{ key: '', value: '' }]);
});
