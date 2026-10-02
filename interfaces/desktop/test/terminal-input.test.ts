import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalDimensions, terminalKeyData } from '../src/ui/logic/terminal-input.ts';

const key = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
  key, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, ...overrides,
});

test('terminal sends printable, control, and navigation bytes', () => {
  assert.equal(terminalKeyData(key('中')), '中');
  assert.equal(terminalKeyData(key('Enter')), '\r');
  assert.equal(terminalKeyData(key('ArrowUp')), '\x1b[A');
  assert.equal(terminalKeyData(key('c', { ctrlKey: true })), '\x03');
  assert.equal(terminalKeyData(key('d', { ctrlKey: true })), '\x04');
  assert.equal(terminalKeyData(key('x', { altKey: true })), '\x1bx');
});

test('terminal leaves composition and system shortcuts alone', () => {
  assert.equal(terminalKeyData(key('Process', { isComposing: true })), null);
  assert.equal(terminalKeyData(key('v', { metaKey: true })), null);
  assert.equal(terminalKeyData(key('v', { ctrlKey: true })), null);
});

test('terminal computes PTY geometry from the visible terminal', () => {
  assert.deepEqual(terminalDimensions(800, 400, 10, 20), { cols: 80, rows: 20 });
});

test('terminal clamps PTY geometry to native size limits', () => {
  // Too small a panel never collapses below 2x2.
  assert.deepEqual(terminalDimensions(10, 10, 10, 20), { cols: 2, rows: 2 });
  assert.deepEqual(terminalDimensions(0, 0, 10, 20), { cols: 2, rows: 2 });
  // Oversized panels never exceed the PTY bounds in terminal.rs.
  assert.deepEqual(terminalDimensions(20000, 20000, 10, 20), { cols: 1000, rows: 500 });
  // Fractional font metrics floor down, not up.
  assert.deepEqual(terminalDimensions(79, 39, 8.4, 18), { cols: 9, rows: 2 });
});
