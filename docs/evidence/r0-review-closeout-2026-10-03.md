# R0 代码 review 收口证据（2026-10-03）

## 结论与边界

代码提交：`6e060ff`。本轮关闭三条计量问题：其他写入口先取得租约绕过历史预算、完成轮次未经轮询就退出漏记用量、预算收紧到已用额度以下仍启动新轮。控制字符转义实现、npm 主包启动源码、CLI 计量断言以及此前文件存在/缺失观察和正文重放修复已同时进入提交。

本轮验证核心、CLI 包与桌面 Host 协议；没有重打 Electron 安装包，没有执行实际安装卸载，没有接入真实模型或对外发布。不能据此宣称整个 R0、完整复刻或发布验收完成。已有文件写入的受保护原子替换等差距仍在文件系统矩阵中；强制杀进程/断电时终态用量恢复也未由本轮正常 EOF 测试证明。

## 修复与回归

| 问题 | 修复 | 回归场景 |
| --- | --- | --- |
| 其他入口取得租约后 meter 未重建 | Host 七处写侧加载都调用 `loadForWrite`，成功加载后立即 `meter.rebuild()` | 重启后 session/submit、session/append、approval/ask、approval/answer、失败的 extension/call 先取租约，状态和预算仍一致，不可放宽或重新开轮 |
| EOF 不经过 turn/poll，usage 丢失 | 两路径调用核心 `TokenMeter.settleTurn`，取终态后清除 handle，落盘后释放租约 | 已收到 usage 的 limit=4 取消退出与 limit=5 完成退出均入账一次；重启 used=12；重复轮询后退出不重复入账 |
| 收紧到已用以下仍放行 | `over()` 同时检查历史拒绝与 `total >= budget` | used=12 收紧至 5 即时拒绝且重启仍拒绝；预算为 0 不产生 turn/start；核心覆盖恰好耗尽额度 |

尚未收到 usage 且未 finish 时报告 `absent`，不推断上游实际消耗为零；收到 usage 后即使取消也保留该用量。超预算那一笔仍按现有产品规则登记拒绝事实，不增加 accepted used。

## 干净提交复验

由 `git archive HEAD` 导出仅包含 `6e060ff` 已提交文件的隔离源码；没有复制主工作区的 GUI 或测试增量。

隔离目录：`C:\Users\jingg\AppData\Local\Temp\dsh-r0-head-306c96de3b934b78a4c95ad7fac2061f`。

工具链：仓颉 1.1.3、Windows x64；stdx 1.1.3.1。构建时使用本机 SDK 和 stdx 路径，这是构建前提；npm 运行验收移除了 SDK PATH。

| 验证 | 结果 | 日志（相对隔离目录） |
| --- | --- | --- |
| `core` 下 `cjpm test` | 119/119，rc=0；此前 HEAD 112/113 的转义红灯关闭 | `source/core/r0-core-test.log` |
| `apps/host` 下 `cjpm build` | rc=0；有 unused 编译警告 | `source/apps/host/r0-host-build.log` |
| `node scripts/pack-host.mjs ...` | 89 文件，含依赖 DLL | 本轮工具输出 |
| `node scripts/pack-cli.mjs` | rc=0，49 文件；有编译警告 | `source/r0-cli-pack.log` |
| `apps/desktop` 下 `node --test` | 53/53，rc=0 | `source/apps/desktop/r0-desktop-test.log` |
| `extjs` 下 `node --test` | 14/14，rc=0 | `source/extjs/r0-extension-test.log` |
| 主包与平台包 `npm pack` | 主包包含 `bin/cli.js` 与 `package.json`，启动脚本有 shebang 且已跟踪 | `main-pack.json`、`platform-pack.json` |
| 新 client 目录离线安装两个 tarball | `npm install --offline --ignore-scripts --no-audit --no-fund` rc=0，安装 2 包 | 本轮工具输出 |
| 安装生成的 `.bin/dsh.cmd stream` | 17 条 PASS，ALL PASS，rc=0 | `cli-stream.log` |
| 安装生成的 `.bin/dsh.cmd tool` | 11 条 PASS，ALL PASS，rc=0 | `cli-tool.log` |

npm 安装后命令在独立 client 目录执行，PATH 仅含 Node 目录、Windows System32 与 Windows；不通过仓颉编译器目录解析 DLL。源码启动入口与平台生成目录的 ignore 规则已分离。

主工作区另有测试增量，当时跑出核心 119/119、桌面 58/58、扩展 14/14；**干净提交桌面计数为 53/53**，两套计数不混用。

## 产物 SHA256

| 文件（相对隔离目录） | SHA256 |
| --- | --- |
| `packages/dsh-cli-0.1.0.tgz` | `BECF0992C3FF1370EAF12CE378FE9D3E765B964CDBF3EB752D79B8DF25823515` |
| `packages/dsh-cli-win32-x64-0.1.0.tgz` | `50C5AD9BFA932F4709922E5A47B557F4950844BC1775B0CBADCBC4F8D137BA1D` |
| `source/apps/desktop/dist/host/bin/dsh-host.exe` | `2B1A0D0FFF08941B9707689FC0AC82C9268F4DC63C77041EA443829C31A6B136` |

PRD 与账号/云服务裁剪矩阵随后作为文档提交保存；C01–C04 的上游核验仍待完成。本报告的代码及二进制证据只对应 `6e060ff`。
