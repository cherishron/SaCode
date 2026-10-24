// 合成会话帧与字格断言：不启动Host，不接触用户会话或模型。
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { App } from '../../src/app.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function captureSessionFrames() {
  const frames = {};
  for (const [width, height] of [[80, 24], [48, 18]]) {
    const entries = [{ id: 's1', title: '原标题'.repeat(50), durable: 2, current: true, archived: false },
      { id: 's2', title: '历史项目', durable: 3, archived: false, workspaceDirectory: 'D:/' + '长路径/'.repeat(50) },
      { id: 's3', title: '已归档项目', durable: 4, archived: true }];
    const replies = {
      initialize: { capabilities: ['session/rename', 'session/archive'] },
      'session/catalog': { entries }, 'workspace/get': { directory: 'D:/demo' },
      'usage/status': { used: 12, budget: 8000 },
      'session/projection': { sessionId: 's1', messageRows: [], toolCalls: [] },
      'model/registry/describe': { providers: [{ id: 'demo' }], defaultProviderId: 'demo', defaultModel: 'demo' },
    };
    const calls = [];
    const client = { stderrText: '', onNotification() { return () => {}; }, async request(method) {
      calls.push(method);
      if (!(method in replies)) throw new Error(`unexpected ${method}`);
      return replies[method];
    } };
    const app = render(React.createElement(App, { client, hostPath: 'synthetic', mode: 'screen' }));
    const waitFor = async (pattern) => {
      for (let i = 0; i < 100 && !pattern.test(app.lastFrame() || ''); i++) await sleep(20);
      assert.match(app.lastFrame(), pattern); await sleep(25);
    };
    const key = async (input) => { app.stdin.write(input); await sleep(35); };
    const capture = (name) => {
      const frame = app.lastFrame();
      assert.ok(frame.split('\n').length <= height, `${name}高度超出${height}`);
      assert.ok(frame.split('\n').every((line) => stringWidth(line) <= width), `${name}宽度超出${width}`);
      assert.doesNotMatch(frame, /输入任务，或|Enter 发送/);
      frames[`${width}x${height}-${name}`] = frame;
    };
    try {
      await waitFor(/输入任务，或/);
      Object.defineProperty(app.stdout, 'columns', { value: width, configurable: true });
      Object.defineProperty(app.stdout, 'rows', { value: height, configurable: true });
      app.stdout.emit('resize'); await sleep(40);
      await key('/resume '); await key('\r'); await waitFor(/搜索：/);
      await key('\x1b[B'); capture('browser-long-directory');
      await key('不存在'); capture('no-matches');
      await key('\x15'); await key('\x01'); capture('archived');
      await key('\r'); await waitFor(/确认恢复归档/); capture('restore-default-cancel');
      await key('\r'); // 默认取消，绝不写。
      await key('/archive '); await key('\r'); await waitFor(/搜索：/);
      await key('\r'); await waitFor(/确认归档/); capture('archive-default-cancel');
      await key('\x1b');
      await key('/rename ' + '新标题'.repeat(50) + '标题尾部标记'); await key('\r');
      await waitFor(/确认重命名/); capture('rename-long-top');
      for (let i = 0; i < 30 && !app.lastFrame().includes('标题尾部标记'); i++) await key('\x1b[6~');
      assert.match(app.lastFrame(), /标题尾部标记/);
      assert.match(app.lastFrame(), /❯ 取消（默认）/);
      capture('rename-long-bottom');
      assert.ok(!calls.some((method) => ['session/rename', 'session/archive', 'session/select', 'session/append', 'task/start'].includes(method)));
    } finally { app.unmount(); app.cleanup(); }
  }
  return frames;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('需指定target/tmp下的帧输出文件');
  const frames = await captureSessionFrames();
  writeFileSync(process.argv[2], JSON.stringify(frames, null, 2));
  console.log(`会话合成帧${Object.keys(frames).length}：宽窄屏/长标题翻页/固定取消/无模型与元信息写请求`);
}
