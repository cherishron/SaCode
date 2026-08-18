# SaCode 速查手册（Cheat Sheet）

> 更新时间：2026-08-18
> 改进说明：原 tutorials.md 为长篇场景教程（步骤 1-6 每步多子步骤），基于评估报告维度四建议改为 cheat sheet 风格快速参考。详细场景仍可参考 [examples.md](examples.md)。

本文档提供按场景分类的命令与提示词速查，复制即用。

---

## 1. 启动方式

| 方式 | 命令 | 适用场景 |
|------|------|----------|
| TUI（默认） | `sacode` | 交互式开发 |
| REPL | `sacode repl` | 轻量交互 |
| 单次任务 | `sacode "任务描述"` | 脚本/管道 |
| 指定模式 | `sacode "任务" --mode plan\|build\|yolo` | 按风险控制 |
| 指定模型 | `sacode "任务" --model gpt-4` | 切换模型 |

---

## 2. 仓库理解

```bash
# 整体概览
sacode "总结这个仓库的真实入口、主要分层和当前高风险模块"

# 要求先读关键文件
sacode "先读 Cargo.toml、README、CI workflow 和主入口，再解释仓库如何运行"

# 聚焦某目录
sacode "只看 runtime/src/agents，解释这一层现在负责什么"

# 聚焦某模块边界
sacode "详细说明 kernel、runtime、interfaces/cli 的职责边界和依赖关系"

# 找关键路径
sacode "这个仓库最重要的代码路径是什么？如果只读 5 个文件，应该读哪 5 个？"

# 了解测试覆盖
sacode "这个仓库的测试覆盖情况如何？哪些核心功能缺少测试？"
```

---

## 3. 风险分析

```bash
# 找回归点
sacode "找出当前仓库最容易引发回归的模块，并说明原因"

# 结合 diff 看风险
git diff | sacode "根据这份改动指出最可能的风险点和建议验证顺序"

# 聚焦某包的验证路径
sacode "如果改动只影响 sacode-runtime，建议我先跑哪些测试"

# 最省时验证顺序
sacode "根据这个仓库的 CI 规则，给我最合理的本地验证顺序"
```

---

## 4. 方案设计（plan 模式）

```bash
# 设计方案
sacode "设计一套改进 TUI 任务状态流转的方案" --mode plan

# 最小改动路径
sacode "为这个问题给出最小可行修复路径，尽量少改文件" --mode plan

# 附验证顺序
sacode "给这个方案附上建议验证顺序，按性价比排序" --mode plan

# 代码审查
sacode "审查当前分支的改动，评估是否可以合并" --mode plan

# 性能优化建议
sacode "分析这个仓库的性能瓶颈，给出优化建议" --mode plan
```

---

## 5. 代码修改（build 模式）

```bash
# 受控修改
sacode "修复当前 /models 选择后 provider 和 model 不同步的问题" --mode build

# 指定只改一小块
sacode "只修改 interfaces/cli/src/tui 相关文件，修复输入框光标定位问题" --mode build

# 重构
sacode "重构 runtime/src/tools/code/symbol.rs 中的缓存逻辑" --mode build

# 添加功能
sacode "为 /memory 命令添加删除功能" --mode build
```

**审批策略**：
- 默认：每个修改动作需确认
- `--approve`：跳过部分确认
- `--deny`：拒绝所有修改

---

## 6. 批处理（yolo 模式）

```bash
# 批量格式化
sacode "批量格式化这个仓库的所有 Rust 代码" --mode yolo

# 文档标准化
sacode "批量整理 docs 目录下的 Markdown 文档标题层级" --mode yolo

# 清理无用代码
sacode "删除所有注释掉的代码块" --mode yolo
```

> ⚠️ yolo 模式自动执行无需确认，使用前建议先在 plan 模式查看影响范围。
>
> 改进说明：`yolo` 将重命名为更严肃名称（如 `auto`/`full`），详见 [report-plan.md](../report-plan.md) 步骤 4.5。

---

## 7. 管道模式（Ghost 模式）

```bash
# 总结文件
cat README.md | sacode "总结这个文件的主要信息"

# 总结 Git 差异
git diff | sacode "总结这次改动做了什么，重点说为什么"

# 生成提交信息
git diff | sacode "根据改动生成一条简洁准确的 commit message" | git commit -F -

# 找 bug
cat main.rs | sacode "找 bug"

# 看目录结构
ls -la | sacode "根据目录输出判断这个项目的主要结构和用途"
```

---

## 8. 提交前检查

```bash
# 1. 运行诊断
sacode doctor          # CLI
# 或 TUI 内
/doctor

# 2. 查看改动摘要
git diff | sacode "总结这次改动的核心变化"

# 3. 获取验证建议
sacode "根据这个仓库的 CI 规则，给我最合理的本地验证顺序"

# 4. 执行验证
cargo test --workspace
cargo build --release

# 5. 风险检查
git diff | sacode "指出这次改动可能的风险点"

# 6. 生成提交说明
git diff | sacode "根据改动生成一条简洁准确的 commit message"
```

---

## 9. TUI 常用命令速查

### 一级命令（必须知道）

| 命令 | 用途 |
|------|------|
| `/login` | 配置 Provider |
| `/models` | 管理模型 |
| `/mode` | 切换 plan/build/yolo |
| `/agents` | 多 Agent 编排 |
| `/help` | 上下文感知帮助 |

### 二级命令（按需发现）

| 命令 | 用途 |
|------|------|
| `/connect` | 快速接入预设 Provider |
| `/providers` | Provider 管理 |
| `/memory` | 项目记忆管理 |
| `/wiki` | 知识库管理 |
| `/loop` | 循环执行 |
| `/checkpoint` | 检查点管理 |
| `/doctor` | 诊断 |
| `/status` | 状态查看 |
| `/insight` | 项目洞察 |
| `/skills` | Skills 管理 |
| `/mcp` | MCP 管理 |
| `/tasks` | 任务管理 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Q` | 退出 |
| `Esc` | 清空输入 / 取消 |
| `Ctrl+T` | 开关思考过程 |
| `Ctrl+M` | 切换执行模式 |

---

## 10. 记忆与知识库

```text
# 查看记忆
/memory

# 添加记忆
/memory append "重要信息" --type memory
/memory append "发布前按 cargo test -> cargo build -> node scripts/check-release.js 顺序验证" --type workflow
/memory append "默认回答保持简洁" --type preference
/memory append "这个功能采用方案 A 而不是方案 B，因为..." --type decision

# 搜索记忆
/memory search 缓存

# 添加全局记忆
/memory append "默认回答保持简洁" --type preference --global

# 知识库
/wiki                    # 查看状态
/wiki refresh            # 刷新
/wiki path               # 查看路径
```

**记忆类型**：`memory`（通用）、`preference`（偏好）、`workflow`（工作流程）、`decision`（决策）

> 改进说明：规划方案步骤 4.2 将知识系统 9 文件分类合并为 3 文件（project.md / experience.md / preferences.md），详见 [report-plan.md](../report-plan.md)。

---

## 11. 检查点（断点续传）

```text
# 创建
/checkpoint save my-checkpoint

# 查看
/checkpoint list

# 恢复
/checkpoint restore checkpoint-20250108-143022

# 清理
/checkpoint clean
```

---

## 12. 项目初始化

```bash
# 轻量初始化
cd /path/to/your/project
sacode init

# 深度初始化（可选，生成目录级 AGENTS.md + 工作流模板）
sacode init-deep

# 配置 Provider
sacode
/login

# 提交初始配置
git add AGENTS.md .sacode/
git commit -m "chore: 初始化 SaCode 项目配置"
```

---

## 13. 循环执行（/loop）

```text
# 基本用法
/loop 完成这个功能的实现

# 熔断条件
# - 最大迭代次数（默认 10）
# - 连续失败次数（默认 3）
# - 用户手动取消

# 取消
/cancel
```

> 改进说明：规划方案步骤 4.1 将 Loop 四层自治架构轻量化为 `/goal <完成条件>`，对齐 Claude Code，详见 [report-plan.md](../report-plan.md)。

---

## 14. 模型选择建议

| 任务类型 | 推荐模型 | 原因 |
|----------|----------|------|
| 代码分析、重构、设计 | `gpt-4`、`deepseek-coder` | 代码理解能力强 |
| 日常问答、文档生成 | `gpt-3.5-turbo`、`deepseek-chat` | 响应快、成本低 |
| 大型任务、复杂推理 | `gpt-4`、`gpt-4o` | 推理能力最强 |
| 本地开发、隐私敏感 | Ollama 本地模型 | 数据不离开本机 |

---

## 15. 配置文件速查

| 文件 | 用途 | 位置 |
|------|------|------|
| `provider.json` | TUI/REPL 交互配置 | `~/.sacode/`、`.sacode/` |
| `config.json` | 任务执行配置（`sacode "<task>"` 读取） | 同上 |
| `mcp.json` | MCP 服务配置 | `.sacode/` |
| `profile.json` | 模型配置组合 | `~/.sacode/`、`.sacode/` |
| `mistakes.json` | 错题本 | `.sacode/` |
| `audit.log` | 沙箱审计日志（企业可审计） | `.sacode/` |

---

## 16. 常见问题速查

| 问题 | 解决方案 |
|------|----------|
| 输出太泛泛 | 明确要求先读关键文件，指定分析角度 |
| 不相关内容多 | 明确分析范围，要求聚焦核心 |
| 缺少实际例子 | 要求提供具体代码片段和调用链 |
| `command not found` | npm 全局路径不在 PATH |
| `Failed to connect` | 检查 Base URL、网络、代理 |
| `Authentication failed` | API Key 错误或过期，重新 `/login` |
| `Rate limit exceeded` | 等待重试或切换 provider |

---

## 相关文档

- [快速上手](getting-started.md) — 30 秒到 5 分钟渐进路径
- [示例集](examples.md) — 可复制命令组合
- [命令参考](../reference/command-reference.md) — 完整命令速查
- [API 文档](../reference/API.md) — 工具系统、Daemon、MCP 接口
- [架构说明](../reference/architecture.md) — 分层与执行链路
- [PRD](../product/PRD.md) — 产品定位与能力全景
- [路线图](../product/roadmap.md) — 版本阶段与交付计划
- [可行性评估报告](../report.md) → [改进规划方案](../report-plan.md)
