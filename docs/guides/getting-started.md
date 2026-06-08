# SaCode 快速上手

本文档面向第一次接触 SaCode 的开发者，目标是帮助你在几分钟内完成安装、配置和第一次任务执行。

## 1. 安装

```bash
npm install -g @cherishron/sacode
sacode --version
```

当前支持平台：

- Linux x64
- Windows x64

## 2. 启动方式

### 默认 TUI

```bash
sacode
```

### REPL

```bash
sacode repl
```

### 单次任务

```bash
sacode "分析当前仓库的架构边界"
```

## 3. 配置 Provider

### 交互式配置

在 TUI 或 REPL 中输入：

```text
/login
```

按提示填写：

1. Base URL
2. API Key

示例 Base URL：

- `https://api.openai.com/v1`
- `https://api.deepseek.com/v1`
- `http://127.0.0.1:11434/v1`

### 快速接入预设 Provider

```text
/connect
```

适合快速配置 OpenAI、DeepSeek、Ollama 等预设。

## 4. 选择模型

```text
/models
```

`/models` 会展示所有已配置 provider 的模型。确认后会同时切换：

1. 当前 provider
2. 当前默认 model

## 5. 执行模式

### `plan`

```bash
sacode "设计一套缓存失效策略" --mode plan
```

适合设计、审查、拆任务。

### `build`

```bash
sacode "修复当前测试失败" --mode build
```

适合日常改代码任务。修改类动作会请求审批。

### `yolo`

```bash
sacode "批量格式化这个仓库" --mode yolo
```

适合明确、低风险、可重复任务。

## 6. TUI 常用命令

### 快捷键

- `Ctrl+Q`：退出
- `Esc`：清空输入或取消当前执行
- `Ctrl+T`：开启或关闭 thinking
- `Ctrl+M`：切换 `plan` / `build` / `yolo`

### 常用斜杠命令

- `/login`
- `/connect`
- `/providers`
- `/models`
- `/memory`
- `/wiki`
- `/loop <task>`
- `/insight`

## 7. 常见工作流

### 代码理解

```bash
sacode "解释 runtime 和 kernel 的职责边界"
```

### 问题定位

```bash
sacode "定位当前仓库里最可能导致回归的改动点"
```

### 提交说明

```bash
git diff | sacode "根据改动生成提交说明"
```

### 项目初始化

```bash
sacode init
sacode init-deep
```

## 8. 运行数据位置

项目根目录下的 `.sacode/` 保存运行配置与任务数据：

```text
.sacode/
├── provider.json
├── mcp.json
├── profile.json
├── mistakes.json
├── project.json
├── skills/
└── checkpoints/
```

## 9. 下一步阅读

- [命令速查](../reference/command-reference.md) — CLI / TUI 所有命令
- [场景教程](tutorials.md) — 按真实任务使用 SaCode
- [示例集](examples.md) — 可直接复制的命令组合
- [架构说明](../reference/architecture.md) — 分层与执行链路
- [API 文档](../reference/API.md) — 工具系统、Daemon、MCP 接口
- [开发指南](../reference/development.md) — 本地开发与贡献
