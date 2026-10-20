# F19 数据导入实现设计

- 文档类型：实现设计（非代码）
- 日期：2026-10-20
- 源码基线：当前工作区只读核对；HEAD 为 `f7cef5f`
- 范围：设计文档，不修改 `core/`、`apps/host/`、`apps/desktop/` 产品源码，不提交、不推送
- 结论口径：F19 当前**未完成**。本文描述“从现有能力到可验收实现”的完整设计，不把设计存在当作功能已交付

---

## 0. 结论摘要

1. `core/src/migration_pack.cj` 不是通用数据导入模块。它只认识 SaCode 自己导出的 `sacode-migrate/1` 包，只覆盖供应商、自定义模型、绑定、预算、探测和凭据引用；不包含会话、知识、消息、工具事件、账本或健康日志。
2. `migration_pack.cj` 只有“校验 + 差异预览”，没有把计划写入注册表的 apply 实现。`MigrationApplyResult` 只是一个数据类，不会被任何函数产出。损坏条目在解析时被静默丢弃，无法满足 F19 的“损坏条目单独报告”。
3. Host 没有通用 `import/*` 或 `migrate/*` 分派。现有 `custom/import/new`、`custom/import/into` 和 `knowledge/import` 是两条窄导入路径；`initialize` 的 capabilities 也未声明通用导入方法。
4. 桌面的 `apps/desktop/import-adapters/` 已有一套 ChatGPT 结构化 JSON 的纯解析、工作线程取消和交接契约，但未接 main/preload、Host、核心落库、UI 或打包链；测试样本全部为合成夹具，没有真实导出格式兼容证据。
5. 推荐架构：**第三方格式解析留在桌面主进程，Host 做权威校验、去重、落库与报告**。新增 `import/*` 方法族；Host 采用“预览只读、应用建作业、轮询推进”的单线程作业模型；核心新增导入作业日志、可重建去重索引和分类型落库能力。
6. 配置导入只接受 `kind=config`，明确拒绝 `secret-bundle`；会话导入只新建独立会话，绝不追加到当前会话，也不伪造工具、审批或执行事件；知识导入按快照批量写入并保存来源指纹；所有导入单向追加、不建立同步。

---

## 1. 范围与非目标

### 1.1 本文覆盖

- 来源选择、文件读取边界、预览、字段映射、去重、应用、逐项报告、取消、重启恢复。
- 会话、知识、配置三类目标的落库边界与失败语义。
- 与现有 Host 分派、turn 门禁、capabilities、IPC 面的接入方式。
- 前端入口、页面状态机、构建接线。
- 安全不变量与验收设计。

### 1.2 明确不做

- 不实现任何第三方产品解析器；除已存在的 ChatGPT 结构化 JSON 解析器外，不为没有 schema 和样本的产品编造兼容。
- 不导入密钥明文，不导入 `secret-bundle`，不读取凭据值，不执行来源脚本，不访问来源网络地址。
- 不做双向同步、后台监听、来源变更回写、来源删除传播。
- 不把导入的 assistant/user 文本伪装成原生工具调用、审批、执行或 goal 事件。
- 不修改来源文件，不在来源目录写任何文件。
- 不在本设计中承诺安装态、真实格式兼容或 F19 完成；这些需要单独构建、运行与用户验收证据。

---

## 2. 当前能力盘点（源码事实）

### 2.1 `migration_pack.cj` 到底支持什么

证据文件：`core/src/migration_pack.cj`。

| 维度 | 当前事实 | 对 F19 的含义 |
| --- | --- | --- |
| 来源 | 只解析 SaCode 自己定义的 `sacode-migrate/1` JSON 包 | 不是“从其他产品导入”的通用格式层 |
| 包类型 | `config`、`secret-bundle` 两种（`:32-33`） | F19 只能接受 `config`；`secret-bundle` 必须拒绝 |
| 数据类型 | 供应商（含模型）、自定义模型（含绑定、预算、探测）、凭据引用 | 不含会话、知识、消息、工具结果、账本、健康日志 |
| 密钥 | `config` 结构不承载明文；`secret-bundle` 的凭据值由 `secret_bundle.cj` 单独加密 | F19 不读入密钥，配置导入必须显式拒绝 secret 包 |
| 解析入口 | `MigrationBundle.fromJson`（`:474`）、`structuralValidation`（`:533`）、`checksumValidation`（`:547`）、`validate`（`:560`） | 可做包级校验，但逐条错误不完整 |
| 读面摘要 | `safeSummary`（`:573`）只返回计数，不含条目内容 | 可以作为报告摘要的基础 |
| 差异预览 | `computeMigrationPlan`（`:781`）按稳定 ID 产出 `new/updated/unchanged`，并检测凭据引用重叠 | 可以作为配置导入的预览基础 |
| apply | **不存在**。`MigrationApplyResult`（`:679-711`）只是字段容器；生产代码没有函数构造或返回它，只有测试直接构造 | 配置导入仍缺真正的落库编排 |
| 构建导出 | `buildConfigBundle`（`:857`）、`buildSecretBundle`（`:886`） | 可复用为导出侧，不是本设计的重点 |
| 损坏条目 | `MigrationProviderEntry.fromJson`、`MigrationCustomModelEntry.fromJson` 等返回 `Option`，`MigrationBundle.fromObject` 直接跳过 `None` | 坏条目会静默消失，违反 F19“损坏条目单独报告” |
| 比较完整性 | `migrationProviderEqual`（`:714`）比较模型时只看 id/name/contextWindow/maxTokens/image，漏掉 `inputModalities`、`outputModalities`、`supports`、`meterUnit`、`provenance`、`availability`；`migrationCustomModelEqual`（`:739`）对 `requires`/`bindings` 只比数量 | 可能把真实变化误判为 `unchanged`，配置导入前必须补全 |
| `conflict` 动作 | 注释定义了 `conflict`（`:585`），但 `computeMigrationPlan` 从不产出 | 冲突语义需要在新编排层补齐 |
| 进程边界 | 没有 Host 分派；没有 `migrate/*` 方法 | 不能从桌面直接调用现有迁移能力 |

补充事实：`core/src/secret_bundle.cj` 与迁移包共用 `sacode-migrate/1` 标识（`:43`），使用 SM4-CTR + HMAC-SHA256 + PBKDF2，口令只以参数进出，且**结构上没有跳过校验的开关**。F19 不应把这条路径当作“顺便导入密钥”的捷径。

结论：`migration_pack.cj` 的准确定位是“SaCode 配置迁移的格式、校验与差异计算模块”，不是 F19 通用导入核心。它的现有差异能力可复用，但必须补逐条问题、比较字段、apply 编排和 Host 接线后才能支撑配置导入。

### 2.2 Host 现有导入路径

证据文件：`apps/host/src/main.cj`、`apps/host/src/knowledge_rpc.cj`。

| 方法 | 位置 | 能力 | 与 F19 的差距 |
| --- | --- | --- | --- |
| `custom/import/new` | `main.cj:816-831` | 把 `providerId/modelId` 条目导入一个新自定义模型；按派生 id 去重；整批能力检查；修订 CAS | 只导模型绑定，不导会话/知识/供应商配置；无通用报告与取消 |
| `custom/import/into` | 同上 | 向已有自定义模型追加绑定；跳过已有绑定 | 同上 |
| `knowledge/import` | `main.cj:1196`、`knowledge_rpc.cj:31-40` | 读取**项目相对文件**，≤64 KiB，转为知识快照保存 | 不接收文本候选/来源指纹；不支持批量逐项报告；不能导入外部产品结构化知识 |
| capabilities | `main.cj:1280` | 声明了上述两个 `custom/import/*` 和 `knowledge/import` | **没有** `import/*` 或 `migrate/*` |
| 分派链 | `main.cj:3577-3656` | 现有 `handleRpc0` 至 `handleRpc62` 已被占用 | 新方法族需要新增分派入口并处理 turn/fault/frozen 顺序 |

`main.cj` 的 turn 门禁在 `handleRpc11`（`:1270-1276`），只放行 `allowedDuringTurn` 白名单。通用导入的写方法必须落在门禁之后，读方法可选择放行；具体见 §6.2。

### 2.3 桌面已有导入数据层

证据目录：`apps/desktop/import-adapters/`。

| 文件 | 能力 | 边界 |
| --- | --- | --- |
| `chatgpt.cjs` | `previewChatGpt(text)`：只解析已读入的 JSON 数组文本；支持 `id/title/current_node/mapping` 与 user/assistant 文本；输出 candidates/duplicates/conflicts/issues/summary；默认 16 MiB、2000 会话、20000 节点、10000 条文本消息、单条 1 MiB | 不读路径、不联网、不解压、不执行；只支持结构化导出 |
| `async-preview.cjs` | 固定工作线程解析，支持取消与 1–120000 ms 超时，取消/超时不返回部分结果 | 未接 Electron；打包态 worker 路径未验 |
| `handoff.cjs` | 只允许 `displayTitle` 映射；target 只接受 `projectId/expectedRevision/requestId`；输出 `append-imported-transcripts` 交接包 | 交接包不是可执行事件；无 apply/落库 |
| `README.md` | 明确“无 apply/落库接口、无 UI/IPC/打包接线，不宣称 F19 完成” | 与本文口径一致 |
| `INTEGRATION.md` | 来源登记：ChatGPT 合成契约可解析/预览/交接；分享网页、ZIP 不支持；其他产品未实现；无真实样本，不登记真实格式兼容 PASS | 真实格式仍是待验证项 |

### 2.4 模型中心迁移页不是 F19

`apps/desktop/renderer/pages/migration.ts` 是模型中心的“迁移”标签页，只做自定义模型绑定条目的导入/导出与 `validateItems`/`buildExport`（`:16-31`），页面自己写明“完整迁移（含供应商与凭据）需后端提供 `migrate/*` 动词”。它不能作为 F19 入口，也不能作为 F19 已完成证据。

### 2.5 PRD 与台账的口径差异

| 文档 | 位置 | 表述 | 本设计采信 |
| --- | --- | --- | --- |
| `docs/product/PRD.md` | `:205`、`:463`、`:508` | F19 要求来源选择、预览、字段映射、去重、报告、取消、重启恢复；单向追加；损坏条目单独报告；不读密钥/不执行脚本 | 作为功能与验收需求 |
| `docs/product/PRD.md` | `:817` | 现状表把“模型配置导入”标为“完整”，同时承认“跨产品通用数据导入/显式字段映射不存在” | “完整”只描述模型绑定导入，不是 F19 完成 |
| `docs/product/PRD-tracking.md` | `:148` | F19 状态“待核”，已完成“无”，剩余“导入实现与验收证据未见；字段映射/去重/报告未落地” | 以台账为准：F19 未完成 |
| `docs/evidence/model-center-b5-migration-2026-10-05.md` | — | 声称 `computeMigrationPlan() → 差异预览 → MigrationApplyResult` 流程 | 与源码不符：源码无 apply；该证据只能证明校验/预览，不能证明应用落库 |

本设计在实现阶段应同步更新台账与证据口径，不得沿用“完整”概括 F19。

---

## 3. F19 需求到设计元素的映射

| F19 要求 | 设计元素 | 验收锚点 |
| --- | --- | --- |
| 来源选择 | `import/sources` + 前端来源卡片 | 只展示已实现来源；未实现来源不伪装可用 |
| 预览 | 桌面本地预览 + Host `import/preview` 权威计划 | 预览不写入目标；显示新增/重复/冲突/无效 |
| 字段映射 | 会话标题、知识标题/作用域、配置合并策略与凭据绑定 | 映射表可见、需确认；不允许映射成工具/审批事件 |
| 去重 | 来源指纹 + 目标 provenance + 可重建索引 | 重复导入不重复追加 |
| 导入报告 | `import/report` + 作业日志 | 逐项状态、原因码、目标 id；部分成功如实报告 |
| 取消 | `import/cancel` + 作业安全点 | 已提交保留，未开始不执行，不虚报回滚 |
| 重启恢复 | 作业日志 + `import/jobs` + `import/resume` | 重启后显示中断作业，可继续；不自动执行 |
| 单向追加 | 不写来源、不监听、不回写 | 来源修改不影响已导入内容 |
| 损坏条目单独报告 | 适配器逐条 issues + Host 逐候选校验 + 配置详细解析 | 坏条目有索引与原因，其他条目可继续 |
| 不读入密钥 | 拒绝 `secret-bundle`；配置凭据只做引用映射；不读值 | 无密钥值进入日志/报告/目标 |
| 不执行来源脚本 | 纯数据解析、固定 worker、无 eval/动态 import/网络 | 负向测试验证 |

---

## 4. 总体架构与关键决策

### 4.1 分层

```text
┌─────────────────────────────────────────────────────────────┐
│ Renderer（纯 JS + Vue runtime）                              │
│  导入面板：来源选择 / 预览 / 映射 / 进度 / 报告              │
│  只拿摘要与报告，不拿完整来源正文                             │
└──────────────────────────┬──────────────────────────────────┘
                           │ preload 有限 IPC（新增 import* 通道）
┌──────────────────────────▼──────────────────────────────────┐
│ Electron main（受信本地进程）                                 │
│  文件选择 + 大小预检 + 固定适配器/worker 解析                  │
│  短期 token 持有候选；不把任意路径/worker 路径交给渲染层        │
└──────────────────────────┬──────────────────────────────────┘
                           │ Host NDJSON JSON-RPC（import/*）
┌──────────────────────────▼──────────────────────────────────┐
│ Host（仓颉，权威边界）                                        │
│  参数校验 / 指纹重算 / 去重 / 计划哈希 / 作业状态机 / 分派      │
└──────────────────────────┬──────────────────────────────────┘
                           │ core API
┌──────────────────────────▼──────────────────────────────────┐
│ core（仓颉共享业务实现）                                      │
│  会话落库（staging + 原子改名）/ 知识快照 / 配置编排            │
│  作业日志 / 去重索引（可重建）/ 来源 provenance                │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 关键决策

| 编号 | 决策 | 理由 | 代价/边界 |
| --- | --- | --- | --- |
| AD-1 | 第三方格式解析留在桌面主进程/固定 worker，不放进 core | 已有 JS 适配器与测试；仓颉侧重写第三方解析没有收益，且扩大不可信输入面 | Host 不能独立解析 ChatGPT 文件；桌面必须负责适配器打包与取消验收 |
| AD-2 | Host 是权威校验、指纹、去重和落库边界；不信任渲染层/主进程的“已存在摘要” | 渲染层可被注入内容影响；哈希不是认证；去重必须对目标真源重新核 | Host 需要维护去重索引或扫描目标 |
| AD-3 | 新增 `import/*` 方法族，不复用 `custom/import/*` 或假设中的 `migrate/*` | 现有方法语义窄且已有调用方；F19 需要独立状态机、报告与取消 | 需要新增 capabilities、分派、IPC 与测试 |
| AD-4 | 作业采用“apply 建作业、poll 推进”的单线程泵模型，不另起后台线程 | Host 主循环单线程；后台写线程会与租约、事件循环、取消产生竞态；泵模型让取消和重启边界确定 | 进度依赖前端持续轮询；关闭窗口即自然停在安全点 |
| AD-5 | 会话导入只新建独立会话，先在 staging 写完整日志，再原子改名为正式会话 | 避免取消/崩溃留下半截会话；不污染当前会话；不伪造工具/审批/执行事件 | 需要新增 staging/commit API；改名前需要同卷 |
| AD-6 | 知识导入按一次快照批量写入，单条非法不拖垮整批，但整批快照仍需修订 CAS | 知识库是单快照真源；逐条写会产生多次全量替换和中间态 | 大批量需要容量预检；取消只能发生在快照写入前 |
| AD-7 | 配置导入只接 `kind=config`，`secret-bundle` 整包拒绝；不把 apply 塞进 `migration_pack.cj` | 保持格式/校验模块纯粹；apply 需要跨 ProviderRegistry/CustomModelRegistry 编排，属于新服务 | 需要新 core 编排模块和详细解析扩展 |
| AD-8 | 去重索引是“可重建索引”，目标 provenance 才是权威；索引与目标不一致时以目标为准 | 遵守“会话日志/目标存储是唯一真源”；索引损坏不能阻断导入 | 需要扫描/重建逻辑与容量上限 |
| AD-9 | 配置导入默认只新增；更新必须显式允许；供应商凭据引用默认清空并禁用，除非用户映射到本机已有引用 | 不静默覆盖用户配置；不读取密钥；不把来源凭据引用误绑到本机秘密 | 导入后的供应商可能需要用户重新绑定凭据并启用 |
| AD-10 | 导入写操作与 turn 互斥；预览/报告等读操作可在 turn 中放行 | 避免导入配置与会话写入与执行轮次交叉；读操作不产生目标变更 | 需要 `turn/start` 与 `import/apply` 双向检查 |

### 4.3 为什么不是“core 直接解析所有格式”

- ChatGPT 导出是第三方 JSON，字段与版本不受本仓控制；仓颉核心解析它会把格式兼容、模糊字段和容错策略塞进共享业务核心。
- 现有 JS 适配器已经用合成夹具钉住了分支、隐藏消息、断链、环、限额、取消和指纹；迁移到仓颉会重复实现并失去这些测试资产。
- Host 仍然掌握权威边界：它只接受规范化候选，重新计算指纹、重新去重、重新校验大小与角色，不把“适配器说它干净”当作事实。

---

## 5. 数据模型与不变量

### 5.1 来源描述符

`import/sources` 返回的静态描述，不是目标状态：

```json
{
  "id": "chatgpt-export",
  "displayName": "ChatGPT 导出 JSON",
  "kinds": ["conversation"],
  "formatVersion": "synthetic-1",
  "compatibility": "synthetic-only",
  "requiresFile": true,
  "limits": {
    "bytes": 16777216,
    "items": 2000,
    "nodes": 20000,
    "messages": 10000,
    "textBytes": 1048576
  },
  "mapping": ["title"],
  "notes": ["仅支持结构化 JSON 数组；不支持分享网页或 ZIP"]
}
```

首批登记来源：

| sourceId | kind | 当前可实现性 | 说明 |
| --- | --- | --- | --- |
| `chatgpt-export` | `conversation` | 数据层已存在，未接线 | 仅结构化 JSON；真实导出格式未验 |
| `sacode-migrate` | `config` | 格式/预览已有，缺 apply/详细问题 | 仅 `config`；拒绝 `secret-bundle` |
| `text-file` | `knowledge` | 需新增文本批量导入 | Markdown/TXT；非第三方产品 schema |

其他产品（Claude、Gemini、Notion 等）没有 schema、样本和适配器，不登记为可用来源。

### 5.2 规范化候选

Host 只接受以下规范化结构；它不接收任意第三方原始 JSON（配置包除外，见 §7.3）。

会话候选：

```json
{
  "candidateId": "c0",
  "sourceKey": "conversation-id-from-export",
  "title": "来源标题",
  "messages": [
    {"role": "user", "text": "..."},
    {"role": "assistant", "text": "..."}
  ]
}
```

知识候选：

```json
{
  "candidateId": "d0",
  "sourceKey": "notes/a.md",
  "title": "来源标题或文件名",
  "content": "..."
}
```

配置载荷：

```json
{
  "kind": "config",
  "text": "<sacode-migrate/1 config 包原文>"
}
```

### 5.3 计划、作业与报告

| 对象 | 关键字段 | 说明 |
| --- | --- | --- |
| `ImportPlan` | `planHash`、`counts`、`items[]`、`issues[]`、`target` | 只读预览结果；不写目标 |
| `ImportPlanItem` | `itemId`、`index`、`displayTitle`、`action`、`dedupeKey`、`detail` | `action`：`new/duplicate/conflict/invalid/skipped` |
| `ImportJob` | `jobId`、`requestId`、`planHash`、`status`、`counts`、`ownerSessionId` | 持久化在作业日志 |
| `ImportReportItem` | `itemId`、`action`、`status`、`code`、`target`、`committedAt` | 不包含正文 |
| `ImportReport` | 摘要 + 分页 items + issues | 终态和运行中都可读 |

作业状态机：

```text
created → running → completed
                  ├→ partial
                  ├→ cancelled
                  └→ failed
created/running ──(Host 重启/EOF)──→ interrupted → running → ...
```

规则：

- `completed`：所有选中条目为 committed 或 duplicate/skipped，且没有 failed。
- `partial`：至少一条 committed，且至少一条 failed 或未执行；或配置跨存储只完成一部分。
- `cancelled`：用户取消；已提交保留；未执行不写。
- `failed`：没有任何 committed，且存在确定性失败。
- `interrupted`：进程结束/断连后由作业日志推导，不是持久化的“成功”。

### 5.4 幂等键与去重键

| 目标 | 去重键 | 幂等边界 |
| --- | --- | --- |
| 会话 | `(sourceId, sourceKey, fingerprint)`；`fingerprint` 由 Host 对 `sourceKey/title/role/text` 规范化后重算 SHA-256 | 同键已存在 → `duplicate`；同 `sourceKey` 不同指纹 → `conflict` |
| 知识 | `(scope, sourceId, sourceKey, fingerprint)`；`fingerprint` 由 Host 对正文重算 SHA-256 | 同键已存在 → `duplicate`；同 `sourceKey` 不同指纹 → `conflict` |
| 配置 | 稳定 ID：`provider:<id>`、`customModel:<id>` | 内容相同 → `unchanged`；不同且未允许更新 → `conflict`；允许更新 → `updated` |
| 请求 | `requestId` + `planHash` | 同请求同计划 → 返回已有作业；同请求不同计划 → `import-request-conflict` |

`itemId` 由 Host 生成并稳定：

```text
conversation: sha256("conversation\0" + sourceId + "\0" + sourceKey + "\0" + fingerprint)[0..24]
knowledge:    sha256("knowledge\0" + sourceId + "\0" + sourceKey + "\0" + fingerprint)[0..24]
config:       "provider:" + providerId 或 "customModel:" + customModelId
```

同一批内出现相同 `itemId` 视为重复/冲突，不静默合并。

---

## 6. Host `import/*` 方法族设计

### 6.1 方法面

| 方法 | 类型 | 作用 | 是否在 turn 中放行 |
| --- | --- | --- | --- |
| `import/sources` | 读 | 返回可用来源描述符与限额 | 是 |
| `import/preview` | 读 | 权威校验、指纹、去重、计划哈希 | 是 |
| `import/apply` | 写 | 校验计划并创建作业 | 否 |
| `import/poll` | 写 | 推进作业（泵）并返回进度 | 否 |
| `import/cancel` | 写（作业） | 标记取消；已提交保留 | 是（只写作业日志） |
| `import/resume` | 写 | 把 `interrupted` 作业恢复为 `running` | 否 |
| `import/report` | 读 | 返回逐项报告（分页） | 是 |
| `import/jobs` | 读 | 列出最近作业，用于重启恢复入口 | 是 |

不设计 `import/pick` Host 方法：文件选择与读取属于桌面主进程，Host 不接收任意文件路径。

### 6.2 分派与门禁

建议新增 `apps/host/src/import_rpc.cj`，提供：

```text
func importRequest(method: String, body: String, idText: String, activeId: String, shared: SessionLog): Bool
```

接入点：

1. 在 `main.cj` 新增 `handleRpc63(method, body, idText)`，放在现有 `handleRpc62` 之后调用（`main.cj:3656` 之后）。这样 `handleRpc11` 的 turn 门禁先执行，写方法天然被拦。
2. 读方法加入 `allowedDuringTurn`：`import/sources`、`import/preview`、`import/report`、`import/jobs`。
3. `import/cancel` 加入 `allowedDuringTurn`，与 `turn/cancel` 同类；它只改变作业状态，不写目标。
4. `turn/start` 增加互斥检查：当存在 `created/running` 的导入作业时返回 `import-in-flight`，避免 turn 与导入同时写。
5. `handleRpc6/7/8` 的故障门禁默认拦截 `import/*`；只读诊断方法是否放行需要实现时逐项决定。首版保持不放行，避免故障态继续导入。
6. `shared.isDurableFrozen()` 门禁默认拦截导入写方法；读方法是否放行沿用现有全局规则，首版不放行。

`initialize` 的 capabilities 增加上述 8 个方法；桌面 IPC 面同步增加对应通道。任何一侧缺失都不得宣称已接入。

### 6.3 方法契约

所有方法都要求 `params.sessionId == activeId`，否则返回 `import-session-changed`。这与会话隔离一致；作业绑定创建它的会话，切换会话后必须回到原会话才能继续写操作。

#### 6.3.1 `import/sources`

请求：

```json
{"sessionId": "session-..."}
```

响应：

```json
{"sources": [{"id": "chatgpt-export", "kinds": ["conversation"], "limits": {}}]}
```

说明：静态能力，不读取目标数据；用于前端决定哪些来源卡片可点。

#### 6.3.2 `import/preview`

请求（会话）：

```json
{
  "sessionId": "session-...",
  "sourceId": "chatgpt-export",
  "kind": "conversation",
  "mapping": {
    "titleMode": "keep",
    "displayTitle": "",
    "prefix": "",
    "workspaceMode": "none",
    "conflictPolicy": "skip"
  },
  "target": {"scope": "user"},
  "candidates": [
    {
      "candidateId": "c0",
      "sourceKey": "conv-1",
      "title": "示例会话",
      "messages": [
        {"role": "user", "text": "你好"},
        {"role": "assistant", "text": "你好，有什么可以帮你？"}
      ]
    }
  ]
}
```

请求（知识）：

```json
{
  "sessionId": "session-...",
  "sourceId": "text-file",
  "kind": "knowledge",
  "mapping": {"titleMode": "source", "titlePrefix": "", "conflictPolicy": "skip"},
  "target": {"scope": "project"},
  "candidates": [
    {"candidateId": "d0", "sourceKey": "notes/a.md", "title": "a", "content": "正文"}
  ]
}
```

请求（配置）：

```json
{
  "sessionId": "session-...",
  "sourceId": "sacode-migrate",
  "kind": "config",
  "mapping": {
    "updatePolicy": "new-only",
    "credentialBindings": {},
    "conflictPolicy": "skip"
  },
  "target": {"scope": "user"},
  "payload": {"kind": "config", "text": "<包原文>"}
}
```

响应：

```json
{
  "planHash": "<sha256 hex>",
  "sourceId": "chatgpt-export",
  "kind": "conversation",
  "counts": {"total": 2, "new": 1, "duplicate": 1, "conflict": 0, "invalid": 0, "skipped": 0},
  "items": [
    {
      "itemId": "i-...",
      "index": 0,
      "displayTitle": "示例会话",
      "action": "new",
      "dedupeKey": "<sha256 hex>",
      "detail": {"messages": 2, "skippedMessages": 0}
    }
  ],
  "issues": [],
  "target": {"scope": "user"},
  "requiresConfirmation": true
}
```

规则：

- Host 重新计算每个候选的指纹，不接受客户端指纹作为去重依据。
- 逐候选校验；非法候选进入 `issues` 并标 `invalid`，其余候选仍可预览。
- 配置包整体校验失败（format/schema/checksum/kind）时整包不可导入；条目级损坏进入 `issues`，其余条目可继续。
- 预览不写目标、不创建会话、不写知识快照、不改注册表。
- `displayTitle` 截断到 200 字符，只用于 UI/报告；不包含消息正文。
- `planHash` 覆盖 `sourceId/kind/target/mapping/candidates（含 Host 重算的指纹）`，用于 apply 时检测计划漂移。

#### 6.3.3 `import/apply`

请求：

```json
{
  "sessionId": "session-...",
  "requestId": "renderer-uuid",
  "planHash": "<preview 返回值>",
  "sourceId": "chatgpt-export",
  "kind": "conversation",
  "mapping": {"titleMode": "keep", "workspaceMode": "none", "conflictPolicy": "skip"},
  "target": {"scope": "user"},
  "candidates": ["与 preview 相同的候选"],
  "selection": {"itemIds": ["i-..."]}
}
```

响应：

```json
{
  "jobId": "job-...",
  "requestId": "renderer-uuid",
  "status": "created",
  "planHash": "<sha256 hex>",
  "counts": {"total": 1, "selected": 1}
}
```

规则：

- Host 重新执行一次预览，重新计算 `planHash`；与请求不一致返回 `import-plan-stale`，不写目标。
- 只允许选择计划中的 `new` 或 `conflict`（且用户选择 `new-copy`）条目；`duplicate`/`invalid`/`skipped` 不可选。
- 同一 `requestId` + 相同 `planHash` 返回已有作业，不重复创建；不同计划返回 `import-request-conflict`。
- 创建作业后立即返回；实际写入由 `import/poll` 推进。
- 作业创建时写入作业日志并 flush；这一步失败则不返回 jobId。
- `target.scope=project` 时只允许当前活动会话的 workspace；不接受调用方传入任意目录。

#### 6.3.4 `import/poll`

请求：

```json
{"sessionId": "session-...", "jobId": "job-..."}
```

响应：

```json
{
  "jobId": "job-...",
  "status": "running",
  "counts": {"total": 10, "committed": 3, "duplicate": 1, "failed": 0, "remaining": 6},
  "current": {"itemId": "i-...", "displayTitle": "示例会话"},
  "lastSeq": 42,
  "terminal": false
}
```

规则：

- 每次调用推进最多一个“不可分割条目”（一个会话、一批知识快照或一个配置条目）；在条目之间检查 50 ms 预算，不把一个条目拆成半截。
- 写目标前先检查作业状态与取消标记；取消后不再开始新条目。
- 作业终态时只返回状态，不再写。
- 该方法是写方法，turn 在途时被 `handleRpc11` 拦截。
- 前端断开/不再轮询时，作业不会在后台继续写；Host 退出后由重启恢复流程推导为 `interrupted`。

#### 6.3.5 `import/cancel`

请求：

```json
{"sessionId": "session-...", "jobId": "job-..."}
```

响应：

```json
{"jobId": "job-...", "status": "cancelled", "counts": {"committed": 3, "remaining": 7}}
```

规则：

- 只对 `created/running/interrupted` 生效；终态作业返回当前状态，不报错。
- 由于泵模型在两次 poll 之间没有在途写入，取消是确定性的；已提交条目保留。
- 不执行回滚；报告明确“已导入保留、未执行未写”。

#### 6.3.6 `import/resume`

请求：

```json
{"sessionId": "session-...", "jobId": "job-..."}
```

响应：

```json
{"jobId": "job-...", "status": "running", "counts": {"committed": 3, "remaining": 7}}
```

规则：

- 只允许 `interrupted`；不得自动恢复终态作业。
- 恢复前逐项核对目标 provenance：已提交的标记为 committed，不重复写；staging 中未提交的重新校验后提交；目标中找不到的重新执行。
- 若目标存储被其他进程修改导致无法确认，标记 `failed` 并如实报告，不猜测。

#### 6.3.7 `import/report`

请求：

```json
{"sessionId": "session-...", "jobId": "job-...", "offset": 0, "limit": 100}
```

响应：

```json
{
  "format": "sacode-import-report/1",
  "jobId": "job-...",
  "status": "partial",
  "counts": {"total": 10, "committed": 8, "duplicate": 1, "failed": 1},
  "items": [
    {
      "itemId": "i-...",
      "index": 0,
      "displayTitle": "示例会话",
      "action": "new",
      "status": "committed",
      "code": "",
      "target": {"kind": "session", "id": "sessions/session-..."}
    }
  ],
  "issues": [],
  "nextOffset": 100,
  "complete": true
}
```

规则：

- 报告不包含消息正文、凭据、完整 baseUrl 或来源文件内容。
- 运行中的作业也可读，返回当前快照并标 `complete:false`。
- 分页上限 200；超过部分用 `nextOffset` 续读。
- `displayTitle` 可能含敏感信息，属于本地报告，不写入诊断日志。

#### 6.3.8 `import/jobs`

请求：

```json
{"sessionId": "session-...", "limit": 20}
```

响应：

```json
{
  "jobs": [
    {
      "jobId": "job-...",
      "requestId": "...",
      "sourceId": "chatgpt-export",
      "kind": "conversation",
      "status": "interrupted",
      "counts": {"total": 10, "committed": 3},
      "createdAt": "2026-10-20T05:00:00Z",
      "updatedAt": "2026-10-20T05:01:00Z",
      "resumable": true
    }
  ]
}
```

规则：只返回当前用户数据根下的作业；按 `updatedAt` 倒序；不返回正文。

### 6.4 错误码

| 码 | 场景 | JSON-RPC code |
| --- | --- | --- |
| `import-bad-args` | 字段缺失、类型错误、未知字段 | -32003 |
| `import-unsupported-source` | 来源/类型组合未登记 | -32003 |
| `import-input-limit` | 字节/条目/消息/文档超过限额 | -32003 |
| `import-invalid-candidate` | 候选结构非法（有索引的逐项报告） | -32003 |
| `import-empty-conversation` | 会话无可导入文本 | -32003（item 级） |
| `import-role-rejected` | 非 user/assistant 角色 | -32003（item 级） |
| `import-secret-refused` | `secret-bundle`（F19 不接密钥载体） | -32003 |
| `import-builtin-rejected` | 配置包含 `declared` 供应商 | -32003（item 级） |
| `import-binding-provider-missing` | 绑定引用不存在的供应商 | -32003（item 级） |
| `import-plan-stale` | 预览后目标变化导致计划哈希不一致 | -32031 |
| `import-request-conflict` | 同 requestId 不同 planHash | -32031 |
| `import-revision-conflict` | 配置/知识写入 CAS 冲突 | -32031 |
| `import-job-busy` | 已有活动作业 | -32003 |
| `import-job-not-found` | jobId 不存在或不属于该数据根 | -32003 |
| `import-job-terminal` | 对终态作业执行 resume/poll 写操作 | -32003 |
| `import-session-changed` | sessionId 不是活动会话/作业属主 | -32003 |
| `import-cancelled` | 取消导致作业未完成 | -32003（报告状态） |
| `import-persistence-failed` | flush/原子改名/快照保存失败 | -32003 |
| `import-log-capacity` | 作业日志超过上限 | -32003 |
| `import-target-limit` | 会话/知识/配置目标容量不足 | -32003 |
| `import-corrupt-index` | 去重索引损坏且无法重建 | -32003 |

`errFrame` 只返回闭集码，不拼接来源内容或路径。逐项失败写入报告，不用整批 RPC 错误吞掉其他条目。

### 6.5 限额建议

| 范围 | 限额 | 依据 |
| --- | --- | --- |
| 单次来源字节 | 16 MiB | 现有 ChatGPT 适配器默认值 |
| 单次会话条目 | 预览可列 2000；单次 apply 选中 ≤500 | 控制单作业时长与报告大小；超出时 UI 分批建作业，去重会跳过已完成项 |
| 单次消息总数 | 10000 | 现有适配器上限 |
| 单条消息 | 1 MiB | 现有适配器上限 |
| 单次知识文档 | 200 条；单条 64 KiB；快照 2 MiB | `KnowledgeStore` 现有容量 |
| 单次配置条目 | 200 供应商 + 200 自定义模型 | 建议导入限额，控制单作业规模；`migration_pack` 本身未声明容量上限 |
| 配置包字节 | 2 MiB | 现有知识快照同级；避免阻塞主循环 |
| 作业日志 | 8 MiB | 防止报告膨胀；超限失败并保留已提交条目 |
| 报告分页 | 200 | UI 可读性 |

所有限额在 `import/sources` 中声明，并在 `import/preview` 阶段预检；超限不能等到 apply 才发现。

### 6.6 作业日志

位置：用户数据根 `imports/jobs/<jobId>.log`。使用与 `SessionLog` 相同的 TSV 转义与 flush 语义，但**不是会话日志**，不进入会话目录，不被 `SessionCatalog.list()` 扫描。

事件：

| 事件 | 数据 |
| --- | --- |
| `import/job-created` | `{jobId,requestId,ownerSessionId,sourceId,kind,planHash,target,createdAt}` |
| `import/plan` | `{counts,itemIds}`（不含正文） |
| `import/item-committed` | `{itemId,index,targetKind,targetId,at}` |
| `import/item-skipped` | `{itemId,index,code}` |
| `import/item-failed` | `{itemId,index,code,at}` |
| `import/job-cancelled` | `{at}` |
| `import/job-completed` | `{status,counts,at}` |
| `import/job-interrupted` | `{at,reason}`（可选；也可由缺失终态推导） |

规则：

- 每次状态变化 append + flush，租约用短持有（每次 poll 取/放），不跨 RPC 长持。
- 作业日志不写消息正文、知识正文、凭据或完整来源路径；`displayTitle` 最多 200 字符。
- 作业日志超过 8 MiB 时停止新条目，作业 `failed`，已提交条目保留。
- 终态作业不自动删除；`import/jobs` 默认只列最近 20 个，保留策略见待确认项。

### 6.7 重启与断连

- Host 启动时扫描 `imports/jobs/`，把有 `job-created` 但没有终态事件的作业推导为 `interrupted`；不自动推进。
- 桌面启动或打开导入面板时调用 `import/jobs`，显示“上次导入未完成”的入口。
- `import/resume` 逐项核对目标 provenance，再继续；没有 provenance 的目标重新执行。
- 桌面关闭/宿主 stdin EOF：Host 停止在两次 poll 之间；作业日志保留；不把 `created/running` 写成成功。
- 不提供“后台继续导入”；这是有意的安全边界。

### 6.8 并发与互斥

| 场景 | 行为 |
| --- | --- |
| 同一 Host 第二个 `import/apply` | `import-job-busy`；必须先完成/取消/恢复已有作业 |
| turn 在途时 apply/poll/resume | `turn-in-flight` |
| 导入 `created/running` 时 `turn/start` | `import-in-flight` |
| 两个 Host 进程同一数据根 | 作业日志与目标写入使用租约/CAS；第二个进程的 apply 在取租约失败时 `import-job-busy` |
| 预览并发 | 允许；不写目标 |
| 配置条目 CAS 冲突 | 停止该阶段，报告 partial；不覆盖其他窗口修改 |

### 6.9 授权与确认

- 预览不写目标；apply 必须由用户在选择面板显式点击确认。
- 渲染层传入的 `confirmed:true` 不是安全边界；真正的边界是：用户选择文件 + 预览结果可见 + 显式选择条目 + Host 重新校验计划。
- Electron main 维护短期 token 状态：`picked → previewed → applied`；未 preview 的 token 不能 apply。该状态是防误用，不是密码学授权。
- Host 不信任渲染层提供的“已存在/已导入”摘要；所有去重以 Host 计算为准。
- 导入不请求任何额外模型、网络、凭据或执行权限。

### 6.10 capabilities 与 IPC 面

需要同步修改的公共面：

| 面 | 变更 |
| --- | --- |
| `apps/host/src/main.cj` | 新增 `handleRpc63` 调用与定义；`initialize` capabilities 增加 8 个方法；`allowedDuringTurn` 增加读方法与 cancel；`turn/start` 增加导入互斥 |
| `apps/host/src/import_rpc.cj` | 新增方法分派与参数校验 |
| `apps/desktop/preload.cjs` | 新增 8 个 import 通道（具体命名见 §9.10） |
| `apps/desktop/main.cjs` / 新 `import-ipc.cjs` | 文件选择、读取上限、worker 调用、token 生命周期、Host bridge 转发 |
| `apps/desktop/test/bridge.test.mjs` | 通道存在性与参数校验；IPC 面计数门禁同步 |
| `apps/desktop/test/host-verbs.test.mjs` | 新方法加入真实 Host 驱动清单 |
| `packaging` | 确认 `import-adapters/*.cjs` 与 worker 进入安装包，且 worker 路径在 asar 内外可用 |

preload 顶层 key 是 IPC 唯一权威；新增通道时必须与实际注册一致，不得只在渲染层加名字。

---

## 7. 分类型落库设计

### 7.1 会话导入

#### 7.1.1 目标

每个来源会话创建为**一个独立会话**，不追加到当前会话，不改变当前会话的选中状态，不触发模型轮次。导入后的会话出现在会话目录中，可像普通会话一样打开；是否继续对话由用户决定。

#### 7.1.2 写入顺序

1. Host 校验候选：`sourceKey`、标题、消息角色、文本大小、指纹、空会话。
2. 生成 `itemId` 与去重键；查去重索引与目标 provenance。
3. 通过后在 `imports/staging/<jobId>/<itemId>/` 创建 `session.log`：
   - `session/title`（映射后的标题）
   - `import/source`（来源/指纹/作业标识）
   - 可选 `workspace/directory`（仅当映射为当前工作区）
   - 按顺序 `user/message` / `assistant/message`
4. 一次 `flush` 成功后，把 staging 目录原子改名为 `sessions/session-<token>-<attempt>`。
5. 追加去重索引记录；作业日志写 `import/item-committed`。
6. 任一步失败：不产生正式会话；staging 保留供 resume 重试，作业日志写 `item-failed`。

`import/source` 事件示例：

```json
{
  "format": "sacode-import/session/1",
  "sourceId": "chatgpt-export",
  "sourceKey": "conv-1",
  "fingerprint": "<sha256>",
  "jobId": "job-...",
  "itemId": "i-...",
  "title": "示例会话",
  "messageCount": 2,
  "skippedMessages": 0,
  "importedAt": "2026-10-20T05:00:00Z"
}
```

#### 7.1.3 事件约束

- 只写：`session/title`、`import/source`、可选 `workspace/directory`、`user/message`、`assistant/message`。
- 不写：`tool/result`、`tool/runtime/result`、审批、执行、goal、queue、system message。
- 不把来源中的 tool/system 角色映射成任何可执行事件；适配器跳过，Host 再拒绝。
- 消息正文按纯文本保存；不解析 HTML，不执行 Markdown 中的脚本，不建立附件引用。
- 消息顺序保持来源当前分支顺序；不重建分支树，不导入被跳过的隐藏消息。

#### 7.1.4 标题、工作区与会话目录

- 标题映射：`keep`（来源标题）、`custom`（用户输入）、`prefix`（前缀 + 来源标题）。
- Host 按 `SessionCatalog.create` 的标题规则（`catalog.cj:136-143`）拒绝控制字符、空标题和超长标题。
- 默认不绑定工作区；用户选择“绑定当前工作区”时才追加 `workspace/directory`，路径来自活动会话而非来源。
- `SessionCatalog.list()` 会回放每条会话日志并读取标题/工作区（`catalog.cj:39-49`）；建议扩展 `SessionCatalogEntry`，从 `import/source` 派生 `importedFrom/importedAt`，用于侧栏徽标和“非原生”提示。该字段是投影，不是第二真源。

#### 7.1.5 去重与冲突

| 情况 | 计划动作 | 应用行为 |
| --- | --- | --- |
| 同 `sourceId+sourceKey+fingerprint` 已导入且目标存在 | `duplicate` | 跳过 |
| 同 `sourceKey` 不同指纹，已有导入 | `conflict` | 默认跳过；`conflictPolicy=new-copy` 时作为新会话导入，`import/source` 增加 `conflictOf` |
| 批内同 `sourceKey` 不同指纹 | `conflict` | 默认只保留第一条；其余报告 |
| 目标会话被用户删除，索引仍有记录 | 视为 `new` | 允许重新导入；索引按目标存在性修正 |

不提供“更新已导入会话正文”的能力；来源变化只能作为新副本导入，符合单向追加。

#### 7.1.6 取消

- 会话条目是不可分割单元：staging 写完并 flush 后才改名；取消发生在条目之间，不会留下正式半截会话。
- 已改名的会话保留；未开始的条目不写；staging 由作业终态或过期清理处理。
- 报告 `cancelled` 与 `committed/remaining` 计数，不声称回滚。

#### 7.1.7 投影与模型上下文

- `import/source` 不是 surface 事件，`MessageProjection` 只处理五类 surface（`core/src/session.cj` 的 `isSurfaceEvent`），因此不会显示成消息。
- 导入的 user/assistant 消息按正常历史参与后续对话；这是产品预期，但需要在 UI 徽标/首次打开提示中说明“这是导入的历史记录，不是本机执行产生的”。
- 若产品决定导入会话默认“只读/不进入模型上下文”，需要另加会话级标记；本设计默认按普通历史处理，列入待确认项。

### 7.2 知识导入

#### 7.2.1 目标

把 Markdown/TXT 文本批量转成知识库文档，写入现有 `KnowledgeStore` 快照；不建立文件监听，不回写来源文件。

#### 7.2.2 批量快照

- Host 先读取当前知识快照与 revision，预检：
  - scope 合法（`user`/`project`；project 必须有活动工作区）；
  - 现有文档数 + 新增数 ≤ 200；
  - 单条 ≤ 64 KiB；快照序列化 ≤ 2 MiB；
  - 每条正文无 NUL、标题非空且 ≤ 600。
- 逐候选校验并标 `new/duplicate/conflict/invalid`。
- 选中条目在一个新快照中一次性写入；使用 `expectedRevision` CAS。
- 任一条目在写入前失败 → 整批不写（这是批级原子性），报告逐项原因；写入时 CAS 冲突 → 整批不写，报告 `import-revision-conflict`。
- 取消只发生在快照写入前；写入中的快照按一次原子替换完成，不能被中途取消。

#### 7.2.3 文档来源字段

现有文档字段：`id/title/content/revision/sourceKind/sourcePath/sourceDigest`。为满足去重与“来源可见”，建议新增可选 `origin`：

```json
{
  "id": "imp-<stable-id>",
  "title": "示例知识",
  "content": "...",
  "revision": 5,
  "sourceKind": "note",
  "sourcePath": "",
  "sourceDigest": "",
  "origin": {
    "format": "sacode-import/knowledge/1",
    "sourceId": "text-file",
    "sourceKey": "notes/a.md",
    "fingerprint": "<sha256>",
    "jobId": "job-...",
    "itemId": "i-...",
    "importedAt": "2026-10-20T05:00:00Z"
  }
}
```

要求：

- `KnowledgeStore.read()` 允许旧文档没有 `origin`；`save()` 必须保留已有 `origin`，不能因为重新保存而丢掉来源。
- 导入文档的 `sourceKind` 保持 `note`，避免把外部文本伪装成本项目当前文件；`sourceStatus` 仍为 `note`，UI 可另用 `origin` 显示“导入”。
- `id` 由 Host 生成：`imp-` + 去重键短哈希；同键重复 → `duplicate`。若用户已有同 id 文档且内容不同 → `conflict`，不覆盖。
- 不新增知识快照版本号；`origin` 是向后兼容的可选字段。若实现时发现 `read()` 的严格字段集不允许新增字段，则升级快照格式并保留旧读路径；这一判断在实现前用最小探针确认。

#### 7.2.4 去重与冲突

| 情况 | 动作 |
| --- | --- |
| 同 scope + sourceId + sourceKey + fingerprint | `duplicate` |
| 同 sourceKey 不同指纹 | `conflict`，默认跳过；可显式作为新文档导入 |
| 同内容不同 sourceKey | 允许新增（不同来源可以保存相同文本） |
| 目标容量不足 | 计划阶段 `invalid`，不进入 apply |

#### 7.2.5 知识引用

- 导入文档仍通过 `knowledge/reference` 显式引用；不在导入时自动注入任何会话或模型上下文。
- 不授予额外权限；引用只是文本快照。

### 7.3 配置导入

#### 7.3.1 接受范围

- 只接受 `kind=config` 的 `sacode-migrate/1` 包。
- `kind=secret-bundle` 整包拒绝，码 `import-secret-refused`；不提示口令、不尝试解包、不读取 `credentialRefs` 之外的任何字段。
- 包级 `format/schema/checksum/kind` 任一失败 → 整包 invalid，不进入 apply。
- `config` 包不含会话或知识；不能拿它冒充通用导入。

#### 7.3.2 详细解析与逐条问题

在 `migration_pack.cj` 增加“详细解析”能力，但不改变现有 `fromJson` 的调用方：

```text
MigrationParseResult {
    bundle: Option<MigrationBundle>,
    issues: Array<MigrationIssue>  // index/kind/id/code/field
}
```

- `MigrationIssue` 至少包含：条目类型（provider/customModel/binding/model）、数组索引、稳定 ID（若可读）、原因码、字段名。
- `fromJsonDetailed` 对缺失/类型错误/超限条目返回 issue，不静默丢弃；包级校验仍由 `validate()` 负责。
- 现有 `fromJson` 可继续作为 `fromJsonDetailed` 的薄包装，保持旧测试通过；新导入路径必须使用详细版。
- 补全比较函数：`migrationProviderEqual` 比较全部模型能力字段；`migrationCustomModelEqual` 比较 `requires`/`bindings` 的元素内容，不只数量。否则 `unchanged` 会掩盖真实变化。

#### 7.3.3 计划与应用

计划阶段：

- 供应商：`new/unchanged/updated/conflict/invalid`。
- 自定义模型：同上；绑定引用的供应商必须在“本机已有 + 本次将新增”的集合中，否则该绑定 `invalid`，并报告 `import-binding-provider-missing`。
- `declared=true` 的供应商（内置目录）不导入，`import-builtin-rejected`。
- 默认 `updatePolicy=new-only`：同 ID 不同内容 → `conflict`；`allow-updates` 才产生 `updated`。
- `credentialRef` 处理：
  - 默认清空；供应商 `enabled=false`，报告 `import-credential-required`。
  - 用户可在映射中为每个供应商选择本机已有凭据引用（只显示引用名/可用性，不显示值）；映射命中则保留该引用，并允许保留原 `enabled`。
  - 不读取、不解密、不写入任何凭据值。
- 不导入 `usage-ledger.log`、`route-health.log`、额度消耗或待核算记录（`migration_pack.cj:23-25` 已声明）。

应用阶段（单线程泵，逐条）：

1. 重新读取两个注册表的 revision。
2. 先应用供应商：每条 `ProviderRegistry.updateObject` + CAS；失败则停止配置阶段。
3. 再应用自定义模型：每条 `CustomModelRegistry.upsertObject` + CAS；失败则停止。
4. 每条提交后写作业日志；不尝试跨存储回滚。
5. 最终状态：
   - 全部成功 → `completed`
   - 部分成功 → `partial`，报告已提交与失败项
   - 首条即失败 → `failed`
   - 用户取消 → `cancelled`，已提交保留

跨注册表没有原子事务，这是设计承认的事实；报告不能说“全量成功/全量回滚”。重试时按稳定 ID 和内容比较跳过已提交项，因此部分成功后再次 apply 是幂等的。

#### 7.3.4 配置导入不做的事

- 不导入密钥值、不解密 secret 包、不把口令写入日志。
- 不导入声明为内置的供应商，不修改内置目录。
- 不导入健康/用量账本。
- 不在导入时自动切换默认模型、启用供应商或发起探测。
- 不覆盖用户在本机已改动的同 ID 配置，除非用户显式允许更新。

### 7.4 跨存储部分成功矩阵

| 失败点 | 已发生 | 报告 | 重试 |
| --- | --- | --- | --- |
| 供应商第 k 条 CAS 冲突 | 前 k-1 条已提交 | `partial` + `import-revision-conflict` | 重新预览；已提交条目 `unchanged` |
| 自定义模型第 k 条能力不匹配 | 供应商已提交，模型前 k-1 条已提交 | `partial` | 修正包后重试；不回滚供应商 |
| 作业日志 flush 失败 | 当前条目可能已提交 | `failed`/`interrupted`，报告“需重新核对” | resume 逐项核对目标 provenance |
| 快照 CAS 冲突 | 无知识写入 | `failed` + `import-revision-conflict` | 重新读取 revision 后重试 |
| 会话改名失败 | staging 完整、正式目录未出现 | `failed` | resume 重试改名 |
| 去重索引写失败但目标已提交 | 目标已提交 | `partial`，索引可重建 | 重建索引后再次预览显示 duplicate |

### 7.5 去重索引

建议新增 `core/src/import_index.cj`（名称实现时可调整），但明确其定位：

- 路径：用户数据根 `imports/index-<scopeKey>.log`；`scopeKey` 为 `user` 或 workspace 哈希，沿用 `KnowledgeStore` 的 scope key 口径。
- 事件：`import/index-entry`，字段 `sourceId/sourceKey/fingerprint/targetKind/targetId/jobId/itemId/at`。
- 读取：启动/预览时回放；索引条目命中后必须检查目标是否存在（会话目录、知识文档 id、配置稳定 ID）。
- 损坏：截断/解析失败时，标记索引不可用并从目标重建：
  - 会话：扫描 `sessions/*/session.log` 的 `import/source`；
  - 知识：读取当前快照的 `origin`；
  - 配置：读取两个注册表的稳定 ID 与内容；没有来源字段，只能做内容等价判断。
- 索引不是真源；索引与目标不一致时以目标为准，修正索引，不因索引损坏阻断导入。
- 索引本身超过 4 MiB 时压缩为快照事件（实现可选）；首版可以先只追加并在超限时重建。

这个索引解决“重复导入不重复追加”的性能问题；即使没有索引，也必须能通过扫描目标得到相同结论，验收时要覆盖“删索引后仍不重复”的用例。

---

## 8. 安全边界

### 8.1 单向追加，不自动同步

- 导入只读来源，不写来源目录，不建立文件监听，不保存来源文件句柄。
- 来源后续新增/修改/删除不触发任何本机变更；本机修改也不回写来源。
- 报告与 UI 明确写“导入是一次性快照，不是同步”。
- 不提供“重新同步”按钮；来源变化只能重新预览并作为新条目/新副本导入。

### 8.2 重复导入不重复追加

- 会话/知识按来源指纹去重；配置按稳定 ID + 内容比较去重。
- `requestId` 防止重复提交；`itemId` 防止崩溃后重复写。
- 已导入条目被用户删除后，目标存在性检查允许重新导入；这不是同步，是新的显式操作。
- 冲突不自动更新：同来源不同指纹默认跳过，用户显式选择新副本才创建。

### 8.3 损坏条目单独报告

- 适配器对每条来源会话输出 `issues`（索引 + 原因码），不中途吞掉。
- Host 对每个候选独立校验；坏条目进入计划 `invalid`，好条目继续。
- 配置详细解析产出条目级 issue；包级校验失败仍整包拒绝，因为 checksum/format 不可信。
- 报告分页展示逐项状态；不用“导入完成”掩盖部分失败。
- 任何“跳过”都有原因码；不静默丢弃。

### 8.4 不读入密钥

- `secret-bundle` 整包拒绝；不提供口令输入、不调用 `openSecretBundle`。
- `config` 包本身不含明文；详细解析只读白名单字段，非白名单字段不写入目标并进入 issue。是否“含密钥”不由正文内容猜测，`secret-bundle` 才是密钥载体，整包拒绝。
- 凭据引用只作为名称处理；用户映射必须选择本机已有引用，Host 只核引用存在性，不读取值。
- 报告、作业日志、诊断日志不记录凭据、口令、认证头、完整 baseUrl 查询串。
- 测试只使用合成占位值，不使用真实密钥。

### 8.5 不执行来源脚本

- 适配器只做 JSON/文本解析；不 `eval`、不 `new Function`、不动态 `import()`、不执行来源中的任何字符串。
- 不读取 ZIP、不抓取分享网页、不访问 URL、不解析 HTML 中的脚本。
- 固定 worker 文件与固定参数；渲染层不能指定 worker 路径、模块路径或脚本内容。
- Worker 设置堆/栈上限与超时；取消/超时终止该次线程，不返回部分结果。
- 打包态验证 worker 文件存在且可加载；缺文件时明确失败，不回退到主线程执行任意内容。

### 8.6 文件、路径与大小

- 文件由用户在系统文件对话框中选择；主进程先 `stat` 检查大小，再读取，读取后再核字节数，避免“小文件检查、大文件读取”竞态。
- 不接受渲染层传入的任意文件路径；token 是内存句柄，不是路径。
- 不接受来源中的路径作为目标路径；知识条目内容不落成文件，只进知识快照。
- 拒绝 NUL/二进制；文本按 UTF-8 读取，解码失败整文件报错。
- 大小/条数限额见 §6.5；超限在预览前拒绝。

### 8.7 不可信文本渲染

- 导入正文是不可信数据；渲染层必须以文本节点/转义方式展示，不能 `innerHTML` 拼接。
- 不复用会执行 HTML 的第三方渲染路径；Markdown 渲染器必须只输出安全节点，并禁止来源中的脚本、事件属性、外链自动加载。
- 标题、文件名、来源 id 同样转义。
- 报告不包含正文，减少二次泄露面。
- UI 提示“导入内容可能包含敏感信息；请自行确认展示与分享范围”。

### 8.8 授权与轮次互斥

- 导入是显式用户操作；不自动应用、不在后台重试、不在启动时自动恢复。
- 写导入与 turn 互斥；读预览可在 turn 中执行。
- 导入不获得工具审批权，不改变权限模式，不触发执行授权。
- 会话导入的内容不是本机执行证据；UI 标识来源，避免用户误以为工具真的运行过。

### 8.9 资源与拒绝服务

- 解析在固定 worker 中，带超时/取消；主进程不等无界解析。
- Host 侧严格字段数、数组长度、字符串长度、JSON 深度与总字节；未知字段拒绝或忽略并报告，不反射。
- 单作业条目上限与作业日志上限；超限失败并保留已提交条目。
- 配置包校验先做大小/结构预检，再做 checksum；避免对超大包反复计算。
- 预览/报告分页，不把 2000 条候选一次性渲染进 DOM。

### 8.10 日志、报告与隐私

- 作业日志只存 id、状态、原因码、目标 id、截断标题；不存正文、凭据、完整路径。
- 报告是本地文件/响应，不自动上传、不写入崩溃日志、不进遥测。
- 诊断日志只记录作业 id 与错误码；排查需要正文时由用户显式提供文件，不自动采集。
- 导出/分享报告时提醒标题可能含敏感信息。

### 8.11 威胁与控制对照

| 威胁 | 控制 |
| --- | --- |
| 恶意 JSON 触发代码执行 | 纯解析、无 eval/动态 import、固定 worker |
| 超大文件/压缩炸弹 | 不接 ZIP；字节上限；先 stat 后读；worker 超时 |
| 路径遍历/任意读 | 不接收路径参数；文件对话框；token 句柄；目标路径由 Host 决定 |
| HTML/脚本注入 | 渲染转义；Markdown 安全节点；CSP 继续 `script-src 'self'` |
| 伪造成已导入绕过去重 | Host 重算指纹与 planHash；目标 provenance 为准 |
| 凭据泄露 | 拒绝 secret 包；不读值；报告/日志脱敏；测试用占位值 |
| 跨会话越权 | `sessionId` 必须等于活动会话；作业绑定属主会话 |
| 导入与 turn 交叉写 | 双向互斥；写方法在 turn 门禁之后 |
| 索引损坏导致重复/丢数据 | 索引可重建；目标存在性校验；不把索引当真源 |
| 部分成功后误报全量 | 状态 `partial`；逐项报告；不回滚不虚报 |

---

## 9. 前端设计

### 9.1 入口

推荐两个入口，共用同一个“导入”设置页：

1. **头像快捷菜单**：在 `AccountMenu` 增加“导入数据…”菜单项，点击后关闭菜单并发出 `settings('import')`。
   - 现有 `AccountMenu` 的 `settings(id)` 已经是“关闭菜单 + `emit('settings', id)`”（`account-menu.ts:13`）；只需增加一个按钮，不需要新事件类型。
   - `app.js:1023` 的 `onSettings` 已把 id 写入 `settingsTab` 并打开设置弹窗，因此无需改 app.js 的入口逻辑。
2. **设置入口**：设置弹窗增加“导入”标签，位于“对话与输入”和“内置插件”之间或“隐私与数据”之前；由设置导航直接进入。

不推荐把导入做成独立管理页：F19 明确允许设置入口；设置弹窗已有对话框、焦点管理和 tab 键盘导航，复用成本最低。若后续导入需要更大工作区，再评估管理页。

### 9.2 页面状态机

```text
idle
  → source-selected（选择来源）
  → picking（系统文件对话框）
  → local-preview（主进程解析，展示候选/问题）
  → host-preview（Host 权威计划）
  → confirmed（用户选择条目、确认映射）
  → applying（创建作业）
  → polling（进度）
  → done（completed/partial/cancelled/failed）
  → resume-available（重启后发现 interrupted）
```

每个状态都要有：

- 明确的“返回/取消”动作；
- 失败时的原因码到中文文案映射；
- 不丢失已选映射（预览失败/计划过期时保留用户输入）；
- `aria-live` 进度播报；
- 禁止在 `applying/polling` 时重复点击。

### 9.3 来源选择

来源卡片显示：

- 名称、支持的数据类型、格式版本、兼容性声明（合成/自有/未验证）。
- 限额摘要。
- “仅支持…”的明确说明。
- 未实现来源不显示为可点；如需展示，标“未接入”，点击只解释原因。

首批：

| 卡片 | 类型 | 状态文案 |
| --- | --- | --- |
| ChatGPT 导出 JSON | 会话 | “仅支持结构化 JSON 数组；真实导出格式尚未验收” |
| SaCode 迁移包 | 配置 | “仅 config；secret-bundle 拒绝” |
| Markdown/TXT 知识文件 | 知识 | “文本文件，不解析 HTML/脚本” |

### 9.4 文件选择与本地预览

- 点击“选择文件”调用主进程对话框；过滤器按来源限定扩展名。
- 主进程读取并解析，返回：
  - `token`（短期、不可猜测、绑定窗口/会话）；
  - 本地预览摘要：候选数、重复数、冲突数、问题列表、每个候选的截断标题/消息数/正文摘要（≤200 字符）。
- 渲染层不接收完整正文/完整 16 MiB 文本。
- 本地预览只用于 UX；随后调用 Host `import/preview` 得到权威计划。
- 本地预览失败（非法 JSON、超限、取消、超时）显示原因；不进入 Host 预览。
- 取消/关闭面板调用 `importDiscard(token)` 释放主进程内存。

### 9.5 预览、映射与选择

预览页布局建议：

```text
┌──────────────────────────────────────────────┐
│ 来源：ChatGPT 导出 JSON      类型：会话       │
│ 计划：新增 7 · 重复 2 · 冲突 1 · 无效 1       │
├──────────────────────────────────────────────┤
│ 字段映射                                      │
│  标题： [保留来源标题 ▼] [自定义输入____]     │
│  工作区：[不绑定 ▼]（当前工作区：…）           │
│  冲突： [跳过 ▼]（作为新副本导入）             │
├──────────────────────────────────────────────┤
│ ☑ 会话 A   12 条消息   新增                  │
│ ☐ 会话 B   3 条消息    重复（已导入）         │
│ ☐ 会话 C   8 条消息    冲突（来源已变化）      │
│ ☐ 会话 D   —           无效（空会话）         │
├──────────────────────────────────────────────┤
│ [取消]                         [确认导入 7 条]│
└──────────────────────────────────────────────┘
```

规则：

- `duplicate`/`invalid`/`skipped` 默认不勾选且不可勾选；
- `conflict` 默认不勾选；只有切换“作为新副本导入”后才可选；
- 全选只选 `new`；
- 显示“将新增 N 条；重复/冲突/无效不会写入”；
- 映射变化会使 Host 计划哈希变化；必须重新预览后才能确认；
- 预览不写目标，关闭不产生副作用。

知识页额外显示：

- 作用域：用户知识 / 当前项目知识（无工作区时项目项禁用并解释）；
- 标题映射：来源标题 / 文件名 / 自定义前缀；
- 容量提示：当前文档数 + 新增数 / 200；快照大小接近 2 MiB 时警告。

配置页额外显示：

- 包类型（只接受 config）、供应商数、自定义模型数；
- 更新策略：仅新增（默认）/ 允许更新同 ID 配置；
- 凭据绑定表：供应商 id → 本机已有凭据引用（下拉只显示引用名与可用状态，不显示值）；未绑定则显示“导入后需配置凭据并启用”；
- 内置供应商标记“跳过”，绑定缺失标记“无效”。

### 9.6 应用、进度与报告

- 确认后调用 `import/apply`；显示“正在创建导入作业…”。
- 进入轮询（建议 300–500 ms 间隔，指数退避到 2 s；页面隐藏时暂停轮询并提示）。
- 进度显示：已提交/总数、当前条目标题（截断）、重复/冲突/失败计数。
- 取消按钮始终可用（终态除外）；点击后调用 `import/cancel`，等待下一个安全点并显示“已取消；已完成 N 条保留”。
- 终态：
  - `completed`：绿色摘要 + “查看报告”。
  - `partial`：黄色摘要 + 失败/未执行列表 + “重试失败项”（重新预览后 apply，已提交条目会变 duplicate/unchanged）。
  - `cancelled`：中性摘要 + 已提交保留说明 + “继续剩余项”（新作业，去重跳过已完成）。
  - `failed`：红色摘要 + 原因码 + 可恢复项。
- 报告页：逐项表格（标题、状态、原因、目标链接）；不显示正文；支持复制摘要；目标链接只对会话/知识有效，配置链接到模型中心对应 id。

### 9.7 重启恢复

- 打开导入面板时调用 `import/jobs`；若有 `interrupted`：
  - 顶部横幅：“上次导入未完成（已提交 N，剩余 M）”。
  - 操作：“查看报告”“继续导入”“放弃并新建”。
- “继续”调用 `import/resume`，再进入轮询；不自动继续。
- 若目标已变化导致无法确认，报告明确列出，不自动覆盖。
- 放弃只结束作业显示，不删除已提交目标；作业日志保留供审计。

### 9.8 文案与错误映射

错误码到文案必须具体，不显示原始 JSON-RPC 错误：

| 错误码 | 文案建议 |
| --- | --- |
| `import-input-limit` | “文件或条目超过限额；请拆分后再导入。” |
| `import-invalid-candidate` | “第 N 条内容不完整，已跳过；其余条目仍可导入。” |
| `import-secret-refused` | “该包含有密钥/凭据，已拒绝导入。请改用不含密钥的配置包。” |
| `import-plan-stale` | “导入计划已变化（目标被修改）；已重新读取，请再次确认。” |
| `import-revision-conflict` | “目标配置已被其他窗口修改；本次未写入，请重新预览。” |
| `import-job-busy` | “已有导入作业在进行；请先完成或取消。” |
| `import-session-changed` | “会话已切换；请回到发起导入的会话继续。” |
| `import-persistence-failed` | “写入未完成；已提交条目保留，请查看报告后重试。” |
| `turn-in-flight` | “当前有任务在运行；请等待本轮结束后再导入。” |
| `import-in-flight` | “导入正在进行；请完成或取消后再开始新任务。” |

### 9.9 构建接线

| 文件 | 变更 |
| --- | --- |
| `apps/desktop/renderer/pages/import-panel.ts` | 新增导入面板组件，编译为 `SaCodeImport` IIFE |
| `scripts/pack-pages.mjs` | 白名单加入 `['import-panel','SaCodeImport']` |
| `apps/desktop/renderer/index.html` | 增加 `<script src="vendor/import-panel.iife.js"></script>`，放在 `general-settings.iife.js` 之后、`settings-state.js` 之前 |
| `apps/desktop/renderer/settings-state.js` | 设置 tabs 增加 `['import','导入']`；渲染 `settings-page-import`；引用 `window.SaCodeImport.Page`；未加载时显示“导入组件未加载” |
| `apps/desktop/renderer/pages/account-menu.ts` | 增加“导入数据…”按钮，调用现有 `settings('import')` |
| `apps/desktop/renderer/app.js` | 无需新增 tab 逻辑；如需传 workspace/session，设置渲染已能访问 `self`；确认打开设置时刷新作业列表 |
| `apps/desktop/preload.cjs` | 新增 import 通道（见 §9.10） |
| `apps/desktop/main.cjs` / 新 `import-ipc.cjs` | 文件对话框、读取上限、适配器/worker、token 生命周期、Host 转发 |
| `apps/desktop/test/bridge.test.mjs` | 新通道参数校验与错误分支 |
| `apps/desktop/test/host-verbs.test.mjs` | 新 Host 方法真实驱动清单 |

注意：`settings-state.js` 是经典脚本，不能使用 ES module；`import-panel.ts` 由 esbuild 在构建期编译为 IIFE，运行时仍只用全局 `Vue`，符合 CSP。

### 9.10 桌面 IPC 适配面

建议新增（命名实现时可微调，但 preload/main/host 必须一致）：

| 通道 | 作用 |
| --- | --- |
| `importSources()` | 主进程转发 Host `import/sources` |
| `importPickFile(sourceId)` | 打开对话框、读取、适配器解析，返回 token + 本地预览 |
| `importPreview(token, mapping, target)` | 主进程把 token 内候选发给 Host，返回权威计划 |
| `importApply(token, planHash, requestId, selection, mapping, target)` | 创建导入作业 |
| `importPoll(jobId)` | 推进并读取进度 |
| `importCancel(jobId)` | 取消 |
| `importResume(jobId)` | 恢复中断作业 |
| `importReport(jobId, offset, limit)` | 读取报告 |
| `importJobs(limit)` | 列出最近作业 |
| `importDiscard(token)` | 释放主进程内存 |

约束：

- 所有通道逐字段校验；token 必须是主进程签发的不可猜测字符串，不能是路径。
- 主进程只允许固定适配器；`sourceId` 不在白名单直接拒绝。
- 渲染层不能指定 Host 方法名或任意参数透传。
- 新增通道后更新 IPC 面计数门禁，不靠旧读数。

---

## 10. 实现落点（仅规划，不在本批修改）

| 层 | 文件/模块 | 工作 |
| --- | --- | --- |
| core | `src/import_job.cj`（新） | 作业日志、状态机、报告、恢复 |
| core | `src/import_index.cj`（新） | 可重建去重索引 |
| core | `src/import_service.cj`（新） | 会话/知识/配置编排、逐项执行、安全点 |
| core | `src/migration_pack.cj` | 详细解析 issues；补全比较字段；不加入 apply |
| core | `src/knowledge_store.cj` | 批量导入 + `origin` 保留；容量/CAS |
| core | `src/catalog.cj` | 导入会话 staging/commit；目录条目 import 投影（可选） |
| core | `src/session.cj` / projection | 确认 `import/source` 非 surface；必要时只加读取器 |
| host | `src/import_rpc.cj`（新） | `import/*` 参数校验、分派、错误码 |
| host | `src/main.cj` | `handleRpc63`、capabilities、allowedDuringTurn、turn/start 互斥 |
| desktop | `import-adapters/` | 复用；补每项 issue、文本文件适配器；配置包由主进程读取文本、Host 解析 |
| desktop | `main.cjs` / `import-ipc.cjs` | 文件选择、token、worker、Host 转发 |
| desktop | `preload.cjs` | 新增 IPC 通道 |
| desktop | `renderer/pages/import-panel.ts` | 导入面板 |
| desktop | `settings-state.js` / `account-menu.ts` / `index.html` | 入口与构建接线 |
| scripts | `pack-pages.mjs` | 新页面白名单 |
| docs | PRD-tracking / evidence | 实现批次完成后按证据更新；设计阶段不更新完成状态 |

实现顺序建议（不是范围削减）：

1. core 数据契约与作业日志 + 单元测试；
2. 会话导入 staging/commit + 去重索引；
3. 知识批量快照 + origin；
4. 配置详细解析 + apply 编排；
5. Host `import/*` + turn 互斥 + 恢复；
6. Electron main/preload + 面板；
7. 真实入口/打包态/取消/重启验收。

---

## 11. 测试与验收设计

### 11.1 单元与适配器

- ChatGPT 适配器：分支、隐藏消息、断链、环、非文本、空会话、重复/冲突、限额、取消、超时、指纹一致性。
- 文本知识适配器：UTF-8、NUL、超限、标题、正文、多个文件的逐项问题。
- 配置详细解析：缺字段、类型错误、未知 kind、checksum 错误、损坏条目、比较字段全量。
- 作业状态机：created/running/completed/partial/cancelled/failed/interrupted 转换。
- 去重索引：重复、冲突、目标删除后重导、索引损坏重建。

### 11.2 Host RPC

- `import/sources` 只返回已登记来源。
- `import/preview` 不写目标；重复预览稳定；坏条目逐项 issue；计划哈希覆盖映射变化。
- `import/apply` 计划过期/请求冲突/选择非法/会话切换/作业忙/密钥包拒绝。
- `import/poll` 每次推进一个条目；终态不再写；turn 中被拦。
- `import/cancel` 在条目间生效；已提交保留；报告计数正确。
- `import/resume` 只恢复 interrupted；逐项核对 provenance；不重复写。
- `import/report` 分页、无正文、目标 id 正确。
- `import/jobs` 重启后推导 interrupted。
- capabilities 与真实分派一致；未知方法仍返回原有错误。

### 11.3 集成与安全负向

- 合成 Host + 临时数据根：会话/知识/配置全链路；关闭重开恢复。
- 重复 apply 同 requestId 不重复创建；崩溃注入（flush 后、改名后、索引前）后 resume 不重复。
- 恶意输入：超大 JSON、深层嵌套、NUL、路径字符串、HTML/脚本、伪造指纹、伪造 `credentialRefs`、secret 包、ZIP、分享网页 URL。
- 确认不执行来源脚本：适配器内无 `eval`/`Function`/动态 import；worker 不联网；测试用 monkey-patch 或静态扫描。
- 确认不读密钥：测试环境放置合成凭据引用，导入后目标/日志/报告无值。
- UI 转义：标题/正文含 `<img onerror>`、`<script>` 时不执行，只显示文本。
- IPC 面：新增通道在 preload/main 一致；非法参数被拒绝；旧通道回归。
- 打包态：worker 文件、适配器、脚本清单、CSP；安装包内路径可加载。

### 11.4 与 F19 验收对应

| F19 验收（PRD `:508`） | 设计验收 |
| --- | --- |
| 来源可读 → 预览并导入 → 新增内容与报告 | 合成 ChatGPT/知识/配置三来源；Host 报告逐项；目标真实出现 |
| 来源损坏/含密钥 → 单项报告并保护来源 | 坏条目 issue + 其他条目继续；secret 包整包拒绝；来源文件哈希不变 |
| 重复导入/取消 → 不重复追加，不建立同步 | 二次 apply duplicate；取消后 committed 保留、remaining 未写；修改来源不自动影响目标 |

### 11.5 证据要求

- 单测通过只算局部证据；必须有真实 Host、真实 Electron 面板、打包态三项运行证据。
- 取消/重启/部分成功必须在真实入口验证，不用模拟摘要代替。
- 真实来源格式兼容必须由用户授权样本验证；没有样本时登记“未验证”，不能写“兼容 ChatGPT”。
- 安装态验收未完成前，F19 状态只能写“实现完成待验”或“部分实现”，不能写“已完成”。

---

## 12. 待确认项

1. **第三方解析归属**：是否确认按 AD-1 留在桌面主进程/worker？若要求 Host 独立解析 ChatGPT 文件，需要另立解析器与测试，不在本设计内。
2. **导入会话是否进入模型上下文**：默认按普通历史参与后续对话；若产品要求“导入历史默认只读、不自动进入上下文”，需要增加会话级标记与 UI 开关。
3. **导入会话工作区**：默认不绑定；是否允许“绑定当前工作区”作为默认？
4. **配置更新策略**：默认仅新增；是否允许用户对单条配置选择更新？当前设计支持全局 `allow-updates`，不细化到单条。
5. **凭据引用映射**：默认清空并禁用供应商；是否接受“映射到本机已有引用”的交互？这需要确认引用列表可展示（不显示值）且不构成密钥读取。
6. **配置导入后的启用**：是否需要导入后自动探测/启用？本设计明确不自动，避免无凭据供应商进入模型选择。
7. **知识 `origin` 字段**：是否接受在现有快照文档中增加可选字段；若读面严格拒绝未知字段，需要升级快照格式并保留旧读路径。
8. **去重索引**：是否接受新增 `imports/index-*.log` 作为可重建索引？若不允许新增索引文件，则每次预览扫描目标，需接受性能成本。
9. **作业保留**：`imports/jobs` 保留最近多少个/多少天？首版建议保留全部终态作业直至用户清理，或最近 100 个。
10. **IPC 面归属**：新增 10 个通道涉及 `preload.cjs`/`main.cjs` 公共面，需要与公共面负责人协调；本设计只给契约。
11. **真实来源样本**：ChatGPT 真实导出格式尚无授权样本；其他产品没有 schema。是否先只交付“合成契约 + 明确未验证”，还是等样本后再实现来源？
12. **配置包详细解析**：是否接受修改 `migration_pack.cj` 的解析返回结构（保持旧 `fromJson` 兼容）？还是新建独立详细解析器以免触碰现有测试？
13. **导入与 turn 互斥**：是否接受导入作业期间禁止 `turn/start`？若不允许，需要改为“仅禁止导入写当前会话/配置”，并重新设计竞态。
14. **报告中的标题**：是否允许报告保存截断标题（可能含敏感信息）？若不允许，报告只显示 itemId 与原因码。

---

## 13. 风险与不宣称事项

- 本设计没有写任何产品代码，不能据此宣称 F19 已实现。
- `import-adapters` 的真实格式兼容未验证；ChatGPT 导出可能随产品变化，不能把合成夹具当真实兼容。
- 其他产品来源没有 schema/样本，当前不实现；不要用“通用导入”暗示已支持。
- Host 主循环是单线程；泵模型避免了后台线程竞态，但单条目过大仍可能造成短暂阻塞。限额与分页是必要缓解，不是性能保证。
- 跨 ProviderRegistry/CustomModelRegistry 没有原子事务；部分成功是设计事实，报告必须如实。
- 知识快照是单文件全量替换；大批量导入会带来一次较大的写放大，容量上限必须先预检。
- 去重索引是新增的派生存储；如果实现不当会成为第二真源。必须坚持“目标 provenance 为准、索引可重建”。
- 新增 IPC 通道会改变公共面计数；未同步 preload/main/bridge 测试前，不得在 UI 宣称可用。
- 现有 `docs/evidence/model-center-b5-migration-2026-10-05.md` 的 apply 表述与源码不符；实现阶段应登记更正，不能沿用旧结论。

---

## 附录 A：请求/响应示例

### A.1 会话预览

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "import/preview",
  "params": {
    "sessionId": "session-abc",
    "sourceId": "chatgpt-export",
    "kind": "conversation",
    "mapping": {"titleMode": "keep", "workspaceMode": "none", "conflictPolicy": "skip"},
    "target": {"scope": "user"},
    "candidates": [
      {
        "candidateId": "c0",
        "sourceKey": "conv-1",
        "title": "示例会话",
        "messages": [
          {"role": "user", "text": "你好"},
          {"role": "assistant", "text": "你好。"}
        ]
      }
    ]
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "planHash": "…",
    "sourceId": "chatgpt-export",
    "kind": "conversation",
    "counts": {"total": 1, "new": 1, "duplicate": 0, "conflict": 0, "invalid": 0, "skipped": 0},
    "items": [
      {"itemId": "i-…", "index": 0, "displayTitle": "示例会话", "action": "new", "detail": {"messages": 2}}
    ],
    "issues": [],
    "target": {"scope": "user"},
    "requiresConfirmation": true
  }
}
```

### A.2 应用与轮询

```json
{"jsonrpc": "2.0", "id": 22, "method": "import/apply", "params": {
  "sessionId": "session-abc",
  "requestId": "0f4f1c7e-…",
  "planHash": "…",
  "sourceId": "chatgpt-export",
  "kind": "conversation",
  "mapping": {"titleMode": "keep", "workspaceMode": "none", "conflictPolicy": "skip"},
  "target": {"scope": "user"},
  "candidates": ["…"],
  "selection": {"itemIds": ["i-…"]}
}}
```

```json
{"jsonrpc": "2.0", "id": 23, "method": "import/poll", "params": {
  "sessionId": "session-abc", "jobId": "job-…"
}}
```

### A.3 报告

```json
{
  "format": "sacode-import-report/1",
  "jobId": "job-…",
  "status": "partial",
  "counts": {"total": 3, "committed": 2, "duplicate": 0, "failed": 1},
  "items": [
    {"itemId": "i-1", "index": 0, "displayTitle": "A", "status": "committed", "target": {"kind": "session", "id": "sessions/session-…"}},
    {"itemId": "i-2", "index": 1, "displayTitle": "B", "status": "committed", "target": {"kind": "session", "id": "sessions/session-…"}},
    {"itemId": "i-3", "index": 2, "displayTitle": "C", "status": "failed", "code": "import-persistence-failed"}
  ],
  "issues": [],
  "nextOffset": null,
  "complete": true
}
```

---

## 附录 B：错误码与 HTTP 无关

本设计复用 Host 现有 JSON-RPC 错误帧（`errFrame`），不新增传输层：

| JSON-RPC code | 语义 | 典型码 |
| --- | --- | --- |
| `-32001` | turn 在途/资源忙 | `turn-in-flight`、`import-in-flight`、`import-job-busy` |
| `-32002` | 启动/选择回放失败 | 现有启动故障码 |
| `-32003` | 参数/状态/目标拒绝 | `import-bad-args`、`import-secret-refused`、`import-input-limit`、`import-persistence-failed` |
| `-32031` | 修订/计划冲突 | `import-plan-stale`、`import-request-conflict`、`import-revision-conflict` |

逐项失败不抛整批 RPC 错误；它们进入计划/报告的 `issues` 与 `items`。

---

## 附录 C：来源能力登记（设计时）

| 来源 | 数据类型 | 当前代码 | 真实样本 | 本设计处理 |
| --- | --- | --- | --- | --- |
| ChatGPT 结构化 JSON | 会话 | `apps/desktop/import-adapters/chatgpt.cjs` | 无（合成夹具） | 复用适配器；Host 权威校验；登记未验证 |
| ChatGPT 分享网页 | 会话 | 无 | 无 | 不支持；不抓取网页 |
| ChatGPT ZIP | 会话 | 无 | 无 | 不支持；不解压 |
| SaCode `sacode-migrate/1` config | 配置 | `core/src/migration_pack.cj` | 仓内格式 | 详细解析 + apply 编排；拒绝 secret-bundle |
| SaCode `sacode-migrate/1` secret-bundle | 配置+密钥 | `core/src/secret_bundle.cj` | 仓内格式 | F19 拒绝；不读口令/密钥 |
| Markdown/TXT | 知识 | `KnowledgeStore` 单文件导入 | 用户文件 | 新增批量文本导入；不解析 HTML/脚本 |
| 其他产品 | 任意 | 无 | 无 | 不实现；不宣称兼容 |

---

## 附录 D：设计决策速查

| 问题 | 结论 |
| --- | --- |
| migration_pack 能否直接支撑 F19？ | 不能。仅配置、无 apply、坏条目静默、比较不全 |
| Host 是否新增 `import/*`？ | 是，8 个方法；`handleRpc63`；capabilities 同步 |
| 第三方格式在哪解析？ | 桌面主进程/固定 worker；Host 只接收规范候选 |
| 会话导入落到哪？ | 新会话；staging + 原子改名；不追加当前会话 |
| 知识导入如何写？ | 单次快照 + `origin`；整批 CAS；逐项预检 |
| 配置导入如何写？ | 只 config；详细解析 + 逐条 CAS；跨存储部分成功如实报告 |
| 密钥怎么办？ | 拒绝 secret-bundle；不读值；凭据只做引用映射 |
| 去重靠什么？ | 目标 provenance 为准；可重建索引加速；planHash/requestId/itemId 幂等 |
| 取消/重启？ | 泵模型安全点；作业日志；手动 resume；不自动继续 |
| 前端入口？ | 头像菜单“导入数据…” + 设置“导入”标签，共用面板 |
| F19 是否完成？ | 否。本文是设计，未写产品代码，未验收 |
