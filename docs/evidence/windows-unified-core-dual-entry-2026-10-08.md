# Windows 同核心双入口复验（2026-10-08）

## 基线与产物

分支 refactor/dsh-learning，HEAD ccf3bff7609d6761d14f7b712676791342e15137。未提交改动不等于已落库。本轮只修改自有证据和台账，不暂存、提交、推送、安装或发布，不改变公共执行门禁。

证据根目录：`target/cli-unified-119fd690e98f489ab8f020960ad2fdd4`。manifest.json 记录四个冻结 CLI 源文件、同一 Host 构建产生的 core.cjo/libcore.a 哈希、完整 cjc 命令及 CLI 哈希。CLI 从该核心库直接链接，避免以旧 CLI 的通过替代本轮核心。编译 -O1，build-exit.txt=0；同目录复制依赖 DLL。私有构建通过不等于默认构建通过。

- Host：`target/closure-b1a9811e86224a90a7fdc1ae2904db71/apps/host/target/release/bin/main.exe`，SHA256 0693abeb6cd5b31a5e67a752808d45b3cc640cd2efa924f5360388888cafc394。
- CLI：证据根目录 sacode.exe，SHA256 b98e3976370e97b7d4517738422fa630ebcf71651791dda0de7624774b35e755。
- current-source-audit.json 合并原冻结清单与两文件监督增量，核对 150 个验收源码文件与当前工作区，差集为空。另记录 326 条未提交/未跟踪路径及哈希，具体会话写者未核的不推断；主责以 W00 为准。index 为空。该清单不覆盖全部 F01–F20 或所有桌面文件。

## 本轮结果

| 面 | 命令（仓库根目录，Node 使用本机运行时） | 真实结果与原件 |
|---|---|---|
| CLI 目标 | node target/cli-unified-119fd690e98f489ab8f020960ad2fdd4/verify.cjs | goal-cli-verify.mjs.exit.txt=0；7 场景全通过；apps/desktop/.tmp-test/goal-cli-proof-e8xVBB/results.json |
| CLI 执行有限接口 | 同上一行 | execution-cli-verify.mjs.exit.txt=0；10 场景；证据根目录 sacode-execution-cli-P41l5R；没有执行真实 Shell |
| Host 目标 | node target/cli-unified-119fd690e98f489ab8f020960ad2fdd4/host-v2.cjs | goal-host-verify.mjs.v2.exit.txt=0；完成、预算、claim-only、持久失败、取消五场景；apps/desktop/.tmp-test/goal-host-proof-UEeyhn/results.json |
| Host 执行有限接口 | 同上一行 | execution-host-verify.mjs.v2.exit.txt=0；六动作、精确审批、去重、恢复、旧修订拒绝；apps/desktop/.tmp-test/execution-host-AdOEfu；没有执行真实 Shell |
| CLI 系统取消 | SACODE_CLI 指向本轮 sacode.exe，node 证据根目录/goal-cli-cancel-verify.mjs | exit=0；apps/desktop/.tmp-test/goal-cli-cancel-Rb7pmC/result.json：signalDelivered=true、forcedCleanup=false、CLI exitCode=130、elapsedMs=32084；describe 不再次请求模型 |

CLI 七场景：complete、budget、claim-only、denied-write、freeze、missing-provider、invalid-budget。两个入口使用真实可执行文件和本地 HTTP/SSE 协议夹具；检查发送前持久轮次提示词、模型请求、结果与恢复事实。它不是远端真实模型验收。系统取消没有强制清理；约 32 秒的在途 HTTP 读取等待仍是待修响应延迟。

首轮 Host 脚本因复制时漏掉相对路径 ../host-bridge.cjs 返回 rc=1，没有进入 Host 业务。已补齐 host-fixture/test-support 与冻结桥接依赖，v2 两项 rc=0；失败日志原样保留。dual-entry.cjs 聚合 rc=1 包含首次两项装配失败，不能作为 v2 的结果；以各项退出与 host-v2-results.json 为准。

## 未收口门槛

- Windows Job 机械监督通过不等于 OS 隔离；AppContainer 最小属性创建对照仍错误码 5，公共执行 providerReady=false。
- Electron 最小应用在 main.cjs 前返回 0x80000003，没有页面或真实 IPC 验收；参见 windows-desktop-runtime-recheck-2026-10-08.md。
- Host/CLI 公共入口尚未开放经过隔离验证的原生监督。真实任务文件结果、子进程恢复、会话切换/断连/迟到回执、远端模型和默认构建仍需独立取证。
- 未构建或安装最终桌面安装包，升级/数据保留未验；前三阶段的稳定全页面 UI 复验仍未收口。F01–F20 保留，不按局部通过升级完成。
