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
  - TUI `/compress`：摘要持久化到 `.sacode/sessions/*.json` 的 `summary` 字段，后续任务自动拼接历史摘要 + 最近对话 + 当前请求
  - REPL `/compress`：内存摘要 + `recent_messages`（最近 12 条），后续任务拼接历史摘要 + 最近对话 + 当前请求
  - 执行任务中禁止压缩，避免截断运行状态

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
