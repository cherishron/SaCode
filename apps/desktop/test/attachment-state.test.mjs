import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = new URL('../renderer/attachment-state.js', import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(upload = async () => ({ receiptId: 'u1', attachment: { id: 'sha256:test' } })) {
  const revoked = [];
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(readFileSync(new URL('../renderer/vendor/vue.runtime.global.prod.js', import.meta.url), 'utf8'), context);
  let generation = 0;
  context.FileReader = class {
    readAsDataURL(file) { this.result = `data:${file.type};base64,aGVsbG8=`; this.onload(); }
  };
  context.URL = { createObjectURL: () => 'blob:preview', revokeObjectURL: value => revoked.push(value) };
  assert.ok(existsSync(modulePath), '附件状态模块尚未提取');
  vm.runInContext(readFileSync(modulePath, 'utf8'), context);
  const error = context.Vue.ref('');
  const state = context.SaCodeAttachmentState.createAttachmentState({
    ref: context.Vue.ref, upload, getGeneration: () => generation,
    error, formatError: e => e.message,
  });
  return { state, error, revoked, changeSession: () => generation++ };
}
const image = { name: 'sample.png', type: 'image/png' };

test('图片上传只交付 base64 并保存宿主凭证', async () => {
  const { state } = fixture(async (...args) => {
    assert.deepEqual(args, ['image', 'sample.png', 'image/png', 'aGVsbG8=']);
    return { receiptId: 'u7', attachment: { id: 'sha256:test' } };
  });
  state.addAttachments([image], []);
  assert.equal(state.uploads.value.a1.status, 'uploading');
  await tick();
  assert.equal(state.attachments.value[0].receiptId, 'u7');
  assert.equal(state.attachments.value[0].previewUrl, 'blob:preview');
  assert.equal(state.uploads.value.a1.status, 'ready');
});

test('上传失败保留附件并允许原文件重试', async () => {
  let fail = true;
  const { state, error } = fixture(async () => {
    if (fail) throw Error('上传失败');
    return { receiptId: 'u2', attachment: {} };
  });
  state.addAttachments([image], []); await tick();
  assert.equal(state.uploads.value.a1.status, 'error');
  assert.equal(error.value, '上传失败');
  fail = false; state.retryAttachment('a1'); await tick();
  assert.equal(state.attachments.value[0].receiptId, 'u2');
});

test('切换会话后迟到回执不恢复旧附件', async () => {
  let resolve;
  const { state, changeSession } = fixture(() => new Promise(r => { resolve = r; }));
  state.addAttachments([image], []); await tick();
  changeSession(); state.clearAttachments();
  resolve({ receiptId: 'u3', attachment: {} }); await tick();
  assert.equal(state.attachments.value.length, 0);
  assert.equal(Object.keys(state.uploads.value).length, 0);
});

test('移除与清空释放图片预览 URL', async () => {
  const { state, revoked } = fixture();
  state.addAttachments([image, image], []); await tick();
  state.removeAttachment('a1'); state.clearAttachments();
  assert.deepEqual(revoked, ['blob:preview', 'blob:preview']);
  assert.equal(state.attachments.value.length, 0);
  assert.equal(Object.keys(state.uploads.value).length, 0);
});

test('文件不冒充图片，目录显式拒收', async () => {
  const { state, error } = fixture(async (...args) => {
    assert.deepEqual(args, ['file', 'notes.txt', '', 'aGVsbG8=']);
    return { receiptId: 'u4', attachment: {} };
  });
  state.addAttachments([{ name: 'notes.txt', type: 'text/plain' }], [{ name: 'folder' }]);
  await tick();
  assert.equal(state.attachments.value[0].kind, 'file');
  assert.equal(state.attachments.value[0].previewUrl, '');
  assert.match(error.value, /folder/);
});
