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
- Category: [代码结构|代码模式|代码生成|构建方法|测试方法|依赖关系|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[SaCode CLI 产品形态]
- Date: 2026-05-14
- Context: 用户澄清 SaCode 后续入口形态和部署方式
- Instructions:
  - SaCode 的最终产品形态是“可部署的 Agent CLI Server”：CLI 是主程序、控制面和执行器，不只是本地终端工具。
  - 当前阶段优先确保 CLI 核心功能可靠可用；Web 管理、微信入口、Webhook/API 等外部接入能力后续再扩展。
  - CLI 后续应内置或配套 Web 管理能力，并可通过 `sacode serve` 作为服务器工具运行。
  - 微信等外部入口应通过配置接入并调用 CLI 工具能力，让用户可以在微信对话窗口指挥 CLI 工作。
  - 后续设计要兼容“终端输入命令”和“外部入口输入命令/自然语言”两种使用方式，且所有入口必须共用同一套权限、审计和工具执行边界。
  - 外部入口配置应走正常服务/API/Webhook/Adapter 方式，不把当前 Agent 环境当作隧道或中转节点。

[Provider 与 Agent 配置模型]
- Date: 2026-05-14
- Context: 用户澄清 API 接入、模型配置和多 Agent 协作方向
- Instructions:
  - Provider/API 接入不应以硬编码默认厂家为中心，而应做成可自定义的数据配置。
  - 配置层级应支持“厂家/Provider -> 接入方式（如 OpenAI-compatible）-> 模型列表”，同一接入下可配置多个模型。
  - CLI 需要支持切换不同 Provider、接入方式和模型，并支持对模型进行一键测试。
  - 后续需要支持多 Agent 协作，类似 oh-my-openagent，可为不同 Agent 配置不同模型和能力。
  - 后续需要支持子 Agent 启动、调度和协作，让不同 Agent 使用不同模型处理不同任务。

[Agent CLI Shell 入口模型]
- Date: 2026-05-14
- Context: 用户澄清核心交互方式不是传统多级子命令，而是进入 CLI 后用 slash commands 和自然语言交互
- Instructions:
  - `sacode` 默认应进入交互式 Agent CLI Shell，而不是只打印帮助。
  - Agent CLI Shell 内部需要支持 `/models`、`/providers`、`/agents`、`/doctor`、`/tools`、`/context` 等 slash commands，也支持自然语言任务。
  - `sacode xxx xxx` 传统子命令仍可保留给脚本、自动化、部署诊断，但不是核心交互体验。
  - 未来微信/Web/HTTP 外部入口应复用同一套 slash command router，让微信对话窗口和 CLI Shell 具备一致语义。
  - 后续开发每完成一个大项后，应先分析下一个开发项，向用户询问是否合理并确认开始开发，再继续实施。

[禁止占位式实现]
- Date: 2026-05-14
- Context: 用户要求完整实现已提及能力，不接受占位信息
- Instructions:
  - 后续开发不允许用“占位信息”“后续接入”“待实现”等文案替代实际功能。
  - 如果某能力暂时不能完整做，应明确拆分为可运行的最小闭环，而不是返回敷衍占位。
  - 已暴露到 CLI Shell、文档或命令列表中的功能必须至少具备真实可用的最小实现。

[SaCode 配置与 Agent 实现要求]
- Date: 2026-05-14
- Context: 用户要求继续实现 CLI 配置、多 Agent 和语言配置
- Instructions:
  - 后续回复不要重复提起已经完成的部分，除非用户明确询问历史进展。
  - CLI 命令应统一使用小写 `sacode`。
  - 不保留或依赖项目 `.env` 作为主要配置方式；模型、Provider、Agent、语言等配置应写入 npm 安装后用户级配置路径。
  - 多 Agent 协作和子 Agent 调度需要实现，并且应支持开启或关闭。
  - 交互语言需要可配置并持久化。
