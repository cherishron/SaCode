# F17 三层安全扫描实现设计

日期：2026-10-20  
范围：设计文档。不写产品代码，不碰 `core/`、`apps/host/` 源码。  
验收口径：PRD F17 与 SC01–SC08；反证「单文件规则冒充深度」「陈旧修复覆盖」。

---

## 0. 目标与非目标

**目标：** 开发者发现并审查风险修复。三层能力分别交付、分别验收：

1. **静态检查（static）**：面向本轮生成代码，可对白名单规则自动提出修复。
2. **轻量扫描（incremental）**：面向增量文件集（added/changed），不做跨文件数据流。
3. **深度扫描（deep）**：跨文件、跨函数 source → 传递 → sink；必须有可核调用/数据路径。

**非目标：**

- 不承诺「没有漏洞」。覆盖不全、解析失败、引擎崩溃 ≠ 干净。
- 不把 `level: "deep"` 标签或规则匹配当数据流证据（适配器 README 已冻结）。
- 不自动安装依赖、不自动 Git 提交/推送、不静默云上传。
- 不新造第二套写盘通道。自动修复落盘必须走既有 `execution/review-apply`。
- 不对本仓发起扫描；验收用自有夹具，冻结语言/规则/引擎/版本。

---

## 1. 现状与接入缺口

| 层 | 现状 | 缺口 |
| --- | --- | --- |
| 数据适配 | `scan-adapters/report.cjs`、`handoff.cjs`：归一、增量范围、修复前置、stale/outsideScope | 未接 Host/IPC/UI |
| 执行 | `execution/propose|authorize|start|stop` + AppContainer | 扫描器未作为受控执行提案 |
| 写回 | `execution/review-prepare/apply/describe/stop`，按 path+digest CAS | 扫描修复未产提案 |
| 协议 | initialize 能力清单无 `scan/*` | 需新增闭集方法 |
| 桌面 | 工作台「安全扫描」`available:false` | 面板未做；开放标签 ≠ 闭环 |
| CLI | 无 `scan` 动作 | 双入口需同契约 |

已冻结、实现时必须复用而非重写：

- 路径：项目内相对路径，`\` → `/`；拒绝对路径、盘符、URI、`.` / `..`。
- 文件身份：调用方提供的 SHA256 digest，不是路径字符串隔离。
- `checkFixPreconditions` 只证明快照匹配，存在 TOCTOU；**落盘前核心必须再核**。
- `freshness=stale`：范围内任一文件变/删，整份报告过期；新文件进 `outsideScope`，不得称已扫。

---

## 2. 三层架构决策

```
┌─────────────┐   scan/run(layer)    ┌──────────────────┐
│ 桌面 / CLI  │ ───────────────────► │ Host 分派         │
└─────────────┘                      │ 核 session/项目/  │
       ▲                             │ 工作区修订/授权   │
       │ scan/status 投影            └────────┬─────────┘
       │                                      ▼
       │                             ┌──────────────────┐
       │                             │ core ScanService │
       │                             │ 范围冻结·规则包  │
       │                             │ 运行记录·报告CAS │
       │                             └────────┬─────────┘
       │                    ┌─────────────────┼─────────────────┐
       │                    ▼                 ▼                 ▼
       │             内置规则引擎        受控外部引擎         修复提案
       │             (static 必选)      (incremental 可选     execution/
       │                                Semgrep；deep 可选    review-prepare
       │                                数据流/CodeQL)        → apply
       └────────────── 归一报告 (复用 scan-adapters 语义) ────┘
```

**分层原则（硬约束）：**

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 三层是否同一引擎 | **否**。每层独立 `engineId`+`engineVersion`+能力声明 | SC01–SC03 分别验收；规则匹配不得标 deep |
| 谁计算增量 | **core 用磁盘当前 digest 对比上一份冻结快照**；可先经适配器 `incrementalScope` 做纯数据差，但权威以核心重读为准 | 禁止用全量缓存冒充本轮增量（SC02） |
| 谁声明 deep | **仅当引擎能力位 `interproceduralDataflow=true` 且本 run 实际跑了数据流** | 适配器 `deep` 字段只是提供方声明 |
| 自动 vs 手动 | 见 §3。static 默认可自动；incremental 默认手动（可配置为回合后）；deep **永远手动** | 深度成本高、误报面大、可能出网 |
| 修复写盘 | **只走 `execution/review-apply`** | 复用审批、租约、workspace CAS、并发冲突相位 |
| 报告真源 | **会话日志 `scan/*` 事件** + 附件仓存完整 SARIF/归一 JSON（脱敏后） | 会话是执行事实真源；不把源码全文写入普通日志 |
| 扫描进程 | 内置规则在 Host 进程内、有界；外部工具走 **既有 execution 提案**（沙箱、取消、超时） | 不另开无审批 spawn |

**能力不得升级冒充：**

- static 引擎即使扫了「很多文件」仍是 static。
- incremental 的 `scan` 列表 = added∪changed；deleted 只用于作废旧发现，不把未改文件算进本轮实测。
- 路径 rename = 删除+新增，不自称识别重命名（适配器已定）。

---

## 3. 三层输入 / 输出 / 触发 / 范围

### 3.1 共同输入（所有层）

```
ScanRunRequest
  sessionId, projectId, workspaceRevision
  layer: "static" | "incremental" | "deep"
  trigger: "auto-turn" | "auto-apply" | "manual" | "cli"
  requestId                 // 幂等；迟到报告不得污染新任务
  taskId? / executionId?    // 绑定本轮或一次执行；迟到核归属
  paths?                    // 显式范围；缺省由层策略计算
  rulePackId, rulePackVersion
  enginePreference?         // 仅可选引擎；未知引擎拒绝，不静默换
  destination: "local"      // 默认；"upload" 必须另字段且先确认（SC04）
  uploadConfirmToken?       // 与文件集/目标/留存绑定的一次性确认
```

**范围控制（所有层）：**

- 只扫 **当前工作区授权树** 内、且属于本次 `paths` 的常规文件。
- 排除默认：`.git/`、`node_modules/`、`target/`、二进制、超限单文件（建议 1 MiB，待确认）。
- 软链接 / 大小写别名 / junction：**核心用平台身份判断**，适配器字符串检查不够。
- 文件数上限与适配器对齐：快照 ≤10000、发现 ≤10000、报告字节预算 16 MiB。

### 3.2 静态检查（static）

| | 规定 |
| --- | --- |
| **输入范围** | **本轮生成/改写的文件**：本 turn 或本 `executionId` 写回成功的 path+digest 集合。无本轮文件则 no-op，不扫全仓。 |
| **引擎** | **内置规则引擎（必选）**。单文件、模式/AST/简单符号。不跨文件。 |
| **触发 — 自动** | 回合结算后（模型工具循环或 `review-apply` 成功）若集合非空，Host 发 `scan/run layer=static trigger=auto-turn`。可在设置关闭。 |
| **触发 — 手动** | 工作台「扫本轮」；CLI `scan run --layer static`。 |
| **输出** | 归一报告 + 对 `autoFix=true` 规则的 **修复提案草稿**（未写盘）。 |
| **自动修复** | 仅：规则白名单 ∧ 单文件局部 ∧ 全部 path 落在本轮集合 ∧ digest 仍匹配。然后走 §5 写回。越范围/高影响 **不得** 自动进 apply。 |
| **失败语义** | 解析失败、未覆盖文件进 `unanalyzed[]`。`exit 0` 或零发现 **不是** 无风险（SC01）。 |

### 3.3 轻量扫描（incremental）

| | 规定 |
| --- | --- |
| **输入范围** | `incrementalScope(previousSnapshot, currentSnapshot).scan`（added+changed）。`previous` 来自上次成功 incremental/static 冻结快照或用户指定基线（如 HEAD）。 |
| **引擎** | 内置规则（必选，可与 static 同包但 **独立 runId**）+ 可选本地 Semgrep（若已安装且用户显式选用）。 |
| **触发 — 自动** | **默认关**。若用户打开「回合后增量扫」，仍只扫增量集，禁止偷偷全量。 |
| **触发 — 手动** | 工作台默认按钮；须展示将扫文件列表与排除项，确认后跑（可用「不再询问」绑定项目修订）。 |
| **输出** | 增量集合冻结清单、发现、`unanalyzed`（漏分析路径单列）、相对基线的删除导致的作废 findingId。 |
| **修复** | **默认不自动 apply**。可生成提案，用户在面板确认后走 review-apply。 |
| **反证** | 不得用「上次全量仍干净」填本轮未扫路径（SC02）。 |

### 3.4 深度扫描（deep）

| | 规定 |
| --- | --- |
| **输入范围** | 用户确认的目录/语言集。允许大于增量，但必须列出。数据流需要的依赖/源根一并冻结。 |
| **引擎** | **仅** `interproceduralDataflow=true` 的引擎。一期候选见 §6。无可用引擎时 **拒绝 run**，返回 `engine-unavailable`，禁止降级为规则匹配却标 deep。 |
| **触发** | **仅手动**（桌面确认框 / CLI 显式 `--layer deep`）。禁止回合自动、禁止自动化 Hooks 默认拉起。 |
| **出网** | `destination=upload` 时：列出文件集、目标、留存；用户确认；秘密文件剔除。重启 **不** 自动续传（SC04/SC07）。 |
| **输出** | 每条发现必须带 `dataflow: { source, steps[], sink }`（可核路径）。无路径的命中降为 `note` 或进 `unanalyzed`，**不得** 计入 deep 检出。负对照净化器路径须可区分（SC03）。 |
| **修复** | 禁止自动。高影响（认证、加密、依赖升级、删除测试）永远单独批准。 |

### 3.5 运行态与取消（三层共用）

状态机：`queued → running → succeeded | failed | cancelled | timeout | crashed | partial`

- `scan/status` / `scan/cancel` 必须真实作用到引擎进程（复用 execution stop / TurnToken）。
- `partial`：有部分发现也必须带 `coverage` 与 `unfinished[]`，UI **禁止** 显示全量干净（SC07）。
- 资源：超时、输出有界、工作目录为自有临时目录；清理只删自有产物。

---

## 4. Core：扫描接口、规则引擎、结果模型

### 4.1 协议闭集（Host/CLI 同步，initialize 声明）

计划原文 `scan/run|status|fix` 不够用。建议闭集如下（实现时再冻结 JSON shape，本设计不写代码）：

| 方法 | 读写 | 作用 |
| --- | --- | --- |
| `scan/describe` | 读 | 可用引擎、规则包版本、层能力位、是否允许 upload |
| `scan/run` | 写 | 创建 run，返回 `scanId`；同 `requestId` 幂等 |
| `scan/status` | 读 | 相位、覆盖、发现摘要、progress |
| `scan/cancel` | 写 | 取消；已落盘报告保持 partial |
| `scan/report` | 读 | 归一报告（可分页）；不含源码全文 |
| `scan/suppress` | 写 | 抑制：规则、理由、路径范围、失效条件（digest 或修订） |
| `scan/fix-prepare` | 写 | 把选定 finding 编成 **execution/review-prepare 兼容提案**，不写盘 |

**不设 `scan/fix` 写盘方法。** 修复执行继续用：

`execution/review-prepare` → `approval/ask(execution/review-apply)` → `execution/review-apply`

若无关联 `executionId`（纯手动扫工作区），`scan/fix-prepare` 先创建或复用一条 **scan 专用 execution 记录**（只承载差异，不跑构建），再走同一写回链。禁止 Host 直接 `fs.write`。

`allowedDuringTurn`：`scan/status|describe|report|cancel` 可读可取消；`scan/run` 与 `fix-prepare` 是否允许在途 turn 内发起 — **待确认**（建议：status/cancel 允许，run 默认拒 `turn-in-flight`，避免与本轮文件集合竞态）。

### 4.2 ScanService（core 职责）

1. 核 `sessionId`、工作区 `revision` + 目录平台身份（对齐 `checkWorkspace`）。
2. 解析层策略 → 冻结 `ScanScope`（path, digest, language?）。
3. 选取引擎：未知/`deep` 能力不足 → 硬失败。
4. 内置引擎同步有界执行；外部引擎 = `ExecutionService` 子提案（只读工作区 + 写出报告文件）。
5. 将引擎原始输出 **归一** 为结果模型（语义对齐 `normalizeReport`：无 `passed` 字段）。
6. 持久化：`scan/run-proposed`、`scan/run-begin`、`scan/run-settled`、发现附件 digest。
7. `scan/fix-prepare`：对每条修复生成 unified diff + `expectedDigest`；调用方随后 `review-prepare`。

迟到：`requestId`/`taskId` 不匹配则丢弃展示，不合并进当前面板。

### 4.3 规则引擎

**内置引擎（static / incremental 基线）：**

- 规则包：`id`、`version`、`language[]`、`layer[]`（规则声明自己适用层；**没有** `layer:deep` 的内置规则）。
- 规则字段：`ruleId`、`severity`、`message`、`languages`、`pattern` 或轻量 AST 谓词、`autoFix?`、`fixKind`（`local-edit` | `none`）、`cwe?`。
- `autoFix` 仅当 `fixKind=local-edit` 且补丁模板不碰依赖清单/锁文件/测试删除。
- 一期语言：**待确认**。建议先 JS/TS + 密钥/注入/危险 API 白名单，Cangjie 跟进；未支持语言进 `unanalyzed`，不假装已扫。
- 负对照：每条自动修复规则必须有「安全写法不报」夹具（SC01）。

**外部引擎适配：**

- 输入：冻结文件列表或目录（沙箱只读挂载）。
- 输出：SARIF 2.1.0 或约定 JSON → 归一器。
- 退出码：非 0 不一定有发现（Semgrep 用 exit 1 表示有 finding）。**归一器看结果文件，不把 rc 当通过/失败唯一依据。**
- 崩溃/超时：`crashed`/`timeout` + 已写出的部分 SARIF。

规则包版本写入每份报告；复验必须同一 `rulePackId@version` + 同一文件 digest（SC08）。

### 4.4 结果模型

```
ScanReport
  version: 1
  scanId, sessionId, projectId, requestId, taskId?
  layer, trigger
  engineId, engineVersion
  rulePackId, rulePackVersion
  workspaceRevision
  files: [{ path, digest }]          // 实际纳入范围
  excluded: [{ path, reason }]
  unanalyzed: [{ path, reason }]     // 解析失败/语言不支持/超时切片
  coverage: { filesScanned, filesInScope, bytes, percent? }
  findings: Finding[]
  issues: []                         // 归一异常，对齐适配器；normalization: valid|partial
  phase, executionStatus             // succeeded/failed/cancelled/unknown — 核心填写，不信外部自报
  createdAt
  // 禁止字段：passed, clean, noVulnerabilities
```

```
Finding
  findingId                          // 稳定：ruleId + path + digest + startLine + sink? 哈希
  path, digest                       // 绑定扫描时版本
  ruleId, severity                   // error | warning | note | info
  startLine, endLine?, startCol?, endCol?
  message                            // 展示必须转义；不自动当已脱敏
  layer                              // 产生该发现的层；不得高于引擎能力
  dataflow?                          // deep 必填；其它层禁止填假路径
  fix?: { kind, diff, expectedDigest, impact }  // impact: local | out-of-scope | high
  suppression?: { reason, expiresOnRevision?, expiresOnDigest? }
```

**严重度：** 只影响排序与是否允许自动进 fix-prepare。`error` 不自动变成阻断 Git 推送（推送仍是独立授权）。

**差异：** 修复 `diff` 为 unified diff，相对 `expectedDigest` 对应字节。展示用既有差异审查组件，不新造第三种 diff。

**抑制（SC06）：** 必须记录 ruleId、理由、路径范围、失效条件。夹具路径禁止抑制。源码离开范围或 digest 变 → 抑制失效，发现重新出现。

---

## 5. 与执行审阅通路的关系

### 5.1 为什么复用而不是 `scan/fix` 写盘

现有写回已经具备产品要求的全部安全性质：

- 绑定 `sessionId`、`executionId`、`executionRevision`
- 工作区目录身份 + `workspaceRevision`
- 每文件 `beforeDigest` / `afterDigest`
- 一次性审批票 `allowed-once`，payload 精确匹配
- 并发：磁盘与提案不符 → `conflict` / `partial-conflict`，**不覆盖**
- 取消：`review-apply-stop`；未知不重放

扫描修复是「带版本的文件写回」，不是新的副作用域。再做一套 CAS 会分叉失败语义。

### 5.2 推荐时序

```
scan/run (settled, findings with fix)
    → 用户勾选 或 static 白名单自动挑选
    → checkFixPreconditions(proposal, currentSnapshot)     // 适配器，可失败快
    → 核心重读 digest（权威）
    → 若无 executionId：创建 scan-fix execution 记录（revision=1）
    → execution/review-prepare(paths)
    → 审批 execution/review-apply（static 自动修复：见待确认 T1）
    → execution/review-apply
         成功：finding 标 fixedPendingRescan
         conflict：不写该文件；面板保留提案 diff 与「磁盘当前」diff（SC05）
    → 复扫仅这些 path（同层引擎）→ 指定 findingId 消失且相关测试若已跑则不得报修复完成（SC06）
```

**自动修复仍展示差异：** 即使免二次点击（若 T1 选择「任务写授权覆盖局部安全修复」），面板必须能打开本次 apply 的 before/after。不能静默改文件。

**越范围 / 高影响：** `fix.impact != local` → 只生成提案，按钮为「申请批准」，禁止 auto 路径。

**不得：** 为灭红灯而删测试、改夹具、加抑制（SC05 反证）。

### 5.3 与构建测试 / Git 的边界

- 复扫后的「功能验证」若需要测试：另走 F09 `execution/start`，失败则修复状态 = `fix-unverified`，不是 `fixed`。
- 扫描与修复 **不** 暂存、提交、推送。

---

## 6. 依赖清单与平台

### 6.1 分层依赖

| 层 | 来源 | 打包 | 许可证/风险 | 平台 |
| --- | --- | --- | --- | --- |
| static 基线 | **内置规则**（core 或只读规则 JSON + 引擎） | 随 Host | 自有规则；无 Semgrep 运行时 | Win 先；POSIX 后验 |
| incremental 基线 | 同上内置 | 随 Host | 同 | 同 |
| incremental 增强 | **可选 Semgrep CLI** | **不默认捆绑**；`scan/describe` 探测 PATH 或用户配置绝对路径 | 用户自装；来源未知二进制拒绝（SC04） | Win/macOS/Linux 官方包；**未探测则能力位 false** |
| deep 一期 | **待确认 T2**：A) 自研 JS/TS 过程间污点（有限 API sink 表）B) 可选 CodeQL CLI C) 云端 SAST（必须 upload 确认） | A 随 Host；B/C 不捆绑 | CodeQL 条款与数据库体积；云端数据去向 | CodeQL 在 Windows 可用但重；无引擎则 deep 入口禁用而非假跑 |
| 归一/增量/前置 | 已有 `scan-adapters`（桌面 Node） | 已在桌面测试树 | 无第三方运行时 | 核心应 **移植语义到仓颉** 或 Host 调同一规范；避免两套 CAS 定义分叉 |
| 执行/沙箱 | 现有 Execution + AppContainer | 已有 | 外部扫描器在沙箱内只读挂工作区 | Win AppContainer；其它平台 BLOCKED 直到对等隔离 |
| 写回 | `execution/review-apply` | 已有 | — | 已有双入口 |

### 6.2 明确不依赖

- 不在产品默认安装里塞 CodeQL bundle / Semgrep 规则包下载器。
- 不用模型「猜一条数据流」充当 deep（SC03）。
- 不把桌面适配器的 `applicable:true` 当写权限。

### 6.3 平台矩阵（设计态度）

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 内置 static/incremental | 实施主路径 | 源码同构，验收另排 | 同 |
| Semgrep 可选 | 探测后启用 | 探测后启用 | 探测后启用 |
| CodeQL 可选 | 探测后启用 | 探测后启用 | 探测后启用 |
| 沙箱内跑外部引擎 | 跟现有 execution | **BLOCKED** 直到该平台 execution 隔离验收 | 同 |
| 双入口报告 | Host + CLI 同契约 | 同 | 同 |

缺引擎写 BLOCKED，不借 Windows 探测结果给其它平台打勾（对齐 IO08 精神）。

---

## 7. 前端：扫描结果面板

工作台资源 `id: scan`，**仅当** initialize 声明 `scan/run` 且 `scan/describe` 成功后把 `available` 置 true。开放标签仍须 SC01–SC08 才算闭环。

### 7.1 布局（三块，不可互相替代）

```
┌ 范围 ──────────────────────────────────────────────┐
│ 层切换：静态 | 增量 | 深度（深度无引擎则禁用+原因） │
│ 基线 / 本轮文件数 / 排除 / 规则包 version           │
│ 覆盖：已扫/范围内/未分析；normalization / phase     │
│ 数据去向：本地（默认） | 上传（需确认令牌）         │
│ [开始扫描] [取消]  运行中不可用「干净」徽章         │
└────────────────────────────────────────────────────┘
┌ 结果 ─────────────────────┬ 修复差异 ──────────────┐
│ 严重度过滤 / 规则 / 路径   │ 选中 finding 的 diff    │
│ 列表：位置、规则、层标签   │ expectedDigest vs 磁盘  │
│ 点击定位编辑器（当前文件   │ 冲突：并排「提案|磁盘」 │
│ 版本须匹配 digest，否则    │ [申请写回] [抑制…]     │
│ 标过期）                   │ 自动修复：仍列出本批    │
│ unanalyzed 独立一节        │ apply 的文件与相位      │
└───────────────────────────┴────────────────────────┘
```

### 7.2 展示规则

- **没有 `passed`。** 文案用「范围内 N 个文件、M 条发现、K 个未分析」。
- 层标签来自报告 `layer` + 引擎能力；UI 不得因用户点了「深度」就把 static 结果改标。
- 正文转义；密钥类规则的匹配片段默认折叠，导出脱敏（SC08）。
- `freshness=stale`：横幅「源码已变，结果不可作为当前结论」；修复按钮禁用，直到复扫。
- 在途：进度与已出发现；取消后保留 partial。
- 键盘：列表、差异、开始/取消可全键盘操作；回执不抢焦点。

### 7.3 CLI 对等

`scan describe|run|status|cancel|report`；`scan fix-prepare` 打印将交给 review-apply 的路径列表。不提供「一键写盘且无审批」开关。

---

## 8. 持久化、授权、安全边界

- **授权：** 扫描读工作区 ≠ 写回授权 ≠ 上传授权 ≠ 安装扫描器。
- **秘密：** 发现消息可含密钥片段 → 普通会话投影剥离，完整报告在附件仓，导出走脱敏。
- **取消：** 与 turn/execution 同一 Stop 语义；取消不把已写修复回滚（回滚是 Git/撤销域）。
- **自动化：** F13 触发扫描视为 `trigger=manual` 的等价物但仍要项目内授权；无人值守 **不能** 自动 upload、不能自动 high-impact fix。
- **项目身份：** 迟到 scanId 不得写入新会话投影。

---

## 9. 实施顺序（建议，非本轮施工）

1. core 结果模型 + `scan/describe|run|status|cancel|report` + 内置 static 引擎 + 夹具 SC01。  
2. Host/CLI 分派；桌面面板只读展示；tab 仍可先 false 直到 run 通。  
3. `scan/fix-prepare` 接 `execution/review-apply`；并发冲突夹具 SC05。  
4. incremental + 适配器范围冻结 SC02。  
5. deep 按 T2 选型后单独验收 SC03；无引擎则入口保持禁用。  
6. 抑制/复扫/测试验证 SC06；取消/崩溃 SC07；双入口导出 SC08。  
7. 可选 Semgrep 探测，能力位驱动 UI，不捆绑。

每层独立证据：冻结夹具、规则版本、文件 digest、预期 findingId。

---

## 10. 待确认项

| ID | 问题 | 建议默认 | 阻塞 |
| --- | --- | --- | --- |
| **T1** | static 自动修复是否还要弹 `execution/review-apply` 审批，还是「本任务已有写授权」则只展示差异后直接 prepare+apply？ | **仍走 apply 工单**；任务授权只限制 *哪些 path 可进自动挑选*，不省略一次性票。更安全，SC05 更易举证。 | 是（修复路径） |
| **T2** | deep 一期引擎：自研 JS/TS 污点 / CodeQL / 仅占位禁用？ | **无合格数据流引擎则 deep 禁用**；若要 SC03 本期过，做最小 JS sink 表污点，CodeQL 作可选增强。 | 是（SC03） |
| **T3** | 内置规则语言矩阵（JS/TS/Python/Cangjie/其它） | 先 JS/TS + 密钥；Cangjie 第二；其余 unanalyzed | 否 |
| **T4** | 回合后自动 static 的默认开/关 | 默认 **开**，设置可关；incremental 默认关 | 否 |
| **T5** | `scan/run` 是否允许 turn 在途 | 默认 **拒绝** `turn-in-flight`；status/cancel 允许 | 否 |
| **T6** | Semgrep/CodeQL 用户自备 vs 插件市场分发 | 自备路径 + `scan/describe` 探测；市场分发另走 F12 安装≠启用 | 否 |
| **T7** | 云端 SAST 供应商与留存政策 | 无供应商则 upload 整支禁用，不留「即将支持」假按钮 | 是（若做 SC04 上传支） |
| **T8** | 归一逻辑放 core 仓颉还是 Host 调 Node 适配器 | **语义进 core**；桌面适配器可继续测纯数据，避免双 CAS | 是（真源） |
| **T9** | 无 execution 的手动扫描写回：新建轻量 execution 记录 vs 扩展 review-apply 不绑 executionId | **新建 scan-fix execution**，少改现有 shape=5 的 prepare 契约 | 否 |
| **T10** | 单文件大小/总字节上限是否沿用 1 MiB / 16 MiB | 沿用适配器 16 MiB 报告预算；单文件上限需产品定 | 否 |
| **T11** | 抑制是否允许跨项目 | **否**，按 projectId | 否 |

---

## 11. 验收映射（设计覆盖，非已实现）

| 标识 | 本设计对应 |
| --- | --- |
| SC01 | §3.2 本轮范围 + 负对照 + unanalyzed |
| SC02 | §3.3 冻结增量、禁止全量缓存冒充 |
| SC03 | §3.4 强制 dataflow 路径；无引擎拒 deep |
| SC04 | destination/uploadConfirmToken；未知二进制拒绝 |
| SC05 | §5 review-apply CAS；越范围不自动 |
| SC06 | 复扫 + 抑制失效条件；测试失败不标 fixed |
| SC07 | 状态机 partial；取消真停；不自动续传 |
| SC08 | 双入口同契约；报告绑定修订/规则；无「无漏洞」文案 |

反证：单文件规则标 deep → 协议/UI 校验失败；陈旧 digest apply → conflict 不覆盖。
