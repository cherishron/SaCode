# /pciv-context

重新加载项目上下文。

## 描述

重新读取项目文档、配置文件，刷新 AI 对项目的理解。适用于项目结构变化或上下文丢失时。

## 用法

```
/pciv-context [scope]
```

### 参数

| 参数 | 描述 |
|------|------|
| `all` | 加载所有上下文（默认） |
| `docs` | 仅加载文档 |
| `config` | 仅加载配置 |
| `tech` | 仅刷新技术栈信息 |

## 执行流程

### 1. 文档加载

读取项目文档：
- IFLOW.md / README.md
- docs/ 目录下的文档
- 架构设计文档

### 2. 配置加载

读取项目配置：
- package.json / requirements.txt
- tsconfig.json
- eslint 配置
- prettier 配置

### 3. 技术栈刷新

重新识别：
- 前端框架
- 后端框架
- 数据库
- ORM
- 样式方案

### 4. 上下文重建

整合所有信息，重建项目上下文。

## 输出

```markdown
## 项目上下文已刷新

### 项目信息
- 名称: [项目名称]
- 描述: [项目描述]
- 版本: [版本号]

### 技术栈
| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 18.2.0 |
| 元框架 | Next.js | 14.0.0 |
| 数据库 | PostgreSQL | - |
| ORM | Prisma | 5.0.0 |
| 样式 | Tailwind CSS | 3.4.0 |
| 类型 | TypeScript | 5.0.0 |

### 已加载文档
- ✅ IFLOW.md
- ✅ README.md
- ✅ docs/architecture.md
- ✅ docs/api.md

### 已加载配置
- ✅ package.json
- ✅ tsconfig.json
- ✅ .eslintrc.json
- ✅ tailwind.config.js

### 技术栈参考模板
已加载: resources/tech-stack-templates/nextjs.md

### 上下文状态
✅ 项目上下文加载完成
```

## 使用场景

### 场景 1：项目结构变化

```
# 添加了新模块或重构了目录
用户: /pciv-context
AI: 正在重新加载项目上下文...
```

### 场景 2：切换项目

```
# 切换到另一个项目目录
用户: /pciv-context
AI: 检测到新的项目，正在加载...
```

### 场景 3：上下文丢失

```
# AI 对项目理解有偏差
用户: /pciv-context
AI: 重新加载上下文，刷新项目理解...
```

## 相关命令

- `/pciv-tech-check` - 单独检测技术栈
- `/pciv-prime` - 开始 Prime 阶段
- `/pciv-continue` - 恢复工作流
