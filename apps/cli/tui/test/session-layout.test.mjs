import test from 'node:test';
import { captureSessionFrames } from './support/session-frames.mjs';

test('会话布局：80×24/48×18长标题可翻页、取消固定可见、浏览/确认独占输入', async () => {
  await captureSessionFrames();
});
