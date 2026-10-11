// 批次 F 的「不默认算已解决」：本文件钉住后端对插件缺口的**当前真实契约**。
// 断言对象是「没有这个动词」「返回空壳」「诚实回未接线错误」这三件事本身——
// 任何一条绿都不得被读成对应功能可用；反证口径：一旦后端真接上远程源 / 组件启停 / 安装取消，
// 对应断言必须立刻转红，那时应把它改写成真实语义的用例，而不是把这条删掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realHostEnv } from '../test-support/real-host-env.mjs';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');
const host = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));

async function withHost(run) {
  assert.ok(existsSync(host), '缺少自包含宿主');
  const directory = mkdtempSync(join(tmpdir(), 'sacode-plugin-gap-'));
  const bridge = new HostBridge(host, realHostEnv(directory, host));
  try {
    await bridge.start(directory);
    const cap = await bridge.request('initialize');
    return await run(bridge, cap);
  } finally {
    const stop = await bridge.stop();
    assert.equal(stop.forced, false, '宿主必须靠 stdin EOF 自行退出，不能靠强杀收尾');
  }
}

test('缺口三现状：能力清单里有 install/start 但没有 install/cancel，取消无可寻址通道', async () => {
  await withHost(async (_bridge, cap) => {
    const caps = cap.capabilities || [];
    // 正控：先证明这份宿主确实报了插件安装面，否则下面的否定断言是空场上赢的。
    assert.ok(caps.includes('plugin/install/start'), '本用例的前提是宿主报出 install/start');
    assert.ok(caps.includes('plugin/install/progress'), '本用例的前提是宿主报出 install/progress');
    assert.equal(caps.includes('plugin/install/cancel'), false,
      '后端若补上 cancel 动词，这条必须转红——那时应改写为真实取消语义的用例');
  });
});

test('缺口一现状：plugin/registries 是空壳返回（registry=null 且 fallbackRegistries 为空）', async () => {
  await withHost(async (bridge) => {
    const got = await bridge.request('plugin/registries');
    assert.equal(got.registry, null, '远程源若真接上，这里不该再是 null');
    assert.deepEqual(got.fallbackRegistries, [], '远程源若真接上，这里不该再是空数组');
  });
});

test('缺口二现状：plugin/entry/set-enabled 诚实回 plugin-entry-not-wired 而不是假成功', async () => {
  await withHost(async (bridge) => {
    await assert.rejects(
      () => bridge.request('plugin/entry/set-enabled', { entryId: 'gap-probe/entry', enabled: true, expectedRevision: 0 }),
      /plugin-entry-not-wired/,
      '组件级启停若已接线，这里应返回落盘后的清单而不是该错误码'
    );
  });
});
