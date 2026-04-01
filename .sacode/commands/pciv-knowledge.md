# /pciv-knowledge

查看和管理知识库。

## 描述

查看从错题本提炼的知识点、最佳实践和反模式警示。

## 用法

```
/pciv-knowledge [action] [query]
```

### 参数

| 参数 | 描述 |
|------|------|
| `list` | 列出所有知识点 |
| `search` | 搜索知识点 |
| `recent` | 最近添加的知识点 |
| `category` | 按分类查看 |
| 无参数 | 显示知识库概览 |

## 知识库结构

```
docs/pciv-status/knowledge-base/
├── README.md              # 知识库说明
├── lessons-learned.md     # 经验教训总结
├── best-practices.md      # 沉淀的最佳实践
└── anti-patterns.md       # 反模式警示
```

## 输出

### 概览模式

```markdown
## 知识库概览

### 统计
- 总知识点: 15
- 经验教训: 8
- 最佳实践: 5
- 反模式: 2

### 最近更新
| 日期 | 类型 | 标题 |
|------|------|------|
| 2026-02-16 | 经验 | Docker 环境数据库连接配置 |
| 2026-02-15 | 最佳实践 | Prisma 查询优化技巧 |
| 2026-02-14 | 反模式 | 避免在 Server Component 中使用客户端状态 |

### 分类索引
- 配置相关: 3 条
- 性能优化: 4 条
- 安全相关: 2 条
- 代码质量: 6 条

### 快速访问
- `/pciv-knowledge list` - 查看全部
- `/pciv-knowledge search [关键词]` - 搜索
- `/pciv-knowledge category config` - 按分类查看
```

### 列表模式

```
/pciv-knowledge list
```

```markdown
## 知识库列表

### 经验教训 (8)

#### K001: Docker 环境数据库连接配置
- 来源: M-2026-02-16-001
- 标签: docker, database, config
- 摘要: Docker 容器内访问数据库需使用服务名而非 localhost

#### K002: TypeScript 类型断言的风险
- 来源: M-2026-02-15-002
- 标签: typescript, type-safety
- 摘要: 避免使用 as 类型断言，优先使用类型守卫

...

### 最佳实践 (5)

#### B001: Prisma 查询优化
- 来源: 多个错题提炼
- 标签: prisma, performance
- 内容: 使用 select 指定返回字段，避免查询全部数据

...

### 反模式 (2)

#### A001: Server Component 中使用客户端状态
- 标签: nextjs, anti-pattern
- 警示: Server Component 无法使用 useState 等 Hook
```

### 搜索模式

```
/pciv-knowledge search docker
```

```markdown
## 搜索结果: docker

找到 2 条相关知识点：

### K001: Docker 环境数据库连接配置
- 类型: 经验教训
- 来源: M-2026-02-16-001

#### 问题
Docker 容器内访问数据库时使用 localhost 连接失败

#### 解决方案
使用 docker-compose 中定义的服务名：
```
DATABASE_URL="postgresql://user:pass@db-service:5432/mydb"
```

#### 预防措施
1. 在 Prime 阶段检查项目的基础设施配置
2. 仔细阅读 docker-compose.yml 文件
3. 使用 .env.example 中的示例配置

---

### K003: Docker 卷权限问题
- 类型: 经验教训
- 来源: M-2026-02-10-001
...
```

### 分类查看

```
/pciv-knowledge category performance
```

```markdown
## 分类: performance

共 4 条知识点

### B001: Prisma 查询优化
使用 select 指定返回字段...

### B002: Next.js 图片优化
使用 next/image 组件...

### K005: N+1 查询问题
避免循环中执行数据库查询...

### K008: 大列表渲染优化
使用虚拟列表处理大数据...
```

## 知识提炼流程

当记录错题后，系统会自动建议提炼知识点：

```
AI: 检测到错题 M-2026-02-16-001 可提炼为知识点

### 建议提炼
**类型**: 经验教训
**标题**: Docker 环境数据库连接配置
**标签**: docker, database, config

**摘要**: Docker 容器内访问数据库需使用服务名而非 localhost

**详细内容**:
[自动生成的内容]

是否添加到知识库？
- Y: 添加
- E: 编辑后添加
- N: 跳过
```

## 相关命令

- `/pciv-mistake` - 记录错题
- `/pciv-review` - 代码审查
- `/pciv-check` - 质量检查
