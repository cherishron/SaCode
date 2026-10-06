import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { hostExePath } = require("../paths.cjs");

// win32 的 path.join 会混进反斜杠，断言按分隔符归一化后再比，避免只在一台机器上绿
const norm = (s) => s.split("\\").join("/");

// 打包态的致命点：__dirname 落在 app.asar 里面，而 sacode-host.exe 是要被操作系统
// 直接执行的外部二进制——asar 路径拿来 spawn 一定失败。宿主必须随包放在 asar 之外，
// 路径也只能从 process.resourcesPath 解析。

test("未打包时宿主在应用根目录下的 dist/host/bin", () => {
  const p = hostExePath({ packaged: false, appRoot: "/repo/apps/desktop" });
  assert.equal(norm(p), "/repo/apps/desktop/dist/host/bin/sacode-host.exe");
});

test("打包后从 resourcesPath 取，且绝不落在 asar 内", () => {
  const p = hostExePath({ packaged: true, appRoot: "/app/resources/app.asar", resourcesPath: "/app/resources" });
  assert.equal(norm(p), "/app/resources/host/bin/sacode-host.exe");
  assert.ok(!p.includes("app.asar"), "打包态路径不得引用 asar 内的位置");
});

test("打包态缺 resourcesPath 时明确失败，不回退到 asar 路径", () => {
  assert.throws(
    () => hostExePath({ packaged: true, appRoot: "/app/resources/app.asar" }),
    /resourcesPath/,
    "静默回退会让安装包在运行期才炸"
  );
});
