import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(testDirectory, '../../..');
const exporter = join(repository, 'scripts', 'export-windows-artifact.mjs');
const windowsOnly = { skip: process.platform !== 'win32' };

// 导出脚本的 isInside 守卫要求目标在仓库外。当 TEMP 被指到仓内（如本机受限代理
// 环境把 TEMP 重定向到 target/tmp）时，tmpdir() 会落在仓库内导致守卫误拒。
// 这里取“仓外中性目录”：tmpdir() 在仓外就用它，否则回退到仓库父目录。
const outsideRepoTemp = () => {
  const t = tmpdir();
  return resolve(t).toLowerCase().startsWith(repository.toLowerCase()) ? resolve(repository, '..') : t;
};

test('Windows directory delivery copies content and records a verified manifest', windowsOnly, (t) => {
  const root = mkdtempSync(join(outsideRepoTemp(), 'sacode-delivery-tree-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const nested = join(source, 'resources', 'app');
  const destination = join(root, 'delivery', 'win-unpacked');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(source, 'SaCode.exe'), Buffer.from([0x53, 0x61, 0x43, 0x6f]));
  writeFileSync(join(nested, 'index.html'), '<main>SaCode 中文</main>\n');

  const preflight = spawnSync(process.execPath, [exporter, '--check-destination', destination], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  assert.equal(existsSync(destination), false);
  assert.match(preflight.stdout, /destination preflight only; no files written/);

  const run = spawnSync(process.execPath, [exporter, source, destination], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(readFileSync(join(destination, 'SaCode.exe')).equals(readFileSync(join(source, 'SaCode.exe'))), true);
  assert.equal(readFileSync(join(destination, 'resources', 'app', 'index.html'), 'utf8'), '<main>SaCode 中文</main>\n');

  const manifest = JSON.parse(readFileSync(`${destination}.manifest.json`, 'utf8'));
  assert.equal(manifest.source, source);
  assert.equal(manifest.destination, destination);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.directories, 2);
  const exe = manifest.files.find((item) => item.path === 'SaCode.exe');
  assert.equal(exe.sha256, createHash('sha256').update(readFileSync(join(source, 'SaCode.exe'))).digest('hex'));
  assert.equal(manifest.destinationLabel === 'implicit-medium' || manifest.destinationLabel === 'S-1-16-8192', true);
  assert.match(run.stdout, /"scope":"Content-only export/);

  const legacyDestination = join(root, 'installer.exe');
  const single = spawnSync(process.execPath, [exporter, join(source, 'SaCode.exe'), legacyDestination], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(single.status, 0, single.stderr || single.stdout);
  assert.equal(readFileSync(legacyDestination).equals(readFileSync(join(source, 'SaCode.exe'))), true);
  const fileManifest = JSON.parse(readFileSync(`${legacyDestination}.manifest.json`, 'utf8'));
  assert.equal(fileManifest.sha256, exe.sha256);
});

test('Windows exporter refuses a workspace destination before creating it', windowsOnly, (t) => {
  const destination = join(repository, 'target', 'tmp', `must-not-export-${process.pid}`);
  assert.equal(existsSync(destination), false);
  const run = spawnSync(process.execPath, [exporter, fileURLToPath(import.meta.url), destination], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /outside the build workspace/);
  assert.equal(existsSync(destination), false);
});
