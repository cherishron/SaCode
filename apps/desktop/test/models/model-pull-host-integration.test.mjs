// 显式指定中性位置 Host 时，验证实际 IPC handler → HostBridge → Host → HTTP。
// 不读用户配置、不发真实供应商请求；没有产物时明确跳过，不借旧 dist 默认为已验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { HostBridge } = require('../../host-bridge.cjs');
const { registerCustomsIpc } = require('../../customs-ipc.cjs');
const guard = require('../../customs-guard.cjs');
const host = process.env.SACODE_HOST;

test('真实Host：6.5秒模型发现成功，HTTP失败不冒充成功或修改清单', {
  timeout: 45000,
  skip: !host && '需显式设置 SACODE_HOST 为已验证的中性位置 Host；不默认借用 dist',
}, async () => {
  assert.ok(isAbsolute(host), 'SACODE_HOST 必须为绝对路径');
  const base = fileURLToPath(new URL('../../../../target/tmp/model-pull-integration/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'run-'));
  let deny = false;
  let requests = 0;
  let authMatched = true;
  const server = createServer((req, res) => {
    requests++;
    authMatched &&= req.headers.authorization === 'Bearer invalid-local-model-pull-fixture';
    const denied = deny;
    setTimeout(() => {
      res.writeHead(denied ? 401 : 200, { 'Content-Type': 'application/json' });
      res.end(denied ? '{"error":"denied"}' : '{"data":[{"id":"slow-model"}]}');
    }, denied ? 0 : 6500);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const bridge = new HostBridge(host, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  try {
    await bridge.start(dir);
    const empty = await bridge.request('model/registry/describe');
    const saved = await bridge.request('model/registry/update', {
      draft: { id: 'slow', name: '慢响应合成供应商', baseUrl: `http://127.0.0.1:${server.address().port}`,
        protocol: 'openai-completions', models: [{ id: 'original', name: '原模型', contextWindow: '', maxTokens: '', image: false }] },
      expectedRevision: empty.revision,
    });
    await bridge.request('model/registry/save-credential', {
      providerId: 'slow', expectedRevision: saved.revision, key: 'invalid-local-model-pull-fixture',
    });
    const handlers = {};
    registerCustomsIpc({ handle: (name, handler) => { handlers[name] = handler; } },
      (method, args, timeout) => bridge.request(method, args, timeout), guard, value => typeof value === 'string');
    const started = Date.now();
    const pulled = await handlers['sacode:modelPull']({}, { providerId: 'slow', expectedRevision: saved.revision });
    assert.ok(Date.now() - started >= 6000, '响应必须实际超过原来的5秒窗口');
    assert.deepEqual(pulled.providers.find(p => p.id === 'slow').models.map(m => m.id), ['original', 'slow-model']);
    assert.equal(pulled.late, undefined);
    deny = true;
    await assert.rejects(handlers['sacode:modelPull']({}, { providerId: 'slow', expectedRevision: pulled.revision }), /http-status:401/);
    const after = await bridge.request('model/registry/describe');
    assert.equal(after.revision, pulled.revision);
    assert.deepEqual(after.providers, pulled.providers);
    assert.equal(requests, 2, '每次操作只发一次请求，不盲目重试');
    assert.equal(authMatched, true, '只验证合成凭据是否正确送达，不输出认证头');
  } finally {
    try { await bridge.stop(); }
    finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
