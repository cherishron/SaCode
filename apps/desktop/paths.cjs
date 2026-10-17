"use strict";
const { join, resolve, win32, isAbsolute, basename, dirname } = require("node:path");
const { existsSync } = require("node:fs");

// 打包态下 __dirname 落在 app.asar 里；sacode-host.exe 是要被操作系统直接执行的外部二进制，
// 从 asar 里拿路径 spawn 一定失败。所以随包把它落到 resourcesPath 下（extraResources），
// 路径也只能由 resourcesPath 解析。
function hostExePath({ packaged, appRoot, resourcesPath, platform = process.platform }) {
  if (!['win32', 'linux', 'darwin'].includes(platform)) throw new Error(`不支持的桌面平台：${platform}`);
  const name = platform === 'win32' ? 'sacode-host.exe' : 'sacode-host';
  if (packaged) {
    if (!resourcesPath || !isAbsolute(resourcesPath)) {
      throw new Error("打包态缺 resourcesPath，无法定位宿主可执行文件（不回退 asar 内路径）");
    }
    return join(resourcesPath, "host", "bin", name);
  }
  return join(appRoot, "dist", "host", "bin", name);
}

// 只给本应用的宿主子进程补加载路径，不改变系统环境或从 cwd 搜库。
function hostRuntimeEnv(env, hostExe, platform = process.platform, exists = existsSync) {
  const runtime = { ...env };
  if (platform === 'win32') {
    const zoneinfo = join(dirname(hostExe), 'zoneinfo');
    if (exists(join(zoneinfo, 'Asia', 'Shanghai'))) {
      const existing = typeof env.CJ_TZPATH === 'string' ? env.CJ_TZPATH.split(';').filter(Boolean) : [];
      const normalize = value => win32.resolve(value).toLowerCase();
      if (!existing.some(value => normalize(value) === normalize(zoneinfo))) {
        runtime.CJ_TZPATH = [...existing, zoneinfo].join(';');
      }
    }
    return runtime;
  }
  const key = platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const directory = dirname(hostExe);
  runtime[key] = [directory, env[key]].filter(Boolean).join(':');
  return runtime;
}

// 信任锚随包放在宿主 exe 的同一目录：extraResources 已经把整个 host/bin 搬到 asar 之外，
// 再加一个文件不用动打包清单。核心侧只认 SACODE_CA_BUNDLE 一个变量——安装布局只有壳层知道，
// 不该让核心去猜自己在哪。
// 为什么非要显式给锚：随包的 libssl 编译期默认证书库是空的，实测宿主不带锚时那两次请求
// 塌成 http-request-error，补上锚立刻回真实 HTTP 状态码（401）。注意这不是「所有 https 在无锚
// 机器上必挂」——探针进程装载的是另一颗 OpenSSL，Default 也能验通；差别在装载的是哪一颗，
// 见 docs/evidence/2026-10-11-windows-tls-anchor-audit.md §4、§6、§8。
function caBundleSidecar(hostExe) {
  return join(dirname(hostExe), "ca-bundle.pem");
}

function hostEnvWithCaBundle(env, { sidecarPath, exists }) {
  // 运维显式配置优先；sidecar 不在就干脆不设，避免让核心以为锚已就绪。
  const present = typeof exists === 'function' ? exists(sidecarPath) : exists === true;
  if (env.SACODE_CA_BUNDLE || !present) {
    return { ...env };
  }
  return { ...env, SACODE_CA_BUNDLE: sidecarPath };
}

function computerUsePaths({ packaged, appRoot, resourcesPath, nodeExecutable }) {
  if (packaged) {
    if (!resourcesPath || !isAbsolute(resourcesPath)) {
      throw new Error("打包态缺绝对 resourcesPath，无法定位电脑控制提供者");
    }
    return {
      providerPath: join(resourcesPath, "computer-use", "provider.mjs"),
      nodePath: join(resourcesPath, "computer-use", process.platform === "win32" ? "node.exe" : "node"),
    };
  }
  if (typeof nodeExecutable !== "string" || !isAbsolute(nodeExecutable)) {
    throw new Error("nodeExecutable 必须是显式绝对路径");
  }
  if (/^electron(?:\.exe)?$/i.test(basename(nodeExecutable)) ||
      (process.versions.electron && nodeExecutable === process.execPath)) {
    throw new Error("不能将 Electron 可执行文件当作 Node");
  }
  if (typeof appRoot !== "string" || !isAbsolute(appRoot)) {
    throw new Error("appRoot 必须是绝对路径");
  }
  return {
    providerPath: resolve(appRoot, "..", "..", "extjs", "computer-use", "provider.mjs"),
    nodePath: nodeExecutable,
  };
}

module.exports = { hostExePath, hostRuntimeEnv, computerUsePaths, caBundleSidecar, hostEnvWithCaBundle };
