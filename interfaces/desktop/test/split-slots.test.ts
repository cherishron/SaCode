import assert from 'node:assert/strict';
import test from 'node:test';
import { assign, eject, firstEmptyIn, prune, seed, LOAD_MIME, SWAP_MIME } from '../src/app/split-slots.ts';
test('assign is move semantics: one session never lives in two slots', () => {
  assert.deepEqual(assign(['a', null], 1, 'a'), [null, 'a']);
  assert.deepEqual(assign([], 3, 'x'), [null, null, null, 'x']);
  // 非法下标原样返回
  assert.deepEqual(assign(['a'], -1, 'b'), ['a']);
});
test('eject keeps reference identity for empty slots', () => {
  const slots = ['a', null];
  assert.equal(eject(slots, 1), slots);
  assert.deepEqual(eject(slots, 0), [null, null]);
});
test('prune clears dead sessions and keeps reference when nothing changes', () => {
  const slots = ['a', 'b'];
  assert.equal(prune(slots, new Set(['a', 'b'])), slots);
  assert.deepEqual(prune(slots, new Set(['a'])), ['a', null]);
});
test('firstEmptyIn walks the reading order of visible slots', () => {
  assert.equal(firstEmptyIn(['a', null, null], [2, 0, 1]), 2);
  assert.equal(firstEmptyIn(['a', 'b'], [0, 1]), null);
});
test('seed only fills a fully empty slot table', () => {
  assert.deepEqual(seed([], 's0'), ['s0']);
  assert.deepEqual(seed(['a'], 's0'), ['a']);
  assert.deepEqual(seed([null], null), [null]);
});
test('dnd mime types are private to sacode', () => {
  assert.equal(SWAP_MIME, 'application/x-sacode-split-slot');
  assert.equal(LOAD_MIME, 'application/x-sacode-split-load');
});
