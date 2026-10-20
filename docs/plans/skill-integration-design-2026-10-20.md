# SaCode 技能（Skill）清单接入方案设计（2026-10-20）

> 纯调研 + 设计。DSH 源码只读（`target/tmp/dsh-extract-20261019/dsh/node_modules/@deepseek-ai/`）+ SaCode 源码只读。本文件不改产品代码、不碰在途文件、不构成实施授权。

## 0. 背景与问题

用户反馈："当前客户端尚未接入可引用的技能清单"。核实属实：`apps/desktop/renderer/pages/composer-menu.ts:21` 注释明说"技能清单：宿主 `extension/list` 的真实注册表"，`enter('skills')` 调 `loadTools()`→`props.listTools()`→IPC `extension/list`，即**把普通工具列表当技能展示**。这不是真正的技能。

要搞清楚 DSH 怎么区分"工具"和"技能"，再给 SaCode 的接入路径。

---

## 1. DSH 机制摘要（逐条回答 6 个调研问题）

证据来自 `dsh-tool-skill`、`dsh-skill`、`dsh-skill-badge`、`dsh-skill-filesystem`、`dsh-skill-office`、`dsh-client-ui-skill`、`dsh-agent-preset`、`dsh-agent-preset-registry`、`dsh-agent-instructions`、`dsh-system-prompt`、`dsh-persona`。行号均指各包 `lib/index.js`（或 `lib/client.js`）。

### 1.1 技能 vs 工具：技能是"指令文本"，不是"工具+提示词+约束"的打包

DSH 的"技能"（skill）= **一份可复用的任务专项指令文本**（markdown 正文 + YAML frontmatter 元数据），**不是**"一组工具 + 提示词 + 行为约束"的打包。技能 schema 字段（`dsh-skill/lib/index.js:471-489` `validateDefinition`）：

```
name, description, whenToUse?, invocation, source, provider, resourceBase?, path?, content, metadata?, rank
```

其中 `content` 是加载后才有的**指令正文字符串**。**没有 `tools` 字段、没有 `constraints` 字段**——schema 里 `content` 是单一字符串，不携带工具集或行为约束清单。

`dsh-tool-skill` 是一个**被模型调用的工具**，名为 `skill`（`dsh-tool-skill/lib/index.js:59-66`），参数只有一个 `name`，模型调它来"加载"（取回并注入）某技能的完整指令。工具 output schema 含 `name/provider/resourceBase(oneOf directory|url|opaque)/content`，`render` 用 `renderSkillContent` 渲染成 text。

**本质区别**：工具（tool）是模型可调用的、有副作用/返回结果的函数；技能（skill）是**注入给模型读的指令文档**，模型读了之后自行裁量。技能本身不是工具，但"加载技能"这个动作被包装成一个名为 `skill` 的工具，让模型能主动取正文。

### 1.2 发现机制：provider 注册表 + 分层合并 + 目录扫描

`dsh-skill` 提供 `SkillRegistry`（Cordis Service，`lib/index.js:119`），其它包通过 `ctx.skills.registerProvider(factory)` 注册 provider（`:147-183`）。provider 接口极简（`:427-436` `RUNTIME_SKILL_PROVIDER`）：

```js
{ name, list(options) → candidates[]|{candidates,complete}, get(candidate, options) → definition }
```

三类 provider 发现方式各异：

- **dsh-skill-badge / dsh-skill-office（bundled）**：硬编码候选项，`list()` 返回固定数组，`get()` 读内置 asset 文件（`dsh-skill-badge/lib/index.js:16-43`、`dsh-skill-office/lib/index.js:11-95`）。
- **dsh-skill-filesystem（本地 FS）**：目录扫描 + YAML frontmatter 解析 + chokidar 监视。根表（`lib/index.js:150-188`）分层 rank：
  - `<project>/.dsh/skills`（rank 100）、`<project>/.agents/skills`（200）、自定义目录（300）、`<dshHome>/skills`（400）、`<agentsHome>/skills`（500）、bundled（600）。
  - 文件格式：**Markdown + YAML frontmatter**——`.md` 平铺文件 或 `<name>/SKILL.md` 目录 bundle（`lib/index.js:586-592`）。**不支持** `.yaml`/`.json` 技能文件，**不支持**嵌套 `**/SKILL.md`。
  - frontmatter（`parseSkillFile` `:664-705`）：首行 `---`，YAML 解析 `name`/`description`（必填）、`whenToUse`/`metadata`（可选）、`disable-model-invocation`/`user-invocable`（严格布尔），正文为 frontmatter 之后的 markdown。
  - 监视：`SkillWatchManager`（`:191-479`）chokidar depth=1，缺根用 `fs.watchFile` 轮询，事件合并进 microtask 批次 `invalidate()`；第一方 `write`/`edit` 经 `fs/observed` 同步失效。

分层合并 + rank 裁决（`collectFresh`/`collectLayer` `:298-330`、`compareIndexedCandidates` `:519-520`：`rank - rank || providerOrder || localOrder`）。**每次 `get()` 都向 provider 重读当前文件，不缓存正文**（`dsh-skill/README.zh.md:99`）。

### 1.3 引用方式：`/name` 斜杠手势，引用即注入

用户用 **`/name`**（斜杠 + kebab-case 名，空白边界）在**直接用户消息**里引用技能。手势正则（`dsh-tool-skill/lib/index.js:373`）：

```js
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;
```

引用**即注入**——pre-step 监听器扫描已认领的用户消息，匹配到 `/name` token 后，把该技能的 `<skill_content>` 渲染作为 `user` 角色指令上下文追加进该步骤（`:168-202`），**不依赖模型调 `skill` 工具**。模型也可以不靠用户引用、自行调 `skill` 工具加载。两条加载路径产出**同一种** `renderSkillContent` 形态。

`disable-model-invocation` 的技能只能经 `/name` 用户手势进入，目录与 `skill` 工具永不暴露它（`dsh-tool-skill/README.zh.md:88`）。

UI 侧（`dsh-client-ui-skill/lib/client.js:375-427`）：`/` 触发的 `inputTriggers` 行内建议源，候选来自 `skills/list` RPC，`onPick` 落字面文本 `/${name} `。**菜单 pick 与手敲 `/name` 同效**，无 `@` 语法、无结构化引用载荷、无拖拽。

### 1.4 加载流程：只注入文本，不注入工具/系统提示词/行为约束

技能加载后**只注入文本**——一段规范化的 `<skill_content>` 块（`dsh-skill/lib/index.js:57-70` `renderSkillContent`）：

```
<skill_content name="...">
<skill_resources>...资源指引...</skill_resources>

<skill_instructions>...正文...</skill_instructions>
</skill_content>
```

作为 `user` 角色消息追加进该步骤消息批（pre-step 注入），或作为 `skill` 工具结果保留在历史里。**不注入工具集、不注入独立系统提示词、不注入行为约束条目**。

- `dsh-tool-skill` 全文唯一一次 `ctx.tools.register` 只注册它自己的 `skill` 加载器（`:167`）；`execute`（`:138-157`）只读 `ctx.skills.list/get`，**不调 `ctx.tools.register`**——技能加载不向 ToolRuntime 注册任何工具。
- 技能**不走 `dsh-system-prompt` 的 section 通道**：`SECTION_ORDERS` 表（`dsh-system-prompt/lib/index.js:10-43`）里**无 `SKILL` 条目**。技能注入走 `agent/pre-step` 边界（与 `dsh-agent-instructions` 的 AGENTS.md 注入同属 pre-step/inbox 通道，不是 system 角色）。
- 资源是"指引"不是"附件"——`<skill_resources>` 报告 base directory/URL/opaque hint，**既不枚举也不抓取**引用的文件（`dsh-tool-skill/README.zh.md:245`）。
- 加载是**一次性整段文本**，无流式、无内容句柄、无正文缓存（`dsh-tool-skill/README.zh.md:246`）。
- 工具命名：技能工具名是裸名 `skill`，**无**类似 MCP 的 `mcp__` 前缀分命名空间。

另有一条**目录投影**注入（`dsh-tool-skill/lib/index.js:203-236`）：第二个 pre-step 监听器按 digest 差异决定是否追加/替换一条持久 user-role 目录消息（`<system-reminder>` + `<available_skills>`），列出所有可用技能的 name+description，让模型知道有哪些技能可加载。这是"目录"，不是技能正文。

### 1.5 和 MCP 的关系：完全分离，无代码引用

"MCP = 外部工具，技能 = 内部能力打包"的方向对，但需修正：**DSH 的技能不是"一组工具的打包"**，它只是指令文本。技能 schema 里没有 `tools` 字段，provider 接口（`list`/`get`）只产文本候选与文本定义，不向 ToolRuntime 注册工具。

- grep `mcp|MCP` 在 5 个 skill 包的 `lib/index.js` 与 README 中**零命中**。
- MCP 工具注册走独立路径（`dsh-mcp-client/lib/index.js:104-156` `syncTools` 把 MCP 工具注册进 ToolRuntime）；技能加载**不触达 `ctx.tools`**。
- 技能**不能**在定义里形式化引用 MCP 工具；唯一的"协作"是技能正文里可用自然语言提示模型去调某个 MCP 工具名（自由文本，无 schema 约束），这与模型读 README 后去调工具没区别。

两者职责：MCP 给模型**更多可调用工具**（执行面扩展）；技能给模型**更多指令上下文**（认知面扩展）。正交，互不引用。

### 1.6 技能与预设/系统提示词/persona 的边界

- **技能 vs 预设（preset）**：两个独立概念。preset 是 Cordis YAML 里声明的一组子插件行（`dsh-agent-preset/lib/index.js:13-19` schema 只有 `id/name/description/order/plugins`，**无 `skills` 字段**），决定 agent 启动时的工具与系统提示词段落；技能是运行时按需注入的指令上下文，不改 preset 组合。preset 在 agent 启动时一次性 mount（`dsh-agent-preset-registry/lib/index.js:753-771` `select` 只允许首回合开始前切换）；技能是每步按需的。
- **技能 vs 系统提示词**：技能**不注册** `dsh-system-prompt` section，走 `agent/pre-step` 注入 user 角色消息。`dsh-system-prompt` 的 section 顺序机制是 `SECTION_ORDERS` 常量表 + `getSectionOrder(name)`，`assemble()` 合并全局层与作用域层、跑 `system-prompt/assemble` waterfall。
- **技能 vs persona**：`dsh-persona`（`lib/index.js:35-48`）注册 `deployment:persona-prefix`/`-suffix` system-prompt section（可设 `complete:true` 变唯一段），改的是 agent 身份；技能不碰 system-prompt，只走 pre-step 注入。正交关系。
- **技能 vs AGENTS.md 指令**：`dsh-agent-instructions`（`lib/index.js:1271-1289`）也在 `agent/pre-step` 监听器里把 AGENTS.md 折成 `user/message` 入 `agent.inbox.nextStep`——与技能注入**同属 pre-step 通道**，不是 system 角色。

---

## 2. SaCode 现状对照

| 维度 | DSH | SaCode 现状 | 差距 |
|---|---|---|---|
| 技能定义 | 指令文本（md+frontmatter），`name/description/whenToUse/content/...` | `core/src/skill.cj` `SkillRegistry` **log-only 存根**：只有 `name`+`description`，`register`/`uninstall`/`list`/`describe`，**无 `content`、无 provider、无 frontmatter** | 缺正文、缺 provider 接口 |
| 技能工具 | `skill` 工具（模型主动加载） | **无** `skill` 工具；`extension/list` 返回普通工具（`{name,description,handler}`） | 缺模型面向的 skill 加载工具 |
| 发现机制 | provider 注册表 + 分层目录扫描（`.dsh/skills`、`.agents/skills`、user home、bundled）+ chokidar 监视 | **无** provider、**无**目录扫描、**无** SKILL.md 解析 | 缺 filesystem provider 全套 |
| 引用方式 | `/name` 斜杠手势，pre-step 扫描注入 | `apps/desktop/renderer/user-text.ts` **已有 `/name` slash 渲染钩子**（`slashKind:'skill'`、`openSkill`），但**无后端数据**；`composer-menu.ts` "技能"卡片调 `loadTools()`（`extension/list`）当技能 | UI 钩子在，数据源错 |
| 加载注入 | pre-step 把 `<skill_content>` 作 user 消息注入；目录投影 `<available_skills>` | `core/src/agent.cj` **无 pre-step/skill 注入钩子**（grep `skill`/`preStep`/`inject` 0 命中相关） | 缺 agent 循环的技能注入点 |
| 系统提示词 | `dsh-system-prompt` section 表 + waterfall；技能**不**进 section | `core/src/sysprompt.cj` `SystemPromptBuilder` 简单拼装：角色 + `ToolRegistry.list()` 工具清单 + goal；**无 section 机制** | 技能目录**不**进 sysprompt（§3.4），保持 `sysprompt.cj` 现状不动；目录走持久 user 消息 |
| 技能 vs 工具 | 技能是文本，工具是函数；`skill` 是唯一桥 | "技能"入口接 `extension/list` 普通工具 | **核心错位**：把工具当技能 |
| 技能 vs MCP | 完全分离 | SaCode MCP 也在设计（见 `mcp-integration-design-2026-10-20.md`）；技能与 MCP 同样应分离 | 设计一致即可 |
| plugin-descriptions | — | `apps/desktop/renderer/plugin-descriptions.ts:10-11,68` 已有 `skill-filesystem`/`tool-skill`/`ui-skill` 描述（DSH 插件名抄过来的） | 描述在，实现缺 |
| Host RPC | `skills/list`（typert） | Host 能力表（`docs/plans/host-capabilities.json` + `apps/host/src/main.cj:1274`）**无 `skill/*`** | 缺 `skill/list`、`skill/get` |

SaCode 已有的可复用资产：`SkillRegistry` 存根（log 事件结构可复用）、`user-text.ts` 的 `/name` slash 渲染钩子（`openSkill`）、`plugin-descriptions.ts` 的技能插件描述、`sysprompt.cj` 的 `ToolRegistry` 驱动拼装（**不改**，技能目录不进 sysprompt）。**核心闭环差五段**：技能正文 + provider、`skill` 加载工具（单个，不把每项技能注册为工具）、目录扫描（含文件边界）、agent pre-step 注入（目录+正文+去重+slash 边界）、Host `skill/*` RPC + UI 数据源切换。

---

## 3. 推荐接入路径

按 SaCode「共享 core + Host/CLI/桌面三入口」架构组织，不引入 cordis/React 依赖（仓颉 core 自维护，桌面是 Vue runtime）。

### 3.1 技能定义与 provider（core）

- 扩展 `core/src/skill.cj` 的 `SkillRegistry` → 持 `SkillDefinition`（对齐 DSH schema）：
  ```
  SkillSummary { name, description, whenToUse?, modelInvocable, userInvocable, source, provider, path?, resourceBase? }
  SkillDefinition { summary: SkillSummary, content: String }   // 组合（不继承），暴露 name()/description() 访问器
  // 不用 DSH 的 invocation/rank 数值字段：调用策略用 modelInvocable/userInvocable 两布尔位；
  // 跨层同名覆盖按 §3.2 优先级表，不靠 rank。
  ```
  保留现有 `register`/`uninstall` log 事件（向后兼容），新增 `listSummaries()`（返回 name+description+whenToUse，供目录）与 `get(name)`（返回完整 definition 含 content）。
- provider 接口（对齐 DSH `RUNTIME_SKILL_PROVIDER`）：`{ name, list() → SkillSummary[], get(name) → SkillDefinition? }`。core 提供内置 `BundledSkillProvider`（硬编码随包技能）+ `FilesystemSkillProvider`（扫描目录）。

### 3.2 发现路径与目录扫描 provider（core）

**发现根表与同名覆盖规则**（不照搬 DSH 的 `.dsh` 路径，用 SaCode 品牌目录）：

| 层 | 路径 | 优先级 | 说明 |
|---|---|---|---|
| 项目（原生） | `<projectRoot>/.sa-code/skills` | 1（最高） | 项目专属技能，覆盖用户与内置 |
| 项目（兼容） | `<projectRoot>/.agents/skills` | 2 | 兼容 AGENTS.md 生态跨工具复用；与原生层同名时让位原生 |
| 用户 | `<userHome>/.sacode/skills` | 3 | 用户全局技能（Windows：`C:\Users\<user>\.sacode\skills`） |
| 内置 | `<appResources>/skills` | 4（最低） | 随包出货，被以上覆盖 |

- **同名覆盖**：同一 `name` 跨层出现时，**高优先级层胜出，低层被遮蔽（不合并字段）**。理由：最贴近当前项目的技能应优先（与工作区配置惯例一致）。DSH 是 bundled rank 最高覆盖 user，SaCode 反过来——项目/用户自定义优先于内置。
- **用户目录与 `C:\Users\jingg\.sacode` 的关系**：用户技能目录就是 SaCode 用户主目录 `~/.sacode` 下的 `skills/` 子目录（即 `C:\Users\<user>\.sacode\skills`），**不是独立根**。SaCode 的其它用户级数据（设置、凭据等）同在 `~/.sacode/` 下。`<userHome>` 由 `os.homedir()`（仓颉等价）解析，不硬编 `jingg`。
- **`<projectRoot>` 的来源**：当前会话 `workspace/get` 返回的 `directory`（Host 已有此 RPC），不取 CLI 启动 cwd——避免在 worktree/子目录里误扫上层。
- **文件格式**：**Markdown + YAML frontmatter 严格子集**（不承诺完整 YAML 兼容）。`.md` 平铺文件 或 `<name>/SKILL.md` 目录 bundle。frontmatter 声明子集仅 5 键：`name`（必填，kebab-case `^[a-z0-9]+(-[a-z0-9]+)*$`）/`description`（必填，非空）/`whenToUse`（可选，单行字符串）/`disable-model-invocation`（可选，仅 `true`|`false`）/`user-invocable`（可选，仅 `true`|`false`）。**拒绝**：未知键（含 `metadata`——不解释故不入子集）、重复键、引号串（`"..."`/`'...'`）、块标量（`|`/`>`）、多行续行、空行、无冒号行、非法布尔。**不接受** `.yaml`/`.json` 技能文件，**不递归**嵌套子目录（depth=1）。
- **同层确定性顺序与同名裁决**：同层内**目录(bundle)先于平铺文件**，各自按路径字符串稳定排序；同层同名（bundle 与平铺并存）→ **bundle 胜**。跨层同名按优先级表（项目原生 > 项目兼容 > 用户 > 内置）先到先得。`list()`/`get()` 结果确定性。
- **provider 接口**：`{ name, list() → SkillSummary[], get(name) → SkillDefinition? }`。core 提供 `BundledSkillProvider`（硬编码随包）+ `FilesystemSkillProvider`（扫上表四层）。
- **监视**：仓颉无 chokidar；首版用 **mtime 轮询 + 会话级快照**（每次 `list`/`get` 检查根 mtime，变了才重扫）。不阻塞首版；不引第三方监视库。

**文件边界（安全约束）**——`FilesystemSkillProvider` 的读取**只限上表四个声明根内**：

- **路径穿越**：按**路径组件边界**判定（`isDescendantByComponent`），不用裸 `startsWith`——避免 `skills-other/file.md` 误判在 `skills` 内。candidate `realpath`（canonicalize）后必须等于 root 或以 `root + "/"` 开头。Windows 大小写：**待验证**（`canonicalize` 是否返回真实大小写、字节比较是否等价，未运行确认）；分隔符归一（`\`→`/`）。不基于未经验证的大小写假设声明安全。
- **符号链接/reparse**：candidate 本身是符号链接直接拒；沿原始路径从父逐级到 root 检查祖先，任一是符号链接即拒（depth=1 通常无中间祖先，作 defense-in-depth）。扫描入口处目录项是符号链接也直接跳过。
- **文件大小（有界读取）**：`maxInstructionBytes`（默认 65536，可配）上限；用 `File.read(buffer)` 流式读，**最多读 `maxBytes+1` 字节**，发现超限立即停止、**不读取剩余内容**（`readBounded`）；超限 → fail-closed 丢弃返回 `None`，**不截断**。内存上限 ≈ `maxBytes+1` + 一个 8KB 缓冲区。不再用全量 `File.readFrom` + 事后大小核对。
- **解析错误**：frontmatter 缺失/非法 `name`/未知键/重复键/引号串/块标量/非法布尔 → 丢弃候选，**不抛**。`get()` 重读时同样 fail-closed 返回 `None`。
- **`get()` 最终读取重新核对（TOCTOU 防护）**：`findInLayer` 定位后，`verifiedRead` 重新核对①路径与链接边界 ②有界读取（超限即拒）③解析出的名称仍等于请求名。残留竞争说明：文件可能在定位与核读之间被替换/删除——核读把可被利用的窗口压到最小，但**无法在理论上消除"读取瞬间的真实内容"与"返回内容"完全一致**；需更强保证须文件锁，本版不引入。
- **"读文本不审批"的边界**：`skill/get` 与 `skill` 工具只读**已注册技能的 SKILL.md 正文**（经 provider `get` 返回的 `content`），**不**接受任意路径参数、**不**暴露通用文件读。读任意本机文件仍走现有 `read` 工具与审批。技能目录内的文件读取不等于授予本机任意文件访问权。

### 3.3 `skill` 加载工具 + pre-step 注入契约（core）

**工具注册：一个加载工具，不把技能注册为工具**

- 新增 `core/src/tool_skill.cj`：定义**名为 `skill` 的单个加载工具**（对齐 DSH `dsh-tool-skill`），参数 `{name: string}`，`execute` 调 `SkillRegistry.get(name)`，返回 `renderSkillContent(skill)` 文本，注册进 `ToolRegistry`。
- **明确排除**："把每项技能注册为独立工具"（即每条 `SkillDefinition` 注册一个同名工具）**不做**。技能是注入给模型读的指令文本，不是可调用函数；为每条技能开一个工具会让工具表爆炸、与 MCP 工具混界、且模型会误把技能当副作用动作调。**唯一**因技能而注册的工具是 `skill` 加载器本身。
- 现有 `extension/list`（普通工具）与技能**不共用通道**：`extension/list` 返回 `{name,description,handler}` 工具；`skill/list` 返回 `SkillSummary`（指令文档）。两者数据结构不同，UI 必须分开展示（见 §3.6）。

**注入契约：目录在哪里、正文何时、同轮去重**

- **目录（`<available_skills>` 摘要列表）注入**：在 `agent.cj` 的 pre-step 钩子里，按 **digest 差异**追加/替换一条**持久 user-role 消息**（列 name+description+whenToUse），让模型知道有哪些技能可加载。digest 不变则不重写（避免每轮重复堆目录消息）。
- **正文（`<skill_content>` 完整指令）注入时机**：仅在以下两种触发时注入当步：
  1. 用户在**直接用户消息**里写了 `/name`（slash 手势，见下）；
  2. 模型主动调 `skill` 工具（参数 `name`）。
  两种路径产出**同一种** `renderSkillContent` 形态。`disable-model-invocation` 的技能只能走路径 1（用户手势），`skill` 工具的 `list`/`execute` 不暴露它。
- **同轮去重**：同一步骤内，同一 `name` 的正文**只注入一次**——若用户 `/name` 已触发注入，且模型随后又调 `skill` 工具加载同名，工具结果仍落历史（工具结果保留），但 pre-step **不重复追加**第二条 `<skill_content>` user 消息。去重以 `(stepId, name)` 集合记录。目录摘要消息与正文不互为重复（摘要列名+描述，正文是全文，职责不同），不据此去重。
- **不与系统提示词重复堆目录**：目录摘要**只走持久 user 消息**，**不**再写入 `sysprompt.cj`（见 §3.4 修订）。避免同份目录既在持久消息又在 system prompt 双写。

**Slash 解析契约**

- **仅扫直接用户输入**：pre-step 扫描已认领的 `source.kind === "user"` 消息的 text block；**不扫**工具输出、引用文档、assistant 消息、注入的 `<skill_content>` 自身。防止模型在工具结果里看到 `/name` 文本后被误当用户引用再注入。
- **代码块不触发**：text block 内的 fenced code block（` ``` ` 围栏）与行内 code（`` ` ``）里的 `/name` **不匹配**——先剥代码块再跑正则，避免示例代码被当手势。
- **手势正则**：`/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`（对齐 DSH `SKILL_GESTURE`，kebab-case 名，空白边界）。`/` 后必须紧跟字母数字，避免匹配文件路径（如 `/foo/bar` 不匹配，因为 `foo/bar` 含 `/` 不符合 `[a-z0-9-]+`）。
- **未知名称**：`/foo` 但 `foo` 不是已注册技能 → **原样保留为字面文本**，不注入、不报错、不替换。用户消息不被破坏。
- **多技能**：`/a /b` → 两个都匹配，按出现顺序逐个注入正文。
- **`disable-model-invocation` 行为**：这类技能 `skill/list` 仍返回（标 `modelInvocable:false`）供 UI 展示与 `/name` 触发，但 `skill` 工具的 `execute` 收到它时**拒绝**（返回 `skill-not-model-invocable`），目录摘要里加"仅用户"标记。`user-invocable:false` 的反例（仅模型可调、用户手势不触发）首版不实现（DSH 也基本不用）。

**`<skill_content>` 块格式**（对齐 DSH `renderSkillContent`）：

```
<skill_content name="...">
<skill_resources>...directory|url|opaque 指引...</skill_resources>

<skill_instructions>...正文...</skill_instructions>
</skill_content>
```

资源只给指引（base directory/URL/opaque hint），**不枚举不抓取**（见 §3.5 资源契约）。

### 3.4 系统提示词不承载技能目录（避免双写）

- 技能**不作为 system-prompt section**（与 DSH 一致：`SECTION_ORDERS` 无 SKILL 条目）。`sysprompt.cj` `SystemPromptBuilder.build()` **不追加**技能目录段。
- 目录摘要**只在 §3.3 的持久 user-role `<available_skills>` 消息里**出现一次，不进 `sysprompt`。这样避免同份目录既在持久消息又在 system prompt 重复堆叠——模型不会在 system 段和 user 段各看到一遍目录。
- 正文 `<skill_content>` 也走 user 角色注入（§3.3），不进 system prompt。
- 唯一进 system prompt 的是"现有工具清单"（`ToolRegistry.list()`）与 goal——这两者与技能无关，保持 `sysprompt.cj` 现状不动。

### 3.5 Host RPC 面、IPC 改动点与验收清单（设计样例，本阶段不实现）

新增 `skill/list`、`skill/get` 两条 RPC（写入 `docs/plans/host-capabilities.json` 与 `apps/host/src/main.cj` 分派——本阶段只定样例，不实际加）。

**`skill/list`**

```jsonc
// 请求
{"jsonrpc":"2.0","id":7,"method":"skill/list"}
// 成功响应
{"jsonrpc":"2.0","id":7,"result":{
  "skills":[
    {"name":"commit-convention","description":"git 提交信息规范","whenToUse":"写提交时","modelInvocable":true,"userInvocable":true,"provider":"filesystem","source":"project","path":"<projectRoot>/.sa-code/skills/commit-convention/SKILL.md"},
    {"name":"office-docx","description":"Word 文档结构与检查","whenToUse":"处理 .docx 时","modelInvocable":true,"userInvocable":true,"provider":"bundled","source":"bundled","path":null}
  ],
  "digest":"<sha256 of sorted names+descriptions>"
}}
// 错误（仅协议级；单个坏技能不致 list 失败，按 §3.2 fail-closed 丢弃并记 skill/parse-error）
{"jsonrpc":"2.0","id":7,"error":{"code":-32020,"message":"internal-error"}}  // 仅未捕获异常
```

**`skill/get`**

```jsonc
// 请求
{"jsonrpc":"2.0","id":8,"method":"skill/get","params":{"name":"commit-convention"}}
// 成功响应（content 是完整正文）
{"jsonrpc":"2.0","id":8,"result":{
  "name":"commit-convention","description":"...","whenToUse":"...","modelInvocable":true,"userInvocable":true,
  "resourceBase":{"kind":"directory","path":"<projectRoot>/.sa-code/skills/commit-convention"},
  "content":"<skill 正文 markdown>",
  "rendered":"<skill_content name=\"commit-convention\">...</skill_content>"  // 可选：宿主预渲染好的注入块
}}
// 错误
{"jsonrpc":"2.0","id":8,"error":{"code":-32001,"message":"skill-not-found","data":{"name":"commit-convention"}}}
{"jsonrpc":"2.0","id":8,"error":{"code":-32001,"message":"skill-not-model-invocable","data":{"name":"..."}}}  // disable-model-invocation 经 skill 工具调时
{"jsonrpc":"2.0","id":8,"error":{"code":-32001,"message":"skill-parse-error","data":{"name":"...","reason":"too-large"}}}  // get 重读时发现坏
```

**约束**

- `skill/get` **不走审批**（读已注册技能正文，无副作用，对齐 DSH）；模型调 `skill` 工具也不走 `approval/ask`。技能正文里若指示模型调 write/edit/bash，那些工具调用照常走审批工单。
- `skill/get` **只按 `name` 取**，**不接受 path 参数**——不能用它读任意文件。`name` 必须是已注册技能名。
- `digest` 用于 UI 判断目录是否变化，避免每轮重拉。

**IPC 改动点（桌面，本阶段不实现，仅登记）**

| 改动点 | 内容 |
|---|---|
| `apps/desktop/preload.cjs` | 新增顶层 key `sacode.skillList`（无参→`{skills,digest}`）、`sacode.skillGet`（`{name}`→`SkillDefinition`）。门禁从当前 138→140，同步 `test/bridge.test.mjs` 与 `check_ipc_surface_parity.cjs` |
| `apps/desktop/main.cjs` | 转发到 Host `skill/list`/`skill/get` |
| `apps/desktop/renderer/pages/composer-menu.ts` | `enter('skills')` 改调 `sacode.skillList`（不再调 `listTools`/`extension/list`）；`/` 行内建议源候选来自 `skill/list` |
| `apps/desktop/renderer/user-text.ts` | `openSkill(name)` 接 `skill/list` 返回的 `path` 与 `resourceBase`（见下） |

**`openSkill` 契约（查看内容 vs 打开本地文件 / 资源引用边界）**

- **`openSkill(name)` 语义**：打开该技能的 `SKILL.md` **源文件**（经 `skill/list` 返回的 `path`，走现有文件打开/查看通道，只读视图）。若技能无 `path`（`provider=bundled` 且打包在 asar 内、或 `resourceBase.kind=opaque`）→ **不落盘打开**，改为在右侧栏 `Inspect` 面板里展示 `skill/get` 返回的 `content` 文本。
- **不授予任意文件访问**：`openSkill` 只能打开 `skill/list` 返回的 `path`（该 path 已由 §3.2 文件边界校验在声明根内）；UI **不**把 `path` 暴露成可输入框让用户填任意路径。
- **资源引用（`<skill_resources>`）不触发额外读取**：`resourceBase` 是**指引文本**（directory/url/opaque hint），`skill/get` 返回它但**不枚举不下载**其中文件。模型若要读 `resourceBase.directory` 下的文件，必须走现有 `read` 工具并受审批约束——技能机制不替它读。`url` 类资源必须走现有 `web-fetch`/`bash` 工具。`opaque` 类不解释，仅作提示。
- **理由**：读技能正文不审批 ≠ 可读取任意本机文件。`skill/get` 与 `openSkill` 的可读范围严格限定在"已注册技能的 SKILL.md 正文"，任何超出该范围的文件访问必须走既有受审批工具。

**验收清单（本阶段不实现，给后续阶段用）**

1. `skill/list` 返回的每条 `name` 符合 `^[a-z0-9]+(-[a-z0-9]+)*$`；`digest` 在技能集不变时跨调用稳定。
2. `skill/get` 对未注册名返 `skill-not-found`；对 `disable-model-invocation` 技能经 `skill` 工具调返 `skill-not-model-invocable`；对 path 穿越候选返 `skill-parse-error`（候选在扫描期已被丢，`get` 找不到即 `skill-not-found`）。
3. 用户消息 `/commit-convention` → pre-step 注入 `<skill_content name="commit-convention">`；同一步骤模型再调 `skill` 工具同名 → 工具结果落历史，**不**再追加第二条 user 消息（去重）。
4. 用户消息里 ``` `/foo` ``` （代码块内）→ 不触发注入，原样保留。
5. `/unknown-skill` → 原样保留，不注入、不报错。
6. 工具输出/assistant 消息里的 `/name` → 不触发注入。
7. 目录摘要 `<available_skills>` digest 不变时 → pre-step 不重写该持久消息。
8. `sysprompt` 输出不含技能目录段（只含现有工具清单+goal）。
9. `openSkill` 对 `path` 存在的技能打开源文件；对 `path=null` 的在 Inspect 面板展示 `content`。
10. `skill/get` 不接受 path 参数；`resourceBase` 不触发额外文件读取。

### 3.6 前端组件（桌面渲染层）

- **修正 `composer-menu.ts`**：`enter('skills')` 改调 `skill/list`（新 IPC `sacode.skillList`），不再调 `loadTools()`（`extension/list`）。卡片展示 `name`+`description`，`/` 触发的行内建议源候选来自 `skill/list`，`onPick` 落字面文本 `/${name} `。
- **`SkillRow` 工具行**：注册到现有消息渲染器的 `role==="tool"` 分支，键 `skill`——收起态显示技能图标 + "技能" + 请求加载的 skill 名（运行中 shimmer、失败错误首行、中断"已中止"）；展开态呈现 `<skill_content>` 正文 + `Inspect` 入口。
- **`openSkill`**：`user-text.ts` 已有钩子，接 `skill/list` 返回的 `path`，打开 `SKILL.md`（走现有文件打开通道）。
- IPC 面（`apps/desktop/preload.cjs`）新增 `sacode.skillList`/`skillGet`（门禁扩充，同步改 `test/bridge.test.mjs` 与 `check_ipc_surface_parity.cjs`）。

### 3.7 技能 vs MCP vs 预设的边界（设计约束）

- **技能 ≠ MCP**：技能是文本注入，MCP 是工具注册；两者正交，不互相引用（对齐 DSH）。SaCode 的 MCP 设计（`mcp-integration-design-2026-10-20.md`）与技能设计独立。
- **技能 ≠ 预设**：SaCode 暂无 preset 系统；技能不依赖预设。即便将来引入 preset，技能也不在 preset schema 里声明（对齐 DSH：preset 无 `skills` 字段）。
- **技能 ≠ AGENTS.md**：SaCode 若引入 AGENTS.md 加载（对齐 `dsh-agent-instructions`），它和技能同走 pre-step 注入通道，但职责不同（AGENTS.md 是工作区长期指令，技能是任务专项指令）。

---

## 4. 风险与边界

- **技能不是工具**：最大风险是重蹈覆辙——把 `extension/list` 工具当技能。`composer-menu.ts` 必须切到 `skill/list`，"技能"卡片只展示真技能（有 `content` 的），不展示普通工具。
- **不向 ToolRuntime 注册技能工具**：技能加载只注入文本，不注册工具（对齐 DSH `dsh-tool-skill` 全文唯一 `tools.register` 只注册 `skill` 自身）。唯一的"技能工具"是 `skill` 加载器本身。
- **加载不审批、下游照常审批**：`skill/get` 与 `skill` 工具调用不走 `approval/ask`（读文本无副作用）；技能正文里指示模型调 write/edit/bash 等，走现有审批工单。这与 DSH 一致（DSH 技能不接 approval）。
- **正文不缓存**：每次 `get()` 重读当前文件（对齐 DSH `dsh-skill/README.zh.md:99`），保证编辑后立即生效。SaCode 无 chokidar，首版用 mtime 轮询或会话级快照+手动刷新，不阻塞。
- **frontmatter 解析**：仓颉需自写轻量 YAML frontmatter 解析（DSH 用 yaml 库）。首版只支持 `name`/`description`/`whenToUse`/`disable-model-invocation`/`user-invocable` 五字段，不引完整 YAML 库。
- **目录扫描根**：用 `.sa-code/skills` 而非 `.dsh/skills`（品牌归属），但**兼容 `.agents/skills`**（跨工具生态，AGENTS.md 规范）。bundled 技能随包 `assets/skills/`。
- **`/name` 手势正则**：对齐 DSH `/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`，kebab-case 名，空白边界。避免误匹配文件路径 `/`。
- **slash 仅扫直接用户输入**：不扫工具输出、引用文档、assistant 消息、注入的 `<skill_content>` 自身；代码块（fenced/inline）内的 `/name` 先剥再匹配，避免示例代码被当手势（§3.3）。未知名原样保留不报错；多技能按序注入。
- **文件访问边界（安全）**：`FilesystemSkillProvider` 读取**只在四个声明根内**（§3.2）：**按路径组件边界**判定（不用裸 `startsWith`，避免 `skills-other` 误判）、candidate+祖先符号链接/reparse 拒绝、文件超 `maxInstructionBytes` fail-closed 不截断、frontmatter 坏 fail-closed 丢候选不抛。**"读文本不审批"仅限已注册技能的 SKILL.md 正文**，不等于授予本机任意文件读——任意文件读仍走 `read` 工具+审批。
- **`get()` TOCTOU 残留**：`verifiedRead` 在最终读取时重核路径/链接/大小/名称，把替换利用窗口压到最小，但**不声称彻底解决文件替换竞争**；理论上完全一致须文件锁，本版不引入（§3.2）。
- **确定性发现**：同层目录(bundle)先于平铺文件、各自按路径排序，同层同名 bundle 胜；跨层按优先级先到先得。单个文件消失/不可访问/属性读取失败由 per-candidate try/catch 隔离，不拖垮整层清单。
- **严格 frontmatter 子集**：只接受 5 键（name/description/whenToUse/disable-model-invocation/user-invocable），布尔只认 `true`/`false`，未知键/重复键/引号串/块标量/多行一律拒。不承诺完整 YAML 兼容；含 `metadata` 的旧技能文件会被拒（不解释故不入子集）。
- **跨工具兼容性告诫**：常见外部 `SKILL.md` 可能因引号、多行描述（`|`/`>` 块标量）或额外字段（如 `metadata`）被拒；首版**不能承诺跨工具直接兼容**。需兼容时由用户按本子集改写。
- **Windows 路径语义待验证**（有运行证据前不当作事实）：同一路径的大小写变体（`canonicalize` 是否真返回真实大小写、字节比较是否等价）；根目录与尾分隔符；UNC 路径若需支持；技能根及祖先目录的链接/reparse 实际拒跟行为；`skills` 与 `skills-other` 的组件边界在 Windows 分隔符混合下的判定。当前 `skillPathInsideRoot` 用 `canonicalize` + `normalizeSep`（`\`→`/`）+ 组件边界判定，逻辑正确但**未经运行验证**；不扩大成通用路径库重构。
- **`openSkill` 不扩权**：只打开 `skill/list` 返回的 `path`（已在声明根内校验过）；UI 不把 path 暴露成可输入框。`path=null`（bundled/opaque）改在 Inspect 面板展示 `content`，不落盘。`resourceBase` 指引不触发额外读取，模型要读资源目录下文件须走 `read`/`web-fetch` 工具受审批。
- **目录不双写**：`<available_skills>` 摘要只在持久 user 消息出现一次，**不**进 `sysprompt`（§3.4）；避免模型在 system 段和 user 段各看一遍目录，浪费上下文且口径漂移。
- **同轮去重**：同一 `(stepId, name)` 正文只注入一次 user 消息；模型调 `skill` 工具同名时工具结果落历史但不重复追加 user 注入（§3.3）。
- **资源指引不抓取**：`<skill_resources>` 只给 directory/url/opaque hint，不枚举不下载文件（对齐 DSH "Resources are guidance, not attachments"）。
- **正文大小**：DSH README 标"已知限制/不做"正文版本化与大小上限（`dsh-tool-skill/README.zh.md:244,248`）。SaCode 首版也不做版本化；可加 `maxInstructionBytes` 配置（对齐 DSH `Config.maxInstructionBytes`）防超大正文撑爆上下文。
- **`whenToUse` 消费方**：DSH 注册表保留 `whenToUse` 但目录模板**不渲染**它（`dsh-tool-skill/README.zh.md:243`）。SaCode 可在 `skill/list` 摘要里返回 `whenToUse`，UI 是否展示留待实现期决定。
- **未验证项（DSH 源码未答）**：远程/HTTP skill provider（DSH README 提及但 5 包无实现）；`metadata` 字段是否被用作非正式 MCP 工具引用（schema 不解释，无证据）；`whenToUse` 实际消费方（`dsh-tool-present` grep 零命中）。SaCode 首版不做远程 provider、不解释 `metadata`。

## 5. 不在范围

- 不实施、不写产品代码、不改 core/Host/CLI/桌面源码。
- **本阶段不实际增加 Host/IPC 接口**：§3.5 只给 `skill/list`/`skill/get` 请求/响应/错误样例与 IPC 改动点登记，不写入 `host-capabilities.json`/`preload.cjs`/`main.cj`。
- 不碰其他方在途文件（`renderer/pages/permission-menu.ts`、`product-design.css` 等）。
- 不提交、不推送。
- **不新建索引/台账条目**：本文件已登记在 `docs/plans/README.md` 与 `docs/README.md`；本轮只补充原文件，不新增索引或 PRD 台账条目，待统一登记。
- 暂不执行：仓颉构建、IPC 接入、技能目录迁移、真实用户配置操作。
- 远程/HTTP skill provider、技能正文版本化、技能市场分发首版不做。
- preset 系统（SaCode 暂无）不在本方案范围；技能不依赖 preset。
- AGENTS.md 加载（`dsh-agent-instructions` 等价）是独立方案，本方案只在边界处声明"同走 pre-step 通道"。

## 6. 取证索引

DSH（`target/tmp/dsh-extract-20261019/dsh/node_modules/@deepseek-ai/`）：
- `dsh-tool-skill/lib/index.js`：`skillTool` 定义 `:59-66`、`execute` `:138-157`、`tools.register(skillTool)` `:167`、pre-step 注入 `:168-202`、目录投影 `:203-236`、`SKILL_GESTURE` `:373`、`invokedSkillNames` `:381-394`、目录模板 `:244`。
- `dsh-skill/lib/index.js`：`SkillRegistry` `:119`、`registerProvider` `:147-183`、`renderSkillContent` `:57-70`、`validateDefinition` `:471-489`、`toSummary` `:491-503`、`RUNTIME_SKILL_PROVIDER` `:427-436`、分层合并 `:298-330`、`compareIndexedCandidates` `:519-520`。
- `dsh-skill-filesystem/lib/index.js`：根表 `:150-188`、文件格式 `:586-592`、`parseSkillFile` `:664-705`、`get` 重读 `:115-134`、`SkillWatchManager` `:191-479`。
- `dsh-skill-badge/lib/index.js:16-43`、`dsh-skill-office/lib/index.js:11-95`（bundled provider）。
- `dsh-client-ui-skill/lib/client.js`：`/` source `:375-427`、`skills.list` `:345`、`SkillRow` `:160-267`。
- `dsh-agent-preset/lib/index.js:13-19`（preset schema 无 skills）、`dsh-agent-preset-registry/lib/index.js:471-474,500-524,753-771`、`dsh-system-prompt/lib/index.js:10-43,215-229,310-362`、`dsh-agent-instructions/lib/index.js:1271-1289`、`dsh-persona/lib/index.js:35-48`。

SaCode：
- `core/src/skill.cj:1-114`（`SkillRegistry` log-only 存根）、`core/src/sysprompt.cj`（`SystemPromptBuilder` 简单拼装）、`core/src/agent.cj`（无 skill/preStep/inject 钩子）。
- `apps/desktop/renderer/pages/composer-menu.ts:21,34-35,66`（"技能"卡片调 `loadTools()`＝`extension/list`）、`apps/desktop/renderer/user-text.ts:5,15`（`/name` slash + `openSkill` 钩子）、`apps/desktop/renderer/plugin-descriptions.ts:10-11,68`（skill-filesystem/tool-skill/ui-skill 描述）。
- `docs/plans/host-capabilities.json:49-59`（`extension/*` 有、`skill/*` 无）、`apps/host/src/main.cj:1274,1684`（能力表 + `extension/list` 分派）、`extjs/host.cjs:21-43,142`（extension 模块＝普通工具）。

---

## 7. 实施顺序与并发边界

1. **契约审定**（本文件）：六项契约（发现路径/工具注册区分/注入契约/slash 解析/文件边界/接口样例）由用户审定通过后方可拆分。
2. **独立核心发现/解析模块**（core，可独立并发）：`SkillDefinition`/`SkillSummary` 类型、`SkillProvider` 接口、`BundledSkillProvider`、`FilesystemSkillProvider`（§3.2 根表+文件边界+frontmatter 解析）、`SkillRegistry` 扩展（`listSummaries`/`get`/digest）。**纯 core，不触 agent.cj/Host/IPC**——文件边界确认后可独立并发推进，产物是 core 单测。
3. **Host 与加载工具接入**（core+Host，须等当前执行方交接）：`tool_skill.cj`（`skill` 加载工具注册）、`agent.cj` pre-step 注入钩子（目录摘要+正文+去重+slash 扫描）、Host `skill/list`/`skill/get` RPC 分派。涉及 `agent.cj` 与 Host 装配，必须等当前执行方交接后再接入，不与在途改动混改。
4. **输入框技能清单**（桌面，须等 IPC 交接）：`preload.cjs`+`main.cjs` IPC（`sacode.skillList`/`skillGet`）、`composer-menu.ts` 切数据源、`user-text.ts` `openSkill` 接线、`SkillRow` 工具行。涉及 IPC 门禁，须等交接。
5. **端到端验收**：按 §3.5 验收清单 1–10 逐条验；含 slash 边界、去重、文件边界、`openSkill` 范围。

**并发约束**：第 2 段可在文件边界确认后独立并发；第 3 段（agent.cj/Host）、第 4 段（IPC）有交接依赖，不抢在途文件。各段产物分别验收，不跳段。
