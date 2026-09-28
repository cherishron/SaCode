import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalDimensions, terminalKeyData } from '../src/app/terminal-input.ts';

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
