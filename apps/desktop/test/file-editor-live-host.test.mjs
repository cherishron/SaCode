import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const testFile = fileURLToPath(import.meta.url);
const repository = resolve(dirname(testFile), '../../..');
const host = process.env.SACODE_HOST || '';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../renderer/pages/file-editor-state.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'cjs',
});
const context = { module: { exports: {} } };
vm.runInNewContext(bundle.outputFiles[0].text, context);
const { createFileEditor } = context.module.exports;

test('file editor uses the real Host for one-time save, conflict rejection, and denied approval',
  { skip: !host || !existsSync(host) ? 'set SACODE_HOST to an isolated, current Host executable' : false },
  async (t) => {
    const root = mkdtempSync(join(repository, 'target/tmp/file-editor-live-host-'));
    const project = join(root, '工作区 项目');
    mkdirSync(project);
    writeFileSync(join(project, '草稿.txt'), '基线\n');
    let bridge;
    try {
      bridge = new HostBridge(host, {
        ...process.env,
        TEMP: root,
        TMP: root,
        TMPDIR: root,
        SACODE_USER_SETTINGS_DIR: join(root, 'settings'),
      });
      await bridge.start(root);
      const initialized = await bridge.request('initialize');
      assert.ok(initialized.capabilities.includes('extension/call'));
      await bridge.request('workspace/set-directory', { directory: project });

      const api = {
        read: (path) => bridge.request('extension/call', { name: 'read', args: JSON.stringify({ path }) }),
        ask: (path, text) => bridge.request('approval/ask', {
          name: 'write', args: JSON.stringify({ path, content: text }),
        }),
        answer: (approvalId, decision) => bridge.request('approval/answer', { approvalId, decision }),
        write: (path, text, approvalId) => bridge.request('extension/call', {
          name: 'write', args: JSON.stringify({ path, content: text }), approvalId,
        }),
      };

      const editor = createFileEditor(api, () => {});
      await editor.open('草稿.txt');
      assert.equal(editor.state.loaded, true);
      assert.equal(editor.state.original, '基线\n');
      editor.edit('经真实 Host 保存\n');
      editor.review();
      await editor.save();
      assert.equal(readFileSync(join(project, '草稿.txt'), 'utf8'), '经真实 Host 保存\n');
      assert.equal(editor.state.saveRevision, 1);
      assert.equal(editor.state.notice, '已保存并核对磁盘内容。');

      editor.edit('过期草稿\n');
      editor.review();
      writeFileSync(join(project, '草稿.txt'), '外部新版本\n');
      await editor.save();
      assert.equal(readFileSync(join(project, '草稿.txt'), 'utf8'), '外部新版本\n');
      assert.equal(editor.state.draft, '过期草稿\n');
      assert.match(editor.state.error, /外部修改/);
      assert.equal(editor.state.saveRevision, 1);

      const deniedEditor = createFileEditor({
        ...api,
        answer: (approvalId) => api.answer(approvalId, 'denied'),
      }, () => {});
      await deniedEditor.open('草稿.txt');
      deniedEditor.edit('拒绝后不得落盘\n');
      deniedEditor.review();
      await deniedEditor.save();
      assert.equal(readFileSync(join(project, '草稿.txt'), 'utf8'), '外部新版本\n');
      assert.equal(deniedEditor.state.draft, '拒绝后不得落盘\n');
      assert.match(deniedEditor.state.error, /未获授权/);
      deniedEditor.dispose();
      editor.dispose();
    } finally {
      if (bridge?.proc && bridge.proc.exitCode === null && bridge.proc.signalCode === null) {
        const stopped = await bridge.stop();
        assert.equal(stopped.code, 0);
        assert.equal(stopped.forced, false);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
