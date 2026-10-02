import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalDimensions, terminalKeyData } from '../src/ui/logic/terminal-input.ts';
import { startTerminal } from '../src/ui/platform/tauri-bridge.ts';

test('terminal IPC omits absent cwd and forwards an explicit cwd without changing dimensions', async () => {
  const calls: unknown[] = [];
  const globals = globalThis as typeof globalThis & { __TAURI__?: unknown };
  const previous = globals.__TAURI__;
  globals.__TAURI__ = {
    core: { invoke: async (command: string, args: unknown) => { calls.push({ command, args }); return null; } },
    event: { listen: async () => () => {} },
  };
  try {
    await startTerminal();
    await startTerminal(30, 100, 'src');
    await startTerminal(24, 80, '');
    assert.deepEqual(calls, [
      { command: 'terminal_start', args: { rows: 24, cols: 80 } },
      { command: 'terminal_start', args: { rows: 30, cols: 100, cwd: 'src' } },
      { command: 'terminal_start', args: { rows: 24, cols: 80, cwd: '' } },
    ]);
    delete globals.__TAURI__;
    assert.equal(await startTerminal(30, 100, 'src'), null);
  } finally {
    if (previous === undefined) delete globals.__TAURI__;
    else globals.__TAURI__ = previous;
  }
});

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
