"use strict";
const { join, resolve, isAbsolute, basename } = require("node:path");

// 打包态下 __dirname 落在 app.asar 里；sacode-host.exe 是要被操作系统直接执行的外部二进制，
// 从 asar 里拿路径 spawn 一定失败。所以随包把它落到 resourcesPath 下（extraResources），
// 路径也只能由 resourcesPath 解析。
function hostExePath({ packaged, appRoot, resourcesPath }) {
  if (packaged) {
    if (!resourcesPath) {
      throw new Error("打包态缺 resourcesPath，无法定位宿主可执行文件（不回退 asar 内路径）");
    }
    return join(resourcesPath, "host", "bin", "sacode-host.exe");
  }
  return join(appRoot, "dist", "host", "bin", "sacode-host.exe");
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
    providerPath: resolve(appRoot, "..", "..", "computer-use", "provider.mjs"),
    nodePath: nodeExecutable,
  };
}

module.exports = { hostExePath, computerUsePaths };
