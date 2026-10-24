import test from 'node:test';
import { captureReferenceFrames } from './support/reference-frames.mjs';

test('引用布局：80×24/48×18确认/读取/失败路径可翻页，披露与取消不被挤掉', async () => {
  await captureReferenceFrames();
});
