# 会话级 Worktree 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 按 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 跟踪。

**Goal:** 让 SaCode 用户能在 CLI 与桌面两个入口显式进入/退出 Git worktree 会话工作区，并保证删除受归属、脏文件与独有提交三重保护。

**Architecture:** 生命周期全部收在仓颉共享核心 `core/src/worktree.cj`，绑定与目录变更只写会话日志（`workspace/directory` 等），Git 元数据仅用于外部实体核验，不建第二真源。Host/CLI/daemon/桌面只是同一契约的不同入口；模型工具面注册 `enter_worktree` / `exit_worktree`，所有文件与 shell 工具的 cwd 跟随会话有效目录。

**Tech Stack:** 仓颉 `cjc`/`cjpm` 1.1.3（target `x86_64-w64-mingw32`）、Node ≥18、Electron 33 + Vue runtime（CSP `script-src 'self'`）。

**Spec:** 上游行为口径来自 Qwen Code 用户文档 `users/features/worktree`（2026-10-08 直读正文）；产品定位为「参考其契约的自有增量」，不承诺与上游插件源码兼容。

## Global Constraints

- 会话日志是唯一真源；`append` 只在实例内可见，跨进程可见必须 `flush`。
- 固定目录 `<repoRoot>/.sacode/worktrees/<slug>/`，分支 `worktree-<slug>`；名称 ≤64 字符，允许字母、数字、`.`、`_`、`-`；不给名称时生成 `<形容词>-<名词>-<6hex>`。
- PR 入口只接受编号（含 `#` 前缀）与 `https://github.com/<owner>/<repo>/pull/<N>`；从 `origin` 抓 `pull/<N>/head`，超时 30 秒；缺 GitHub `origin`、PR 不存在、编号为零或越界一律非零退出且不建目录。
- 删除三重保护：创建会话归属、未提交文件（含未跟踪）、`worktree-<slug>` 上未被其他本地分支或远程 ref 保留的提交。`discard_changes` 只能覆盖第二项，**第三项没有任何强制通路**。
- 退出动作取值 `keep` / `remove`；`remove` 必须审批，`AUTO_EDIT` 不能自动获批。
- 不支持嵌套：不在 Git 仓库内、或已在 worktree 目录内时拒绝进入。
- 会话存储按工作目录归属；`--resume <id> --worktree <name>` 以后者为准并把覆盖信息同时打到 stderr 与首条提示提醒。恢复绑定本身不自动 chdir，只有启动 `--worktree` 在首次模型交互前切进程 cwd。
- `--worktree` 不能与 ACP 标志同用；ACP 主机通过 `loadSession`/`newSession` 的 `cwd` 指定目录。
- 过期清理只覆盖 `agent-<7hex>` 且 mtime 超过 30 天，且需同时满足「无未提交已跟踪改动」「提交可从远端到达」「Git 状态读取无误」；用户命名目录永不自动清理。
- 注释、文档、commit 一律中文；commit 形如 `feat(core,host): 描述`。
- 不提交构建产物：`target/`、`apps/desktop/dist/`、`renderer/vendor/`。
- 时序敏感用例必须独占跑，且每轮用唯一私有 TMP 与独立 `--target-dir`。

## 任务与文件结构

| 任务 | 交付物 | 责任文件 |
| --- | --- | --- |
| T1 生命周期核心 | `SessionWorktree` 进入/描述/退出/代理准备与收束/过期清理 | `core/src/worktree.cj`、`core/src/worktree_test.cj` |
| T2 创建后装配 | 目录共享符号链接与 hooks 继承 | `core/src/worktree_setup.cj`、`core/src/worktree_setup_test.cj` |
| T3 模型工具面 | `enter_worktree` / `exit_worktree` schema、审批与后续工具 cwd 跟随 | `core/src/worktree_tools.cj`、`core/src/worktree_tools_test.cj`、`core/src/model_tool_runtime.cj`、`core/src/agent.cj`（`runCodeStep` 传 `cwd`、`exit_worktree` 走 exact 审批）、`core/src/ptc_exec.cj`（`runCode(..., cwd!)`） |
| T4 Host 协议 | `worktree/enter`、`describe`、`exit`、`agent-prepare`、`agent-finish`、`cleanup`；起轮 `workingDirectory` 冻结；活动绑定期拒 `workspace/set-directory`；`initialize` 能力登记 | `apps/host/src/worktree_rpc.cj`、`apps/host/src/main.cj`、`apps/host/test/*` |
| T5 CLI/daemon | `--worktree`（空/名称/`=`/PR/URL）、`worktree` 子命令、真实会话入口、remote 只透传不本地建目录、daemon 有限白名单转发与通知回桥 | `apps/cli/src/*`、`apps/daemon/src/*`、各自 `test/` |
| T6 桌面 | 有限 IPC 通道 + 逐字段校验、面板创建/选择/退出、保留/删除/取消确认、未提交与独有提交计数展示、关闭时保护失败不假成功 | `apps/desktop/preload.cjs`、`main.cjs`、`host-bridge.cjs`、`renderer/*`、`test/bridge.test.mjs`、`test/worktree*.test.mjs` |
| T7 收口 | 能力来源判定证据、状态文档追加批段落、提交级取证、推送 | `docs/evidence/session-worktree-2026-10-08.md` |

## 并发归因规则（2026-10-09 起生效）

本工作区当轮存在另一条并行线（实测 09:05–09:33 改 `core/src/computer_*.cj` 并自跑 cjpm，私有目录 `.qoder/computer-runtime-20261009-unique/`）。因此：

- 代理可改白名单只含**未入库的本批新文件**；`core/src/agent.cj`、`model_tool_runtime.cj`、`ptc_exec.cj`、`apps/host/src/main.cj` 等共享已跟踪文件一律撤权，报错落在其中即停下上报，绝不由两条线先后覆盖。
- `cjpm test` 里失败用例名不含 `worktree`/`Worktree` 的，记「并发线在飞，不计入本批判据」并单独列出，不算本批红。
- 每轮前后各存一份 `ls -l --time-style=+%H:%M core/src/*.cj` 快照，期间被改动的非白名单文件要点名报告。

## 验收门槛（每项须当轮实测，不得以夹具绿替代真实交付）

| 门槛 | 判据 |
| --- | --- |
| 核心全套 | `cd core && cjpm test`，只认剥码后最后一个 `Summary` 块五计数，TOTAL>0 且 FAILED=ERROR=0 |
| Host 专项 | 真实临时 Git 仓库下：进入后 shell/文件工具落在 worktree、主检出文件不被成员改动污染、`keep` 恢复原目录、脏目录与独有提交删除各自被拒、进程重启后绑定仍生效 |
| 模型工具 | 未显式提 worktree 不触发工具；`remove` 走审批；进入后同一轮内后续工具 cwd 已切换（变异反证：把 cwd 改回冻结值必须变红） |
| CLI | `--worktree`、`--worktree=name`、`--worktree=#N`、URL 四种形态；非零失败不留半成品目录；`--remote` 时绝不本地建目录 |
| 桌面 | `npm test` 与 `npm run ui-smoke` 在**重打后的宿主**上跑；打包态另验宿主 mtime 与能力计数 |
| 结构 | 本批文件互不相关的提交逐文件精确暂存；`git show --name-status` 与期望路径逐条比对后才推送 |

## 已完成的基线取证

- [x] 隔离工作树：`git worktree add --detach .qoder/worktrees/worktree-session-20261008 511c422`（`.qoder/worktrees` 已被 gitignore，`git check-ignore` 命中）。
- [x] 固定提交 extjs 基线：`cd extjs && node --test` → tests 24 / pass 24 / fail 0 / skipped 0，rc=0。

## 已知偏离上游与理由

| 项 | 本仓做法 | 理由 |
| --- | --- | --- |
| 目录根 | `.sacode/worktrees/` | 本仓品牌与既有用户目录约定 |
| 绑定存储 | 会话日志事件，不写旁挂 `<id>.worktree.json` | 违反「会话日志唯一真源」不变量 |
| 符号链接权限 | Windows 普通用户可能建不了符号链接 | 诚实记 BLOCKED，不静默降级成复制 |
| 子代理隔离 | 需真实子代理执行入口才宣称支持；`SubagentLedger` 只是账本 | 不能拿登记当执行器 |

## 能力来源判定（2026-10-09 直读上游冻结快照）

上游 `deepseek-harness` @ `639ed015397290b3745d163aafe02ffee4aa3f84`（14,139 文件全量解包，`api.github.com` 与 `codeload` 两条通道逐条对齐 16,070 条）：

- `docs/subsystems/**` 128 篇（63 模块 en+zh）对 `worktree` **命中 0**。
- 98 个含该词的文件全部落在贡献者开发流程（`.agents/notes`、`scripts/`、lefthook 钩子、翻译配对门禁、`pytest.ini`）。
- 仅有的两处产品语义都是**否定式**：`packages/experimental/agent-team/README.zh.md:206`「本包不提供 worktree…共享 cwd」、`packages/hooks/hooks-claude-code/README.zh.md:174` 把 `WorktreeCreate`/`WorktreeRemove` 列为 30 项中 23 项不支持事件，且 `grep --include=*.ts` 全仓无实现。
- `workspace` 子系统原文契约承诺范围止于「用户工作目录的持久记录 + 会话有序账本」：`docs/subsystems/workspace.zh.md:5`、`:120`（`create` 只登记已存在目录）、`:122`（会话 cwd 由创建者赋予并落进不可变 `SessionHeader`）、`:132`（归档准入拒藏住运行中的工作）。不含创建工作树、按名进出、切 cwd、未提交/独有提交保护。

**判定：自有增量，不新增矩阵行、分母保持 63。** 三重删除保护与进出语义按自有设计登记，不挂进 workspace 契约行；Qwen Code 页只作行为灵感。

一处更正：本计划早先转述的矩阵 workspace 行缺口「宿主与扩展仍共用进程级当前目录」全仓 grep 0 命中，该句是我方转述时自造的，不予采用；行级真实缺口以 `docs/plans/dsh-capability-matrix.md` 的 workspace 行为准。

另一处更正（2026-10-09 直读 `core/src/agent.cj` 后）：本节原先写「进入 worktree 后 shell 与文件工具仍在主检出执行」，**归因过宽**。`workingPath()`（`core/src/agent.cj`）与 `lspVerbStep` 一直是执行时读 `SessionWorkspace(log, fallback: workingDirectory).effectiveDirectory()`，`workspace/directory` 事件优先于入口 fallback，因此 read/write/edit/glob/grep/bash/pwsh/LSP 本就跟会话目录走。真实冻结点只有 `run_code`：`PtcExecutor` 只用构造期那份目录且原先没有 `cwd` 形参——本批改为 `runCode(..., cwd!: String = "")` 并补指定用例（去掉 `cwd:` 即红）。Host 侧仍需显式传 `workingDirectory` 作 fallback，但它是「补齐基准」而非「修一个全程跑错目录的大 bug」。

## 冻结契约（四条实现线共用，签名不得各写一份）

```
public class SessionWorktree {
    public init(log: SessionLog, fallback!: String = "")
    public func active(): Bool
    public func name(): String
    public func directory(): String             // 无绑定时回落到 fallback（= 会话有效目录）
    public func originalDirectory(): String
    public func branch(): String
    public func enter(name: String): String     // 空串自动生成，返回实际目录绝对路径
    public func enterPullRequest(reference: String): String
    public func describe(): String              // JSON，字段见下表
    public func exit(action: String, discardChanges!: Bool = false): String
    public func prepareAgent(agentId: String): String
    public func finishAgent(agentId: String): String
    public func cleanupAgents(): Int64
}
```

`describe()` 的 JSON 字段集**恰好**为这 8 个，Host 透传、桌面适配器逐字段校验，任何一面不得增删或改名：

`active` Bool、`name` String、`directory` String、`originalDirectory` String、`branch` String、`dirty` Bool、`uncommittedCount` Int64、`uniqueCommits` Int64。

- 退出动作取值只有 `keep` / `remove`（草稿里出现过的 `delete` 一律改成 `remove`）。
- Host 方法名：`worktree/enter`（`name` 或 `reference` 二选一）、`worktree/describe`、`worktree/exit`（`name`+`action`+`discardChanges`）、`worktree/agent-prepare`、`worktree/agent-finish`、`worktree/cleanup`。
- 模型工具名与参数：`enter_worktree`（`name` 可选）、`exit_worktree`（`name` 必填、`action` 取 `keep|remove`、`discard_changes` 可选布尔）。
- `SessionWorktree` 自带进程调用，**不得** import 未入库的 `git_workbench.cj`（否则提交态编不过，属假通过）。
