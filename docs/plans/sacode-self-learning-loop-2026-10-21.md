# SaCode 自学习闭环总方案（蓝图）

- 日期：2026-10-21
- 状态：设计提案，未实现、未验收。
- 定位：串联[调度者 Agent](sacode-orchestrator-agent-2026-10-21.md)、[记忆与每日进化](sacode-memory-daily-evolution-2026-10-21.md)、[技能接入](skill-integration-design-2026-10-20.md)三个子方案，补"错题本 + skill 自动生成 + 会话内保存"三个跨方案接口。本方案是**总蓝图**，各子方案按本方案调整各自接口。
- 本轮授权：保存方案，不修改业务代码、不提交或发布。
- 决策落定（2026-10-21 用户确认）：
  - A 会话内 `knowledge_save` 模型工具，走审批（build 档 ask）
  - B "学错" = test 失败 / build 编译错误 / 语法检查失败，**自动**进错题本，按技术语言分类
  - C 错题本→skill 生成草稿，用户审阅后才启用；skill 变更版本化、可回滚（不让步）
  - D2 skill 启用开关由用户决定，跨会话持久
  - E skill 一键发布登记"待研究"，发布前密钥擦除 + 用户确认
  - F 自动化生成文章列为后续阶段（依赖 F13 executor）
  - 补充1 错题本按技术语言分类（java/cangjie/rust/ts/...）
  - 补充2 内置"create-skill"元技能（指导 agent 如何写 skill）

## 0. 闭环全景

```
┌─────────────────────────────────────────────────────────────────┐
│  会话                                                            │
│                                                                  │
│  用户"保存到知识库" ─► knowledge_save 工具 ─审批─► 知识库文档    │
│                                                                  │
│  agent 跑 test/build/syntax ─失败─► 自动捕获错误 ─► 错题本       │
│                                       （按语言分类 java/...）    │
│                                                                  │
│  轮末提取记忆 draft                                              │
│   ├─ confirmed → 注入模型                                        │
│   └─ 用户标记"学错" → 补充通道 → 错题本                          │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    错题本（按语言聚合 open 错误）
                                  │
                          生成 skill 草稿（用户审阅）
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
          新 skill 草稿                  已有 skill 变更草稿（diff）
                  │                               │
                  └──── 用户审阅启用 ─────────────┘
                                  │
                          skill 启用（用户决定，跨会话持久）
                                  │
                          注入模型（避免再犯同语言错误）—— 闭环
                                  │
                          一键发布（待研究，密钥擦除 + 确认）

  自动化（F13，后续阶段）→ 选知识库内容 → 生成文章
```

闭环核心：**失败事件自动捕获 → 错题本 → skill 草稿 → 用户审阅 → 启用 → 注入模型 → 避免再犯**。

## 1. 错题本（ErrorBook）

### 1.1 定位与存储

- 独立 `ErrorBookStore`（复用 KnowledgeStore 的存储/作用域/CAS/持久屏障/原子发布框架），**不混进知识库文档库**
- 理由：写入触发、字段、生命周期与文档库不同（文档库是用户主动写，错题本是失败事件自动写）
- 作用域：`project`（按工作区 SHA-256 隔离）+ `user`（跨项目同类语言错误，可选）
- 会话日志为唯一真源（沿用 KnowledgeStore 口径）

### 1.2 字段

```
ErrorEntry {
  id, revision,
  language,           // java/cangjie/rust/ts/py/...（按文件扩展名或工具判定）
  errorKind,           // syntax / build / test / lint
  errorMessage,        // 归一化错误首行
  normalizedHash,      // language + errorKind + 归一化 errorMessage 的哈希，用于去重
  codeContext,         // 文件:行 + 周边几行（脱敏，不含密钥）
  firstSeen, lastSeen, occurrences,
  fixApplied,          // 如有：后来修复时记录的修复动作摘要
  status,              // open / resolved / ignored
  sourceCallId         // 触发该错误的工具调用 ID（可追溯）
}
```

### 1.3 自动捕获触发（B 决策落定）

捕获点接现有执行链，**不新造执行器**：

| 触发源 | 判定 | 现有实现 |
|---|---|---|
| F09 build/test | 退出非零 + stderr 含编译/语法错误模式 | BuildTestPage 报告判定含退出事实（已有） |
| F02 bash/pwsh/run_code 工具 | 退出非零 + 输出含 `error:`/`Error:`/`syntax error`/`failed to compile` 等模式 | ShellExecutor 结算（已有） |
| F08 review-apply | 编辑写回后用户跑测试失败 | execution/review-*（已有） |
| LSP diagnostics | `lsp_diagnostics` 返回 error 级诊断 | F21 LSP（已有） |

- 捕获在 execution/test/diagnostics **结算后**的钩子执行，不在工具调用中途（不阻塞主流程）
- 错误提取：归一化 errorMessage（去路径绝对值、去行号具体值、保留模式）→ 算 `normalizedHash` → 同 hash 增 `occurrences`/`lastSeen`，不重复建条目
- **语言判定**：按触发文件扩展名（`.cj`→cangjie、`.java`→java、`.rs`→rust、`.ts`→ts...）；工具调用无文件则按工具（`cjpm`→cangjie、`mvn`/`gradle`→java、`cargo`→rust）
- **密钥擦除**：codeContext 与 errorMessage 写入前 scrub `KEY|PASSWORD|SECRET|TOKEN|SACODE_*` 模式，命中 fail-closed 不写该条

### 1.4 用户操作

- 错题本页：按语言分组展示，每条显示错误模式 + 出现次数 + 最近时间 + 状态
- 用户可：编辑/删除/标记 resolved（标记后该 hash 不再注入 skill 生成）/标记 ignored（不生成 skill 但保留记录）
- 自动捕获只写不删；resolved 需用户显式标记（agent 修复后**不自动**标 resolved——可能引入新错）

### 1.5 注入与不注入

- 错题本 `open` 条目**不直接注入 model context**（和记忆 draft 同铁律：失败记录本身不是指令）
- 错题本只作为 **skill 生成的素材**——见 §2

## 2. 错题本 → skill 生成（C 决策落定）

### 2.1 生成触发

- 用户在错题本页点"生成 skill 草稿"（按语言或选条目）
- 或 agent 在 create-skill 元技能辅助下主动提议（仍需用户确认才生成草稿）
- 不自动生成（自动生成 = agent 自己写规则，C 决策不让步）

### 2.2 生成产物：skill 草稿

- 按 language 聚合 open 条目，生成 skill 草稿：
  - `name`: `avoid-${language}-errors`（如 `avoid-cangjie-errors`）或用户起名
  - `description`: "避免 ${language} 常见错误（test/build/syntax）"
  - `whenToUse`: "写/改 ${language} 代码时"
  - `content`: 从错题本条目提炼的"避免这些错误"指令文本（含错误模式 + 修复指引）
- 草稿落 `skill/draft` 事件，进 skill 草稿区，**不启用**

### 2.3 已有 skill 的变更草稿

- 同名 skill 已存在 → 生成**变更草稿**（diff 形式，新增/修改的指令段落）
- 落 `skill/update-proposed` 事件，用户审阅 diff
- 用户合并 → 落 `skill/updated`，skill revision +1，保留旧修订历史
- 拒绝 → 草稿归档，skill 不变

### 2.4 版本化与回滚

- skill 文件带 `revision`（整数递增）
- 每次合并变更落 `skill/updated` 事件（含旧 revision + 新 revision + diff）
- 用户可回滚到任意历史 revision（落 `skill/rolled-back` 事件）
- 草稿与历史修订均持久（会话日志唯一真源）

## 3. 内置 create-skill 元技能（补充2）

- 随包 `assets/skills/create-skill/SKILL.md`，bundled provider 提供
- frontmatter: `name: create-skill`、`description: 指导创建与更新技能`、`whenToUse: 想从错题本/知识库生成或更新 skill 时`、`user-invocable: true`、`model-invocable: true`
- content 指导 agent：
  1. 分析错题本（按语言聚合 open 条目）或知识库文档
  2. 提取可复用模式（错误模式 + 修复指引 / 知识点）
  3. 写符合 frontmatter 子集（name/description/whenToUse/disable-model-invocation/user-invocable）的 SKILL.md
  4. 提交草稿供用户审阅，**不自动启用**
  5. 已有同名 skill → 生成变更 diff，不整篇覆写
- 这个 skill 自身是"模型读的指令"，让模型会写 skill；它本身不调用任何写工具，下游写 skill 草稿仍走 `skill/save-draft` RPC + 审批

## 4. 会话内 knowledge_save 工具（A 决策落定）

### 4.1 模型工具

- 新增 `core/src/tool_knowledge.cj`，定义模型工具 `knowledge_save`：
  - 参数：`{ scope: "user"|"project", title: string, content: string, sourceKind?: "note"|"session-extract", sourcePath? }`
  - `execute` 调 `KnowledgeStore.save(...)`，返回修订与文档 id
- 注册进 `ToolRegistry`（`model_tool_runtime.cj`），工具目录含此工具

### 4.2 审批

- 走 `approval/ask` 工单（与 write/edit 同语义）
- `plan` 档 deny（只读）、`build` 档 ask、`auto`/`yolo` 按档位
- 审批载荷标注 `intent: "knowledge-save"` + scope + title + content 摘要

### 4.3 用户语义

- 用户在会话说"保存这个到知识库" / "记一下这个" → agent 提取会话片段 → 调 `knowledge_save` → 审批 → 落库
- 不需要切到管理页；管理页仍可手动建/编辑

## 5. skill 启用与本地/线上（D2 + E 决策落定）

### 5.1 启用开关（D2）

- skill 管理页每条 skill 有"启用"开关
- 启用状态持久化（`skill-enabled.txt` 或同等机制，跨会话）
- **启用的 skill**：其目录摘要（name+description+whenToUse）默认进 model context（pre-step 注入，对齐 skill-integration-design §3.3）
- **未启用的 skill**：不在目录摘要里，用户仍可 `/name` 手势引用（按 skill 方案 §3.3 slash 解析）
- 不是"所有 skill 都注入"——避免 context 爆炸（D2 决策）

### 5.2 本地/线上来源标记

- skill 定义增 `source` 字段：`local`（本地文件）/ `online`（线上下载）/ `bundled`（内置）
- 线上下载 skill = skill marketplace（E，待研究）
- 本地 skill 优先级高于线上（同 name 时本地胜出，对齐 skill 方案 §3.2 优先级表）

### 5.3 一键发布（E，待研究）

- skill 管理页"发布"按钮（本地 skill）
- 发布前：**密钥擦除**（scrub `KEY|PASSWORD|SECRET|TOKEN`）+ 用户确认内容
- 平台接口/key/审核流程：登记为"待研究"，不阻塞本方案
- 本地侧只保证：发布包不含密钥、不含运行中工单、不含会话内容

## 6. 各子方案的接口调整

本总方案落定后，三个子方案需相应调整（不在本轮改子方案文件，实施前统一更新）：

### 6.1 记忆方案（sacode-memory-daily-evolution-2026-10-21.md）

- §1 三态：rejected 增"标记为学错"选项 → 进错题本（补充通道，主通道是 §1.3 自动捕获）
- §2 分类：增"学错"类别，但主学错源是 ErrorBook 不是记忆；记忆的 rejected 只是补充
- §4.1 轮末提取：增 test/build 失败事件捕获（不依赖记忆提取）

### 6.2 skill 方案（skill-integration-design-2026-10-20.md）

- §3.1 SkillDefinition 增 `source: local|online|bundled`、`enabled: bool`、`revision: Int64`
- §3.2 优先级表：增 online 层（介于用户与内置之间）
- §3.3 注入契约：**启用的 skill** 目录摘要进 context，未启用只 `/name` 可引
- 新增 §3.8 skill 草稿与版本化：`skill/draft`/`skill/update-proposed`/`skill/updated`/`skill/rolled-back` 事件
- 新增 §3.9 一键发布：密钥擦除 + 用户确认，平台接口待研究
- 内置 skill 清单增 `create-skill` 元技能

### 6.3 调度者方案（sacode-orchestrator-agent-2026-10-21.md）

- §4.1 员工定义字段组增 `enabledSkills: string[]`（该员工启用的 skill）
- reviewer 角色默认启用 `create-skill`（审查时若发现可复用模式可提议生成 skill）
- 不破坏调度者模型——skill 注入仍是 pre-step，不进委派原语

## 7. 错题本的 Host RPC 面

新增 `errorbook/*` 命名空间（写入 `host-capabilities.json` 与 `main.cj` 分派）：

| RPC | 作用 |
|---|---|
| `errorbook/list` | 列错题（按 language/status/errorKind 筛选） |
| `errorbook/get` | 取单条详情 |
| `errorbook/update` | 编辑/标记 resolved/ignored/删除（带 CAS） |
| `errorbook/generate-skill-draft` | 按语言聚合 open 条目，生成 skill 草稿（落 `skill/draft`） |

约束：`errorbook/generate-skill-draft` 只生成草稿，不启用 skill（C 决策）；自动捕获是 Host 内部钩子，不暴露 RPC 给前端触发。

## 8. 安全与失败处理

- **密钥擦除**贯穿：错题本写入、skill 草稿生成、skill 发布前，都 scrub `KEY|PASSWORD|SECRET|TOKEN|SACODE_*`，命中 fail-closed
- **错题本不直接注入**：open 条目是 skill 素材，不是 model context（同记忆 draft 铁律）
- **skill 草稿不自动启用**：C 决策不让步；自动生成草稿可以，启用必须用户审阅
- **skill 变更版本化**：revision 递增、diff 可审、可回滚
- **错题本去重**：normalizedHash 防同一错误重复建条目
- **resolved 不自动**：agent 修复后不自动标 resolved（可能引入新错）；resolved 需用户显式标记
- **自动捕获不删**：失败事件是审计事实，用户可删/ignored，agent 不自动删
- **语言分类**：按文件扩展名/工具判定，无文件无工具的归 `unknown`，不臆测
- **create-skill 元技能不扩权**：它只生成草稿文本，下游写 skill 草稿仍走 RPC + 审批
- **发布前擦除**：本地侧保证不发密钥；平台审核是平台责任

## 9. 与现有需求域的关系

| 域 | 关系 |
|---|---|
| F02 AI 执行与工具 | 新增 `knowledge_save` 模型工具；test/build 失败捕获接现有执行链结算钩子 |
| F08 代码与 Git | review-apply 后测试失败是错题本来源之一 |
| F09 终端与验证 | build/test 报告判定是错题本主来源 |
| F11 知识库 | knowledge_save 工具 + 错题本（独立 store）；F11"记忆/速记/批注"由记忆方案闭合 |
| F12 扩展管理 | skill 本地/线上/启用/发布；create-skill 元技能 |
| F13 自动化 | 自动生成文章列为后续阶段（F13 executor 未实现 D07） |
| F21 LSP | lsp_diagnostics 是错题本来源之一 |

## 10. 实施顺序与验收

依赖顺序：冻结错题本/skill 草稿/版本化语义 → ErrorBookStore + 自动捕获钩子 → Host `errorbook/*` RPC → skill 草稿与版本化 → create-skill 元技能 → knowledge_save 工具 → skill 启用开关 → 错题本页 + skill 管理页 → 一键发布（待研究）→ 打包态验收。依赖顺序不是范围裁剪。

| 验收面 | 必须结果 |
|---|---|
| 错题本自动捕获 | test/build/syntax 失败真实进错题本；按语言分类；同 hash 去重；密钥命中 fail-closed |
| 错题本不注入 | open 条目**不**进 model context（反证：故意留 open 错误，模型请求不含它） |
| skill 草稿生成 | 按语言聚合 open → 生成草稿；草稿**不自动启用** |
| skill 变更版本化 | 同名 skill 变更生成 diff 草稿；合并后 revision+1；可回滚到历史 revision |
| create-skill 元技能 | 指导生成符合 frontmatter 子集的草稿；不自动启用；不扩权 |
| knowledge_save 工具 | 会话内调用 → 审批 → 落库；plan 档 deny；build 档 ask |
| skill 启用开关 | 启用状态跨会话持久；启用的目录摘要进 context；未启用只 `/name` 可引 |
| 错题本页 | 按语言分组展示；编辑/标记 resolved/ignored/删除带 CAS |
| 发布前擦除 | 发布包不含密钥（反证：故意在 skill 写 API key，发布前擦除命中 fail-closed） |
| 交付 | 新构建的桌面与 CLI 真实验证，不用单测或静态 UI 代替 |

关键反证：故意让 open 错题本注入 model context、让 skill 草稿自动启用、让变更不增 revision、让自动捕获跳过密钥擦除、让 resolved 被 agent 自动标记、让未启用 skill 的目录摘要进 context，指定测试必须转红。

## 11. 本轮结论

自学习闭环方向可行，"失败事件自动捕获 → 错题本（按语言分类）→ skill 草稿 → 用户审阅 → 启用 → 注入"是相对市面更进一步的差异化设计。C 决策（草稿审阅不让步）与"错题本不直接注入"是安全底线。本轮仅保存总蓝图，不修改业务代码、不提交或发布；各子方案实施前按 §6 统一调整接口。skill 一键发布平台接口待研究，自动化生成文章列为后续阶段。
