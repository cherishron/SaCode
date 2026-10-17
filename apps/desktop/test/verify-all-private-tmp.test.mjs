// 防回归：统一验收入口必须给整轮跑一份独占临时目录。
// 实测依据：共享 %LOCALAPPDATA%\Temp 有数千条目时，桌面真宿主用例与 cjpm test
// 会成批假红（mkdir 报 -13 Permission denied、std.unittest 起 worker 直接抛
// "Too many attempts to create a temporary file"），本批实测该形态吃掉 58 条红里的 52 条。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

test('verify-all 用一次性私有临时目录跑，并在退出时清掉', () => {
  const r = spawnSync('node', [join('scripts', 'verify-all.mjs'), '--list'], {
    cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
  });
  assert.equal(r.status, 0, `verify-all --list 退出码 ${r.status}：${r.stderr}`);
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const line = out.split(/\r?\n/).find((l) => l.includes('临时目录'));
  assert.ok(line, `输出里没有「临时目录」这一行，说明私有 TMP 接线不在了：\n${out.slice(0, 400)}`);
  const dir = /临时目录[：:]\s*(\S+)/.exec(line)[1];
  assert.ok(!dir.startsWith(tmpdir()), `临时目录还落在共享 ${tmpdir()} 里：${dir}`);
  assert.ok(existsSync(dir) === false, `退出后没清理，残留 ${dir}`);
});

test('私有临时目录对子进程生效，且每次调用各拿一份', async () => {
  const { createPrivateTmpDir, disposePrivateTmpDir } = await import(
    pathToFileURL(join(root, 'scripts', 'verify-tmp.mjs')).href
  );
  const a = createPrivateTmpDir(root);
  const b = createPrivateTmpDir(root);
  assert.notEqual(a.dir, b.dir, '两次调用拿到同一份目录，并发跑就会互撞');
  assert.deepEqual(readdirSync(a.dir), [], '新目录不是空的');

  const probe = spawnSync('node', ['-e', 'console.log(require("node:os").tmpdir())'], {
    cwd: root, encoding: 'utf8', env: a.env,
  });
  assert.equal(probe.stdout.trim(), a.dir, '子进程 os.tmpdir() 没有指进私有目录');

  for (const one of [a, b]) {
    disposePrivateTmpDir(one.dir);
    assert.equal(existsSync(one.dir), false, `清理没生效，残留 ${one.dir}`);
  }
});
