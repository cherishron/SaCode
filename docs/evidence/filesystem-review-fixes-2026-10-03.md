# 文件系统 review 修复与双入口发布验收

后续收口：相关源码与 npm 启动脚本已在 `6e060ff` 入库，干净提交复验见 [R0 报告](r0-review-closeout-2026-10-03.md)。下文“仅工作区存在、待提交”等描述是本批历史快照；本批 Electron 产物证据仍只对应原隔离快照。

本批基于 `a5f8ae1`，在 `dsh-filesystem-validation` 隔离工作区验证，避免主工作区同时新增 token-meter 影响本批证据。记录的是本批快照，不将它冒充主分支所有并行改动的验收。

## 修复的行为

- 已存在但未观察的文件拒绝覆盖；测试不再把未观察覆盖断言为成功。
- 观察键解析绝对路径、软链接，并统一 Windows ASCII 大小写；相对、绝对、大写及 `./` 别名回归有覆盖。保存原始字节比较，撤销可能碰撞的自制短哈希。
- 非 UTF-8 读取返回 `invalid-encoding`，不写成功结果、不登记成功观察，宿主仍能处理后续请求。
- JSON 回执对剩余控制字符使用 Unicode 转义，NUL、换页、退格等不再丢失。
- 已观察的目标被删除，旧观察不能授权重新创建；读到缺失后又出现外部创建，也不能覆盖。
- 新建文件由独占临时文件发布，`rename(overwrite: false)` 在落位时拒绝覆盖已存在的目标。
- 读取正文写入同一份 `tool/result` 日志；文件删除后，重放仍能恢复原先读取到的正文。
- 收窄 `.gitignore` 的平台包二进制规则；npm 主包启动脚本 `npm/dsh-cli/bin/cli.js` 带 Node shebang，**目前仅在工作区存在，尚未跟踪、待提交**，不能称为已入库。此前干净 checkout 缺该脚本，`npm pack` 只打出 `package.json`。

## 已完成的验证

| 验证 | 本批结果 |
| --- | --- |
| 核心 `cjpm test` | 110/110，无跳过 |
| 使用新构建、自包含宿主的桌面 `node --test` | 39/39，无跳过 |
| CLI `tool` | 11 条断言 ALL PASS，退出码 0 |
| npm 主包及 Windows 平台包 `npm pack` 后离线安装 | 2 个包安装成功；从安装生成的 `node_modules/.bin/dsh.cmd tool` 运行，11 条全部通过 |
| npm 安装后运行环境 | PATH 仅保留 Node 和 Windows System32，不含仓颉工具链或仓库目录 |
| Electron 最终重新构建 | portable 与 NSIS 两种产物，构建退出码 0；采用本地已安装的官方 Electron dist |
| 打包态协议与 UI | `win-unpacked/DSH Desktop.exe --smoke` PASS；`--ui-smoke` 36 条全部通过；均用新建会话目录 |
| 打包态退出 | 本隔离工作区的 `dsh-host.exe` 残留进程数为 0 |

本批最终产物：`apps/desktop/dist/electron/DSH Desktop Setup 0.1.0.exe`（80,338,845 字节）及 `dsh-desktop-portable.exe`（80,171,864 字节），两者 Authenticode 检查均为 `NotSigned`。这些二进制留在隔离工作区，不入库。NSIS 安装/卸载及干净机器整机回归尚未执行，不将包内程序的冒烟冒充安装流程验收。

修复已合入主工作区文件后，另跑主工作区的 `core/cjpm test`：116/116 通过，包含并行新增的 token-meter 用例。该结果只证明该次核心快照；上表的双端分发验收仍对应本批隔离快照，不延伸到其它并行新增能力。

本轮收尾复核（主工作区 HEAD `523ebb9`，不提交）：隔离目录为 `C:/Users/jingg/.codex/worktrees/dsh-filesystem-validation/sa-code`（HEAD `a5f8ae1`）。`core/src/agent.cj`、`core/src/extproc.cj`、`core/src/fs_test.cj` 归一 LF 后 SHA256 分别为 `656d4451272f4c87c7110997ee49f7bbfb2b37c4a13f750e2013a6159605cdcd`、`d2535b62540f95309efb8422873ad3c204cf48b5ecef71c48949165c83548d82`、`8f9e52e5bd31729cad557fc0155b3a056628abbb072b41d0b8ae78de279fcdf0`，两处一致；launcher 原始字节 SHA256 同为 `ce62c4b6d6cc212a0dcc6fd548fa60ca1fb573a28ec6f66bb3e9ec7607804f22`。CLI/bridge/Host 与桌面视图的实质差异为并行计量及冒烟目录隔离增量；两枚隔离产物现存且尺寸与上文一致，因此沿用隔离文件系统验收，不重打整包。主工作区本轮 core 最后 Summary **TOTAL 116 / PASSED 116 / FAILED 0 / SKIPPED 0 / ERROR 0，rc=0**（`D:/Project/sa/saai/sa-code/core/filesystem-closeout-test.clean.log:1213-1215`）。npm 主包 dry-run 清单含 `bin/cli.js` 与 `package.json` 共 2 文件；入口与本报告仍未跟踪、待提交。上表桌面、离线安装与 UI 的原始终端输出本轮未定位到独立日志，计数属于沿用报告，不冒称本轮重跑；签名与残留进程数亦未在本轮复测。

npm 安装验证在独立临时目录执行，没有直接调用源码目录中的 launcher。这个验证证明本批 Windows 包的安装启动链路，不等同于已经发布 npm，也不等同于完整 AI 编程 CLI。

## 上游核对与尚未完成的范围

按冻结版本读取了 [DSH 文件系统文档](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/639ed015397290b3745d163aafe02ffee4aa3f84/docs/subsystems/filesystem.zh.md) 的目标身份、观察状态、创建与替换守卫契约，据此新增缺失状态回归。没有因此把整模块标为已核或完整复刻。

文件系统仍为部分实现：provider/consumer/可卸载观察策略尚未拆开，缺 edit/glob/grep、窗口化与有界读取、上游结构化错误/结果格式；已有文件的检查与写入尚未组成受保护的原子替换临界区，版本仍只比较内容，未覆盖全部身份与元数据变化；Unicode 大小写、Windows 大小写敏感目录等身份边界也尚未全面验证。

CLI 和 Electron 继续共同纳入完整 DSH 范围。上述修复不替代真实模型 HTTPS/SSE、插件生命周期、完整桌面交互及全模块验收。
