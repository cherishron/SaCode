# 贡献指南

感谢您对 SaCode 项目的关注！本文档将帮助您了解如何参与项目开发。

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发环境搭建](#开发环境搭建)
- [项目结构](#项目结构)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [问题反馈](#问题反馈)

## 行为准则

- 尊重所有贡献者
- 保持建设性的讨论
- 接受建设性批评
- 关注对社区最有利的事情

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/STAND-ALONE/saclaw/issues) 中搜索是否已有相关问题
2. 如果没有，创建新 Issue，包含：
   - 清晰的标题
   - 复现步骤
   - 期望行为
   - 实际行为
   - 环境信息（Node.js 版本、操作系统等）

### 提交功能建议

1. 先在 Issues 中讨论您的想法
2. 说明功能的使用场景
3. 等待维护者反馈后再开始实现

### 提交代码

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 开发环境搭建

### 环境要求

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 22.0.0 | LTS 版本推荐 |
| pnpm | >= 9.0.0 | 包管理器 |
| Git | >= 2.40.0 | 版本控制 |
| IDE | - | VSCode 推荐 |

### 克隆与安装

```bash
# 克隆仓库
git clone https://github.com/STAND-ALONE/sacode.git
cd sacode

# 安装依赖
pnpm install

# 初始化数据库
pnpm -C packages/database prisma generate
pnpm -C packages/database prisma db push

# 复制环境变量
cp .env.example .env
```

### 开发命令

```bash
# 开发模式
pnpm dev                    # 开发所有包
pnpm -C packages/web dev    # 仅开发 Web UI
pnpm -C packages/api dev    # 仅开发 API

# 构建
pnpm build                  # 构建所有包

# 测试
pnpm test                   # 运行测试
pnpm test:watch             # 监视模式
pnpm test:coverage          # 覆盖率报告

# 代码质量
pnpm lint                   # ESLint 检查
pnpm typecheck              # TypeScript 类型检查
pnpm format                 # Prettier 格式化
```

## 项目结构

```
SaCode/
├── packages/
│   ├── core/           # 核心引擎 - Provider 抽象层
│   ├── adapters/       # IM 适配器 - 10 个平台
│   ├── database/       # 数据库层 - Prisma ORM
│   ├── auth/           # 认证模块 - Passport.js
│   ├── cli/            # 命令行工具 - Commander.js
│   ├── capabilities/   # 自动化能力 - 文件/浏览器/Shell
│   ├── api/            # REST API + WebSocket - Express
│   └── web/            # Web UI - Vue 3 + Vite + TinyVue
│
├── docs/               # 文档
├── tests/              # 测试文件
├── .sacode/            # SaCode 配置
└── javisk/             # PCIV 工作流模板
```

### 包依赖关系

```
@sacode/types       (无内部依赖 - 共享类型定义)
    ↓
@sacode/container  (无内部依赖)
    ↓
@sacode/core       (依赖 types, container)
    ↓
@sacode/database   (无内部依赖)
    ↓
@sacode/auth       (依赖 database)
    ↓
@sacode/capabilities (无内部依赖)
    ↓
@sacode/adapters   (依赖 types)
    ↓
@sacode/api        (依赖 core, database, auth, capabilities, adapters)
    ↓
@sacode/web        (依赖 api, auth, core)
@sacode/cli        (依赖 core)
```

## 代码规范

### TypeScript

项目使用 TypeScript 严格模式：

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true
  }
}
```

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 文件/目录 | kebab-case | `session-mapper.ts` |
| 组件 | PascalCase | `ChatPanel.vue` |
| 变量/函数 | camelCase | `getSessionId` |
| 常量 | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT` |
| 接口/类型 | PascalCase | `SessionMappingEntry` |
| 枚举 | PascalCase | `QueueTaskStatus` |

### ESLint 规则

```javascript
// eslint.config.js
export default [
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];
```

### 代码风格

使用 Prettier 自动格式化：

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(adapter): add Slack adapter` |
| `fix` | Bug 修复 | `fix(auth): handle expired tokens` |
| `docs` | 文档更新 | `docs: update installation guide` |
| `style` | 代码格式（不影响功能） | `style: format imports` |
| `refactor` | 重构 | `refactor(core): simplify session manager` |
| `perf` | 性能优化 | `perf(queue): reduce memory usage` |
| `test` | 测试相关 | `test(adapter): add DingTalk tests` |
| `chore` | 构建/工具相关 | `chore: update dependencies` |
| `ci` | CI 配置 | `ci: add GitHub Actions workflow` |

### Scope 范围

- `core` - 核心模块
- `adapter` - 适配器
- `auth` - 认证模块
- `api` - API 模块
- `web` - Web UI
- `cli` - 命令行工具
- `database` - 数据库
- `docs` - 文档

### 示例

```bash
# 新功能
git commit -m "feat(adapter): add WhatsApp multimedia support"

# Bug 修复
git commit -m "fix(core): handle session timeout correctly"

# 破坏性变更
git commit -m "feat(api)!: change authentication endpoint

BREAKING CHANGE: /api/auth/login now requires email instead of username"
```

## Pull Request 流程

### 提交前检查

- [ ] 代码通过 `pnpm lint` 检查
- [ ] 代码通过 `pnpm typecheck` 类型检查
- [ ] 测试通过 `pnpm test`
- [ ] 新功能有对应测试
- [ ] 文档已更新（如有必要）

### PR 标题

使用与提交消息相同的格式：

```
feat(adapter): add WeChat miniprogram support
```

### PR 描述模板

```markdown
## 变更类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构
- [ ] 文档更新
- [ ] 其他

## 变更说明
<!-- 描述您的变更 -->

## 测试
<!-- 描述如何测试您的变更 -->

## 相关 Issue
<!-- 关联的 Issue 编号，如 Closes #123 -->
```

### 审核流程

1. 自动检查（CI）通过
2. 至少一位维护者审核
3. 解决所有审核意见
4. 维护者合并

## 问题反馈

### Bug 报告模板

```markdown
**描述**
<!-- 清晰简洁地描述 Bug -->

**复现步骤**
1. 执行 '...'
2. 点击 '...'
3. 看到错误 '...'

**期望行为**
<!-- 描述您期望发生什么 -->

**实际行为**
<!-- 描述实际发生了什么 -->

**环境信息**
- Node.js 版本:
- 操作系统:
- SaCode 版本:

**截图**
<!-- 如有截图，请在此添加 -->

**附加信息**
<!-- 其他任何有助于解决问题的信息 -->
```

### 功能请求模板

```markdown
**功能描述**
<!-- 清晰描述您希望添加的功能 -->

**使用场景**
<!-- 描述该功能的使用场景 -->

**建议方案**
<!-- 如果有建议的实现方案，请描述 -->

**附加信息**
<!-- 其他相关信息 -->
```

## 开发提示

### 调试

使用 Node.js 调试器：

```bash
# VSCode 调试配置
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["-C", "packages/api", "dev"],
      "console": "integratedTerminal"
    }
  ]
}
```

### 数据库

```bash
# 创建迁移
pnpm -C packages/database prisma migrate dev --name add_new_table

# 重置数据库
pnpm -C packages/database prisma migrate reset

# 打开 Prisma Studio
pnpm -C packages/database prisma studio
```

### 日志

开发环境日志输出到控制台：

```typescript
import { logger } from "@saclaw/core";

logger.info("操作成功");
logger.warn("警告信息");
logger.error("错误信息", error);
```

## 许可证

提交代码即表示您同意您的贡献将根据 [MIT 许可证](./LICENSE) 授权。

---

感谢您的贡献！
