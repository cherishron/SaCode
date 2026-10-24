import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 三份 build.cj 是各入口 cjpm 的 post-build 钩子，补抄上游 cjpm 不随包复制的
// 运行期 DLL（issue #725）。这一步只对 Windows 有意义，但源码曾把本机 Windows
// SDK/stdx 绝对路径写死在 stagePostBuild 里：Linux 上每次完整构建都在链接成功
// 之后被钩子以 rc=1 判失败。本测试直接编出钩子并运行 post-build，断言在不适用
// 的平台上也必须正常退出，而不是去访问不存在的 Windows 目录。
const root = path.resolve(import.meta.dirname, '..');
const hookSources = ['apps/cli/build.cj', 'apps/host/build.cj', 'apps/daemon/build.cj'];
const workRoot = path.join(root, 'target', 'tmp', `build-post-hook-${process.pid}`);

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function findCjc() {
  const exe = process.platform === 'win32' ? 'cjc.exe' : 'cjc';
  if (process.env.CJC && existsSync(process.env.CJC)) return process.env.CJC;
  if (process.env.CANGJIE_HOME) {
    const candidate = path.join(process.env.CANGJIE_HOME, 'bin', exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// cjc 的运行时库不在默认搜索路径里：派生进程既要能编（链接 runtime），
// 也要能跑（构出来的钩子本身）。只补仓颉自己的库目录，不伪造平台相关路径。
function toolchainEnv(cjc) {
  const env = { ...process.env };
  const home = process.env.CANGJIE_HOME || path.resolve(path.dirname(cjc), '..');
  const triple = process.platform === 'win32' ? 'windows_x86_64_cjnative'
    : process.platform === 'darwin' ? 'darwin_x86_64_cjnative'
    : 'linux_x86_64_cjnative';
  const runtimeDir = path.join(home, 'runtime', 'lib', triple);
  env.PATH = `${path.join(home, 'bin')}${path.delimiter}${runtimeDir}${path.delimiter}${env.PATH ?? ''}`;
  if (process.platform !== 'win32') {
    env.LD_LIBRARY_PATH = `${runtimeDir}${path.delimiter}${env.LD_LIBRARY_PATH ?? ''}`;
  }
  return env;
}

test('三个入口的 build.cj 保持字节一致', () => {
  const hashes = hookSources.map(rel => sha256(path.join(root, rel)));
  assert.equal(new Set(hashes).size, 1,
    `build.cj 已分叉：${hookSources.map((rel, i) => `${rel}=${hashes[i].slice(0, 12)}`).join(', ')}`);
});

test('post-build 在不适用的平台上不因硬编码 SDK 路径失败', (t) => {
  const cjc = findCjc();
  if (!cjc) {
    t.skip('找不到 cjc（可设 CJC 或 CANGJIE_HOME）');
    return;
  }
  mkdirSync(workRoot, { recursive: true });
  t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  const env = toolchainEnv(cjc);
  const exe = path.join(workRoot, process.platform === 'win32' ? 'hook.exe' : 'hook');

  const build = spawnSync(cjc, [path.join(root, 'apps/cli/build.cj'), '-o', exe], {
    cwd: workRoot, encoding: 'utf8', timeout: 180000, env
  });
  assert.equal(build.status, 0, `编译 build.cj 失败\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`);

  const runDir = path.join(workRoot, 'run');
  mkdirSync(runDir, { recursive: true });
  const res = spawnSync(exe, ['post-build'], { cwd: runDir, encoding: 'utf8', timeout: 180000, env });
  assert.equal(res.status, 0,
    `post-build 在 ${process.platform} 上失败（rc=${res.status}）\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assert.doesNotMatch(res.stderr, /copyIfDll failed/,
    `post-build 访问了不适用于当前平台的 DDL 源目录\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);

  // Windows 上再验一次 CI 的真实布局：cjpm --target-dir 的产物不在旧的两套 bin 里，
  // 钩子必须靠 SACODE_BUILD_TARGET_DIR 找到本轮 main.exe，并把 DLL 抄到它旁边。
  if (process.platform === 'win32') {
    const fakeRuntime = path.join(workRoot, 'fake-runtime');
    const fakeStdx = path.join(workRoot, 'fake-stdx');
    const targetDir = path.join(workRoot, 'target-dir');
    const targetBin = path.join(targetDir, 'release', 'bin');
    mkdirSync(fakeRuntime, { recursive: true });
    mkdirSync(fakeStdx, { recursive: true });
    mkdirSync(targetBin, { recursive: true });
    writeFileSync(path.join(fakeRuntime, 'libcangjie-runtime.dll'), 'runtime-bytes');
    writeFileSync(path.join(fakeStdx, 'libstdx.crypto.common.dll'), 'stdx-bytes');
    writeFileSync(path.join(targetBin, 'main.exe'), 'exe');
    // 用一个全新的 cwd：上一个场景已按旧布局建过 runDir/target/release/bin，
    // 在同一目录里无法判断这次有没有再建。
    const runDir2 = path.join(workRoot, 'run-target-dir');
    mkdirSync(runDir2, { recursive: true });
    const staged = spawnSync(exe, ['post-build'], {
      cwd: runDir2,
      encoding: 'utf8',
      timeout: 180000,
      env: {
        ...env,
        SACODE_RUNTIME_DLL_DIR: fakeRuntime,
        SACODE_STDX_DLL_DIR: fakeStdx,
        SACODE_BUILD_TARGET_DIR: targetDir
      }
    });
    assert.equal(staged.status, 0,
      `target-dir 布局 post-build 失败（rc=${staged.status}）\nstdout:\n${staged.stdout}\nstderr:\n${staged.stderr}`);
    assert.ok(existsSync(path.join(targetBin, 'libcangjie-runtime.dll')), '运行期 DLL 没落到 --target-dir 的 bin');
    assert.ok(existsSync(path.join(targetBin, 'libstdx.crypto.common.dll')), 'stdx DLL 没落到 --target-dir 的 bin');
    assert.match(staged.stdout, /target bin = .*target-dir/);
    assert.equal(existsSync(path.join(runDir2, 'target', 'release', 'bin')), false,
      '找到显式 target-dir 后不应再创建旧布局 bin');
  }
});
