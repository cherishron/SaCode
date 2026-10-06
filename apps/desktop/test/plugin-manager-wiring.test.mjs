// 插件清单接线的端到端验收。契约面：docs/evidence/plugin-manager-contract-2026-10-05.md §3。
// 上游口径（冻结 639ed01 的 plugin-manager/manager-store.ts 开头注释）：每一个事实都来自宿主，
// 每次动作后都要重读——所以这一组断言全部走协议面，不接受渲染层自己记状态，
// 也不接受「先造一份静态包清单把页面点亮」。判据是盘上的真事实：
// 换一个全新的宿主进程重读，清单必须还是同一份。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.SACODE_HOST || join(HERE, '..', 'dist', 'host', 'bin', 'sacode-host.exe');

// 造一个本地插件包源目录。manifest 的四个必填字段与核心 psSource 用的那份一致，
// 多出来的字段由调用方给（检视面要验 description 是否原样带出）。
function makePluginSrc(dir, name, extraFields) {
  mkdirSync(dir, { recursive: true });
  const base = `{"name":${JSON.stringify(name)},"version":"0.1.0","kind":"tool","entry":"index.cjs"`;
  const tail = extraFields ? `,"${extraFields[0]}":${JSON.stringify(extraFields[1])}` : '';
  writeFileSync(join(dir, 'sacode.plugin.json'), base + tail + '}');
  writeFileSync(join(dir, 'index.cjs'), "module.exports = { name: 'echo', handler: () => 'ok' }\n");
  return dir;
}

async function boot(dir) {
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'user-settings') });
  await bridge.start(dir);
  return bridge;
}

// 只取清单里那个包，方便断言；没有就返回 undefined。
function pkg(inventory, name) {
  return (inventory.packages || []).find((p) => p.name === name);
}

test('装-启-停-卸四动作都落在宿主真事实上，换进程重读不变', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-plugin-wiring-'));
  const bridge = await boot(dir);
  try {
    // 空态必须是 available:true + packages:[]：「还没装」不是「本部署不管理插件」，
    // 混成 available:false 界面就会把空态渲染成错误态。
    const empty = await bridge.request('plugin/inventory');
    assert.equal(empty.available, true, '空清单也必须声明本部署管理插件档案');
    assert.equal(empty.revision, 0, '全新用户目录的修订号从 0 起');
    assert.deepEqual(empty.packages, []);

    const src = makePluginSrc(join(dir, 'src-echo'), '@local/sacode-tool-echo', ['description', '回显一条消息']);
    const inspected = await bridge.request('plugin/install/inspect', { spec: src, registry: null });
    assert.equal(inspected.status, 'accepted', `本地目录应当被接受，实际是 ${JSON.stringify(inspected)}`);
    assert.equal(inspected.name, '@local/sacode-tool-echo');
    assert.equal(inspected.version, '0.1.0');
    // 检视是预览，不是安装：动过修订号就说明它偷偷落位了。
    assert.equal((await bridge.request('plugin/inventory')).revision, 0, '检视不得落位');

    const started = await bridge.request('plugin/install/start', { spec: src, registry: null, requestId: 'req-1' });
    assert.equal(started.requestId, 'req-1', '应答必须认得出是在问哪一次安装');
    const progress = await bridge.request('plugin/install/progress', { requestId: 'req-1' });
    assert.equal(progress.requestId, 'req-1');
    assert.equal(progress.phase, 'done', `本地目录安装应当结算成 done，实际 ${progress.phase}`);

    const after = await bridge.request('plugin/inventory');
    assert.equal(pkg(after, '@local/sacode-tool-echo').installed, true);
    assert.equal(after.packages.length, 1);
    // 事件落盘才算真装上了：插件清单与 providers.log 同一条纪律——日志即真源。
    assert.ok(existsSync(join(dir, 'user-settings', 'plugins.log')), '安装事实必须落进用户目录的 plugins.log');

    // 停用再启用：两次写都带写前的修订号，每次成功都要把修订号推进一格。
    const off = await bridge.request('plugin/bundle/set-enabled', { name: '@local/sacode-tool-echo', enabled: false, expectedRevision: after.revision });
    assert.equal(pkg(off, '@local/sacode-tool-echo').enabled, false, '停用必须在写后的清单里立刻可见');
    assert.equal(off.revision, after.revision + 1, '每一次写都要推进修订号');
    const on = await bridge.request('plugin/bundle/set-enabled', { name: '@local/sacode-tool-echo', enabled: true, expectedRevision: off.revision });
    assert.equal(pkg(on, '@local/sacode-tool-echo').enabled, true);

    // 卸载：清单里没了，目录也没了——只删事件不删目录会留下孤儿包，
    // 只删目录不删事件会得到一条指向不存在目录的记录，两者都是「装了但打不开」。
    const removed = await bridge.request('plugin/bundle/remove', { name: '@local/sacode-tool-echo', expectedRevision: on.revision });
    assert.equal(pkg(removed, '@local/sacode-tool-echo'), undefined, '卸载后不能再出现在清单里');
    assert.equal(existsSync(join(dir, 'user-settings', 'plugins', 'local-sacode-tool-echo')), false, '卸载要把包目录一起撤掉');

    // 换进程重读：上游那条「别的表面改过这里不用手动刷新」的反面证明——
    // 如果状态只在内存里，新进程会看到一个还在的包或一个不存在的包，两边都对不上。
    const second = await boot(dir);
    try {
      const reread = await second.request('plugin/inventory');
      assert.deepEqual(reread.packages, [], '卸载事实必须跨进程成立');
      assert.equal(reread.revision, removed.revision, '修订号是真源里的计数，不是进程内的计数');
    } finally {
      await second.stop();
    }
  } finally {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('修订号过期的写动作被拒，并且盘上事实一字未动', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-plugin-conflict-'));
  const bridge = await boot(dir);
  try {
    const src = makePluginSrc(join(dir, 'src-echo'), '@local/sacode-tool-echo');
    await bridge.request('plugin/install/start', { spec: src, registry: null, requestId: 'req-c1' });
    const view = await bridge.request('plugin/inventory');
    assert.equal(view.packages.length, 1);

    // 拿写之前的修订号（0）去改一个已经到 1 的档案：必须是冲突而不是「静默成功」。
    await assert.rejects(
      () => bridge.request('plugin/bundle/set-enabled', { name: '@local/sacode-tool-echo', enabled: false, expectedRevision: 0 }),
      /-32031 plugin-conflict/,
      '修订号不匹配要报 -32031，让界面重读后让用户重试'
    );
    const still = await bridge.request('plugin/inventory');
    assert.equal(pkg(still, '@local/sacode-tool-echo').enabled, true, '被拒的写不能留下半改状态');
    assert.equal(still.revision, view.revision, '被拒的写不推进修订号');

    // 不存在的包：not-found 与 conflict 必须分开，合并成「操作失败」就丢掉了唯一可执行的信息。
    await assert.rejects(
      () => bridge.request('plugin/bundle/remove', { name: '@local/nope', expectedRevision: still.revision }),
      /-32032 plugin-not-found/
    );
    // 非法定位：spec 指向一个不存在的目录，检视要如实说 not-found，而不是抛一个看不见的错。
    const missing = await bridge.request('plugin/install/inspect', { spec: join(dir, 'no-such-dir'), registry: null });
    assert.equal(missing.status, 'refused');
    assert.equal(missing.problem, 'not-found');
  } finally {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('安装任务的修订与远端源不在这一片：注册表只报本机事实，未接的动作如实拒绝', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-plugin-honest-'));
  const bridge = await boot(dir);
  try {
    // 注册表面前只接本机：没有配置任何远端源时必须如实报空，
    // 不能回一个 https://registry.npmjs.org/ 让界面以为「有默认源可装」。
    const reg = await bridge.request('plugin/registries');
    assert.equal(reg.registry, null);
    assert.deepEqual(reg.fallbackRegistries, []);

    // npm 名形态还没接（这一片只接本地目录）：必须明确拒绝并给出 problem，
    // 而不是当成一个不存在的本地目录报 not-found——那会把用户指向错的方向。
    const npmSpec = await bridge.request('plugin/install/inspect', { spec: '@local/from-npm', registry: null });
    assert.equal(npmSpec.status, 'refused');
    assert.equal(npmSpec.problem, 'invalid');

    // 行级启用属于装配层（要有 live entry 才知道改哪一行），装配内核还没接：如实拒绝。
    await assert.rejects(
      () => bridge.request('plugin/entry/set-enabled', { entryId: 'echo', enabled: true, expectedRevision: 1 }),
      /-32033 plugin-entry-not-wired/
    );
  } finally {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('主进程字段守卫：修订号、启用位、包名与 spec 逐字段校验', async () => {
  const guard = require('../plugins-guard.cjs');
  // expectedRevision 缺失、0、负数、非整数、Infinity 一律拒（协议面上 -1 = 无条件写不可达）。
  for (const bad of [undefined, 0, -1, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', true, null]) {
    assert.throws(() => guard.sanitizeRevision(bad), /missing-revision|bad-revision/, `修订号 ${String(bad)} 应当被拒`);
  }
  assert.equal(guard.sanitizeRevision(1), 1);
  // enabled 只收布尔：'true' 与 1 会被当成「用户想启用」，那是猜默认值。
  for (const bad of ['true', 1, 0, null, undefined]) assert.throws(() => guard.sanitizeEnabled(bad), /bad-enabled/);
  assert.equal(guard.sanitizeEnabled(false), false);
  // 名字：1..214、无控制字符。
  assert.throws(() => guard.sanitizeName(''), /bad-plugin-name/);
  assert.throws(() => guard.sanitizeName('a'.repeat(215)), /bad-plugin-name/);
  assert.throws(() => guard.sanitizeName('带\n换行'), /bad-plugin-name/);
  assert.equal(guard.sanitizeName('@local/sacode-tool-echo'), '@local/sacode-tool-echo');
  // entryId 同规则。
  assert.throws(() => guard.sanitizeEntryId(undefined), /bad-entry-id/);
  assert.equal(guard.sanitizeEntryId('echo'), 'echo');
  // spec：1..500、trim 后非空、无控制字符；主进程不解析它的内容。
  assert.throws(() => guard.sanitizeSpec('   '), /bad-plugin-spec/);
  assert.throws(() => guard.sanitizeSpec('x'.repeat(501)), /bad-plugin-spec/);
  assert.throws(() => guard.sanitizeSpec('带\t制表'), /bad-plugin-spec/);
  // registry：http(s) URL 或 null（空串与 null 同义：用本机自己配置里那个源）。
  assert.equal(guard.sanitizeRegistry(null), null);
  assert.equal(guard.sanitizeRegistry(''), null);
  assert.equal(guard.sanitizeRegistry('https://registry.npmmirror.com/'), 'https://registry.npmmirror.com/');
  for (const bad of ['file:///c:/etc', 'javascript:alert(1)', 'https://a'.repeat(40), 42]) {
    assert.throws(() => guard.sanitizeRegistry(bad), /bad-plugin-registry/, `registry ${String(bad)} 应当被拒`);
  }
});
