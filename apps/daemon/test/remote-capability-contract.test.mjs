import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 按仓库根解析，不靠 cwd：从 apps/daemon 下跑 `node --test test/...` 时
// 相对路径会指到 apps/daemon/docs/plans/，整份文件在 import 阶段就 ENOENT。
const root = path.resolve(import.meta.dirname, '../../..');
const rows = JSON.parse(readFileSync(path.join(root, 'docs/plans/remote-capability-contract.json'), 'utf8'));

const validPermissions = new Set(['read', 'write', 'execute', 'approval', 'management']);
// clientConsumers 是消费登记，不替代 daemon runtime 的 token/scope/resource 校验。
const validConsumers = new Set(['desktop', 'mobile', 'cli', 'web']);
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

test('web 仅登记首批三个原生只读动作，不包含写入或管理', () => {
  const web = rows.filter(row => row.clientConsumers.includes('web'));
  assert.deepEqual(web.map(row => row.method).sort(), ['initialize', 'session/catalog', 'session/events'].sort());
  for (const row of web) {
    assert.equal(row.permission, 'read');
    assert.equal(row.durable, false);
    assert.equal(row.requiredScope, null);
  }
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

// 设计 §4.2「设备列表、确认、撤销只能通过本机受保护管理入口」——
// 移动设备面绝不能出现 device-admin 动作，即使 granted scope=management 也不能。
// 这条是硬红线，避免有人后续给 mobile 加进 clientConsumers 开后门。
test('device-admin 面（auth/devices/auth/revoke）只能 desktop 消费', () => {
  const DEVICE_ADMIN = new Set(['auth/devices', 'auth/revoke']);
  for (const row of rows) {
    if (DEVICE_ADMIN.has(row.method)) {
      assert.deepEqual(
        row.clientConsumers, ['desktop'],
        `${row.method} 只能由 desktop 消费，当前：${row.clientConsumers.join(',')}`
      );
    }
  }
});

// 计划 §1「资源键只能是明确 workspaceId/sessionId，不用隐式 currentSession」——
// 契约里若出现别的 resourceKey（deviceId/operationId/customId 之类）说明设计口径漂了。
test('resourceKeys 值域严格 ⊂ {workspaceId, sessionId}', () => {
  const ALLOWED = new Set(['workspaceId', 'sessionId']);
  for (const row of rows) {
    for (const k of row.resourceKeys) {
      assert.ok(
        ALLOWED.has(k),
        `${row.method}: resourceKeys 出现非白名单值 "${k}"`
      );
    }
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


// 转发面与两份清单的三方对账（契约表 / 宿主能力清单 / daemon 白名单）。
// 这一组检查的存在理由：白名单此前只有 16 条硬编名字，与契约表 119 行、
// 宿主实际声明的 120 条能力各自漂移，远程客户端能打到什么面完全靠人记。
// 「宿主声明但契约没有」的名字（turn/start、extension/host/*、appearance/set-theme）
// 是宿主内部管道或历史别名，刻意不进远程面；这里用子集极性写，将来宿主新增能力
// 不会让本仓现有断言变红，只有「我转发了宿主不认的名字」才会红。
const hostCaps = JSON.parse(
  readFileSync(path.join(root, 'docs/plans/host-capabilities.json'), 'utf8'));
const hostCapSet = new Set(hostCaps);
const proxySource = readFileSync(path.join(root, 'apps/daemon/src/host_proxy.cj'), 'utf8');
const forwardMatch = proxySource.match(/let hostMethods = \[([\s\S]*?)\]/);
assert.ok(forwardMatch, '解析不到 host_proxy.cj 里的 hostMethods 数组');
const forwarded = (forwardMatch[1].match(/"[^"]+"/g) || []).map(s => s.slice(1, -1));
const forwardedSet = new Set(forwarded);

// daemon 自己实现、不经宿主的方法：这些不在转发白名单里是对的。
// session/events 自 50633ef 起属于这一类：宿主本人不声明它，补读面在
// apps/daemon/src/event_replay.cj 里按会话日志的持久前缀回答。
const DAEMON_LOCAL = new Set([
  'initialize', 'session/catalog', 'session/events', 'daemon/shutdown',
  'auth/enroll', 'auth/token', 'auth/devices', 'auth/revoke',
]);

// 宿主有这条方法，但它的语义是「长连接通知」：本代理的读线程统一收帧后送 bus，
// 一次性 HTTP RPC 转过去只会等到一个永远不来的应答。host_proxy.cj 的注释是权威，
// 这里只是把同一条例外写进推导，别让白名单被机械地"补全"回一条死路。
const PROXY_OWNED_STREAM = new Set(['session/subscribe']);

test('转发白名单里每条方法都必须同时出现在契约表与宿主能力清单', () => {
  const notInContract = forwarded.filter(m => !rows.some(r => r.method === m));
  const notInHostCaps = forwarded.filter(m => !hostCapSet.has(m));
  const shouldNotForward = forwarded.filter(m => DAEMON_LOCAL.has(m) || PROXY_OWNED_STREAM.has(m));
  assert.deepEqual(notInContract, [], '转发了契约里没有的方法（过度宣称）：' + notInContract.join(','));
  assert.deepEqual(notInHostCaps, [], '转发了宿主能力清单里没有的方法（宿主会回 method not found）：' + notInHostCaps.join(','));
  assert.deepEqual(shouldNotForward, [], '转发了 daemon 自有或代理自留长连接的方法：' + shouldNotForward.join(','));
  assert.equal(forwarded.length, forwardedSet.size, '白名单不得有重名');
});

test('契约里已实现、需经宿主且非桌面专属的方法必须在转发白名单内', () => {
  const missing = [];
  for (const row of rows) {
    if (DAEMON_LOCAL.has(row.method)) continue;
    if (PROXY_OWNED_STREAM.has(row.method)) continue;
    if (row.method.startsWith('team/')) continue;   // 团队面由 TeamHost 承接，另有一条分派支
    if (/^拟新增/.test(row.implementationAnchor)) continue;
    if (!hostCapSet.has(row.method)) continue;      // 宿主尚未声明的属未发布能力，不得转发
    const remoteFacing = (row.clientConsumers || []).some(c => c === 'mobile' || c === 'cli');
    if (!remoteFacing) continue;
    if (!forwardedSet.has(row.method)) missing.push(row.method);
  }
  assert.deepEqual(missing, [], '以下远程消费的方法宿主已声明、契约已实现，却打不进远程面：\n  ' + missing.join('\n  '));
});

test('转发白名单等于「契约 ∩ 宿主能力 − 本地 − 团队」这一推导集', () => {
  const expected = rows
    .filter(r => !DAEMON_LOCAL.has(r.method) && !PROXY_OWNED_STREAM.has(r.method)
      && !r.method.startsWith('team/') && hostCapSet.has(r.method))
    .map(r => r.method)
    .sort();
  assert.deepEqual([...forwardedSet].sort(), expected,
    '白名单与推导集不一致（多出的或缺失的都会在这里现形）');
  assert.ok(expected.length > 60, '推导集过小说明契约或能力清单被误删，实得 ' + expected.length);
});
