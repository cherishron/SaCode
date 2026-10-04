# Electron 标准输出管道断开修复（2026-10-04）

用户截图中的 `EPIPE` 来自隔离测试目录 `D:\Temp\SaCode-ui-scroll-20261004` 的 `frame-smoke.cjs` 日志写入。直接从 PowerShell 调用 GUI 可执行文件时，启动命令提前返回，输出管道关闭；Electron 仍在运行，后续 `console.log` 引发未处理的流错误。

修复在 `main.cjs` 最早阶段安装标准输出和标准错误的错误监听，仅消化 `EPIPE`。其他错误仍抛出；不安装全局异常吞错处理，也不修改仓颉宿主协议管道。`stdio-guard.cjs` 加入 Electron 打包清单。

验证：

- `node --test test/stdio-guard.test.mjs`：2/2。真实子进程输出管道关闭后捕获 `EPIPE` 并正常退出；正常日志不丢失，非管道错误继续失败。
- `node --test test/paths.test.mjs test/renderer-bundle-guard.test.mjs`：4/4。
- `node --check main.cjs` 通过。
- 修复源码复制到隔离实例后，使用 `Start-Process -PassThru`、独立输出文件和 `WaitForExit()` 重跑 `--frame-smoke`，实际退出码 0，报告无失败。证据目录 `D:\Temp\SaCode-ui-scroll-20261004\attachment-captures-held`。

本轮验证为隔离开发实例；尚未重新生成或安装桌面安装包，已有安装包不会自动获得此次源码修复。
