import assert from 'node:assert/strict';
import test from 'node:test';
import type { TimelineItem } from '../src/app/service.ts';
import {
  ANCHOR_LABEL_MAX,
  MAX_ANCHORS,
  collectTimelineAnchors,
} from '../src/components/timeline-rail.ts';

function item(kind: TimelineItem['kind'], text: string): TimelineItem {
  return { kind, text };
}

test('user messages anchor each turn in message order', () => {
  const anchors = collectTimelineAnchors([
    item('system', 'ready'), item('user', 'first question'),
    item('assistant', 'first answer'), item('tool', 'tool output'),
    item('user', 'second question'), item('assistant', 'second answer'),
  ]);
  assert.deepEqual(anchors, [
    { msgIndex: 1, label: 'first question' },
    { msgIndex: 4, label: 'second question' },
  ]);
});

test('assistant messages are fallback anchors when there are no user turns', () => {
  assert.deepEqual(collectTimelineAnchors([
    item('system', 'ready'), item('assistant', 'answer'), item('error', 'failure'),
  ]), [{ msgIndex: 1, label: 'answer' }]);
});

test('all messages are fallback anchors without user or assistant turns', () => {
  assert.deepEqual(collectTimelineAnchors([
    item('system', 'ready'), item('error', 'failure'),
  ]), [
    { msgIndex: 0, label: 'ready' },
    { msgIndex: 1, label: 'failure' },
  ]);
});

test('anchor labels flatten whitespace, truncate, and substitute empty text', () => {
  const longText = 'a'.repeat(ANCHOR_LABEL_MAX + 5);
  const anchors = collectTimelineAnchors([
    item('user', '  hello\n  world  '),
    item('user', longText),
    item('user', '  \n  '),
  ]);
  assert.deepEqual(anchors.map(({ label }) => label), [
    'hello world', `${'a'.repeat(ANCHOR_LABEL_MAX)}…`, '(空消息)',
  ]);
});

test('dense histories sample at most 80 anchors, preserving both endpoints', () => {
  const items = Array.from({ length: 200 }, (_, index) => item('user', `turn ${index}`));
  const anchors = collectTimelineAnchors(items);
  assert.equal(anchors.length, MAX_ANCHORS);
  assert.equal(anchors[0].msgIndex, 0);
  assert.equal(anchors.at(-1)?.msgIndex, 199);
  assert.ok(anchors.every((anchor, index) => index === 0 || anchors[index - 1].msgIndex < anchor.msgIndex));
});

test('empty history has no navigation anchors', () => {
  assert.deepEqual(collectTimelineAnchors([]), []);
});
