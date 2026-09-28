import assert from 'node:assert/strict';
import test from 'node:test';
import { clampWorkspaceSplit } from '../src/app/resizable-workspace.ts';

test('split width stays usable at either drag extreme', () => {
  assert.equal(clampWorkspaceSplit(-1), 0.25);
  assert.equal(clampWorkspaceSplit(0.42), 0.42);
  assert.equal(clampWorkspaceSplit(5), 0.68);
});
