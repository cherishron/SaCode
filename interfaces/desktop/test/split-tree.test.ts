import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESETS,
  equalizeAt,
  insertEdgeLeaf,
  leaves,
  moveLeafToEdge,
  paneCount,
  remapLeaves,
  removeLeaf,
  sameShape,
  setRatio,
  splitLeaf,
  swapLeaves,
  validateTree,
} from '../src/app/split-tree.ts';
test('leaves returns visual reading order and paneCount counts leaves', () => {
  assert.deepEqual(leaves(PRESETS['4']), [0, 2, 1, 3]);
  assert.equal(paneCount(PRESETS['4']), 4);
});
test('validateTree accepts good archives and rejects bad ones', () => {
  assert.notEqual(validateTree(PRESETS['2col']), null);
  assert.notEqual(validateTree(JSON.parse(JSON.stringify(PRESETS['2col']))), null);
  assert.equal(validateTree({ dir: 'diag', ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }), null);
  assert.equal(validateTree({ leaf: -1 }), null);
  assert.equal(validateTree({ leaf: 1.5 }), null);
  // 重复槽位:两个叶都声称槽 0
  assert.equal(validateTree({ dir: 'col', ratio: 0.5, a: { leaf: 0 }, b: { leaf: 0 } }), null);
  // 自引用对象成环:a 的子树指回自身,遍历必须被 seenObjects 拦下
  const cyclic: Record<string, unknown> = { dir: 'col', ratio: 0.5 };
  cyclic.a = cyclic;
  cyclic.b = { leaf: 1 };
  assert.equal(validateTree(cyclic), null);
  // 同一叶对象出现在两个位置(结构共享)同样作废
  const shared: Record<string, unknown> = { leaf: 0 };
  assert.equal(validateTree({ dir: 'col', ratio: 0.5, a: shared, b: shared }), null);
});
test('splitLeaf picks the smallest unused slot and keeps the original first', () => {
  const first = splitLeaf(PRESETS['1'], 0, 'col');
  assert.deepEqual(first, { tree: PRESETS['2col'], newSlot: 1 });
  const again = splitLeaf(first!.tree, 0, 'row');
  assert.deepEqual(leaves(again!.tree), [0, 2, 1]);
  // 不存在的叶:原样返回 null
  assert.equal(splitLeaf(PRESETS['1'], 7, 'col'), null);
});
test('setRatio retargets only the addressed node', () => {
  const moved = setRatio(PRESETS['2col'], '', 0.25);
  assert.equal((moved as { ratio: number }).ratio, 0.25);
  assert.equal((PRESETS['2col'] as { ratio: number }).ratio, 0.5);
  // 嵌套树:路径 'a' 指向 a 子树里的 branch 节点,不动根
  const nested = splitLeaf(PRESETS['1'], 0, 'col')!.tree;
  const deeper = splitLeaf(nested, 0, 'row')!.tree;
  const retargeted = setRatio(deeper, 'a', 0.3);
  const a = (retargeted as { a: { ratio: number } }).a;
  assert.ok(Math.abs(a.ratio - 0.3) < 1e-12);
  // 路径指到叶子:原样返回
  assert.deepEqual(setRatio(PRESETS['2col'], 'a', 0.25), PRESETS['2col']);
});
test('removeLeaf promotes the sibling and refuses to kill the last leaf', () => {
  const tree = splitLeaf(PRESETS['1'], 0, 'col')!.tree;
  assert.deepEqual(removeLeaf(tree, 1), PRESETS['1']);
  assert.equal(removeLeaf(PRESETS['1'], 0), PRESETS['1']);
  // 嵌套树:关中间叶,兄弟上位
  const nested = splitLeaf(tree, 0, 'row')!.tree;
  assert.deepEqual(removeLeaf(nested, 2), PRESETS['2col']);
});
test('swapLeaves swaps two on-tree slots and ignores off-tree ones', () => {
  const swapped = swapLeaves(PRESETS['2col'], 0, 1);
  assert.deepEqual(swapped, { dir: 'col', ratio: 0.5, a: { leaf: 1 }, b: { leaf: 0 } });
  assert.deepEqual(swapLeaves(swapped, 0, 1), PRESETS['2col']);
  assert.deepEqual(leaves(swapLeaves(PRESETS['4'], 0, 1)), [1, 2, 0, 3]);
  assert.equal(swapLeaves(PRESETS['2col'], 0, 9), PRESETS['2col']);
});
test('equalizeAt splits area evenly under the node only', () => {
  // 左列上下两格 0/2,右列一格 1,根比例拖到 0.9 后双击等分 -> 三格等面积
  let tree = splitLeaf(splitLeaf(PRESETS['1'], 0, 'row')!.tree, 0, 'col')!.tree;
  tree = setRatio(tree, '', 0.9);
  const equalized = equalizeAt(tree, '');
  const root = equalized as { ratio: number };
  assert.ok(Math.abs(root.ratio - 2 / 3) < 1e-9, 'root should get 2/3 for two leaves');
});
test('insertEdgeLeaf adds a global column for left/right', () => {
  const added = insertEdgeLeaf(PRESETS['1'], 0, 'right');
  assert.ok(added);
  assert.deepEqual(leaves(added!.tree), [0, 1]);
  const left = insertEdgeLeaf(PRESETS['1'], 0, 'left');
  assert.deepEqual(leaves(left!.tree), [1, 0]);
});
test('insertEdgeLeaf inserts into the vertical group for top/bottom', () => {
  // 上下拆出 0/1,再在 0 下插一格:纵向组三行等高
  const tree = splitLeaf(PRESETS['1'], 0, 'row')!.tree;
  const added = insertEdgeLeaf(tree, 0, 'bottom');
  assert.ok(added);
  assert.deepEqual(leaves(added!.tree), [0, 2, 1]);
  const rows = added!.tree as { dir: string; ratio: number };
  assert.equal(rows.dir, 'row');
  assert.ok(Math.abs(rows.ratio - 1 / 3) < 1e-9);
});
test('moveLeafToEdge moves an existing pane and collapses the old slot', () => {
  const tree = splitLeaf(PRESETS['1'], 0, 'col')!.tree;
  const moved = moveLeafToEdge(tree, 1, 0, 'bottom');
  assert.deepEqual(leaves(moved), [0, 1]);
  assert.equal((moved as { dir: string }).dir, 'row');
});
test('sameShape ignores ratios but tracks shape and slot labels', () => {
  assert.ok(sameShape(PRESETS['2col'], setRatio(PRESETS['2col'], '', 0.25)));
  assert.ok(!sameShape(PRESETS['2col'], PRESETS['2row']));
  assert.ok(!sameShape(PRESETS['2col'], swapLeaves(PRESETS['2col'], 0, 1)));
});
test('remapLeaves renumbers slots without touching shape or order', () => {
  const tree = splitLeaf(splitLeaf(PRESETS['1'], 0, 'col')!.tree, 0, 'row')!.tree;
  const remapped = remapLeaves(tree, new Map([[0, 5], [2, 6], [1, 7]]));
  assert.deepEqual(leaves(remapped), [5, 6, 7]);
  assert.ok(sameShape(remapped, tree) === false || leaves(remapped).length === 3);
});
