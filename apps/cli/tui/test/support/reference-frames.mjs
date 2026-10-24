// 文本引用确认的合成字格取样；不启动Host、不读用户文件、不发模型请求。
import assert from 'node:assert/strict';
import React from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ReferenceConfirmation } from '../../src/reference-confirmation.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function captureReferenceFrames() {
  const frames = {};
  for (const [width, height] of [[80, 24], [48, 18]]) {
    for (const status of ['confirm', 'reading', 'failed']) {
      const view = { status, selected: 1, paths: Array.from({ length: 8 }, (_, i) => `src/${'长路径/'.repeat(10)}引用-${i}.txt`),
        identity: { directory: 'D:/project/' + '长工作区/'.repeat(10) },
        ...(status === 'reading' ? { progress: '取消已请求，等待当前读取结算；不会发送' } : {}),
        ...(status === 'failed' ? { error: '引用读取失败；工具记录已结算，消息未发送，请修正后重试' } : {}) };
      const app = render(React.createElement(Box, { width, flexDirection: 'column' },
        React.createElement(ReferenceConfirmation, { view, height })));
      try {
        await sleep(40);
        const check = (name) => {
          const frame = app.lastFrame();
          assert.ok(frame.split('\n').length <= height);
          assert.ok(frame.split('\n').every((line) => stringWidth(line) <= width));
          assert.match(frame, /正文将保存到会话/);
          assert.match(frame, /❯ 取消（默认，保留草稿）/);
          assert.doesNotMatch(frame, /Enter 发送|输入任务，或/);
          frames[`${width}x${height}-${name}`] = frame;
        };
        check(status + '-top');
        for (let i = 0; i < 15; i++) { app.stdin.write('\x1b[6~'); await sleep(10); }
        assert.match(app.lastFrame(), status === 'failed' ? /消息未发送/ : /引用-7.txt/);
        check(status + '-bottom');
      } finally { app.unmount(); app.cleanup(); }
    }
  }
  return frames;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('需指定target/tmp下输出帧路径');
  const frames = await captureReferenceFrames();
  writeFileSync(process.argv[2], JSON.stringify(frames, null, 2));
  console.log(`文本引用合成帧${Object.keys(frames).length}；确认/读取取消/失败/全部路径翻页/默认取消可见`);
}
