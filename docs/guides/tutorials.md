# SaCode 场景教程

本文档按真实开发场景组织，帮助你把 SaCode 用到“能解决问题”的程度，而不是只停留在命令记忆层。

## 1. 理解一个陌生仓库

目标：快速弄清楚入口、分层、主要模块和高风险区域。

### 直接问仓库结构

```bash
sacode "解释这个仓库的主要分层、真实入口和高风险模块"
```

### 让它优先看可执行真源

```bash
sacode "先读 Cargo.toml、README、CI 和主入口，再总结这个仓库如何运行"
```

### 在 TUI 中持续追问

```text
/login
/models
```

然后输入：

```text
总结 kernel、runtime、interfaces/cli 的职责边界
```

适合继续追问：

- 哪个文件是真实入口
- 哪条命令最接近 CI
- 哪些目录当前不参与构建

## 2. 定位问题和回归

目标：找到最可能的失败点，并给出最短修复路径。

### 让 SaCode 先做排查

```bash
sacode "定位当前仓库里最可能导致测试失败或回归的问题"
```

### 让它结合当前 diff

```bash
git diff | sacode "根据这份改动判断最可能的回归风险和验证顺序"
```

### 明确让它给验证路径

```bash
sacode "针对这个仓库给我一个最省时的验证顺序，先跑最值钱的检查"
```

如果你已经知道任务范围，直接指定包更有效：

```bash
sacode "只看 runtime 相关改动，帮我判断先跑哪些 sacode-runtime 测试"
```

## 3. 做一次受控改动

目标：让 SaCode 改代码，但保持可控。

### 用 `build` 模式做常规修改

```bash
sacode "修复当前 TUI 中与 /models 相关的交互问题" --mode build
```

适合：

- 改代码
- 跑必要验证
- 保留审批节点

### 用 `plan` 模式先看方案

```bash
sacode "设计一套改进 AGENTS.md 生成流程的方案" --mode plan
```

适合：

- 先看任务拆解
- 先看潜在影响面
- 先看验证建议

### 用 `yolo` 做高确定性批处理

```bash
sacode "批量整理这个仓库的 Markdown 文档标题层级" --mode yolo
```

适合：

- 格式化
- 明确范围的小改动
- 用户已确认的自动化任务

## 4. 用 TUI 跑多轮任务

目标：在一个会话里连续做分析、修改、验证和追问。

### 关键快捷键

- `Ctrl+Q`：退出
- `Esc`：清空输入或取消当前执行
- `Ctrl+T`：开启或关闭思考功能
- `Ctrl+M`：切换 `plan` / `build` / `yolo`

### 常用命令

- `/connect`：快速接入 Provider
- `/models`：选择模型
- `/doctor`：检查配置是否就绪
- `/status`：查看 MCP 与插件状态
- `/memory`：查看或写入分类记忆
- `/wiki`：查看知识库加载状态
- `/loop <task>`：循环执行直到完成或熔断
- `/cancel`：取消当前任务

### 典型流程

1. `/doctor`
2. `/models`
3. 提交任务
4. 根据输出继续追问
5. 用 `/memory append ...` 记录稳定结论

## 5. 使用项目知识和分类记忆

目标：把可复用的偏好、流程、决策沉淀下来。

### 查看当前项目记忆

```bash
sacode memory show
```

### 查看摘要

```bash
sacode memory summary
```

### 搜索已有结论

```bash
sacode memory search TUI
```

### 追加一条流程类记忆

```bash
sacode memory append "发布前按 cargo test --workspace -> cargo build --release -> node scripts/check-release.js 顺序验证" --type workflow
```

### 写入用户级记忆

```bash
sacode memory append "默认回答保持简洁" --type preference --global
```

### 查看 wiki 加载状态

```bash
sacode wiki
```

`/wiki` 会显示：

- 用户级知识源
- 项目级知识源
- 会话级知识源
- 当前是否已加载摘要

## 6. 初始化一个项目

目标：给新仓库或文档薄弱仓库补齐基础协作上下文。

### 轻量初始化

```bash
sacode init
```

会做的事：

- 扫描项目结构
- 生成或更新根 `AGENTS.md`
- 初始化 `.sacode/` 基础文件

### 深度初始化

```bash
sacode init-deep
```

适合：

- 需要更完整的协作约束
- 需要工作流和 MCP 模板
- 需要目录级 AGENTS 草稿

## 7. 提交前自检

目标：让 SaCode 帮你把验证顺序和风险说明整理清楚。

### 让它给验证顺序

```bash
sacode "根据这个仓库的 CI 规则，告诉我这次改动最合适的验证顺序"
```

### 让它总结当前改动

```bash
git diff | sacode "总结这次改动的核心变化、风险点和建议测试"
```

### 让它生成提交说明

```bash
git diff | sacode "根据改动生成一条简洁的 commit message"
```

## 8. 检查本地环境是否可用

目标：先确认 Provider、模型、MCP、wiki、插件等是否已到位。

### 诊断配置

```bash
sacode doctor
```

`doctor` 当前会检查：

- Provider
- 默认模型
- 模型路由覆盖数
- 输出风格
- 项目级 wiki 记忆
- 插件状态
- MCP 状态

### 查看当前状态

```bash
sacode status
```

`status` 会：

- 自动补默认的 `context7` MCP
- 展示 MCP 连通性
- 展示插件启用状态

## 9. 升级 SaCode

### 检查新版本

```bash
sacode update --check
```

### 直接升级

```bash
sacode update
```

### 强制重新安装

```bash
sacode update --force
```

底层使用的是：

```bash
npm install -g @cherishron/sacode@latest
```

## 10. 相关文档

- [快速上手](getting-started.md) — 安装与基本配置
- [示例集](examples.md) — 可复制的命令组合
- [命令参考](../reference/command-reference.md) — 完整 CLI / TUI 命令速查
- [架构说明](../reference/architecture.md) — 分层与执行链路
- [产品路线图](../product/roadmap.md) — 当前能力与演进方向
