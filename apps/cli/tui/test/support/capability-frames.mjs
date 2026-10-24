// 只读能力菜单合成取样，不连接服务、不读真实技能/凭据、不运行模型。
import React from 'react';
import { render } from 'ink-testing-library';
import { writeFileSync } from 'node:fs';
import { App } from '../../src/app.mjs';

const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = {};
for (const [width, height] of [[80, 24], [48, 18]]) {
  for (const command of ['/skills', '/mcp', '/permissions', '/plan']) {
    const replies = {
      initialize: { capabilities: ['skill/list', 'skill/get', 'mcp/list', 'mcp/status', 'approval/get-mode', 'plan/get-mode'] },
      'session/catalog': { entries: [{ id: 's1', current: true, title: '合成能力预览' }] },
      'workspace/get': { directory: 'D:/demo' }, 'usage/status': { used: 128, budget: 8000 },
      'session/projection': { sessionId: 's1', messageRows: [], toolCalls: [] },
      'model/registry/describe': { providers: [{ id: 'demo', name: '演示' }], defaultProviderId: 'demo', defaultModel: 'demo' },
      'skill/list': [{ name: 'review', description: '合成审查技能' }],
      'skill/get': { name: 'review', description: '仅浏览', content: '# 技能正文\n不自动执行。' },
      'mcp/list': { servers: ['synthetic-server'] }, 'mcp/status': { connected: false },
      'approval/get-mode': { ok: true, mode: 'build' }, 'plan/get-mode': { ok: true, active: false },
    };
    const client = { stderrText: '', onNotification() { return () => {}; }, async request(method) {
      if (!(method in replies)) throw new Error(`unexpected ${method}`);
      return replies[method];
    } };
    const app = render(React.createElement(App, { client, hostPath: 'synthetic', version: 'preview', mode: 'screen' }));
    try {
      await wait(100);
      Object.defineProperty(app.stdout, 'columns', { value: width, configurable: true });
      Object.defineProperty(app.stdout, 'rows', { value: height, configurable: true });
      app.stdout.emit('resize'); await wait();
      app.stdin.write(command); await wait(); app.stdin.write('\r'); await wait();
      frames[`${width}x${height}-${command.slice(1)}`] = app.lastFrame();
      if (command === '/skills' || command === '/mcp') {
        app.stdin.write('\r'); await wait();
        frames[`${width}x${height}-${command.slice(1)}-detail`] = app.lastFrame();
      }
      if (app.lastFrame().split('\n').length > height) throw new Error(`视口溢出：${command} ${width}x${height}`);
    } finally { app.unmount(); app.cleanup(); }
  }
}
if (!process.argv[2]) throw new Error('需指定target/tmp下的输出文件');
writeFileSync(process.argv[2], JSON.stringify(frames, null, 2));
console.log(`能力菜单合成帧 ${Object.keys(frames).length}，无Host/服务/模型请求`);
