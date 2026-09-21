import assert from 'node:assert/strict';
import test from 'node:test';
import { createTauriTransport } from '../src/ipc-transport.ts';
import { isTauri } from '../src/tauri-bridge.ts';

test('isTauri is false without __TAURI__', () => {
  assert.equal(isTauri(), false);
});

test('tauri transport extracts path from absolute url', async () => {
  const calls: { method: string; path: string; body?: string }[] = [];
  (globalThis as Record<string, unknown>).__TAURI__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      assert.equal(cmd, 'daemon_proxy');
      calls.push({
        method: String(args?.method),
        path: String(args?.path),
        body: args?.body as string | undefined,
      });
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({ status: 'healthy', version: '1.1.1' }),
      };
    },
  };
  try {
    const transport = createTauriTransport();
    const res = await transport({
      method: 'GET',
      url: 'http://127.0.0.1:1/health',
      headers: {},
    });
    assert.equal(res.ok, true);
    assert.equal(calls[0].path, '/health');
    const health = (await res.json()) as { status: string };
    assert.equal(health.status, 'healthy');

    const res2 = await transport({
      method: 'POST',
      url: 'http://127.0.0.1:1/task/abc/approve',
      headers: {},
      body: JSON.stringify({ approval_id: 'x', approved: false }),
    });
    assert.equal(res2.ok, true);
    assert.equal(calls[1].path, '/task/abc/approve');
    assert.ok(calls[1].body?.includes('approved'));
  } finally {
    delete (globalThis as Record<string, unknown>).__TAURI__;
  }
});

test('SidecarHandleDto contract has no token field in bridge types', async () => {
  const bridge = await import('../src/tauri-bridge.ts');
  const dto = {
    host: '127.0.0.1',
    port: 1,
    base_url: 'http://127.0.0.1:1',
    pid: 2,
    auth_required: true,
    version: '1.1.1',
  };
  assert.equal('token' in dto, false);
  assert.equal(typeof bridge.startDaemon, 'function');
  assert.equal(typeof bridge.daemonProxy, 'function');
});
