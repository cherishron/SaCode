# 持久任务双入口新源码复验（2026-10-08）

HEAD `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，`refactor/dsh-learning` 的未提交工作区。未新增分支、提交、推送、安装或发布。

## 本轮 CLI 产物

在 `apps/cli` 执行 `cjpm build -i --target-dir ../desktop/.tmp-test/execution-desktop-cli`，实际 rc=0。使用 pack-host 的 DLL 同目录复制逻辑打到私有 `.tmp-test/execution-desktop-cli-packed`，再仅将私有 exe 改为 sacode.exe；未运行会覆盖共享 npm 载荷的 pack-cli。此为本批 job 验证产物，不代表完整 npm 发布包。

CLI SHA256：`7BF38EA33486E7C7D01A4CE0643AFC8E5633F5DB40A944020ED3AA06C0CD33B8`。构建日志：`apps/desktop/.tmp-test/execution-desktop-cli-build.log`。

`SACODE_CLI` 指向该新 exe，执行 `node apps/desktop/test-support/execution-cli-verify.mjs`，rc=0、10 个真实命令场景通过。运行 PATH 仅 System32，TMP/设置/会话在 D 盘私有目录。每次命令为新进程；拒绝或非 y 不准入，y 生成本进程精确工单；下一进程不继承许可。验证日志 `execution-desktop-cli-verify.log`，逐命令退出码、stdout、stderr 在 `.tmp-test/sacode-execution-cli-xnqCE1/results.json`，事实日志同目录 session.log。

## 与新 Host 的共同事实比较

对照上一轮新 Host `.tmp-test/execution-host-0uW4tU/results.json`，机械提取并比对共同事实，结果 `DUAL_ENTRY_FACTS_PASS`；输出 `.tmp-test/execution-dual-entry-facts.json`。

| 共同场景 | Host / CLI 实测 |
|---|---|
| 初始提案 | awaiting-approval，providerAvailable=false |
| 同请求同提案重复 | 保留同一 executionId |
| 明确批准一次 | admitted |
| 启动 | execution-provider-unverified，未执行命令 |
| 空输出 | records=[]，无执行事实可声明 |
| 恢复后写动作 | awaiting-approval，修订提高，重新审批 |
| 取消未启动提案 | cancelled-before-start |
| 跨会话读取 | execution-session-changed |

比较的是行为与授权/恢复判据，非日志逐字相同：工作区路径、提案正文及其摘要不同；Host 保持同进程审批直到重启，CLI 每个 job 命令是独立进程。Host 原始六动作包括额外字段拒绝、旧修订拒绝和旧票不可用；CLI 十场景不能冒充这些 Host 专项全部也验过。

## Electron 与剩余交付

启用 Chromium 日志以及单独尝试 disable-gpu，仍于页面脚本前退出 0x80000003，未得到日志或 checks.json；原因未确认，不据此宣称 GPU 成因。未关闭沙箱或改系统权限。正式页面验收继续阻塞，但核心、双入口和控制器仍可独立推进。

此批证明准入/恢复共同事实，不能证明真实进程执行、子进程监督、隔离、测试报告、GoalRunner 产品轮次或安装包。下一步需继续真实监督提供方及目标轮次接线；前者未通过不开放 execution/start。
