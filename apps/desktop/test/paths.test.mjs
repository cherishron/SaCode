import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { hostExePath, caBundleSidecar, hostEnvWithCaBundle } = require("../paths.cjs");

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

// 随包信任锚：宿主目录里那颗 libssl 的编译期默认证书库在干净机器上是空的（实测：不带
// SSL_CERT_FILE 时公网 https 一律塌成 transport 错误，补上锚立刻变成真实 HTTP 状态码）。
// 锚文件跟 exe 同目录随包走，路径由壳层算好后用 SACODE_CA_BUNDLE 交给宿主——
// 壳层才知道自己的安装布局，核心不必去猜自己在哪。

test("信任锚 sidecar 与宿主 exe 同目录", () => {
  assert.equal(
    norm(caBundleSidecar("/app/resources/host/bin/sacode-host.exe")),
    "/app/resources/host/bin/ca-bundle.pem"
  );
});

test("sidecar 存在时才把锚路径写进宿主环境", () => {
  const env = hostEnvWithCaBundle({ PATH: "/bin" }, { sidecarPath: "/h/ca-bundle.pem", exists: true });
  assert.equal(env.SACODE_CA_BUNDLE, "/h/ca-bundle.pem");
  assert.equal(env.PATH, "/bin", "不能顺手丢掉别的环境变量");
});

test("sidecar 缺失时不指向不存在的锚文件", () => {
  const env = hostEnvWithCaBundle({}, { sidecarPath: "/h/ca-bundle.pem", exists: false });
  assert.ok(!("SACODE_CA_BUNDLE" in env), "指向空文件会让核心以为锚已配置");
});

test("调用方已给出的 SACODE_CA_BUNDLE 优先于随包 sidecar", () => {
  const env = hostEnvWithCaBundle(
    { SACODE_CA_BUNDLE: "/operator/mine.pem" },
    { sidecarPath: "/h/ca-bundle.pem", exists: true }
  );
  assert.equal(env.SACODE_CA_BUNDLE, "/operator/mine.pem", "运维显式配置不能被随包文件盖掉");
});

// 上面四条只证明 paths.cjs 里有这两个函数；真正让打包机「不带 SSL_CERT_FILE 也能验通证书」
// 的是壳层把它们接上。锚调用写在构造参数里，求值早于进程创建，所以这里钉的是
// 「交给 HostBridge 的那份环境是锚过的」，而不是它在文件里的先后。
test("main.cjs 把随包信任锚接进交给宿主的那份环境", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const desktop = resolve(import.meta.dirname, "..");
  const src = readFileSync(resolve(desktop, "main.cjs"), "utf8");
  assert.match(src, /caBundleSidecar\(/, "锚路径要由壳层按自己的安装布局算出来");
  assert.match(
    src,
    /new HostBridge\(\s*HOST,\s*hostEnvWithCaBundle\(/s,
    "宿主必须拿到锚过后的环境，只在 paths.cjs 里备着函数不算接上"
  );
  assert.ok(
    !/new HostBridge\(\s*HOST,\s*hostEnvironment\s*\)/.test(src),
    "禁止把未锚定的环境直接交给宿主"
  );
});

