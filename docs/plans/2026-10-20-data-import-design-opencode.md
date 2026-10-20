# F19 数据导入实现设计（2026-10-20）

> 纯设计，非代码。不碰 core/Host 源码。覆盖 core 能力盘点、Host `import/*` 分派、安全边界、前端面板、与现有通路复用、依赖与待确认项。

## 0. 目标

从其他产品导入内容（会话/知识/配置等）到 SaCode。单向追加，不自动同步；重复导入不重复追加；损坏条目单独报告；不读密钥、不执行来源脚本。

## 1. 当前能力盘点

### 1.1 `core/src/migration_pack.cj`（39KB）

| 维度 | 已有能力 |
|---|---|
| 包格式 | `sacode-migrate/1`，schema v1；两类：`config`（供应商+自定义模型+绑定，**不含密钥**）、`secret-bundle`（上述+credentialRefs 引用，**值单独加密**，不含明文） |
| 数据类型 | **仅 provider/customModel/binding** 三类（MigrationProviderEntry/MigrationCustomModelEntry/MigrationBindingEntry，字段全：baseUrl/protocol/transport/models/price micros/budget/probe 等） |
| 解析 | 每类 `fromJson(JsonObject): Option<T>`，缺必填返 None；JSON 经 `stdx.encoding.json`；SHA-256 摘要校验 entriesJson |
| 去重 | `computeMigrationPlan(bundle, currentProviders, currentCustomModels, existingCredentialRefs): MigrationPlan`——按**稳定 ID**（不按名称）对齐，输出 `new`/`updated`/`unchanged`；幂等（unchanged 不重复创建） |
| 凭据覆盖 | secret-bundle 含 credentialRefs 时，与本机 existingCredentialRefs 比对，命中则 `needsCredentialConfirmation=true`；导入配置永不静默换密钥 |
| 构建 | `buildConfigBundle`/`buildSecretBundle`（只建信封，credentialRefs 列名不含值） |
| 拒绝码 | 闭集：`migration-bad-format`/`-bad-schema`/`-bad-checksum`/`-bad-kind`/`-malformed`/`-credential-confirm-required` |
| **明确不在** | usage-ledger.log、route-health.log、待核算记录、已用额度（§8.4，服务搬迁走独立备份恢复） |

**缺口**：migration_pack 只覆盖 provider/customModel/binding 配置面；**不覆盖**会话、知识、技能、MCP 配置、数据库连接、通用设置。F19"从其他产品导入内容（会话/知识/配置等）"需要更广。

### 1.2 Host 既有 import 通路（`docs/plans/host-capabilities.json`）

| RPC | 作用 | 覆盖 |
|---|---|---|
| `custom/import/new` | 从外部导入自定义模型到新条目 | customModel 配置 |
| `custom/import/into` | 导入到已有条目（合并） | customModel 配置 |
| `knowledge/import` | 导入知识条目 | knowledge |

**无通用 `import/*` 命名空间**；会话导入无通路。

### 1.3 可复用资产
- `migration_pack.cj`：config 包解析/去重/报告/校验逻辑（稳定 ID 对齐、幂等、凭据覆盖检测）。
- `knowledge_store.cj`：知识存储与 `knowledge/import`。
- `custom_model_registry.cj`：customModel 注册与 `custom/import/*`。
- `SessionLog`：会话日志追加（`session/append`/`session/flush`）。
- `ToolRegistry` needsApproval fail-closed 口径。
- 凭据机制：`credentialRef` 引用（不内联值），与 model/registry/save-credential 同款。

## 2. core 层设计

### 2.1 不重写 migration_pack，按数据类型分适配器

migration_pack 已稳定处理 provider/customModel/binding；F19 在其上新增**导入适配器层**（`core/src/import_adapter.cj`，新模块），按来源×数据类型分派：

```
interface ImportSource {
  kind(): String                      // "config-bundle" | "knowledge" | "session" | "skills"
  detect(header: String): Bool        // 嗅探头部判定是否本源能解析
  parse(content: String, token: TurnToken): ParseResult
}
interface ImportAdapter {
  plan(parsed: ParsedSource, current: CurrentSnapshot): ImportPlan   // 复用 migration_pack 的稳定 ID 去重
  apply(plan: ImportPlan, decisions: ApplyDecisions, token: TurnToken): ImportReport
}
```

- `config-bundle` 适配器：直接委托 `migration_pack.parseMigrationBundle` + `computeMigrationPlan` + 落盘（复用，不重写）。
- `knowledge` 适配器：委托 `knowledge_store` 的导入路径（`knowledge/import` 既有），按知识条目稳定 ID（hash）去重。
- `session` 适配器（新）：解析外部会话格式（SaCode session.log JSONL 或他产品导出 JSON），按 `(sessionId, seq)` 或时间戳去重，`session/append` 追加到本机会话目录——**单向追加，不修改既有事件**。
- `skills` 适配器（新，与技能模块协调）：导入 SKILL.md 到用户技能目录（`~/.sacode/skills`），按 `name` 去重（同名标 `unchanged`/`updated`，不重复创建）。

### 2.2 解析/去重/报告

- **解析 fail-soft**：逐条解析，坏条目（缺必填/类型不符/JSON 损坏）收集到 `ParseResult.corrupt: Array<{index, reason}>`，**不抛、不中止整批**；好条目继续。
- **去重**：复用 migration_pack 的**稳定 ID 对齐**（provider/customModel/binding 按 ID；knowledge 按 hash；session 按 (id,seq)；skill 按 name）。输出 `ImportPlan{entries: [{kind,id,action:new|updated|unchanged|conflict}]}`。**重复导入 → unchanged，不重复追加**。
- **报告**：`ImportReport{applied, skipped, corrupted, credentialConflicts, warnings}`；损坏条目单独列出（index+reason），不混入成功计数。
- **取消**：`TurnToken` 传入 parse/apply；apply 按条目批次检查 `token.cancelled()`，取消后已落盘的批次保留（追加语义，不回滚已追加），未处理批次标 `cancelled`。

### 2.3 不读密钥/不执行脚本

- config-bundle 解析**只取 credentialRef 名**，不解析任何凭据值字段；secret-bundle 的值段由独立口令加密，导入时**不自动解密**——需用户显式输入口令 + 确认覆盖（`migration-credential-confirm-required`）。
- 来源若含可执行脚本（如他产品导出含 `.sh`/`.js` 执行指令字段），适配器**忽略不执行**；导入面板标注"来源含可执行内容，已跳过"。
- 归属字段（provenance）不信任、不落盘（migration_pack §2.4 已有不变量）。

## 3. Host 层 `import/*` 分派设计

新增 `import/*` 命名空间（写入 `host-capabilities.json` 与 Host 分派——本设计只列方法）：

| RPC | 作用 | 审批？ |
|---|---|---|
| `import/sources` | 列可用导入源（config-bundle/knowledge/session/skills）及探测结果 | 否 |
| `import/parse` | 解析来源内容（文件路径或粘贴文本），返回 ParseResult（好条目预览+损坏列表） | 否（只读解析） |
| `import/plan` | 对 parsed 计算 ImportPlan（new/updated/unchanged/conflict） | 否（只读比对） |
| `import/preview` | 返回 plan 的可读预览（字段映射+影响对象+冲突） | 否 |
| `import/apply` | 按用户 decisions 执行导入（追加/覆盖/跳过），返回 ImportReport | **是**（写入副作用，走 approval） |
| `import/cancel` | 取消进行中的 apply | 否 |

约束：
- `import/apply` 收 `approvalId`（与 `toolCall`/`database/write` 一致）；未授权不落盘。
- `import/apply` 的 decisions 区分：`new`→追加，`updated`→覆盖（需显式 decision，默认 skip），`unchanged`→跳过，`conflict`→需用户逐条决策（不自动合并）。
- 凭据覆盖：若 plan 含 `credentialConflicts`，apply 前必须用户确认（`migration-credential-confirm-required`），否则拒。

## 4. 安全边界

1. **单向追加，不自动同步**：导入只把来源内容追加到本机；不回写来源、不建立双向同步、不自动覆盖本机既有（updated 需显式 decision）。
2. **重复导入不重复追加**：稳定 ID 对齐 + unchanged 标记；幂等，重复导入同一包不产生重复条目。
3. **损坏条目单独报告**：`ParseResult.corrupt` 与 `ImportReport.corrupted` 分列，不混入成功；坏条目不中止整批，好条目继续。
4. **不读密钥**：config 包不含密钥值；secret-bundle 值段不自动解密，需口令+确认；credentialRef 只引用名。
5. **不执行来源脚本**：适配器忽略可执行字段；来源脚本不跑。
6. **归属不信任**：provenance 字段不落盘（既有不变量）。
7. **导入走与在线编辑相同的校验与拒绝分诊**（migration_pack §不变量）：导入的 provider/customModel 经 `custom_model_registry` 同款校验，不绕过。
8. **写入需审批**：`import/apply` 走 `approval/ask` 工单（与文件写/数据库写同语义）；只读 parse/plan/preview 不审批。
9. **大来源限制**：parse 阶段上限（条目数/字节数），超限截断 + 标 `truncated`，不一次性载入。
10. **取消真实反馈**：`import/cancel` 后 apply 标 `cancelled`；已追加批次保留（追加语义不回滚），未处理批次不执行。

## 5. 前端导入面板设计

### 5.1 入口
- **头像快捷菜单**（`account-menu.ts` 现有）新增"导入数据…"项；或**设置入口**（`general-settings.ts`）新增"数据导入"标签。二选一或并存，待 UI 决策（待确认项）。
- 不在 composer/工作台主区放入口（导入是低频操作，不占主操作面）。

### 5.2 面板流程（`renderer/pages/import-panel.ts`，新建）
1. **选来源**：文件选择器（本机文件）或粘贴文本；面板调 `import/sources` + 嗅探 `import/parse`。
2. **预览**：`import/preview` 返回好条目列表（kind/id/action 标记 new/updated/unchanged/conflict）+ 损坏条目列表（index+reason）。损坏条目灰显单独区，可导出错误清单。
3. **字段映射**（仅跨产品来源需要）：若来源字段名与 SaCode 不同，面板提供映射表（来源字段→SaCode 字段）；同源（sacode-migrate 包）无需映射。
4. **决策**：用户逐条或批量决定（追加新/覆盖更新/跳过/取消冲突）；updated 默认 skip，需主动选"覆盖"。
5. **凭据确认**：若 plan 含 credentialConflicts，弹确认（输入 secret-bundle 口令 + 覆盖确认）。
6. **执行**：`import/apply{decisions, approvalId}`；面板显示进度（条目计数）+ 最终 `ImportReport`（applied/skipped/corrupted/warnings）。
7. **取消**：进行中可 `import/cancel`。

### 5.3 IPC（`apps/desktop/preload.cjs`，门禁扩充）
新增 `sacode.importSources`/`importParse`/`importPlan`/`importPreview`/`importApply`/`importCancel`。同步 `test/bridge.test.mjs` 与 `check_ipc_surface_parity.cjs`。

## 6. 与现有通路的复用

| 通路 | 复用方式 |
|---|---|
| `custom/import/new`+`into` | config-bundle 适配器**直接委托**（provider/customModel 落盘走 custom_model_registry 既有校验与注册），不另写落盘 |
| `knowledge/import` | knowledge 适配器委托，按知识 hash 去重 |
| `migration_pack.computeMigrationPlan` | 所有适配器的去重/plan 逻辑复用其"稳定 ID 对齐 + new/updated/unchanged"模式；新增 session/skill 适配器按各自稳定 ID（(id,seq)/name）套同模式 |
| 凭据机制（credentialRef） | config/secret-bundle 复用；不内联值、不写日志、覆盖需确认 |
| `approval/ask` 工单 | `import/apply` 走工单，与文件写/数据库写/Git 推送同语义 |
| `TurnToken` 取消 | parse/apply 复用（mcp_client.cj 范式） |
| `SessionLog` append | session 适配器按 `session/append` 追加，不修改既有事件 |

## 7. 依赖与待确认项

1. **跨产品来源格式**：他产品（如 DSH/Claude Code/Cursor）的会话/知识/配置导出格式各异；首版优先支持 **sacode-migrate 包**（同源导入）+ **SaCode session.log JSONL**；跨产品格式适配器按需逐个加（每个来源一个 ImportSource 实现），不在首版承诺通用。
2. **会话导入的稳定 ID**：SaCode 会话按 sessionId；跨产品会话无稳定 ID 时用（来源标识+时间戳）哈希作 ID，需确认去重粒度（整会话 vs 单事件）。
3. **知识导入去重**：确认 `knowledge/import` 既有去重粒度（hash？标题？）是否满足"重复导入不重复追加"；若不满足需补。
4. **技能导入与技能模块协调**：导入 SKILL.md 到 `~/.sacode/skills` 须与技能 FilesystemSkillProvider 的目录约定一致（§技能方案）；按 `name` 去重，严格子集校验（frontmatter 5 键）。
5. **secret-bundle 口令**：确认 secret_bundle.cj 的加密/解密机制（是否已有 `sealSecretBundle`/`openSecretBundle`）；导入需用户输口令。
6. **大来源上限**：parse 阶段 maxEntries/maxBytes 定值（建议 50000 条 / 16MB）。
7. **字段映射 UI 复杂度**：跨产品映射首版是否做，还是首版只同源+手动改包。
8. **导入面板入口**：头像菜单 vs 设置标签 vs 两者——待 UI 决策。
9. **与 Trae 计划批准关口**：`import/apply` 的 approval 持久化须满足 Trae 关口（批准持久化未成功不执行）。
10. **损坏条目导出**：是否提供"导出损坏清单"为文件（CSV/JSON），方便用户修包。
11. **MCP 配置/数据库连接导入**：是否在 F19 范围（F16 数据库连接、MCP 配置是否算"配置"导入）——待确认；首版建议不含，单独按 F16/MCP 方案处理。

## 8. 不在范围

- 不写产品代码（core/Host/桌面）。
- 不提交推送。
- 不实现 UI、不建夹具、不跑真实导入。
- usage-ledger/route-health/已用额度导入不在范围（migration_pack §8.4 明确排除，走独立备份恢复）。
- DBA 运维数据导入不在范围。

## 9. 取证索引

- `core/src/migration_pack.cj:1-974`（包格式/解析/去重/构建/拒绝码；§8.4 不含项）。
- `docs/plans/host-capabilities.json:32-36,76`（`custom/import/*`、`knowledge/import` 既有）。
- `core/src/knowledge_store.cj`、`core/src/custom_model_registry.cj`（既有导入落盘）。
- `docs/product/PRD.md` F19（导入面板需求）。
