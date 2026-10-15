# 三件套门禁修复记录（2026-10-16）

本批先修验收判据与静态门禁的扫描口径，避免退出码、旧分母或遗漏拆分模块把回归伪装成通过。验证范围是 Windows 本机 Node.js 22 的静态脚本与测试；没有运行完整仓颉单测、桌面安装态或真实模型请求。

## 变更

- `scripts/gate-verdict.mjs` 现在只接受非零检查数、`fail=0`、非零自证探针、`missed=0` 且 `baseline=green` 的完整 PASS 行；非零进程退出码始终判失败。
- `scripts/verify-output.mjs` 统一解析 cjpm 与 Node TAP 汇总，要求所有结果计数齐全且合计闭合、至少一项实际通过；零测试、全跳过、TODO、取消、失败、ERROR 和 FAILED 均不算通过。
- `scripts/verify-all.mjs` 的核心测试使用每轮独立 `--target-dir`，不删除或重试共享 `core/target` 的二进制，避免碰到其他会话占用的 worker。
- 桌面 IPC 门禁从 `main.cjs` 找到的实际注册调用继续扫描注册模块，并解析有限的字面通道、动作表及循环注册通道。当前工作区的 13 个注册模块覆盖 138 条 preload 方法。
- Host 门禁扫描 `main.cj` 的内联分派，以及实际由入口调用的 ACP、页面工具、工作树、提醒、团队、执行与历史等 8 个闭集路由谓词。历史证据 `p0-interface-freeze-2026-10-06.md` 的 82 是当时快照，已经过期；提交 `ef5d923ebcc7e4ace5e89759670c255992552763` 的当前分母为 158。

## 验证读数

当前工作区：

- `node --test test/gate-verdict.test.mjs test/verify-output.test.mjs`（工作目录 `apps/desktop`）：**5/5 通过**。
- `node scripts/check_ipc_surface_parity.cjs`：**138 个 preload 方法 ↔ 138 条已注册通道，8/8 检查通过**；`--selftest` **9/9 探针捕获，基线绿**。
- `node scripts/check_host_method_surface.cjs`：诚实失败。声明集 166 条，当前分母 158；路由集比声明多 `automation/control`、`automation/list`、`automation/save` 三条。`--selftest` 的 **12/12 探针均捕获**，但实际工作区基线为红，因此自证也保持失败。
- `node scripts/verify-all.mjs gates`：退出码 **1**；责任映射、路径责任、当前 IPC 门禁通过，Host 门禁红。执行器按首个失败停止，不继续声称后续项目已验。

固定提交态复核：

- 基线为 `ef5d923ebcc7e4ace5e89759670c255992552763`。从该提交读取 Host 源文件到 `apps/desktop/.tmp-test/host-gate-head-2aa0bd1f07c74534b8ee10889a5b7cd2` 的临时快照，并用本批检查器复跑：Host 分派与能力 **158/158**；`GATE: PASS (10 checks, fail=0)`、`SELFTEST: PASS (probes=12, missed=0, baseline=green)`。
- 同一提交的桌面 IPC 检查器发现已有三条真实缺口：`webSettingsDescribe`、`webSettingsApply`、`webSettingsSetCredential` 在 preload 有暴露但未注册 handler。其 `--selftest` 的 **9/9 探针均捕获**，基线按设计为红；这说明提交态该页面链尚未闭合，门禁不把它改写为绿。

上述分开的读数不能互相覆盖：固定提交 Host 基线通过，不会掩盖当前工作区新增的自动化能力声明缺失；当前工作区 IPC 通过，也不会掩盖固定提交中 Web 设置的旧缺口。后续产品批次应分别补齐对应真实入口，再重跑门禁。

本批没有暂存或提交其他会话的产品改动，也没有推送。

## 2026-10-16 二次复核：冻结提交基线与脏工作区分离

二次复核基于分支 `refactor/dsh-learning`、HEAD `a55bff0db52b695804df3293e5cd7eb985b8a444`。此时 Host 能力新增属于未提交工作区：HEAD 仍为 158 条；工作区有 11 条新增 RPC，其中知识库 5 条、个人资料 2 条、Git 推送目标查询 1 条已声明，自动化 `list/save/control` 3 条已路由但此前漏声明。

为避免未提交的合法增量把自证整体染红，同时继续拦截回归，Host 门禁现在分别检查：

- 冻结分母只核对 `git show HEAD:apps/host/src/main.cj` 的 158 条能力；
- 当前工作区必须保留 HEAD 全部能力；
- 当前闭集路由与 `initialize.capabilities` 必须逐名双向相等、无重复；
- 每项自证变异独立命中目标判据。

本轮只在未提交 `main.cj` 的初始化能力中补入 `automation/list`、`automation/save`、`automation/control`。这只证明 RPC 已被 Host 宣告并可调用，不代表定时执行器已实现；自动化页面仍显示 `executorAvailable=false`。

### 二次验证读数

- `node scripts/check_host_method_surface.cjs`：**GATE PASS，11 项检查**；当前工作区 169 条声明 = 164 条字面路由 + 5 条目标路由，HEAD 的 158 条全部保留。
- `node scripts/check_host_method_surface.cjs --selftest`：**13/13 探针命中，baseline=green**。
- `node scripts/verify-all.mjs gates`：退出码 **0**，责任映射、路径责任、IPC 对账、Host 对账 **4/4 通过**。
- `node --test test/automation-page.test.mjs test/automation-ipc.test.mjs test/gate-verdict.test.mjs test/verify-output.test.mjs`（工作目录 `apps/desktop`）：**18/18 通过**。
- 本机仓颉 **1.1.3**，在 `apps/host` 执行 `cjpm build --target-dir D:\Project\sa\saai\sa-code\target\automation-host-d6297f07c262463b859b7891911a5b1c`：退出码 **0**，`cjpm build success`；含既有警告，未把警告数当作产品通过标准。
- 用该源码新构建的 Host 经 `scripts/pack-host.mjs` 装入独立目录 `apps/desktop/.tmp-test/automation-host-pack-2edd565090374ad79a8b1cd247d4e873`。`SACODE_HOST` 指向该目录的 `bin/sacode-host.exe` 后，真实 Host 测试 `automation-host.test.mjs` 与 `automation-timezone-host.test.mjs` **2/2 通过**：初始化声明三项自动化 RPC、空清单、会话绑定和项目作用域拒绝、保存 Asia/Shanghai 配置及拒绝无效时区。测试包使用 SDK/stdx DLL 与当前进程 PATH 上的 OpenSSL DLL，不是发布载荷验收。
- `core` 定向用例 `automationDefinitionsPersistLiteralPromptAndRejectStaleEdits`：独立 TMP/TEMP、`--parallel 1`，**1 通过 / 1434 跳过 / 0 失败**。这不是完整 core 套件通过。

本次相关工作区 SHA-256：`scripts/check_host_method_surface.cjs`=`137635c53ab085c8a1a24bdd2345ef234e64dafc220bef05d73610e3841b9a6e`；`apps/host/src/main.cj`=`eabcf7257500cb58e2fa49a36abe59bef56cb9b1fbdbaf1bb767879fcb0857c7`；`apps/host/src/automation_rpc.cj`=`3d38312ecb98901f3e74af83329fd522ff942e8d26dcba8b786464c99c833a1a`；`core/src/automation_store.cj`=`3164a95ba9e783aec6a053366f4eef592f84aca60f74333c9d4668c9e209df6c`。以上工作区代码尚未因此记录为提交态；不得用本节替代后续完整 core、桌面默认安全启动、安装态或调度执行验收。

## 2026-10-16 三次复核：已提交接口推进冻结基线

基线更新为 `281142e560c49b4737cdc74960d1c54c3e107a4b`。该提交把 `automation/list`、`automation/save`、`automation/control` 三个已路由并完成 Host 验收的方法纳入提交态，因此冻结声明数从 158 增至 161。自动化仍只是定义管理，调度执行器未接通。

当前工作区声明 169 条，其中 161 条来自已提交基线，另有未提交的知识库 5 条、个人资料 2 条、Git 推送目标查询 1 条。当前路由与能力逐名一致；其余三个门禁项仍分别独立运行。

### 三次复核读数

- `node scripts/check_host_method_surface.cjs`：**11/11 检查通过**，冻结 HEAD 161 条全部保留，工作区 169 条与路由完全匹配。
- `node scripts/check_host_method_surface.cjs --selftest`：**13/13 变异探针命中，baseline=green**。
- `node scripts/verify-all.mjs gates`：**4/4 门禁通过**，退出码 0。

这次基线变化来自已审核且已提交的三条自动化方法，不是通过放宽扫描来消除红灯。知识库 Host 集成测试本轮实际返回 `already-owned` 与 `knowledge-storage-unavailable`；当前 `--skip-build --filter knowledgeStore` 命令没有选中对应用例（`PASSED 0 / SKIPPED 1435`），不能计为通过。知识库批次因此不提交，需单独修复并重新构建验收。

## 2026-10-16 后续批次提交后的冻结更新

随后提交 `a6a3a06`（Host 方法扫描修正）和 `46623c4a1eb0f91303359c0de792fcaf0f57db38`（知识库、用户资料及 Git 推送目标查询）。后者新增知识库 5 个、资料 2 个和 Git 推送目标 1 个 Host 方法，提交态冻结声明数因此从 161 增至 **169**。前节读数和“知识库批次不提交”仅代表该时间点的历史状态。

首次提交后重跑门禁时，旧冻结分母 161 正确报红（HEAD=169）；审查已提交的 8 个新增方法并将 `scripts/check_host_method_surface.cjs` 的冻结分母更新为 169，没有放宽路由扫描或变异判据。更新后实测：

- `node scripts/check_host_method_surface.cjs`：**GATE PASS，11/11**；169 条声明与 169 条路由对齐。
- `node scripts/check_host_method_surface.cjs --selftest`：**13/13 探针命中，baseline=green**。
- `node scripts/verify-all.mjs gates`：**4/4 门禁通过**，退出码 0。
- `node --test test/gate-verdict.test.mjs test/verify-output.test.mjs`（工作目录 `apps/desktop`）：**5/5 通过**。
