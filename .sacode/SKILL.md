---
name: pciv-workflow
description: PCIV 结构化开发工作流 - Prime（准备）、Clarify（澄清）、Implement（实施）、Validate（验证）四阶段人机协同开发流程，支持技术栈自动识别、错题本机制、自我验证反馈循环。
license: MIT
version: 2.0.0
author: Javisk Team
tags: [workflow, development, pciv, quality-assurance, human-centric, mistake-learning]
categories: [development, workflow, quality]
homepage: https://github.com/javisk/pciv-workflow
repository: https://github.com/javisk/pciv-workflow
icon: 🔄
compatibleWith:
  iflow-cli: ">=1.0.0"
  claude-code: ">=1.0.0"
triggers:
  - type: command
    patterns: ["/pciv", "/pciv-prime", "/pciv-clarify", "/pciv-implement", "/pciv-validate", "/pciv-check", "/pciv-status"]
  - type: keyword
    patterns: ["PCIV", "Prime Clarify Implement Validate", "开始 PCIV"]
config:
  techStack: "auto"
  language: "zh-CN"
  strictMode: false
  autoValidate: true
---

# PCIV 工作流 - 结构化开发工作流

## 概述

PCIV 工作流是基于 Javisk 开发方法论的人工主导结构化开发流程，通过 **Prime（准备）→ Clarify（澄清）→ Implement（实施）→ Validate（验证）** 四阶段循环，确保代码质量和可控性。

### 核心特点

- **人工主导** - 每个关键步骤都需要确认和决策
- **技术栈无关** - 自动识别项目技术栈，适配多种开发环境
- **渐进式实现** - 一次只做一个变更，完成后立即验证
- **错题本机制** - 记录错误、沉淀知识、避免重复犯错
- **自我验证循环** - 即时质量反馈，持续改进

### 适用场景

- 任务复杂度高，需要深度理解
- 涉及架构设计或重大决策
- 需要频繁调整方向
- 对代码质量有极高要求
- 需要学习和探索新技术
- 跨技术栈项目开发

### 核心理念

1. **人机协同** - AI 作为智能助手，辅助而非替代人类开发者
2. **质量优先** - 生成的代码必须经过严格审查和测试
3. **技术栈无关** - 适配任何技术栈，不绑定特定框架
4. **知识沉淀** - 从错误中学习，持续积累经验
5. **可追溯性** - 所有决策和代码变更都有清晰的记录

## 工作流结构

### PCIV 四阶段循环

```
    ┌─────────────┐
    │   Prime     │  ← 准备阶段：理解上下文、定义范围
    │  (准备)     │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   Clarify   │  ← 澄清阶段：需求确认、风险识别
    │  (澄清)     │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │  Implement  │  ← 实现阶段：按计划执行任务
    │  (实施)     │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   Validate  │  ← 验证阶段：全面质量检验
    │  (验证)     │
    └──────┬──────┘
           │
           ├────► 完成交付
           │
           └────► 循环迭代
```

### 阶段说明

#### Prime 阶段（准备）

**目标**：理解项目上下文、定义功能范围、制定初步计划

**关键步骤**：
1. **加载项目文档** - 读取 IFLOW.md、README.md、架构文档
2. **技术栈识别** - 自动检测项目配置文件，识别技术栈
3. **理解需求** - 分析用户需求描述
4. **定义范围** - 确定功能点粒度（小/中/大）
5. **制定计划** - 生成初步实施计划
6. **识别风险** - 初步风险评估

**产出**：
- 技术栈识别报告
- 需求理解文档
- 功能范围定义
- 初步实施计划
- 风险清单

#### Clarify 阶段（澄清）

**目标**：确认需求细节、消除歧义、完善方案

**关键步骤**：
1. **审查 Prime 产出** - 验证初步计划的合理性
2. **识别歧义** - 找出需求中的模糊点和未定义项
3. **结构化提问** - 通过标准化问题澄清需求
4. **技术方案确认** - 确定最终技术实现方案
5. **任务分解** - 将计划分解为可执行任务
6. **获得确认** - 用户确认后进入实施

**产出**：
- 澄清问答记录
- 技术方案决策
- 详细任务清单
- 更新后的风险评估

#### Implement 阶段（实施）

**目标**：按照计划逐步实现功能，确保每个步骤的质量

**关键步骤**：
1. 查看当前任务状态
2. 选择下一个待办任务
3. 使用适当工具完成该任务
4. **即时自我验证** - 类型检查、代码风格检查
5. 更新任务状态
6. 重复直到所有任务完成

**产出**：
- 完成的功能实现
- 更新的任务状态
- 同步的文档更新

#### Validate 阶段（验证）

**目标**：全面验证实现质量，确保符合标准和需求

**关键步骤**：
1. 类型检查
2. 代码风格验证
3. 功能测试
4. 集成测试
5. 构建验证
6. 文档完整性检查

**产出**：
- 验证报告
- 测试结果
- 问题清单（如有）
- 错题记录建议

### 阶段转换检查点

```
Prime ───────────────────► Clarify
    │  ✅ 项目上下文已加载
    │  ✅ 技术栈已识别
    │  ✅ 需求已理解
    │  ✅ 功能范围已定义
    │  ✅ 初步计划已制定
    
Clarify ─────────────────► Implement
    │  ✅ 所有歧义已澄清
    │  ✅ 技术方案已确认
    │  ✅ 任务清单已分解
    │  ✅ 用户已确认计划
    
Implement ───────────────► Validate
    │  ✅ 所有任务已完成
    │  ✅ 自测已通过
    │  ✅ 代码已提交
    │  ✅ 文档已更新
    
Validate ────────────────► 完成 / 循环
    │  完成：所有验证项通过
    │  循环：
    │    类型错误 → Implement
    │    需求偏差 → Clarify
    │    设计问题 → Prime
```

## Slash 命令

### 阶段命令

| 命令 | 描述 |
|------|------|
| `/pciv-prime` | 启动 Prime 阶段，加载上下文、识别技术栈 |
| `/pciv-clarify` | 启动 Clarify 阶段，澄清需求、确认方案 |
| `/pciv-implement` | 启动 Implement 阶段，执行任务 |
| `/pciv-validate` | 启动 Validate 阶段，全面验证 |

### 质量检查命令

| 命令 | 描述 |
|------|------|
| `/pciv-check [type]` | 快速质量检查（all/type/lint/test/security） |
| `/pciv-fix [auto]` | 自动修复可修复的问题 |
| `/pciv-review [file]` | 代码审查（基于错题本和最佳实践） |

### 状态管理命令

| 命令 | 描述 |
|------|------|
| `/pciv-status` | 查看当前工作流状态和进度 |
| `/pciv-continue` | 继续上一个未完成的任务 |

### 上下文管理命令

| 命令 | 描述 |
|------|------|
| `/pciv-context` | 重新加载项目上下文 |
| `/pciv-tech-check` | 技术栈检测和显示 |

### 错题本/知识库命令

| 命令 | 描述 |
|------|------|
| `/pciv-mistake` | 记录新的错题 |
| `/pciv-knowledge` | 查看知识库 |

## 使用方法

### 快速开始

1. **开始 Prime 阶段**
```
/pciv-prime

# 或使用自然语言
"开始 PCIV 工作流，我需要实现文章搜索功能"
```

2. **进入 Clarify 阶段**
```
/pciv-clarify

# AI 会自动识别歧义并提出澄清问题
```

3. **执行 Implement 阶段**
```
/pciv-implement

# 按任务列表逐步实现
```

4. **执行 Validate 阶段**
```
/pciv-validate

# 全面验证后输出报告
```

### 使用模板

```
# 加载特定阶段模板
@templates/prime-phase.md
@templates/clarify-phase.md
@templates/implement-phase.md
@templates/validate-phase.md

# 加载检查清单
@templates/checklist.md

# 加载阶段转换检查点
@templates/phase-transition.md
```

### 查看示例

```
# 加载示例场景
@examples/blog-search.md
@examples/api-development.md
@examples/frontend-component.md
```

## 错题本机制

### 触发时机

1. **Validate 阶段发现错误** - 类型检查失败、测试失败、构建失败
2. **Implement 阶段遇到阻塞** - 同一问题尝试超过 2 次仍未解决
3. **Clarify 阶段发现理解偏差** - 用户反馈与预期不符
4. **用户主动记录** - 使用 `/pciv-mistake` 命令

### 错题记录内容

- 错误现象和错误信息
- 根因分析（直接原因 + 根本原因）
- 解决方案（即时修复 + 根本解决）
- 预防措施（流程层面 + 文档层面）
- 文档更新清单

### 知识沉淀

错题自动提炼为知识点，经用户确认后加入知识库：
- 经验教训总结
- 最佳实践沉淀
- 反模式警示

## 自我验证机制

### 双模式验证

**模式一：即时验证（自动触发）**
- 每次代码变更后自动运行
- TypeScript 类型检查
- ESLint 代码风格检查
- 基础语法验证

**模式二：手动触发**
- `/pciv-check` - 完整质量检查
- `/pciv-check type` - 仅类型检查
- `/pciv-check lint` - 仅代码风格检查
- `/pciv-check test` - 运行测试
- `/pciv-check security` - 安全漏洞扫描

### 反馈循环

```
代码变更 → 即时验证 → 反馈结果
              ↓
         ┌────┴────┐
         ↓         ↓
      通过      有问题
         │         │
         ↓         ↓
      继续    生成修复建议
      开发         │
                   ↓
              自动/手动修复
                   │
                   ↓
              记录到错题本
```

## iFlow 命令映射

### 通用命令

| 操作 | iFlow 命令 | 示例 |
|------|-----------|------|
| 文件引用 | @文件路径 | `@IFLOW.md` |
| 命令执行 | !命令 | `!npx tsc --noEmit` |
| 自然语言 | 直接输入 | `"帮我检查类型错误"` |

### Prime 阶段

| 操作 | 示例 |
|------|------|
| 加载项目上下文 | `@IFLOW.md` `@README.md` |
| 技术栈检测 | `/pciv-tech-check` |
| 明确需求 | `"我需要实现搜索功能"` |

### Clarify 阶段

| 操作 | 示例 |
|------|------|
| 提出澄清问题 | `"请列出需要确认的问题"` |
| 确认技术方案 | `"确认使用 MySQL 全文索引"` |
| 任务分解 | `"请分解为具体任务"` |

### Implement 阶段

| 操作 | 示例 |
|------|------|
| 查看任务状态 | `/pciv-status` |
| 执行任务 | `"开始实现搜索 API"` |
| 即时验证 | `/pciv-check type` |

### Validate 阶段

| 操作 | 示例 |
|------|------|
| 类型检查 | `!npx tsc --noEmit` |
| 代码风格 | `!npx eslint .` |
| 运行测试 | `!npm test` |
| 构建验证 | `!npm run build` |

## 最佳实践

### Prime 阶段

1. 充分理解需求和上下文
2. 让系统自动识别技术栈
3. 明确定义功能范围和粒度
4. 初步评估潜在风险

### Clarify 阶段

1. 主动提出澄清问题
2. 确认技术方案的可行性
3. 详细分解任务
4. 获得用户明确确认后再进入实施

### Implement 阶段

1. 渐进式实现，小步快跑
2. 每次变更后运行即时验证
3. 使用专用工具而非 shell 命令
4. 及时更新任务状态和文档

### Validate 阶段

1. 全面验证所有检查项
2. 问题记录到错题本
3. 更新相关文档
4. 提炼知识点

## 技术栈识别

### 自动检测的配置文件

| 类型 | 检测文件 | 识别内容 |
|------|----------|----------|
| Node.js 前端 | package.json | React/Vue/Angular/Svelte |
| 元框架 | package.json | Next.js/Nuxt/SvelteKit |
| Python | requirements.txt, pyproject.toml | Django/FastAPI/Flask |
| Go | go.mod | Go 项目 |
| Rust | Cargo.toml | Rust 项目 |
| 数据库 | schema 文件 | PostgreSQL/MySQL/MongoDB |
| ORM | 配置文件 | Prisma/TypeORM/SQLAlchemy |
| 样式 | 配置文件 | Tailwind/CSS-in-JS/Sass |

### 技术栈参考模板

识别到技术栈后，自动加载对应的参考模板：
- `resources/tech-stack-templates/nextjs.md`
- `resources/tech-stack-templates/react.md`
- `resources/tech-stack-templates/vue.md`
- `resources/tech-stack-templates/python.md`
- 更多模板持续扩展中...

## 限制和注意事项

1. **学习曲线** - PCIV 工作流需要一定的学习成本
2. **开发速度** - 相比传统开发，PCIV 模式开发速度较慢
3. **适用场景** - 不适合简单的任务或原型开发
4. **依赖环境** - 需要 iFlow CLI 或兼容平台支持

## 目录结构

```
pciv-workflow/
├── SKILL.md                    # 本文件
├── AGENTS.md                   # AI 助手上下文
├── README.md                   # 项目说明
│
├── .iflow/                     # iFlow 适配层
│   ├── IFLOW.md               # iFlow 标准入口
│   ├── agents/                # 智能体配置
│   ├── commands/              # Slash 命令定义
│   └── settings.json          # 配置文件
│
├── adapters/                   # 多平台适配层
│   ├── claude-code/           # Claude Code 适配
│   └── cursor/                # Cursor IDE 适配
│
├── templates/                  # 工作流模板
│   ├── prime-phase.md
│   ├── clarify-phase.md
│   ├── implement-phase.md
│   ├── validate-phase.md
│   ├── phase-transition.md
│   ├── task-tracker.md
│   ├── mistake-record.md
│   └── self-validation.md
│
├── examples/                   # 实践示例
│
├── resources/                  # 参考资源
│   ├── best-practices.md
│   ├── commands-mapping.md
│   ├── terminology.md
│   └── tech-stack-templates/
│
└── docs/                       # 文档
    └── pciv-status/           # 状态持久化
        ├── mistake-book/      # 错题本
        └── knowledge-base/    # 知识库
```

## 版本历史

### v2.0.0 (2026-02-16)

- **重大更新**：PIV 升级为 PCIV 四阶段工作流
- 新增 Clarify 澄清阶段
- 新增技术栈自动识别功能
- 新增错题本机制和知识沉淀
- 新增自我验证双模式
- 新增完整 Slash 命令集
- 技术栈无关化设计
- 多平台适配层

### v1.0.0 (2026-01-21)

- 初始版本发布
- 支持 PIV 三阶段工作流
- 提供完整的模板和示例

## 许可证

MIT License - 详见 [LICENSE.txt](./LICENSE.txt)

## 贡献

欢迎贡献！请提交 Issue 或 Pull Request。

## 联系方式

- 项目主页：https://github.com/javisk/pciv-workflow
- 问题反馈：https://github.com/javisk/pciv-workflow/issues
