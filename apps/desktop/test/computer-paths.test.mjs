import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { computerUsePaths } = require("../paths.cjs");
const repo = resolve("contract-fixture", "repo");
const appRoot = join(repo, "apps", "desktop");
const nodeExecutable = join(repo, "runtime", "node.exe");
const resourcesPath = join(repo, "resources");
const nodeName = process.platform === "win32" ? "node.exe" : "node";

// 所有夹具仅为路径字符串，不创建文件、不启动 SDK；存在性检查留给运行时。
test("开发态金路径：提供者来自仓库根，Node 保留显式绝对路径", () => {
  assert.deepEqual(computerUsePaths({ packaged: false, appRoot, nodeExecutable }), {
    providerPath: join(repo, "computer-use", "provider.mjs"),
    nodePath: nodeExecutable,
  });
});

test("开发态忽略打包资源目录", () => {
  assert.deepEqual(computerUsePaths({ packaged: false, appRoot, nodeExecutable, resourcesPath }), {
    providerPath: join(repo, "computer-use", "provider.mjs"),
    nodePath: nodeExecutable,
  });
});

test("打包态金路径：两条路径只能来自 resourcesPath", () => {
  assert.deepEqual(computerUsePaths({ packaged: true, appRoot: join(resourcesPath, "app.asar"), resourcesPath, nodeExecutable }), {
    providerPath: join(resourcesPath, "computer-use", "provider.mjs"),
    nodePath: join(resourcesPath, "computer-use", nodeName),
  });
});

test("打包态不回退工作区或显式 Node，且不要求开发态参数", () => {
  assert.deepEqual(computerUsePaths({ packaged: true, resourcesPath }), {
    providerPath: join(resourcesPath, "computer-use", "provider.mjs"),
    nodePath: join(resourcesPath, "computer-use", nodeName),
  });
});

for (const missing of [undefined, null, ""]) {
  test(`打包态缺资源路径明确拒绝：${String(missing)}`, () => {
    assert.throws(() => computerUsePaths({ packaged: true, appRoot, resourcesPath: missing, nodeExecutable }), /resourcesPath/);
  });
}

test("带空格的开发态及打包态路径不加引号、不截断", () => {
  const root = resolve("contract fixture", "repo with spaces");
  const node = join(root, "Node Runtime", "node.exe");
  assert.deepEqual(computerUsePaths({ packaged: false, appRoot: join(root, "apps", "desktop"), nodeExecutable: node }), {
    providerPath: join(root, "computer-use", "provider.mjs"), nodePath: node,
  });
  const resources = join(root, "App Resources");
  assert.deepEqual(computerUsePaths({ packaged: true, resourcesPath: resources }), {
    providerPath: join(resources, "computer-use", "provider.mjs"),
    nodePath: join(resources, "computer-use", nodeName),
  });
});

test("开发态缺 Node 拒绝，不使用 PATH 或当前进程默认值", () => {
  for (const missing of [undefined, null, ""]) {
    assert.throws(() => computerUsePaths({ packaged: false, appRoot, nodeExecutable: missing }), /nodeExecutable.*绝对路径/);
  }
});

test("开发态相对 Node 路径及裸命令拒绝", () => {
  for (const relative of ["node", "node.exe", "./node", "runtime/node.exe"]) {
    assert.throws(() => computerUsePaths({ packaged: false, appRoot, nodeExecutable: relative }), /nodeExecutable.*绝对路径/);
  }
});

test("开发态不接受 Electron 可执行文件，即使环境自报 RUN_AS_NODE", () => {
  for (const executable of ["electron", "Electron.exe"]) {
    assert.throws(() => computerUsePaths({ packaged: false, appRoot, nodeExecutable: join(repo, executable) }), /Electron/);
  }
});

// 隔离加载同一源码，仅替换平台读数，确保 Windows 与非 Windows 分支都被执行。
const source = readFileSync(new URL("../paths.cjs", import.meta.url), "utf8");
for (const platform of ["win32", "linux", "darwin"]) {
  test(`打包 Node 平台后缀：${platform}`, () => {
    const module = { exports: {} };
    vm.runInNewContext(source, { require, module, process: { platform, versions: {}, env: { ELECTRON_RUN_AS_NODE: "1" } } });
    const paths = module.exports.computerUsePaths({ packaged: true, resourcesPath });
    assert.equal(paths.nodePath, join(resourcesPath, "computer-use", platform === "win32" ? "node.exe" : "node"));
    assert.equal(paths.providerPath, join(resourcesPath, "computer-use", "provider.mjs"));
  });
}

test("Electron 内的开发态不能把已改名的当前进程当 Node", () => {
  const module = { exports: {} };
  const execPath = join(repo, "SaCode.exe");
  vm.runInNewContext(source, { require, module, process: { platform: process.platform, versions: { electron: "1" }, execPath, env: { ELECTRON_RUN_AS_NODE: "1" } } });
  assert.throws(() => module.exports.computerUsePaths({ packaged: false, appRoot, nodeExecutable: execPath }), /Electron/);
});
