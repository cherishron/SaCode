# Qwen Code Batch API 复刻方案草案

- 状态：v0.1，供架构评审；**尚未开始实现**，不装依赖、不替换实现、不发布。
- 本次范围：把 https://qwenlm.github.io/qwen-code-docs/zh/users/features/batch/ 的 CLI 封装层（`qwen batch` 子命令族）复刻进本仓（仓颉 `core` + `apps/cli` + `apps/desktop`）。
- 复刻口径：**行为等价 / 架构约束等价 / 格式或协议兼容 / 插件源码兼容**四级分开验收，不把其中一种宣称为全部兼容。完整范围保留，分批交付不等于删项。
- 三类标注：**事实**（上游原文可复查）/ **本项目提案**（接口名冻结前不是上游 API）/ **兼容目标**（不承诺）。

---

## 0. 口径先行：这个功能的分母是什么

**事实**：`batch` 不在 `docs/plans/dsh-capability-matrix.md` 的 63 模块冻结快照里（全表 grep 无命中）；`docs/evidence/dsh-upstream-delta-commits-2026-10-06.json` 里出现的 batch 串全部是无关项（write-batching 架构笔记、resume-selector-batch-projection bug-fix、windows-signature-batch 打包脚本），不是本功能。

**事实**：上游页面是 **CLI 用户指南**，不是 DashScope Batch API 的 HTTP 契约。页面本身**没有** HTTP 端点、请求/响应 schema、JSONL 行格式、文件上传端点——这些属于 DashScope 平台 API 参考文档，不在本页面内（两次 WebFetch 均确认）。

**结论（本项目提案）**：按 AGENTS.md「有→复刻契约；没有→自有增量不占上游分母」，本功能属**自有增量**，不进 63 行矩阵分母。复刻对象是 **CLI 封装层 + 编排语义**；底层 HTTP API 是**外部平台依赖**，与本仓已有模型 provider API 同等接入性质，不是可从本页面冻结的上游契约。

---

## 1. 上游到底是什么（分层认知）

| 层 | 内容 | 一句话本质 |
|---|---|---|
| L0 平台 API | DashScope Batch API（HTTP，本页面未给出契约） | 异步远端批处理：上传 JSONL → 提交 batch → 轮询 → 下载结果文件 |
| L1 CLI 封装 | `qwen batch check/run/collect/retry/list/cancel/clean` + `settings.json` 配置面 | 把平台 API 包成**有审批、有快照、有状态机**的本地命令 |
| L2 编排语义 | 计划文件（`.qwen/batch/plans/<slug>.json`）、快照哈希、delivered/held/failed 三态、自动收集开关 | 批处理是**有持久产物的有状态流程**，不是一次远程调用 |

关键判断：**批处理与日常对话是两条独立的计费/认证面**（`batch.model` / `batch.authType` / `envKey` 独立于日常 provider），且**提交后立即返回、等待过程不调用模型**。这两条是复刻的架构锚点，不是 UI 细节。

---

## 2. 复刻的硬规格：架构不变量表

| # | 不变量 | 出处 |
|---|---|---|
| 1 | **批处理模型可独立配置，不必替换日常对话的模型或认证**——batch 与 chat 是两条独立 provider 配置线 | 页面「批处理模型可独立配置」 |
| 2 | **计划是持久产物**：`.qwen/batch/plans/<slug>.json`，含 `maxCostUsd` / `maxOutputTokens` / `thinking_budget` / token 估算 / 快照哈希 | 页面「配置」「执行输入」「计划文件」 |
| 3 | **提交前有快照校验**：`--expect <snapshot>` 防止计划/文件/设置在预览与提交之间被修改 | 页面「`qwen batch run`」「--expect」 |
| 4 | **审批在提交之前**：预览展示计划，用户确认支出后才提交（计费点在提交） | 页面「Agent 检查配置…生成计划并展示预览；用户在提交审批时确认支出」 |
| 5 | **提交立即返回**：后台以 HTTP 轮询等待，**等待过程不调用模型**，用户可继续其他工作 | 页面「提交后立即返回，后台以 HTTP 轮询等待…等待过程不调用模型」 |
| 6 | **同一任务不能被多个批处理命令同时操作**（单任务互斥） | 页面「只明确同一任务不能被多个批处理命令同时操作」 |
| 7 | **交付三态**：delivered（已写入）/ held（源文件变更或目标冲突，暂停）/ failed（截断、为空、工具调用错误、提供商错误） | 页面「项目状态」「结果写入…分别报告已写入、暂缓写入或失败」 |
| 8 | **重复收取是幂等的**：已 delivered 的项不会重做 | 页面「重复收取不会重做已交付项」 |
| 9 | **失败项不自动重试**（避免再次计费）；截断项须用更大的 `--max-output-tokens` 重试 | 页面「失败项不会自动重试」「截断项须通过更大的 --max-output-tokens 重试」 |
| 10 | **重试再次计费；取消仍可能收取部分结果费用；清理本地记录不等于取消远程任务**——计费与清理解耦 | 页面「重试再次计费；取消仍可能收取部分结果费用；清理本地记录不等于取消远程任务」 |
| 11 | **输出不得越出项目或进入隐藏路径** | 页面「输出不得越出项目或进入隐藏路径」 |
| 12 | **仅支持 chat-completions 协议**；`wireApi` 省略或 `"chat-completions"`，`"responses"` 不支持；**OAuth 不能用于批处理认证** | 页面「配置」「wireApi」「OAuth 本身不能用于批处理认证」 |
| 13 | **自动收集是上下文相关的**：交互会话支持自动收集；无头运行、服务模式及 IDE/ACP 客户端**不支持**该自动行为 | 页面「交互会话支持自动收取；无头运行、服务模式及 IDE/ACP 客户端不支持」 |
| 14 | **成功请求按实时标价的一半计费，但无前缀缓存**；仅比较输入成本时，缓存命中率超 62.5% 可能更便宜——成本模型可由 `QWEN_BATCH_INPUT/OUTPUT_PRICE_PER_1M_USD` 环境变量自定义 | 页面「成功请求按实时标价的一半计费…」「环境变量」 |
| 15 | **`check` 不计费**：验证配置就绪状态，不提交计费任务 | 页面「`qwen batch check`：验证配置，不提交计费任务」 |
| 16 | **完成窗口至少 24 小时**，实际等待从秒级到小时级；`collect --wait` 可等待完成，`--timeout` 控制超时 | 页面「完成窗口至少 24 小时」「`--wait`」「`--timeout`」 |

---

## 3. 系统地图与复刻分层

### 3.1 上游子系统清单（本页面可确认的部分）

| 子系统 | 内容 | 复刻分层 |
|---|---|---|
| batch-config | `settings.json` 的 `batch.*` 段 + `settings.env` 的 `envKey` 引用 | P0 |
| batch-plan | 计划文件的生成、快照哈希、`maxCostUsd`/`maxOutputTokens`/`thinking_budget` | P0 |
| batch-cli | `check/run/collect/retry/list/cancel/clean` 七个子命令 + 标志位 | P0 |
| batch-state | 任务记录（`QWEN_BATCH_HOME` 下）与 delivered/held/failed 状态机 | P0 |
| batch-api | 对外部长 HTTP Batch API 的接入（契约不在本页面，**待补**） | P1（依赖平台文档） |
| batch-ui | 桌面端的批处理入口与状态展示 | P1 |
| batch-auto-collect | 交互会话的自动收取（无头/服务/ACP 明确排除） | P2 |

### 3.2 本仓落点（本项目提案）

| 子系统 | 落点 | 说明 |
|---|---|---|
| batch-config | `core/` 配置模块 + `apps/cli` | 复用现有 provider 配置抽象，新增 `batch` 命名空间 |
| batch-plan | `core/` | 纯本地 JSON 产物，不依赖远端 |
| batch-cli | `apps/cli/main` | 仓颉可执行，也是 npm CLI 二进制来源 |
| batch-state | `core/` 会话日志旁的独立任务记录 | **不**复用 session.log（批处理是独立产物面） |
| batch-api | `core/` HTTP 客户端封装 | 契约待补 → 写成 BLOCKED 前提，不假装已知 |
| batch-ui | `apps/desktop/renderer/` | 经 IPC 通道，不自建消息面 |
| batch-auto-collect | `core/` + `apps/host` | 依赖会话上下文判定 |

---

## 4. 五层职责与禁止职责

| 层 | 职责范围 | **不允许承担什么** |
|---|---|---|
| **核心运行时**（`core/` 仓颉静态库） | 批处理配置解析、计划生成与快照、任务状态机、delivered/held/failed 判定、自动收集上下文判定、对远端 Batch API 的 HTTP 封装 | **不得**依赖桌面壳、前端框架或页面工具 SDK；**不得**把批处理任务记录并进 session.log（那是另一条真相源）；**不得**在无远端契约时把 API 形状写成已确认 |
| **客户端 UI 模型**（`apps/desktop/renderer/`） | 展示批处理入口、计划预览、任务列表与三态状态；经 IPC 通道提交/收取 | **不得**自行发起远端 HTTP 请求；**不得**绕过审批直接提交（计费点必须经用户确认）；**不得**在无头/服务/ACP 形态下开启自动收集 |
| **桌面壳**（`apps/desktop/main.cjs` 等） | 进程管理、IPC 通道注册、打包态宿主路径解析 | **不得**承载批处理业务逻辑；**不得**把批处理当成普通对话轮次渲染 |
| **扩展宿主**（`extjs/`） | 若批处理能力以扩展形式提供，由此处装载 | **不得**让扩展宿主成为批处理的第二条提交通路（审批只走主入口） |
| **页面工具/ACP 接入层** | 远端调用方经此接入 | **不得**开启自动收集（上游明确排除 IDE/ACP）；**不得**透传未校验的审批字符串 |

---

## 5. 交付入口切分

| 入口 | 输入形态 | 展示形态 | 审批形态 | 取消与退出语义 |
|---|---|---|---|---|
| **CLI**（`apps/cli`，npm 包二进制） | 子命令 + `--dry-run` / `--expect` / `--wait` / `--timeout` / `--max-output-tokens` / `--force` | stdout 文本 + 退出码 | `--dry-run` 预览不提交；提交前需用户确认支出（**非交互入口无应答者则拒绝，不静默放行**） | `cancel` 可能部分计费；`clean --force` 仅删本地记录，不取消远端 |
| **Electron 桌面**（`apps/desktop`） | 菜单/面板入口 + IPC 通道 | 计划预览弹窗、任务列表、三态徽标 | 审批弹窗确认后才提交；**fail-closed**：无应答者拒绝 | 关闭面板不取消远端任务；`cancel` 与 `clean` 分开 |

**不可让步规则**：CLI 包不捎带桌面前端；桌面包不依赖全局安装 CLI；两个入口共享同一 `core`，不维护第二套业务逻辑。

---

## 6. 动态扩展与兼容分级

本功能是**自有增量**，不以插件兼容为目标。兼容阶梯按以下两级起步，不宣称更高：

| 级别 | 判据 | 本功能当前定位 |
|---|---|---|
| **行为等价** | 同一 CLI 命令序列产生同可观测行为（提交/收取/三态） | 目标 |
| **架构约束等价** | 独立配置面 / 单任务互斥 / 提交即返回 / 审批在提交前 | 目标 |
| 格式或协议兼容 | 与上游任务记录格式、远端 API 协议可互认 | **兼容目标**（不承诺，格式未冻结） |
| 插件源码兼容 | 未修改的上游扩展包可装载执行 | **不适用**（上游无对应 JS 扩展包，且本仓不跑上游 .ts） |

**安全边界**：批处理涉及**计费**，任何新增接入路径（扩展宿主、远程调用、页面工具）必须走同一套身份、审批、取消与审计，不得成为绕过审批的第二提交通路。

---

## 7. 首轮验证与分阶段路线

### 7.1 首轮纵向切片（证伪关键假设，不是 demo）

| 验证项 | 正向与反向验收 |
|---|---|
| 配置面 | 正向：`batch.model`/`batch.authType`/`envKey` 独立于日常 provider，`check` 不计费；反向：缺 `envKey` 指向不存在的键必须拒绝，`wireApi:"responses"` 必须拒绝 |
| 计划与快照 | 正向：生成 `plans/<slug>.json` 含 `maxCostUsd`/`maxOutputTokens`/快照哈希；反向：修改计划后用旧 `--expect` 提交必须被拒 |
| 状态机 | 正向：delivered/held/failed 三态，重复收取幂等；反向：held 项被误标 failed、failed 项被自动重试 |
| 提交即返回 | 正向：提交后立即返回、后台轮询不阻塞；反向：等待过程调用模型、或提交后立即阻塞到完成 |
| 审批 fail-closed | 正向：`--dry-run` 不提交；反向：无应答者路径静默放行、审批字符串经渲染层透传 |
| 自动收集上下文 | 正向：交互会话自动收取；反向：无头/服务/ACP 形态下自动收取被触发 |
| 输出 confinement | 正向：结果写入项目内指定路径；反向：结果写入隐藏路径或项目外必须被拒 |
| 计费与清理解耦 | 正向：`clean --force` 不取消远端；反向：`clean` 被当成取消、或取消后本地状态被误清 |
| 跨入口一致性 | 正向：CLI 与桌面同一任务投影相同；反向：两入口同时操作同一任务，第二写者被明确拒绝 |

**判决只用三值**：PASS / FAIL / BLOCKED。BLOCKED 必须列出缺什么前提。

### 7.2 分阶段路线

```text
S0 冻结上游页面 + 确认分母（自有增量，不占 63）  → 门禁：事实/提案/兼容目标三类标注可评审
P0 配置面 + 计划/快照 + 七个 CLI 子命令（本地态，不接远端） → 门禁：7.1 前 8 行 PASS
P1 接入远端 Batch API（契约待补，先写 BLOCKED 占位）   → 门禁：真实凭证端到端，假响应不得标真实接入
P2 桌面入口 + 自动收集上下文判定                       → 门禁：双入口一致性 + fail-closed
```

---

## 8. 明确后置清单

- **远端 HTTP 契约不在本页面内**：端点、请求/响应 schema、JSONL 行格式、文件上传接口均需 DashScope 平台 API 参考文档。**在拿到契约前，`batch-api` 行保持 BLOCKED，不得写成已支持。**
- 上游页面未说明：请求并发数、结果顺序保证、批处理大小上限、文件大小上限、超时与重试策略的平台侧行为。
- 上游页面未说明：任务记录的完整 JSON schema、`list` 的输出格式、`cancel` 的平台侧语义细节。
- 本仓尚无独立的批处理任务记录面：需新增（不并入 session.log）。
- 桌面端 IPC 通道需新增（同步改 `preload.cjs` 与 `test/bridge.test.mjs`）。

---

## 9. 待用户拍板的分叉

| # | 分叉 | 默认推荐 | 依据 |
|---|---|---|---|
| 1 | 是否现在就接远端 Batch API | **先不接**，P0 只做本地态与 CLI 面 | 远端契约不在本页面，凭空写 schema 会造出假已知 |
| 2 | 任务记录存哪 | 新增独立目录 `batch/tasks/<task-id>/`，不并入 session.log | 上游 `QWEN_BATCH_HOME` 即独立目录；会话日志是唯一真相源，不可混 |
| 3 | 桌面入口形态 | P1 随 CLI 能力同步落地，经 IPC 调用同一 `core` | 双入口共享核心是本仓既定架构 |
| 4 | 自动收集默认开关 | **默认开启**（上游默认），但无头/服务/ACP 强制关闭 | 上游 `general.batchAutoCollect` 默认开启且明确排除无头形态 |
| 5 | 成本估算 | 用环境变量可自定义价格，缺省按实时标价一半 | 上游提供 `QWEN_BATCH_*_PRICE_PER_1M_USD` |

---

## 10. 证据与可信度

**已读范围**：
- 上游页面 `https://qwenlm.github.io/qwen-code-docs/zh/users/features/batch/`（两次 WebFetch，内容一致）。
- `docs/plans/dsh-capability-matrix.md`（全表 grep 确认无 batch 行）。
- `docs/evidence/dsh-upstream-delta-commits-2026-10-06.json`（确认 delta 中无本功能）。
- 本仓 `core/src/` grep：`batch` 仅作局部变量（`batchEnd`/`lineBatches`/`attachmentImageBatch`），无批处理 API 入口。

**自行复核过的结论**：
- 「本仓没有 Batch API 功能」——基于 `core/src/`、`apps/`、`docs/` 全仓 grep，排除 `.tmp-dsh-asar/`（那是上游 DSH 参考副本，非本仓源码）。
- 「batch 不在 63 模块分母」——基于能力矩阵全表 grep 无命中。

**上游文档自身没给出的**（已列入 §8）：远端 HTTP 契约、并发数、顺序保证、任务记录完整 schema。

**未读**：DashScope Batch API 平台文档（不在本页面内，需另行获取）；本仓 `apps/desktop/preload.cjs` IPC 全量通道列表（仅知需新增通道，未逐条核现有 33/42 条）。