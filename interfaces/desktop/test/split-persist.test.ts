import assert from 'node:assert/strict';
import test from 'node:test';
import {
  layoutStorageKey,
  restoreWorkbench,
  serializeWorkbench,
  type SavedWorkbench,
} from '../src/ui/logic/split-persist.ts';
import { PRESETS, removeLeaf, splitLeaf } from '../src/ui/logic/split-tree.ts';

const tools = { open: true, tab: 'changes', width: 400, treeWidth: 200 } as const;

function sample(): SavedWorkbench {
  return {
    version: 1,
    tree: PRESETS['2col'],
    slots: [
      { conversationId: 'conversation-a', title: '会话 A', mode: 'chat', tools },
      { conversationId: null, title: '空格', mode: 'empty', tools: { ...tools, open: false, tab: 'files' } },
    ],
    focusSlot: 1,
    taskColWidth: 280,
  };
}

test('workbench layout round-trips tree, slots, tools and task column width', () => {
  const saved = sample();
  const restored = restoreWorkbench(serializeWorkbench(saved));
  assert.deepEqual(restored, saved);
  assert.equal(layoutStorageKey('D:/ws'), 'sacode.layout.D:/ws');
});

test('restore rejects corrupt trees and keeps valid slot holes', () => {
  assert.equal(restoreWorkbench('{'), null);
  assert.equal(restoreWorkbench(JSON.stringify({ ...sample(), version: 2 })), null);
  assert.equal(restoreWorkbench(JSON.stringify({ ...sample(), tree: { leaf: -1 } })), null);

  // 关掉中间槽后：槽 1 成洞，恢复不得凭空补会话
  const nested = splitLeaf(PRESETS['2col'], 0, 'row')!;
  const closed = removeLeaf(nested.tree, 1)!;
  const withHole: SavedWorkbench = {
    version: 1,
    tree: closed,
    slots: [
      { conversationId: 'a', title: 'A', mode: 'chat', tools },
      null,
      { conversationId: null, title: '空格', mode: 'empty', tools: { ...tools, open: false } },
    ],
    focusSlot: 2,
  };
  const restored = restoreWorkbench(serializeWorkbench(withHole));
  assert.ok(restored);
  assert.equal(restored.slots[1], null);
  assert.equal(restored.slots[0]?.conversationId, 'a');
  assert.equal(restored.focusSlot, 2);
});

test('restore falls back focus to the first visible leaf and clamps metrics', () => {
  const messy = JSON.parse(serializeWorkbench(sample())) as Record<string, unknown>;
  messy.focusSlot = 99;
  messy.slots = [
    { conversationId: 'a', title: 'A', mode: 'chat', tools: { open: 1, tab: 'nope', width: 10, treeWidth: 10 } },
    { conversationId: null, title: '', mode: 'nope', tools: null },
  ];
  messy.taskColWidth = 9999;
  const restored = restoreWorkbench(JSON.stringify(messy));
  assert.ok(restored);
  assert.equal(restored.focusSlot, 0);
  assert.equal(restored.slots[0]?.tools.open, false);
  assert.equal(restored.slots[0]?.tools.tab, 'files');
  assert.equal(restored.slots[0]?.tools.width, 240);
  assert.equal(restored.slots[1]?.mode, 'empty');
  assert.equal(restored.taskColWidth, 420);
});

test('orphan slot content outside the tree is dropped on restore', () => {
  const withOrphan = JSON.parse(serializeWorkbench(sample())) as Record<string, unknown>;
  withOrphan.slots = [
    sample().slots[0]!,
    sample().slots[1]!,
    { conversationId: 'ghost', title: '幽灵', mode: 'chat', tools },
  ];
  const restored = restoreWorkbench(JSON.stringify(withOrphan));
  assert.ok(restored);
  assert.equal(restored.slots[2], null);
});
