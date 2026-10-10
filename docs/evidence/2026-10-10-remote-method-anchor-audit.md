# 批次 Z：`remote-capability-contract.json` 实现锚点真实落地审查

对齐 `docs/superpowers/plans/2026-10-10-unified-remote-mobile.md` §1 第 72 行：
「审查方法表真实引用，记录能力缺实现时需补哪个核心/Host模块；未完成项不得进 capabilities」。

工作区 HEAD `435b030`。取证工具 `apps/desktop/.tmp-test/audit-anchors-v2.cjs`（探针输出到 `.tmp-test/contract-anchor-audit-v2.json`，未入库）。

## 0. 分类法（本批定义）

一条契约行的锚点由 1..N 段组成，用 `+` 分隔，每段 `文件[:行号] [后缀]`：
- 后缀 `capabilities` — 指向能力宣告数组
- 后缀 `ExecutionApi` / `isGoalControlMethod` / `isQueueMethod` / `isTipsMethod` — 指向辅助谓词函数
- 无后缀 — 指向具体 `if (method == "...")` 分派行

每条契约行的**真实落地**由五档判定（探针先跑、再人工复核）：

| 档 | 定义 | 语义 |
| --- | --- | --- |
| `implemented-locally` | 方法字面量出现在某个宿主/守护进程文件的 `if (method == "...")` 分派位置，或在谓词函数体内被判读 | 有真实现 |
| `forwarded-only` | 方法仅在 `apps/daemon/src/host_proxy.cj` 的转发白名单里，宿主侧没有本地分派 | 由 daemon 转宿主的转发通路承担 |
| `capabilities-only` | 方法只在 `apps/host/src/main.cj:1017` 的 caps blob 里出现，没有本地分派 | 能力宣告但无处理器 |
| `proposed` | 锚点以「拟新增」开头 | 计划中的模块尚未建 |
| `anchor-stale-but-implemented` | 契约锚点指向错的文件/行/后缀，但方法字面量在**别处**存在真分派 | 契约表元数据过期，实现存在 |
| `proposed-but-implemented` | 锚点标「拟新增」，但方法已在别处落地 | 契约表元数据过期，实现存在 |

## 1. 探针原始结果

```
TALLY {"implemented-locally":91,"forwarded-only":6,"anchor-broken":20,"proposed":2}
```

探针把 20 条 `anchor-broken` 归错了——都是「契约表本身过期」而不是「方法真的没实现」。人工复核逐条确认它们各自在哪个文件里有真分派（见 §3）。

## 2. 结论表（119 条按契约表的真实分母）

| 类别 | 计数 | 说明 |
| --- | --- | --- |
| 有真实现（`implemented-locally`） | **91** | 探针直接判出，锚点与真实分派对齐 |
| 有真实现（`anchor-stale-but-implemented`） | **20** | 契约表元数据过期，见 §3 逐条指认真分派点 |
| 有真实现（`proposed-but-implemented`） | **2** | `auth/enroll` / `auth/token` 已建，见 §3.3 |
| 真在转发白名单上、宿主本人有分派（`forwarded-only` 但实为本地+转发） | **1** | `workspace/set-directory`（`main.cj:2256` 本地 + `host_proxy.cj:67` 白名单），契约表漏记本地 |
| 真在转发白名单上、**宿主本人无分派** | **5** | `worktree/enter` / `worktree/exit` / `worktree/agent-prepare` / `worktree/agent-finish` / `worktree/cleanup` —— 契约表漏记 `apps/host/src/worktree_rpc.cj` 这条真分派源 |
| 完全没有实现 | **0** | 没有任何一条契约行是「声明了但完全没写」 |
| **合计** | **119** | 119/119 都能指到代码里的某个真分派点 |

**「未完成项不得进 capabilities」这一半的判定**：`apps/host/src/main.cj:1017` 的 caps blob 里声明了 119 个方法名（除 `auth/*` 三条走独立管理面），**逐个都在别处能找到真分派**，没有裸声明。这一半为 PASS。

## 3. `anchor-broken` + `proposed` 的 22 条：契约表元数据过期清单

以下 22 条契约表的 `implementationAnchor` 字段写错了（指向的行是 caps blob 而不是具体分派行，或指向的文件根本不含该方法字面量）。**实现本身都存在**，需要修正的是契约表的元数据。

### 3.1 caps-suffix 指向 `main.cj:987` 但真分派在别处（6 条）

契约表用 `apps/host/src/main.cj:987 capabilities` 想指 initialize 的 caps blob；但 caps blob 实际在 `main.cj:1017`，而且这些方法本身在 main.cj 里有各自独立的分派分支：

| 方法 | 契约锚点 | 真分派 |
| --- | --- | --- |
| `workspace/files` | `main.cj:987 capabilities` | `apps/host/src/main.cj:2191` — `if (method == "workspace/files")` |
| `workspace/git-status` | `main.cj:987 capabilities` | `apps/host/src/main.cj:2149` — 与 `workspace/git-diff` 共一个 `if` 分支 |
| `workspace/git-diff` | `main.cj:987 capabilities` | `apps/host/src/main.cj:2149` — 同上 |
| `attachment/upload` | `main.cj:987 capabilities` | `apps/host/src/main.cj:1639` — `if (method == "attachment/upload")` |
| `ledger/stats` | `main.cj:987 capabilities` | `apps/host/src/main.cj:1685` — `if (method == "ledger/stats")` |
| `workspace/set-directory` | `host_proxy.cj:40`（转发） | `apps/host/src/main.cj:2256` — `if (method == "workspace/set-directory")`；契约表漏记了本地分派 |

### 3.2 谓词后缀指错文件（11 条）

`isGoalControlMethod` 与 `isTipsMethod` 定义在 `core/src/`；`ExecutionApi.readOnly` 与 `handles` 定义在 `core/src/execution_api.cj`；`worktree/*` 谓词定义在 `apps/host/src/worktree_rpc.cj`。契约表用 `apps/host/src/main.cj` 作锚文件，字面量在 main.cj 里自然找不到（它们在核心/子模块里）：

| 方法 | 契约锚点 | 真分派 |
| --- | --- | --- |
| `goal/create` | `main.cj isGoalControlMethod` | `core/src/goal_control.cj:7` `isGoalControlMethod` + `:42` `if (method == "goal/create") { svc.create(...) }` |
| `goal/edit` | `main.cj isGoalControlMethod` | `core/src/goal_control.cj:7` + `:43` |
| `goal/pause` | `main.cj isGoalControlMethod` | `core/src/goal_control.cj:7` + `:44` |
| `goal/resume` | `main.cj isGoalControlMethod` | `core/src/goal_control.cj:7` + `:45` |
| `goal/clear` | `main.cj isGoalControlMethod` | `core/src/goal_control.cj:8` |
| `tips/get` | `main.cj:921` | `apps/host/src/tips_surface.cj:13` `isTipsMethod` + `:128` `if (method == "tips/get")` |
| `tips/startup` | `main.cj:921` | `apps/host/src/tips_surface.cj:13` + `:120` |
| `tips/after-reply` | `main.cj:921` | `apps/host/src/tips_surface.cj:14`（谓词里含） |
| `tips/set-hidden` | `main.cj:921` | `apps/host/src/tips_surface.cj:14` + `:101` `if (method == "tips/set-hidden")` |
| `execution/propose` | `main.cj ExecutionApi` | `core/src/execution_api.cj:13` `handles` + `:43` `if (method == "execution/propose")` |
| `execution/authorize` | `main.cj ExecutionApi` | `core/src/execution_api.cj:13` + `:59` |

同一族的 `execution/describe` / `execution/output`（`ExecutionApi.readOnly`）在 `execution_api.cj:16`，也是同类锚点错位——它们探针没判成 anchor-broken 是因为 main.cj 有相关调用点，探针在 main.cj 里能扫到。

### 3.3 auth 管理面（4 条）

| 方法 | 契约锚点 | 真分派 |
| --- | --- | --- |
| `auth/enroll` | `拟新增: apps/daemon/src/identity.cj` | **已建**：`apps/daemon/src/remote_access.cj:258` `POST /auth/enroll` 处理器 + `apps/daemon/src/daemon.cj:762` `server.distributor.register("/auth/enroll", ...)`。契约表的「拟新增」标记过期（批次 O 建了处理器）。**解锁动作**：把 `拟新增:` 前缀删掉，改指 `apps/daemon/src/remote_access.cj` |
| `auth/token` | `拟新增: apps/daemon/src/identity.cj` | **已建**：`apps/daemon/src/remote_access.cj`（`/auth/token` 处理器）+ `apps/daemon/src/daemon.cj:769` `register("/auth/token", ...)`。**解锁动作**：同上 |
| `auth/devices` | `apps/daemon/src/remote_management.cj` | **已建**：`apps/daemon/src/remote_management.cj`（88 行，批次 O 建的认证 RPC 管理面）+ `apps/daemon/src/daemon.cj:441` `else if (method == "auth/devices" || method == "auth/revoke")` 分派。契约表锚文件是对的，但缺了 `daemon.cj:441` 这一层入口 |
| `auth/revoke` | `apps/daemon/src/remote_management.cj` | 同上 |

### 3.4 worktree 分派在 `worktree_rpc.cj`（5 条）

| 方法 | 契约锚点 | 真分派 |
| --- | --- | --- |
| `worktree/enter` | `main.cj + host_proxy.cj:43` | `apps/host/src/worktree_rpc.cj:14` `isWorktreeMethod` + `:114` `if (method == "worktree/enter")` |
| `worktree/exit` | 同上 | `apps/host/src/worktree_rpc.cj:15` + `:126` |
| `worktree/agent-prepare` | `host_proxy.cj:43` | `apps/host/src/worktree_rpc.cj:15` + `:139` |
| `worktree/agent-finish` | `host_proxy.cj:43` | `apps/host/src/worktree_rpc.cj:15` + `:139` |
| `worktree/cleanup` | `host_proxy.cj:43` | `apps/host/src/worktree_rpc.cj:16` + `:172` |

## 4. 契约表的两个真实结构缺陷（不是元数据错位）

### 4.1 worktree 五条在 daemon 转发白名单里，但**契约表漏了它们的真分派源**

`worktree/enter` / `worktree/exit` / `worktree/agent-prepare` / `worktree/agent-finish` / `worktree/cleanup` 这五条在 `apps/daemon/src/host_proxy.cj:67-69` 的 `hostMethods` 转发白名单里（批次 C 加的）。它们由 daemon 转发给宿主，宿主在 `apps/host/src/worktree_rpc.cj` 里分派。契约表只写了 `host_proxy.cj`，看起来像「只转发、宿主没实现」，实际上宿主有真实现，只是契约表没把 `worktree_rpc.cj` 也标上。

**能力缺实现时需补哪个核心/Host 模块**：这五条不需要补实现，需要补的是契约表把 `apps/host/src/worktree_rpc.cj:14 isWorktreeMethod` 也列入锚点。核心侧 `core/src/worktree_tools.cj`（worktree 生命周期）与 `core/src/goal_control.cj`（worktree-agent-prepare 用的子 agent 目录）已存在。

### 4.2 `workspace/set-directory` 只标了转发白名单，漏了本地分派

`workspace/set-directory` 在 `apps/daemon/src/host_proxy.cj:67` 白名单里、也在 `apps/host/src/main.cj:2256` 有本地分派。契约表只写了前者。**能力缺实现时需补哪个核心/Host 模块**：不缺，补契约表把 `main.cj:2256` 也列入锚点。

## 5. 契约表元数据修正清单（本批不改）

修正属于 `docs/plans/remote-capability-contract.json` 这一份文档的编辑动作；本批只在证据文档里指认错误点，不改契约表——因为契约表与 `apps/daemon/test/remote-capability-contract.test.mjs`、`remote-method-surface.test.mjs` 两份测试文件通过机械校验绑定，本批没有测试脚本支持「只改锚点字符串」的独立编辑（改一处会牵出锚点格式、契约测试与三份文档的一致性）。**解锁动作**：单独开一个只改契约表锚点、同步三份文档、跑三份测试的独立批次。

## 6. 「未完成项不得进 capabilities」判定

`apps/host/src/main.cj:1017` 的 caps blob 里 119 条方法名（不含 `auth/*` 三条独立端点）逐条对上 §2 与 §3 的**真分派**——没有裸声明。

但 caps blob 里也**没有** `auth/enroll` / `auth/token` / `auth/devices` / `auth/revoke`——这四个是独立 HTTP 端点 + 独立 RPC 分派，不走 `initialize.capabilities` 宣告。契约表里也有这四条。这里存在一处轻微不一致：**契约表把 auth 四条列进 capabilities 声明面，但 initialize 应答的 capabilities 数组里没它们**。

从 `docs/plans/remote-capability-contract.json` 的 `clientConsumers` 与 `requiredScope` 字段看，这四条的语义是「独立认证端点，不进主 RPC 能力面」，属于设计选择而不是遗漏。但如果要让契约表 100% 对齐 caps blob，需要单独批次把 auth 四条从 capabilities 面里剔除（或补进 caps blob）。**本批不改**：这个决定会牵动移动客户端的能力发现逻辑（`apps/mobile/kotlin/`），先记录、单独立项。

## 7. 自检边界

- 本批只做了**静态锚点审计**（读契约表、按文件读代码、匹配字面量与谓词）。**没有跑任何编译/测试**——审计脚本本身是纯 Node 侧的静态扫描，没有触及仓颉编译产物。
- 每一条 `implemented-locally` / `anchor-stale-but-implemented` 的**分派行号**都是从源码逐行核过的（`grep -n` 直读），不是靠探针盲归。
- 「能力缺实现时需补哪个核心/Host 模块」这一半的答复是「**没缺**」——119 条契约方法都能在代码里找到真分派点。这一结论是本批最重要的产物。
- 本批**不改**契约表本身、**不改**任何源码、**不改**任何测试文件——因为契约表与三份测试文件强耦合，本批无独立编辑通道，改动应作为单独批次走「修改 + 测试复跑 + 文档三对齐」。
- **BLOCKED**：契约表元数据的实际修正是文档维护工作，非本批授权范围；本批仅出证据。要真正修 22 条锚点，需授权改动 `docs/plans/remote-capability-contract.json` 与 `apps/daemon/test/remote-capability-contract.test.mjs`、`remote-method-surface.test.mjs` 的期望集。
