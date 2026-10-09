import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync('docs/plans/remote-capability-contract.json', 'utf8'));

const validPermissions = new Set(['read', 'write', 'execute', 'approval', 'management']);
const validConsumers = new Set(['desktop', 'mobile', 'cli']);
const scopePermissions = new Set(['execute', 'approval', 'management']);

test('契约非空', () => {
  assert.ok(rows.length > 0, 'capability contract must not be empty');
});

test('method 名唯一', () => {
  const methods = rows.map(x => x.method);
  assert.equal(new Set(methods).size, methods.length, 'method names must be unique');
});

test('每行必填字段与合法枚举', () => {
  for (const row of rows) {
    assert.ok(row.implementationAnchor, `${row.method}: implementationAnchor required`);
    assert.ok(row.permission, `${row.method}: permission required`);
    assert.ok(validPermissions.has(row.permission), `${row.method}: invalid permission "${row.permission}"`);
    assert.ok(Array.isArray(row.resourceKeys), `${row.method}: resourceKeys must be array`);
    assert.ok(typeof row.durable === 'boolean', `${row.method}: durable must be boolean`);
    if (row.permission !== 'read') {
      assert.equal(row.idempotent, true, `${row.method}: write/execute/approval/management must be idempotent`);
    }
    assert.ok(Array.isArray(row.clientConsumers) && row.clientConsumers.length > 0, `${row.method}: clientConsumers required`);
    for (const c of row.clientConsumers) {
      assert.ok(validConsumers.has(c), `${row.method}: invalid consumer "${c}"`);
    }
  }
});

test('execute/approval/management 必须声明 requiredScope；read/write 不得声明', () => {
  for (const row of rows) {
    const notDeclared = row.requiredScope === undefined || row.requiredScope === null || row.requiredScope === '';
    if (scopePermissions.has(row.permission)) {
      assert.equal(
        notDeclared, false,
        `${row.method}: permission=${row.permission} 缺 requiredScope`
      );
    } else {
      assert.equal(
        notDeclared, true,
        `${row.method}: permission=${row.permission} 不应有 requiredScope`
      );
    }
  }
});

test('requiredScope 只允许 execute/approval/management 三种', () => {
  for (const row of rows) {
    if (row.requiredScope !== undefined && row.requiredScope !== null && row.requiredScope !== '') {
      assert.ok(
        scopePermissions.has(row.requiredScope),
        `${row.method}: requiredScope "${row.requiredScope}" 不在允许集合`
      );
    }
  }
});

test('mobile 客户端方法面 >50 条', () => {
  const mobileMethods = rows.filter(r => r.clientConsumers.includes('mobile'));
  assert.ok(mobileMethods.length > 50, `mobile must have >50 methods, got ${mobileMethods.length}`);
});

test('至少一条 durable 方法（会话日志真源）', () => {
  const durableMethods = rows.filter(r => r.durable);
  assert.ok(durableMethods.length > 0, 'must have durable methods');
});

test('auth/* 方法固定 4 条（enroll/exchange/revoke/refresh）', () => {
  const authMethods = rows.filter(r => r.method.startsWith('auth/'));
  assert.equal(authMethods.length, 4, 'must have 4 auth methods');
});

test('每条方法 implementationAnchor 都指向 core 或 apps/*（未落地的允许「拟新增: 」前缀）', () => {
  for (const row of rows) {
    const stripped = row.implementationAnchor.replace(/^拟新增:\s*/, '');
    assert.match(
      stripped,
      /^(core|apps\/(host|cli|daemon))\//,
      `${row.method}: implementationAnchor "${row.implementationAnchor}" 不在允许前缀内`
    );
  }
});

// 「无 resourceKey 的 management/write」必须是白名单里明确的全局动作，
// 防止后续新增管理方法忘了声明资源键（例如 auth/revoke 应当带 deviceId 却漏）。
test('management/write 且 resourceKeys 为空的动作，只允许白名单里的全局/无资源动作', () => {
  const GLOBAL_NO_RESOURCE = new Set([
    'global/appearance/set-theme',
    'global/appearance/set-font-size',
    'global/appearance/set-busy-send',
    'global/settings/set-transcript-view',
    'global/settings/set-composer-enter',
    'global/settings/set-session-log',
    'tips/set-hidden',
    'daemon/shutdown',
    'auth/devices',           // 列表：作用域在 management 本身
    'auth/revoke',            // 撤销：目标 deviceId 由 management 范围门控；契约层无独立资源键
  ]);
  const offending = [];
  for (const row of rows) {
    if (
      (row.permission === 'management' || row.permission === 'write') &&
      row.resourceKeys.length === 0 &&
      !GLOBAL_NO_RESOURCE.has(row.method)
    ) {
      offending.push(`${row.method} (${row.permission})`);
    }
  }
  assert.deepEqual(
    offending, [],
    '以下 write/management 方法既无 resourceKeys 又不在全局白名单：\n  ' + offending.join('\n  ')
  );
});

