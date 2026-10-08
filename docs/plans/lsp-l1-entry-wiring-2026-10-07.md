# L1：LSP 语义工具契约与入口接线 —— 公共入口责任登记（2026-10-07，A）

本文件是 L1 批开工前的**登记单**，不是实施方案。实施完成后验收证据另落 `docs/evidence/`。
口径来源：`docs/product/PRD.md` §4.3（7 verb 表 + L1/L2/L3 分期）、
`docs/plans/plan-deepseek-harness-replication.md`（一切皆插件、会话日志唯一真源）、
协议基线为 LSP 3.17 官方规范。

## 1. 基线

| 项 | 实测值 |
|---|---|
| 分支 | `refactor/dsh-learning` |
| 固定提交 | `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820` |
| 待改文件基线哈希 | `docs/evidence/lsp-l1-baseline-hashes.txt`（11 个文件，sha256） |
| 仓颉 | `Cangjie Project Manager: 1.1.3`，`CANGJIE_HOME=D:\Program Files\HuaWei\Cangjie` |
| Node | `v22.23.2` |

## 2. 本批涉及的公共入口及其责任

按 `docs/plans/w00-path-ownership-and-isolation-2026-10-06.md` §2 规则 3，公共入口只有 A 能改。
本批是入口接线批，**以 A 身份直接改**，同时把新增的两个核心文件按规则 1 登记进所有权表（已加，见该表 `| A | W40 | file | core/src/lsp_contract*.cj |` 两行）。

| 入口 | 表内主责 | 本批责任 | 不做什么 |
|---|---|---|---|
| `core/src/lsp_contract.cj` | 新增 → A/W40 | 7 verb 契约、`LspServer` 接口、`LspRouter` 按扩展名路由、无插件回退形状 | 不启进程、不做协议转换、不出现任何具体 language server 名称 |
| `core/src/fs_tools.cj` | E/W40 | **只保留** `lspSymbols` 文本回退，不在此重复定义接口 | 不动 `lspSymbols` 签名与既有断言 |
| `core/src/lsp.cj` / `lsp_test.cj` | 未登记（既有）→ 补 A/W40 | `LspSymbolRegistry` 与其测试**原样保留** | 不改语义、不删用例 |
| `core/src/agent.cj` | E/W40 | 7 个步骤方法 + 执行器表 7 行注册；旧 `lsp` 执行器保留 | 不把旧 `lsp` 从执行器表摘掉（手工入口仍用） |
| `core/src/model_tool_runtime.cj` | E/W40 | 模型声明面：`lsp` 一条换成 7 条 `lsp_*` | 不给任何一条开审批 |
| `core/src/model_agent.cj` | F/W50 | 诊断成功不计入 `successfulToolCalls`（与 `update_goal` 同一排除口径） | 不改其余工具的计数口径 |
| `apps/host/src/main.cj` | A/W90 | 7 个固定 `lsp/*` method 分派 + `initialize` 能力表 7 条 + 带 `data` 的错误帧 | 不开通用 method 转发；默认 router 无服务器 |
| `apps/desktop/main.cjs` | A/W90 | 7 条 `ipcMain.handle` + 逐字段参数守卫 | 不接受渲染层自报 method 名 |
| `apps/desktop/preload.cjs` | A/W90 | 7 个有限动作通道（顶层 key 是 IPC 面唯一权威） | 不加 `request(method, params)` 这种万能通道 |
| `apps/desktop/test/bridge.test.mjs` | A/W60 | 断言 7 条通道存在、负载校验生效、通用转发不存在 | 不缩已有分母 |

## 3. 未提交改动登记（开工前工作区实测）

`git status --short --untracked-files=all` = **216 条**（已跟踪 31 条 + 未跟踪 185 条）。
最近一次写入 2026-10-07 23:39（本登记单开工前约 52 分钟），非本批写入。

**处置口径：本批不 revert、不吞并、不代提交这些改动。**需要与之同文件共存时（`agent.cj`、
`model_agent.cj`、`model_tool_runtime.cj`、`apps/host/src/main.cj`、`apps/desktop/main.cjs`、
`preload.cjs`、`test/bridge.test.mjs`、`approval.cj`、`goal_evidence.cj`、`goal_runner.cj`、
`lease.cj`、`session.cj`、`shlex.cj`）只做**行级追加**，并在提交阶段用 `git add` 精确暂存后逐行核。

已跟踪改动规模（`git diff --stat`，本批交集面）：

| 文件 | 未提交规模 | 与本批关系 |
|---|---|---|
| `core/src/agent.cj` | 66 +/- | 同文件——本批的执行器表与 7 个 step 方法在此追加 |
| `core/src/model_tool_runtime.cj` | 1 +/- | 同文件——声明面替换在此 |
| `core/src/model_agent.cj` | 3 +/- | 同文件——`successfulToolCalls` 排除口径在此 |
| `apps/host/src/main.cj` | 59 +/- | 同文件——`lsp/*` 分派在此 |
| `apps/desktop/main.cjs` | 26 +/- | 同文件——7 条 IPC 通道在此 |
| `apps/desktop/preload.cjs` | 5 +/- | 同文件——7 个通道在此 |
| `apps/desktop/test/bridge.test.mjs` | 33 +/- | 同文件——7 通道断言在此 |
| `core/src/fs_tools.cj` | 干净（10-06 mtime） | 只读引用 `lspSymbols` |
| 其余 14 条（renderer、goal_*、approval、session、shlex、lease、docs） | — | **与本批无关，不动** |

未跟踪的 185 条集中在 `.tmp-dsh-asar/`、`.tmp-capture*.ps1`、`apps/desktop/.tmp-test/`、
`apps/desktop/dist/` 等一次性工作区与构建产物，均不入库，也不进本批断言对象。

## 4. 契约面决定（写码前冻结）

| 面 | 决定 | 依据 |
|---|---|---|
| verb 名 | `define` `lookup` `references` `implementation` `call-hierarchy` `diagnostics` `rename` | PRD §4.3 表 |
| 模型工具名 | `lsp_define` … `lsp_rename`（7 条），`needsApproval: false` | 同上；工具名不能带 `/` |
| Host method | `lsp/define` … `lsp/rename`（7 条固定） | 协议面按动作命名 |
| 位置 | 0 起始行、**UTF-16 列**；`Range` 左闭右开 | LSP 3.17 `Position` 定义 |
| 路径 | 规范化后必须落在会话工作区内；插件返回的位置与编辑同样复核 | 会话日志唯一真源 + 不越界 |
| 请求 | 携带会话、请求身份（`requestId`）与取消令牌 | 取消要在途生效 |
| 响应 | 携带服务器身份与文档版本；版本落后当前版本即判迟到 | 「迟到结果不能作新文档版本的有效结果」 |
| 错误码 | `lsp-no-server` / `lsp-unsupported` / `lsp-server-gone` / `lsp-cancelled` / `lsp-bad-args` / `lsp-out-of-workspace` / `lsp-stale-result` / `lsp-server-failed` | 失败、取消、断连**不伪装成空结果** |
| 回退 | 保持失败态 + `lspSymbols` 文本线索 + `nonSemantic: true` 标注；定义/诊断/rename 的语义字段留空 | 已确认方案 |
| 不扫描 | 参数错误、越界、取消三种失败不触发文件扫描 | 回退只接在 `lsp-no-server` 后面 |
| 诊断 | 快照三态：无快照 ≠ 有效空快照 | `publishDiagnostics` 未推过时不能报「没问题」 |
| rename | 只出跨文件 TextEdit 预览，核心不调任何写盘方法 | 应用变更归 F08 |
| 测试服务器 | 内存契约夹具，明确不代表真实 LSP 通信 | L1 不 spawn 进程 |

## 5. L1 不做（留给后续批）

- L2：TS language server 插件（spawn + stdio + 文档同步 + `publishDiagnostics` 缓存 + 进程管理）。
- L3：Go/Python/Rust 等多语言插件。
- F08：rename 预览的落盘、审查、冲突检测与授权链。

## 6. 实施期发现的并发冲突与跨线耦合（2026-10-08 实测）

**一条硬冲突，已备份、未删除他人工作**：

- 01:19 本批把 `core/src/lsp_contract.cj`（914 行 / 37 KB）放进核心；01:20 该文件被**另一条会话换成 318 行 / 20199 字节的另一版实现**（sha256 前缀 `5dcc5a81`）。
- 两版用的是**同一套词表**（`LspRouter` / `LspServer` / `LspRouters.sharedRouter()` / 14 个 `lsp-*` 原因常量 / `lspVerbNames` / `lspParseParams` / `lspBuildRequest` / `lspResponseJson`），差异在三处本批的测试与接线都依赖的点：对方是 `LspRegistrationResult` / `LspTextScanner` / `lspToolSpec`，且**没有 `hasRegistration()`**（`lsp-server-gone` 不变量靠它），也没有 `lspOutcomeCount()`。
- 处置：对方那份完整保存在 `.qoder/lsp1/foreign-lsp_contract.cj`，本批按自己这版收口；要改用对方那版，一条命令即可 `cp .qoder/lsp1/foreign-lsp_contract.cj core/src/lsp_contract.cj`。**没有 revert、没有吞并。**

**跨线耦合（同文件同段落，提交时必须逐 hunk 核对）**：

| 文件 | 并发线（未提交） | 本批加的 | 合并后必须同时成立 |
| --- | --- | --- | --- |
| `core/src/agent.cj` | `ToolRuntime` 增 `update_goal` 执行器等 +60/-6 | `ApprovalOutcome.structured`、4 个 lsp 字段与具名构造参、7 条执行器、`lspVerbStep` | 两条执行器表都要在：`update_goal` 与 `lsp_*` 7 条 |
| `core/src/model_agent.cj` | `call.name != "update_goal"` 排除 | 追加 `&& call.name != "lsp_diagnostics"`、`outcome.structured` 直传对象 | 两个 clause 都在，否则 claim 或诊断会自己生成进展证据 |
| `core/src/model_tool_runtime.cj` | `registry.register(goalUpdateToolSpec())`（工具数 10→11） | 旧 `lsp` 一条换成 7 条循环注册 | 声明面总数 = 11 − 1 + 7 = 17 |
| `core/src/model_tool_runtime_test.cj` | 请求内 tools 数 10→11 | 本批改成 17 | **只在带 `update_goal` 的工作区态成立**；纯 HEAD 上该数应是 16 |
| `apps/cli/src/main.cj` | +54 行插件装配断言 | 7 条 `lsp_*` 短参数 ToolSpec | 旧 `lsp` 一条保留 |

**红已如实拿到（先测试后实现）**：`cjpm test --no-run --target-dir <私有>` → `150 errors generated, 8 errors printed`，打印出的 8 条全是 `error: undeclared type name 'Lsp…'`（`LspServer` / `LspFallbackScanner` / `LspRequest`×4 / `LspRouter` / `LspResponse`），位置全在 `core/src/lsp_contract_test.cj`，**没有冒出任何上一批就存在的符号名**。日志 `.qoder/lsp1/red.log`（剥码 `.qoder/lsp1/red.clean.log`），rc=1。

> 取数教训（写回证据而不是只记结论）：cjpm 的 `--no-color` 挡不住 `error\e[0m:` 这种把转义码插在 token 中间的形态，`grep "error:"` 在原始日志上匹配 **0 行**，看着像「没报错」；必须先按 `cangjie-cjpm-test-result-verification` 的 sed 剥码再数，否则会把 150 条红读成 0 条。

**一条编译器事实修正了本批 11 处断言**：`ArrayList<T>.size` 是 `Int`（`core/src/mcp.cj:211` 的 `Int64(entries.size)` 就是在补这个转换），`Array<T>.size` 才是 `Int64`；`@Expect(list.size, Int64(n))` 会因泛型两侧类型不一致编不过，本批统一改成 `@Expect(list.size == n, true)`（字面量适配两侧）。

**顺带把三张表收成一个真源**：`lspToolParamNames(verb)` 现在同时生成模型 JSON Schema、CLI 短参数串与运行期按键白名单。此前是 schema 一套、`lspParseParams` 另一套，且 `lspParseParams` 放过 `documentVersion` 而 schema 未声明——「声明面拒绝、运行面放过」正是最难查的漂移。`documentVersion` 属请求信封（迟到结果按它判），现 7 个 verb 一致收；`diagnostics` 是文件级的，不吃位置。
