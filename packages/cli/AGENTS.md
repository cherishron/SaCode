# @sacode/cli

> 命令行工具 — Commander.js + React Ink TUI + Vim 模式

---

## 子目录映射

| 目录 | 职责 |
|------|------|
| `commands/` | CLI 命令实现（chat, start, auth, config 等） |
| `agent/` | Agent 上下文管理、模型选择器 |
| `auth/` | CLI 认证逻辑 |
| `config/` | 配置文件读写 |
| `core/` | 核心启动/初始化逻辑 |
| `lib/` | 共享工具函数 |
| `tools/` | CLI 工具注册 |
| `ui/` | React Ink TUI 组件（模型选择器等） |
| `vim/` | Vim 键绑定模式支持 |

## 入口点

- **主入口**: `src/cli.ts` → Commander.js program 定义
- **导出入口**: `src/index.ts` → 重导出 commands + program

## 关键文件

| 文件 | 职责 |
|------|------|
| `cli.ts` | Commander.js program 注册、全局选项解析 |
| `commands/chat.tsx` | 交互式聊天（React Ink 渲染） |
| `commands/start.ts` | 启动 API/Web 服务 |
| `commands/auth.ts` | 登录/登出/注册 |
| `agent/context.ts` | Agent 运行上下文（含 @ts-expect-error 用于 token budget 预留） |
| `ui/model-selector.ts` | 模型选择 TUI 组件 |

## 技术栈

- **Commander.js** — 命令定义与解析
- **React Ink** — 终端 UI 渲染（chat, model-selector）
- **Bun test** — CLI 测试运行器（非 Vitest）

## 注意事项

- `agent/context.ts:15` 有 `@ts-expect-error` — 为未来 token budget 功能预留
- `ui/model-selector.ts:67` 和 `commands/chat.tsx:102` 使用 `as any` — React Ink 类型兼容
- Vim 模式 (`vim/`) 提供类 Vim 键绑定用于聊天交互
