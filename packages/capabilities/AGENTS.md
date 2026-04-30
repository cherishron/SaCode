# @sacode/capabilities

> 自动化能力 — 文件/浏览器/Shell/Web/搜索/LSP/任务/Agent/Git 33 工具

---

## 子目录映射

| 目录 | 职责 | 工具数 |
|------|------|--------|
| `files/` | 文件读写/编辑/删除 | 6 |
| `browser/` | Puppeteer 浏览器控制 | 5 |
| `shell/` | Shell 命令执行 | 1 |
| `web/` | Web 搜索/获取/HTTP 请求 | 3 |
| `search/` | ripgrep 代码搜索 | 1 |
| `lsp/` | LSP 集成（7 种操作） | 1 |
| `task/` | 任务创建/更新/Cron | 3 |
| `agent/` | 子 Agent/团队管理 | 3 |
| `git/` | Git Worktree 管理 | 2 |
| `environment/` | 运行时/环境检测 | — |
| `tools/` | 工具注册中心 | — |
| `types/` | 共享类型定义 | — |
| `adapter.ts` | ToolBridge 适配器 | — |

## 核心类

```typescript
// 工具注册与执行
const capabilities = new CapabilitiesManager(config);
const tools = capabilities.getAllTools();         // 获取所有工具
const result = await capabilities.executeTool("web_search", { query: "..." });
```

## 工具分类

| 类别 | 工具 | 说明 |
|------|------|------|
| **文件** | `read_file`, `write_file`, `replace`, `list_directory`, `edit_file`, `delete_file` | 行范围/正则/字符串替换 |
| **浏览器** | `web_search`, `web_fetch`, `run_shell_command`, `image_read`, `xml_escape` | Puppeteer 驱动 |
| **Shell** | `run_shell_command` | 安全执行 Shell 命令 |
| **Web** | `web_search`, `web_fetch`, `http_request` | DuckDuckGo 搜索 + HTTP 客户端 |
| **搜索** | `grep_tool` | ripgrep 高性能代码搜索 |
| **LSP** | `lsp_tool` | definition/references/completion/diagnostics/symbols/format/rename |
| **任务** | `task_create_tool`, `task_update_tool`, `cron_create_tool` | interval/once/cron |
| **Agent** | `agent_tool`, `team_create_tool`, `team_delete_tool` | sequential/parallel/hierarchical |
| **Git** | `enter_worktree_tool`, `exit_worktree_tool` | Git Worktree 切换 |

## ToolBridge 集成

```typescript
import { createToolRegistryAdapter } from "@sacode/capabilities";
const adapter = createToolRegistryAdapter(capabilities);
// 传入 ToolBridge 使用
```

## 测试

- `src/__tests__/` — 基础能力测试
- 4 个测试用例
