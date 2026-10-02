import assert from 'node:assert/strict';
import test from 'node:test';
import { closePaneLayout, layoutPanes, resizeSplit, restoreWorkbenchLayout, splitPane, swapPanePositions, type SplitLayout } from '../src/ui/logic/split-layout.ts';

test('splitting below a pane keeps its sibling and allows independent resize', () => {
  const initial: SplitLayout = { axis: 'column', ratio: 0.5, first: { pane: 0 }, second: { pane: 1 } };
  const nested = splitPane(initial, 1, 2, 'row');
  assert.deepEqual(layoutPanes(nested), [0, 1, 2]);
  const resized = resizeSplit(nested, 'b', 0.7);
  assert.equal('pane' in resized ? null : resized.ratio, 0.5);
  assert.equal('pane' in resized || 'pane' in resized.second ? null : resized.second.ratio, 0.7);
});

test('workbench layout restores only valid pane trees', () => {
  const layout = { axis: 'column', ratio: 0.6, first: { pane: 1 }, second: { pane: 0 } };
  const saved = { layout, taskIds: ['conversation-a', 'conversation-b'], activePane: 1 };
  assert.deepEqual(restoreWorkbenchLayout(JSON.stringify(saved)), saved);
  assert.equal(restoreWorkbenchLayout(JSON.stringify({ ...saved, layout: { ...layout, second: { pane: 1 } } })), null);
  assert.equal(restoreWorkbenchLayout(JSON.stringify({ ...saved, layout: { ...layout, ratio: 99 } })), null);
});

test('closing a nested pane promotes its sibling and renumbers remaining panes', () => {
  const initial: SplitLayout = { axis: 'column', ratio: 0.5, first: { pane: 0 }, second: { pane: 1 } };
  const nested = splitPane(initial, 0, 2, 'row');
  assert.deepEqual(layoutPanes(closePaneLayout(nested, 0)), [1, 0]);
  assert.deepEqual(layoutPanes(closePaneLayout(nested, 2)), [0, 1]);
});

test('swapping positions moves panes without changing split sizes', () => {
  const layout = splitPane({ axis: 'column', ratio: 0.35, first: { pane: 0 }, second: { pane: 1 } }, 1, 2, 'row');
  const swapped = swapPanePositions(layout, 0, 2);
  assert.deepEqual(layoutPanes(swapped), [2, 1, 0]);
  assert.equal('pane' in swapped ? null : swapped.ratio, 0.35);
  assert.deepEqual(layoutPanes(swapPanePositions(swapped, 0, 2)), [0, 1, 2]);
});
