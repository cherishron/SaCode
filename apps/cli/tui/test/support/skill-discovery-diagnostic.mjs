// 临时定位驱动：只创建合成技能，比较绑定前/后/冷启动，不读真实用户技能。
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { HostClient } from '../../src/host-client.mjs';

const root = mkdtempSync(resolve('target/tmp/skill-discovery-host-'));
const project = join(root, 'project');
mkdirSync(join(project, '.sa-code/skills/probe'), { recursive: true });
writeFileSync(join(project, '.sa-code/skills/probe/SKILL.md'), '---\nname: discovery-probe\ndescription: synthetic probe\n---\n# PROBE_BODY\n');
const client = new HostClient(process.env.SACODE_HOST, { cwd: root, env: {
  ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings'),
} });
try {
  await client.start();
  await client.request('initialize');
  console.log('before-bind', (await client.request('skill/list')).length);
  await client.request('workspace/set-directory', { directory: project });
  console.log('workspace-bound', (await client.request('workspace/get')).configured);
  console.log('after-bind', (await client.request('skill/list')).length);
  await client.request('session/select', { sessionId: 'current' });
  console.log('after-select', (await client.request('skill/list')).map((item) => item.name));
  await client.stop();
  await client.start();
  await client.request('initialize');
  console.log('after-restart', (await client.request('skill/list')).map((item) => item.name));
  await client.request('session/select', { sessionId: 'current' });
  console.log('after-restart-select', (await client.request('skill/list')).map((item) => item.name));
  console.log('detail-after-restart', (await client.request('skill/get', { name: 'discovery-probe' })).content.includes('PROBE_BODY'));
} finally { await client.stop(); }
console.log('evidence-root', root);
