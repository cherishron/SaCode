"use strict";
const { join } = require("node:path");

// 打包态下 __dirname 落在 app.asar 里；dsh-host.exe 是要被操作系统直接执行的外部二进制，
// 从 asar 里拿路径 spawn 一定失败。所以随包把它落到 resourcesPath 下（extraResources），
// 路径也只能由 resourcesPath 解析。
function hostExePath({ packaged, appRoot, resourcesPath }) {
  if (packaged) {
    if (!resourcesPath) {
      throw new Error("打包态缺 resourcesPath，无法定位宿主可执行文件（不回退 asar 内路径）");
    }
    return join(resourcesPath, "host", "bin", "dsh-host.exe");
  }
  return join(appRoot, "dist", "host", "bin", "dsh-host.exe");
}

module.exports = { hostExePath };
