import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInitialUiDocument, createSaDesignState } from '../src/app/sadesign-state.ts';
import {
  createUiNode,
  executeUiCommand,
  findUiNode,
  findUiNodeLocation,
  nextNodeId,
} from '../src/app/ui-document-editor.ts';

test('UICommand updates node content without mutating source document', () => {
  const state = createSaDesignState();
  state.draft.request = 'Dashboard';
  const source = buildInitialUiDocument(state, 'source');
  const result = executeUiCommand(source, {
    type: 'set-content', nodeId: 'title', patch: { text: 'Edited title' },
  });

  assert.equal(findUiNode(source, 'title')?.content.text, 'Dashboard');
  assert.equal(findUiNode(result.document, 'title')?.content.text, 'Edited title');
  assert.equal(result.document.status, 'draft');
});

test('UICommand insert, duplicate and delete preserve unique structure', () => {
  const state = createSaDesignState();
  const source = buildInitialUiDocument(state, 'structure');
  const id = nextNodeId(source, 'text');
  const inserted = executeUiCommand(source, {
    type: 'insert-node', parentId: 'root', index: 1, node: createUiNode('text', id),
  });
  assert.equal(findUiNodeLocation(inserted.document, id)?.parent?.id, 'root');

  const duplicateId = nextNodeId(inserted.document, 'text');
  const duplicated = executeUiCommand(inserted.document, {
    type: 'duplicate-node', nodeId: id, newNodeId: duplicateId,
  });
  assert.ok(findUiNode(duplicated.document, duplicateId));
  assert.notEqual(duplicateId, id);

  const deleted = executeUiCommand(duplicated.document, { type: 'delete-node', nodeId: id });
  assert.equal(findUiNode(deleted.document, id), null);
  assert.ok(findUiNode(deleted.document, duplicateId));
});

test('UICommand moves nodes across containers and rejects descendant cycles', () => {
  const state = createSaDesignState();
  const source = buildInitialUiDocument(state, 'move');
  const moved = executeUiCommand(source, {
    type: 'move-node', nodeId: 'metric-projects', parentId: 'trend', index: 0,
  });
  assert.equal(findUiNodeLocation(moved.document, 'metric-projects')?.parent?.id, 'trend');
  assert.throws(() => executeUiCommand(source, {
    type: 'move-node', nodeId: 'metrics', parentId: 'metric-projects', index: 0,
  }), /子节点/);
});

test('locked nodes reject edits until unlocked by metadata command', () => {
  const state = createSaDesignState();
  const source = buildInitialUiDocument(state, 'lock');
  const locked = executeUiCommand(source, { type: 'set-node-meta', nodeId: 'title', locked: true });
  assert.throws(() => executeUiCommand(locked.document, {
    type: 'set-content', nodeId: 'title', patch: { text: 'blocked' },
  }), /锁定节点/);
  const unlocked = executeUiCommand(locked.document, { type: 'set-node-meta', nodeId: 'title', locked: false });
  const edited = executeUiCommand(unlocked.document, {
    type: 'set-content', nodeId: 'title', patch: { text: 'allowed' },
  });
  assert.equal(findUiNode(edited.document, 'title')?.content.text, 'allowed');
});

test('UICommand updates interactions and document tokens through the same path', () => {
  const state = createSaDesignState();
  const source = buildInitialUiDocument(state, 'interactions');
  const interaction = { trigger: 'click', action: 'navigate', target: '/details' };
  const interacted = executeUiCommand(source, {
    type: 'set-interactions', nodeId: 'primary-action', interactions: [interaction],
  });
  assert.deepEqual(findUiNode(interacted.document, 'primary-action')?.interactions, [interaction]);

  const tokenized = executeUiCommand(interacted.document, {
    type: 'set-token', name: 'colors.primary', value: '#ff0066',
  });
  assert.equal((tokenized.document.tokens.colors as Record<string, unknown>).primary, '#ff0066');
});

test('locked parent containers reject structural child changes', () => {
  const state = createSaDesignState();
  const source = buildInitialUiDocument(state, 'locked-parent');
  const locked = executeUiCommand(source, { type: 'set-node-meta', nodeId: 'header', locked: true });
  assert.throws(() => executeUiCommand(locked.document, { type: 'delete-node', nodeId: 'title' }), /锁定容器/);
  assert.throws(() => executeUiCommand(locked.document, {
    type: 'duplicate-node', nodeId: 'title', newNodeId: 'title-copy',
  }), /锁定容器/);
  assert.throws(() => executeUiCommand(locked.document, {
    type: 'move-node', nodeId: 'title', parentId: 'root', index: 0,
  }), /锁定容器/);
});

test('restore-document inverse returns the previous UIDocument', () => {
  const state = createSaDesignState();
  state.draft.request = 'Original';
  const source = buildInitialUiDocument(state, 'history');
  const changed = executeUiCommand(source, {
    type: 'set-content', nodeId: 'title', patch: { text: 'Changed' },
  });
  const restored = executeUiCommand(changed.document, changed.inverse);
  assert.equal(findUiNode(restored.document, 'title')?.content.text, 'Original');
});
