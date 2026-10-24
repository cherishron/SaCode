// 技能只读协议回归：initialize/首次绑定/同会话换项目/冷启动都不得读缓存空目录。
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { HostBridge } = createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const host = process.env.SACODE_HOST;
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const enabled = !!host && existsSync(host);

function fixture() {
  const root = mkdtempSync(join(repo, 'target/tmp/host-skill-discovery-'));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const body = (name, marker) => `---\nname: ${name}\ndescription: synthetic read-only regression\n---\n# ${marker}\n`;
  mkdirSync(join(first, '.sa-code/skills/discovery-first'), { recursive: true });
  mkdirSync(join(second, '.sa-code/skills'), { recursive: true });
  writeFileSync(join(first, '.sa-code/skills/discovery-first/SKILL.md'), body('discovery-first', 'FIRST_BODY'));
  writeFileSync(join(first, '.sa-code/skills/discovery-flat.md'), body('discovery-flat', 'FLAT_BODY'));
  writeFileSync(join(first, '.sa-code/skills/invalid.md'), '---\nname: Invalid Name\ndescription: bad candidate\n---\nINVALID_BODY');
  writeFileSync(join(first, '.sa-code/skills/oversize.md'), body('discovery-oversize', 'x'.repeat(70000)));
  writeFileSync(join(second, '.sa-code/skills/discovery-second.md'), body('discovery-second', 'SECOND_BODY'));
  return { root, first, second };
}

async function boot(root) {
  const bridge = new HostBridge(resolve(host), { ...process.env,
    SACODE_USER_SETTINGS_DIR: join(root, 'settings'), TEMP: root, TMP: root,
  });
  await bridge.start(root);
  await bridge.request('initialize'); // 必须先初始化，不能靠先选择会话掩盖过早缓存。
  return bridge;
}

async function names(bridge) {
  const list = await bridge.request('skill/list', {});
  assert.ok(Array.isArray(list));
  return list.map((item) => item.name);
}

test('技能发现：initialize 后首次绑定项目，无需重选会话即可列目录/平铺与正文', { skip: !enabled }, async () => {
  const { root, first } = fixture();
  let bridge;
  try {
    bridge = await boot(root);
    assert.ok(!(await names(bridge)).includes('discovery-first'));
    await bridge.request('workspace/set-directory', { sessionId: 'current', directory: first });
    const before = await bridge.request('session/projection');
    const found = await names(bridge);
    assert.ok(found.includes('discovery-first'), '目录式技能必须在首次绑定后可见');
    assert.ok(found.includes('discovery-flat'), '平铺技能必须在首次绑定后可见');
    assert.ok(!found.includes('Invalid Name'), '格式非法候选仍然被拒绝');
    assert.ok(!found.includes('discovery-oversize'), '超出既有读取预算仍然被拒绝');
    const content = await bridge.request('skill/get', { name: 'discovery-first' });
    assert.match(content.content, /FIRST_BODY/);
    await assert.rejects(bridge.request('skill/get', { name: 'discovery-oversize' }), /skill-not-found/);
    assert.equal((await bridge.request('session/projection')).events, before.events, '发现/读取不写会话事件');
  } finally { if (bridge) await bridge.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('技能发现：同会话切项目后立即改读新目录，不泄漏前一项目正文', { skip: !enabled }, async () => {
  const { root, first, second } = fixture();
  let bridge;
  try {
    bridge = await boot(root);
    await bridge.request('workspace/set-directory', { directory: first });
    assert.ok((await names(bridge)).includes('discovery-first'));
    await bridge.request('workspace/set-directory', { directory: second });
    const found = await names(bridge);
    assert.ok(found.includes('discovery-second'));
    assert.ok(!found.includes('discovery-first'));
    await assert.rejects(bridge.request('skill/get', { name: 'discovery-first' }), /skill-not-found/);
    assert.match((await bridge.request('skill/get', { name: 'discovery-second' })).content, /SECOND_BODY/);
  } finally { if (bridge) await bridge.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('技能发现：冷启动及切回已有会话直接回读持久目录，不需要补一次select刷新', { skip: !enabled }, async () => {
  const { root, first, second } = fixture();
  let bridge;
  try {
    bridge = await boot(root);
    await bridge.request('workspace/set-directory', { directory: first });
    await bridge.stop();
    bridge = await boot(root);
    assert.ok((await names(bridge)).includes('discovery-first'), '冷启动应按盘上目录发现');
    const created = await bridge.request('session/create', { title: '合成第二会话' });
    await bridge.request('session/select', { sessionId: created.id });
    await bridge.request('workspace/set-directory', { sessionId: created.id, directory: second });
    assert.ok((await names(bridge)).includes('discovery-second'));
    await bridge.request('session/select', { sessionId: 'current' });
    assert.ok((await names(bridge)).includes('discovery-first'));
    assert.ok(!(await names(bridge)).includes('discovery-second'));
  } finally { if (bridge) await bridge.stop(); rmSync(root, { recursive: true, force: true }); }
});
