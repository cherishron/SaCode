# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[回复语言偏好]
- Date: 2026-06-03
- Context: 用户在当前对话中要求统一回复语言时
- Instructions:
  - 后续回复统一使用中文。

[SaCode 运行时权限授权流程]
- Date: 2026-06-04
- Context: 用户补充 SaCode 运行中权限受限场景的统一处理方式
- Instructions:
  - 在 SaCode 运行过程中，遇到文件访问、工具调用或执行权限受限时，先向用户发起交互授权确认。
  - 用户同意后，再继续申请或执行对应权限范围内的操作。

[完善实现优先]
- Date: 2026-05-24
- Context: 用户要求继续补全 skills、MCP 等能力时
- Instructions:
  - 当用户要求补功能时，直接补到可用完成态。
  - 输出和实现以完整落地为目标，不停留在演练、展示或清单阶段。

[TUI 任务工作流]
- Date: 2026-05-26
- Context: 用户要求改进 sacode TUI 的任务交互流程时
- Instructions:
  - 执行中的对话需要显示等待区，并支持取消当前任务。
  - 后续发送的任务需要进入等待队列，当前任务完成后自动继续执行下一项。
  - 当对话中存在明确步骤规划时，需要展示 todo 列表，并在用户确认后按 todo 顺序执行。

[TUI 取消后续执行]
- Date: 2026-05-28
- Context: 用户补充 Esc 取消后的消息队列行为时
- Instructions:
  - 用户按 `Esc` 取消当前执行后，消息队列中的下一条消息需要自动开始执行。
  - 取消当前任务不应阻塞后续排队消息的自动发送。

[TUI 结果驱动交互]
- Date: 2026-05-28
- Context: 用户补充发送消息后的交互流转规则时
- Instructions:
  - 发送消息后的流转需要根据大模型返回结果决定下一步状态。
  - 当模型需要继续处理、继续请求模型、等待用户回答或等待用户确认时，TUI 需要进入对应状态，而不是固定执行一次后直接结束。
  - 用户按回车确认下一步对话的能力需要由模型返回结果触发。
  - 当存在等待用户回答的任务时，普通输入继续进入消息队列；只有显式 `/answer ...` 或输入框为空时按回车，才用于恢复当前等待中的任务。
  - 等待回答如果包含多个问题，TUI 需要使用 tabs 切换问题；有选项时支持上下左右和回车操作，并保留自定义输入回答能力。

[执行模式授权策略]
- Date: 2026-05-28
- Context: 用户补充 build/plan/yolo 与工具审批策略的关系时
- Instructions:
  - 工具审批策略需要根据执行模式动态生效，而不是固定使用 deny。
  - `plan` 模式只允许读取类工具，完全禁止写入和修改类工具。
  - `build` 模式对修改类工具执行审批，支持单次授权和本次会话永久授权。
  - `yolo` 模式对修改类工具自动授权，无需再询问。

[Init 命令流程]
- Date: 2026-05-28
- Context: 用户定义 `/init` 命令的标准执行流程时
- Instructions:
  - `/init` 需要先遍历目录结构，识别项目类型，并尊重 `.gitignore`` 跳过无关文件。
  - `/init` 需要读取关键配置文件，例如 `package.json`、`tsconfig.json`、`pyproject.toml`、`requirements.txt`、`Cargo.toml`、`vite.config.*`，提取技术栈、依赖和 scripts。
  - `/init` 需要分析架构与约定，包括源码目录、入口文件、路由层、测试目录，以及 ESLint、Prettier、Black 等格式工具配置。
  - `/init` 需要先生成结构化 `AGENTS.md` 草稿。
  - `/init` 需要先展示草稿供用户确认；存在旧 `AGENTS.md` 时优先增量改进，而不是静默覆盖。

[Init-deep 分层 AGENTS]
- Date: 2026-05-28
- Context: 用户定义 `/init-deep` 的目录级 AGENTS.md 产出方式时
- Instructions:
  - `/init-deep` 需要在关键目录生成多个 `AGENTS.md`，利用目录就近加载机制提供按需上下文。
  - 根目录 `AGENTS.md` 保持极简，只保留技术栈总览和全局规则，控制在约 50 到 150 行。
  - `src/`、`src/api/`、`src/components/`、`tests/` 等关键目录需要生成对应的局部 `AGENTS.md`，写入该层专属约定。
  - 只有在目录具备独立职责和稳定约定时，才生成该目录下的局部 `AGENTS.md`。
  - 局部 `AGENTS.md` 负责承载该目录的职责、导入规范、错误处理、鉴权、UI 约定、测试约定等就近规则，避免把根文件撑大。

[避免编译测试]
- Date: 2026-05-26
- Context: 当前这一轮功能修改期间
- Instructions:
  - 先不要运行编译和测试命令，优先完成代码改动与静态检查。

[项目记忆命令]
- Date: 2026-05-26
- Context: 用户要求加入 /memory 系列命令时
- Instructions:
  - 项目级记忆统一使用 `.monkeycode/MEMORY.md`。
  - `/memory` 命令优先围绕项目级记忆文件提供查看、搜索、摘要和追加能力。

[IDE 集成命令]
- Date: 2026-05-26
- Context: 用户要求加入 /ide 命令时
- Instructions:
  - `/ide` 主入口应面向 VS Code、Cursor、JetBrains 等开发工具接入。
  - 底层 `.sacode/server.json` 查看和 ACP/LSP host/port 设置能力放到 `/ide config`。

[输出风格命令]
- Date: 2026-05-26
- Context: 用户要求加入三种 AI 输出习惯命令时
- Instructions:
  - 输出风格命令名使用 `/outstyle`。
  - `/outstyle` 默认写入用户级配置。
  - 当前项目如需单独覆盖，使用项目级覆盖方式。
  - 输出风格至少支持 concise、explanatory、teaching 三种模式。

[诊断命令]
- Date: 2026-05-26
- Context: 用户要求加入 /doctor 命令时
- Instructions:
  - `/doctor` 用于检查当前项目的 provider、模型、输出风格、MCP、插件和项目记忆是否就绪。

[交互与检查命令]
- Date: 2026-05-26
- Context: 用户要求加入 /vim、/hooks、/keybindings、/diff 命令时
- Instructions:
  - `/vim` 用于切换 Vim 风格导航，默认写用户级配置，并允许项目级覆盖。
  - `/keybindings` 用于展示当前可用快捷键与 Vim 导航状态。
  - `/hooks` 用于展示当前内置 hook 与生命周期点。
  - `/diff` 用于展示当前仓库的 Git 差异摘要。

[TUI 上下文压缩]
- Date: 2026-05-26
- Context: Agent 在执行 `/compress` 命令实现时发现
- Category: 工作流协作
- Instructions:
  - TUI `/compress`：必须调用大模型对当前会话做语义分析和结构化压缩，禁止回退为本地文本拼接或简单格式化。
  - TUI `/compress`：摘要持久化到 `.sacode/sessions/*.json` 的 `summary` 字段，后续任务自动拼接历史摘要 + 最近对话 + 当前请求
  - REPL `/compress`：内存摘要 + `recent_messages`（最近 12 条），后续任务拼接历史摘要 + 最近对话 + 当前请求
  - 执行任务中禁止压缩，避免截断运行状态

[架构审计 P0 阻塞问题]
- Date: 2026-05-28
- Context: Agent 在执行 dev 分支系统性审计时发现
- Category: 排错调试
- Instructions:
  - shell.exec 与 fs.search 在 Windows 上完全失效：`runtime/src/tools/shell/exec.rs:54` 使用 `Command::new("sh")`，`runtime/src/tools/fs/search.rs:57` 使用 `Command::new("grep")`，Windows 上不存在这些命令，需要用 `cfg(target_os)` 分平台处理。
  - 输入框光标定位与多行软换行数学计算存在边缘风险：`layout_input_lines` 每次遍历整串文本重建所有行，`cursor_col` 记录的是 Unicode 宽度累计而非字符列位置，`ui()` 中第一次 `input_inner_width` 与第二次不一致导致高度与内容不匹配。
  - `/loop` 循环任务缺少 `max_iterations` 上限与 `error_count` 失败计数，可能无限循环或连续失败仍续跑。

[架构审计 P1 功能完整性问题]
- Date: 2026-05-28
- Context: Agent 在执行 dev 分支系统性审计时发现
- Category: 排错调试
- Instructions:
  - init 增量更新 AGENTS.md 未保留用户手动修改：`apply_init_draft` 直接 `fs::write` 覆盖文件，`build_init_draft` 只检查文件是否存在决定 `DraftAction::Update` 或 `DraftAction::Create`，但更新时直接覆盖，用户定制内容会丢失。
  - init 扫描逻辑对 `.gitignore` 语义不完整：`load_gitignore_patterns` 只做简单行提取与前后斜杠裁剪，没有通配符展开、否定模式、目录匹配语义，可能扫描过多无关文件或漏掉应跳过的目录。

[架构审计 P2 架构健壮性问题]
- Date: 2026-05-28
- Context: Agent 在执行 dev 分支系统性审计时发现
- Category: 排错调试
- Instructions:
  - 沙箱功能弱：`runtime/src/sandbox/executor.rs` 只是命令白名单检查，没有真正的文件系统隔离（chroot、namespace）、网络隔离、Windows 上无法使用 Unix 特有的安全机制（seccomp、pledge）。
  - SideEffectLevel 与 ApprovalPolicy 对齐良好：`runtime/src/tools/spec.rs` 的 `SideEffectLevel`（ReadOnly/Modify/Execute）与 `kernel/src/execution/approval.rs` 的 `ApprovalPolicy`（Prompt/AutoApprove/AutoDeny）在 `runner.rs` 中正确配合。
  - 文档一致性已对齐：README、AGENTS.md、npm-package/README.md 已去除旧 TS/迁移叙述，聚焦 Rust 实现。

[编程洞察机制]
- Date: 2026-05-26
- Context: Agent 在实现 `/insight` 命令并注入系统提示时发现
- Category: 工作流协作
- Instructions:
  - `/insight` 分析聊天记录生成个性化编程洞察：任务类型、技术栈、常见问题、AI 帮助模式、高频关键词、代码风格偏好、错误处理模式
  - 洞察持久化到 `.sacode/insights.json`，采用累计更新机制（每次运行增量更新）
  - `runner.rs` 的 `build_system_prompt` 自动注入洞察到后续任务的系统提示，让 AI 了解用户偏好
  - CLI：`sacode insight`；REPL/TUI：`/insight`

[用户级 insight 网页]
- Date: 2026-05-27
- Context: 用户要求重构 `/insight` 的产出形式和修复闭环时
- Instructions:
  - `/insight` 需要生成用户级 `.sacode` 下的网页报告，而不是只输出终端文本。
  - 网页报告需要包含统计、习惯说明、洞察结果、优化项、修复指令。
  - 报告生成成功后需要自动打开，方便用户在浏览器中查看和复制修复指令。
  - 修复指令的落点是用户级 `AGENTS.md`、用户级记忆或用户级规则，用于定义哪些行为可以怎样做。
  - 后续项目级协作需要基于这些用户级记忆和规则持续规避问题并学习偏好。

[用户级继承结构]
- Date: 2026-05-27
- Context: 用户要求重新划分 `.sacode` 的用户级与项目级目录时
- Instructions:
  - 用户级 `.sacode` 需要包含 `mcps`、`skills`、`plugin` 等跨项目能力配置。
  - 项目级 `.sacode` 需要继承用户级配置，再叠加当前项目覆盖项。
  - 所有项目的会话归档应放在用户级目录下，项目级只保留当前项目运行态和短期数据。

[分层知识库与持续学习]
- Date: 2026-05-29
- Context: 用户要求在 harness 之上接入 llm wiki 风格的分层知识库时
- Instructions:
  - 需要在 harness 之上支持用户级知识库和项目级知识库的分层加载与覆盖。
  - 后续交互中需要持续沉淀和更新知识库，让系统逐步学习用户习惯和项目约定。

[提示词装配落点]
- Date: 2026-05-29
- Context: Agent 在实现统一 prompt builder 时发现
- Category: 工作流协作
- Instructions:
  - 平台级基础提示词、`AGENTS.md` 摘要读取、`.sacode/prompt.md` 读取、skill prompt 展开放在 `runtime/src/prompt/mod.rs`。
  - CLI `runner.rs` 负责在 runtime 基础 prompt 之后继续拼接 `outstyle` 和 `insight` 这类接口层附加指令。

[P1 功能闭环修复]
- Date: 2026-05-28
- Context: Agent 在执行 P1 功能闭环任务时
- Category: 构建方法
- Instructions:
  - Modal 统一容器：所有弹窗使用 `render_modal_block` 或 `render_relative_modal_block`（包括命令选择器、Skills/MCP/Checkpoint 选择器）。
  - Init `.gitignore` 语义：引入 `ignore = "0.4"` crate 实现完整 gitignore 语义（通配符、否定模式、目录匹配）。
  - AGENTS.md 增量更新：已有文件时读取旧内容，追加到 `## Auto-generated updates` 段落，保留用户手动修改。
  - `/loop` 熔断机制：`LoopState` 增加 `max_iterations=10` 和 `error_count`，连续失败 3 次自动停止，达到上限提示"已达到最大轮次上限"。

[tui.rs 模块拆分与日志确认]
- Date: 2026-05-28
- Context: Agent 在执行代码清理任务时
- Category: 构建方法
- Instructions:
  - tui.rs 巨石文件拆分：创建 `tui/mod.rs`（主模块）和 `tui/input.rs`（输入框逻辑），抽取纯函数 `layout_input_lines`、`is_editable_input_mode`、`display_workdir`。
  - 日志实现确认：`append_raw_log` 已正确记录 stderr 和 JSON 解析错误到 `~/.sacode/logs/tui.log`。
