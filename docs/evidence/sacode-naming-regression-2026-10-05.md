# SaCode 命名迁移回归（2026-10-05）

## 当前范围

全量命名迁移仍在工作区，尚未作为独立提交收口；共享文件包含模型中心会话的在途改动，不批量暂存或提交。

本轮补齐两处真实遗漏：
- `npm/sacode-cli/package.json` 的 npm bin key 从 `dsh` 改为 `sacode`。
- `npm/sacode-cli/bin/cli.js` 的非 Windows 二进制名称从 `dsh` 改为 `sacode`。

新增 `scripts/sacode-naming.test.mjs`：检查 CLI 名称、固定 IPC 前缀与主进程配对、宿主打包名称、渲染桥和系统角色名。
测试首跑 2/3：解析器只识别双引号，漏掉主进程已有的单引号 goal 通道；修正识别单双引号后 3/3。并非实际缺失 goal 通道。

## 实测

- 仓颉 Host：`cjpm build` 成功，退出码 0（1 条 unused 警告）。
- 将最新 `apps/host/target/release/bin/main.exe` 复制至 `apps/desktop/dist/host/bin/sacode-host.exe`，保留同目录 DLL；本次不是重新生成全部发布目录。
- 命名专项：`node --test scripts/sacode-naming.test.mjs`，3/3，退出码 0。
- 桌面专项五文件：23/23，退出码 0。
- 桌面全量：在 `apps/desktop` 执行 `node --test`，205/205，失败 0、跳过 0、退出码 0，约 37.54 秒。
- 全量测试中真实 StepFun 往返用例通过（约 3.49 秒），测试契约检查真实 provider、流式 text 帧、真实 usage、终止原因、助手消息投影与日志不含凭据。端点为 `https://api.stepfun.com/step_plan/v1`，模型 `step-5-preview`，凭据由现有测试的环境/忽略文件入口提供，本报告不记录凭据。
- 真实模型增强用例通过（约 29.06 秒）。

## 不升级的结论

这批结果不证明前端全部复刻、Cordis 原生插件源码兼容、全部后端能力、真实模型工具调用完整闭环或安装/卸载验收。
## 后续构建验证增量

- `npm run vendor` 返回 0：Vue runtime、TinyVue、TinyRobot 及 11 个 TypeScript 页面 bundle 重建成功。
- 真实 Electron `--ui-smoke`：`UI_SMOKE PASS`，退出码 0；包括聊天槽位接管、插件卸载/重装、草稿保留、真实 IPC、审批与会话日志投影。
- 首跑 Electron 返回 1：继承的 `ELECTRON_RUN_AS_NODE=1` 导致应用以 Node 模式启动，Electron app 不存在；仅在测试进程移除该变量后复跑通过。没有把首跑错误计为应用通过。
- 仓颉 CLI `cjpm build` 返回 0（48 条编译警告，未消除）。
- `node scripts/pack-cli.mjs` 返回 0，输出 sacode.exe 平台包：45 个二进制/DLL 文件、扩展宿主 2 个源码及 5 个样例工具。
- 将 PATH 限定为 Windows/System32，不含仓颉 SDK，运行平台包 `sacode.exe all`：`ALL PASS`，退出码 0。此项是直接二进制离线自测，不等于 npm 安装入口验证。

## npm 安装态验证增量

新增 `scripts/smoke-npm-install.mjs`，已实际执行成功：本地两个源码/平台包生成 tarball，在临时目录以 `npm install --offline --ignore-scripts --no-audit --no-fund` 安装两个包，再经 npm 自动生成的 `sacode.cmd` 运行 `all`。PATH 仅保留 Node 与 Windows 系统目录，不含仓颉 SDK；最终 `ALL PASS`、`NPM_INSTALL_SMOKE PASS`，退出码 0。

首轮手工测试误把必要的 Node 移出 PATH，安装成功但命令启动失败；保留声明的 Node 运行时后通过。脚本首跑又发现 cmd 绝对路径引号转义错误，改用隔离目录内相对 shim 路径后完整复跑通过，没有跳过安装步骤。

本次证明 Windows x64 本地 tarball 离线安装与 npm 命令入口，不证明 npm 公网发布、其他平台或桌面安装器。平台 tarball 实际含 91 个文件，约 11.4MB 压缩/30.5MB 解包；此前 pack-cli 的 45 文件控制台计数未包含所有运行库，不能作为总文件数。

剩余：更新指导文档旧名称、清理本会话生成的临时迁移脚本及复核混合行尾差异；未重建 Setup/portable，未做桌面实际安装/卸载。

## 更正历史报告

先前将 `62918700 ns` 误写为 62.9 秒；正确为约 62.9 毫秒。因此提交 `ba30500` 的耗时与“提速”描述不成立。有效的 SSE 基线证据仍是 543 通过/9 ERROR → 552 通过/0 ERROR（总数 554、跳过 2），不是性能改善证据。
