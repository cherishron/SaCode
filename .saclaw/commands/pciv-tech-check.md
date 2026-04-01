# /pciv-tech-check

技术栈检测和显示命令。

## 描述

检测项目的技术栈配置，显示详细的识别结果和推荐参考。

## 用法

```
/pciv-tech-check [output]
```

### 参数

| 参数 | 描述 |
|------|------|
| 无参数 | 显示技术栈摘要 |
| `detail` | 显示详细信息 |
| `json` | JSON 格式输出 |

## 检测规则

### 前端框架检测

| 配置文件 | 依赖名 | 识别结果 |
|----------|--------|----------|
| package.json | react | React |
| package.json | vue | Vue |
| package.json | angular | Angular |
| package.json | svelte | Svelte |
| package.json | solid-js | Solid.js |

### 元框架检测

| 配置文件 | 依赖名 | 识别结果 |
|----------|--------|----------|
| package.json | next | Next.js |
| package.json | nuxt | Nuxt.js |
| package.json | @sveltejs/kit | SvelteKit |
| package.json | @remix-run/react | Remix |
| package.json | astro | Astro |

### 后端框架检测

| 配置文件 | 依赖/标识 | 识别结果 |
|----------|----------|----------|
| package.json | express | Express |
| package.json | fastify | Fastify |
| requirements.txt | django | Django |
| requirements.txt | fastapi | FastAPI |
| go.mod | - | Go |

### 数据库检测

| 检测方式 | 标识 | 识别结果 |
|----------|------|----------|
| schema.prisma | provider = "postgresql" | PostgreSQL |
| schema.prisma | provider = "mysql" | MySQL |
| schema.prisma | provider = "mongodb" | MongoDB |
| 配置文件 | sqlite | SQLite |

### ORM 检测

| 检测方式 | 标识 | 识别结果 |
|----------|------|----------|
| prisma/schema.prisma | - | Prisma |
| package.json | typeorm | TypeORM |
| requirements.txt | sqlalchemy | SQLAlchemy |
| go.mod | gorm | GORM |

### 样式方案检测

| 配置文件 | 依赖/文件 | 识别结果 |
|----------|----------|----------|
| package.json | tailwindcss | Tailwind CSS |
| package.json | styled-components | CSS-in-JJS |
| package.json | sass | Sass |
| tailwind.config.* | - | Tailwind CSS |

## 输出

### 摘要模式

```markdown
## 技术栈检测

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | Next.js + React | 14.0.0 |
| 后端 | Next.js API Routes | - |
| 数据库 | PostgreSQL | - |
| ORM | Prisma | 5.0.0 |
| 样式 | Tailwind CSS | 3.4.0 |
| 类型 | TypeScript | 5.0.0 |
| 测试 | Jest | 29.0.0 |

已加载参考模板: resources/tech-stack-templates/nextjs.md
```

### 详细模式

```
/pciv-tech-check detail
```

```markdown
## 技术栈检测报告

### 检测详情

#### 前端框架
- 技术: React 18.2.0
- 来源: package.json
- 元框架: Next.js 14.0.0
- 来源: package.json

#### 数据层
- 数据库: PostgreSQL
- 来源: prisma/schema.prisma (provider: postgresql)
- ORM: Prisma 5.0.0
- 来源: package.json

#### 样式方案
- 方案: Tailwind CSS 3.4.0
- 来源: package.json, tailwind.config.js
- 插件: @tailwindcss/forms, @tailwindcss/typography

#### 类型系统
- TypeScript 5.0.0
- 配置: tsconfig.json
- 严格模式: 是

#### 测试框架
- Jest 29.0.0
- Testing Library 14.0.0

### 推荐参考模板
- 主模板: resources/tech-stack-templates/nextjs.md
- 补充: resources/tech-stack-templates/react.md

### 开发建议
1. 使用 Server Components 优先
2. 使用 Prisma Client 进行数据库操作
3. 使用 Tailwind CSS 进行样式开发
4. 使用 Jest + Testing Library 进行测试

### 检测时间
2026-02-16 14:30:00
```

## 示例

```
用户: /pciv-tech-check

AI: 正在检测项目技术栈...

扫描 package.json...
扫描 prisma/schema.prisma...
扫描 tsconfig.json...

## 技术栈检测结果

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | Next.js | 14.0.0 |
| 数据库 | PostgreSQL | - |
| ORM | Prisma | 5.0.0 |
| 样式 | Tailwind CSS | 3.4.0 |

已加载技术栈参考模板
```

## 相关命令

- `/pciv-context` - 完整上下文加载
- `/pciv-prime` - 启动 Prime 阶段
