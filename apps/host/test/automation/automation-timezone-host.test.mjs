import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureHostEnv } from '../../../desktop/test-support/fixture-env.mjs';

const require = createRequire(import.meta.url);
const { HostBridge } = require('../../../desktop/host-bridge.cjs');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const hostPath = process.env.SACODE_HOST || '';
const canRun = hostPath && existsSync(join(dirname(hostPath), 'zoneinfo', 'Asia', 'Shanghai'));

test('真实 Windows Host 通过随包 TZif 保存 Asia/Shanghai 自动化配置', {
  timeout: 90000,
  skip: !canRun,
}, async () => {
  const root = join(repository, 'apps', 'desktop', '.tmp-test', `automation-timezone-host-${process.pid}-${Date.now()}`);
  const settings = join(root, 'test-user-settings');
  const workspace = join(root, 'workspace');
  mkdirSync(settings, { recursive: true });
  mkdirSync(workspace, { recursive: true });

  const ownerId = 'f9c46aa289274bd785f24e6e4e54b7b1';
  writeFileSync(join(settings, 'installation-id'), `0\tprincipal/install\t${ownerId}\n`);
  const model = {
    ownerId,
    id: 'timezone-fixture',
    name: '本地时区夹具',
    description: '',
    enabled: true,
    category: 'coding',
    requires: ['text-output'],
    bindings: [],
    mode: 'weighted',
    sortOrder: 0,
    params: '',
    modalityBudget: '',
    dailyTokens: -1,
    monthlyTokens: -1,
    dailyAmountMicro: -1,
    monthlyAmountMicro: -1,
    maxOutputTokens: -1,
    probeEnabled: true,
    probeMaxPerDay: 3,
  };
  writeFileSync(join(settings, 'custom-models.log'), `0\tcustom/upsert\t${JSON.stringify(model)}\n`);

  const env = fixtureHostEnv(root);
  delete env.CJ_TZPATH;
  const bridge = new HostBridge(resolve(hostPath), env);
  try {
    await bridge.start(workspace);
    await bridge.request('initialize');
    const initial = await bridge.request('automation/list', { sessionId: 'current', scope: 'user' });
    const saved = await bridge.request('automation/save', {
      sessionId: 'current',
      scope: 'user',
      revision: initial.revision,
      definition: {
        id: 'timezone-fixture-task',
        title: '验证时区数据',
        prompt: '仅验证配置持久化，不执行模型任务',
        cron: '0 9 * * *',
        workspace,
        modelId: 'timezone-fixture',
        timezone: 'Asia/Shanghai',
        permission: 'plan',
        enabled: true,
      },
    });
    assert.equal(saved.revision, initial.revision + 1);
    assert.equal(saved.tasks[0].id, 'timezone-fixture-task');
    assert.match(readFileSync(join(settings, 'automation-user.log'), 'utf8'), /Asia\/Shanghai/);
    assert.equal(saved.executorAvailable, false, '只验证保存，不声称调度执行器已接通');
    await assert.rejects(bridge.request('automation/save', {
      sessionId: 'current',
      scope: 'user',
      revision: saved.revision,
      definition: {
        id: 'timezone-invalid-fixture-task',
        title: '验证时区错误',
        prompt: '不执行模型任务',
        cron: '0 9 * * *',
        workspace,
        modelId: 'timezone-fixture',
        timezone: 'No/Such-Timezone',
        permission: 'plan',
        enabled: true,
      },
    }), /automation-timezone-load-failed/);
  } finally {
    await bridge.stop(10000).catch(() => {});
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
