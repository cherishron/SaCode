import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceFileRows } from '../src/app/context-panel.ts';

const files = [
  { path: 'src/main.ts', size: 20, language: 'typescript', is_dir: false },
  { path: 'src/lib/util.ts', size: 10, language: 'typescript', is_dir: false },
  { path: 'README.md', size: 5, language: 'markdown', is_dir: false },
];

test('file panel builds folders, expands children, and keeps search ancestors', () => {
  assert.deepEqual(workspaceFileRows(files, new Set()).map((row) => row.path), ['src', 'README.md']);
  assert.deepEqual(workspaceFileRows(files, new Set(['src'])).map((row) => row.path), ['src', 'src/lib', 'src/main.ts', 'README.md']);
  assert.deepEqual(workspaceFileRows(files, new Set(), 'util').map((row) => row.path), ['src', 'src/lib', 'src/lib/util.ts']);
});
