# @sacode/core

> 核心引擎 — Provider 抽象、Agent 编排、会话/路由/任务/MCP/缓存/工具桥接

---

## 子目录映射

| 目录 | 职责 | 关键导出 |
|------|------|----------|
| `provider/` | AI 服务提供商抽象层 | `createProvider`, `BaseProvider`, `OpenAIProvider`, `AnthropicProvider`, `ProviderType` |
| `client/` | SACODEClient — 工具执行循环 + Agent 集成 | `SACODEClient`, `SACODEClientOptions` |
| `tools/` | 工具桥接层（内置 + Capabilities + MCP） | `ToolBridge`, `BUILTIN_TOOLS`, `CapabilitiesToolConverter`, `MCPToolConverter` |
| `agent/` | Agentic 规划与编排 | `AgentRegistry`, `Planner`, `Orchestrator`, `SisyphusLoop`, `AgentChannel` |
| `agents/` | 专家 Agent 系统 (OMO) | `AgentsManager`, `createSpecialistAgent`, `SpecialistRole` |
| `ultrawork/` | 自动化执行循环 (OMO) | `TodoEnforcer`, `IntentGate`, `RalphLoop` |
| `session/` | 会话管理 + 跨渠道映射 | `SessionManager`, `SessionMapper`, `SessionMappingEntry` |
| `router/` | 消息路由 + 智能路由引擎 | `MessageRouter`, `SmartRouter`, `RoutingRule` |
| `model/` | 模型管理 + 分类路由 | `ModelManager`, `CategoryRouter`, `ModelTemplates` |
| `cache/` | 缓存层 (Memory + Redis) | `CacheManager`, `MemoryCache`, `RedisCache` |
| `caching/` | Prompt Caching 架构 | `PromptCachingManager`, `estimateTokens` |
| `scheduler/` | 定时任务调度器 | `TaskScheduler`, `calculateNextRunTime` |
| `task/` | 长任务管理器 | `LongTaskManager`, `TaskTypes`, `TaskStep` |
| `mcp/` | Model Context Protocol 实现 | `MCPServer`, `MCPClient`, `BuiltInTools` |
| `streaming/` | 流式输出管理 | `StreamingManager`, `StreamChatController` |
| `plugin/` | 插件系统 | `PluginManager`, `PluginLoader`, `PluginManifest` |
| `skills/` | Skills 加载器 + 注册中心 | `SkillLoader`, `SkillRegistry`, `SkillInstaller`, `SkillHubAdapter` |
| `memory/` | 内存管理 + 向量嵌入 | `MemoryManager`, `EnhancedMemoryManager`, `OpenAIEmbeddingService` |
| `security/` | 安全管理 | `SecurityManager`, `SessionPermissions`, `SandboxMode` |
| `workspace/` | 工作区管理 | `WorkspaceManager`, `TemplateRegistry`, `MemoryLoader` |
| `hooks/` | 事件驱动钩子系统 | `HookManager`, `HookExecutor`, `builtinHooks` |
| `context/` | 多层级上下文管理 | `ContextLoader`, `ContextManager`, `ContextCompressor` |
| `commands/` | 斜杠命令自动发现 | `CommandDiscovery`, `CommandDefinition` |
| `cost-tracker/` | 成本追踪 | `CostTracker`, `MODEL_PRICING_MAP`, `getModelPricing` |
| `preferences/` | 用户偏好管理 | `PreferenceManager`, `UserPreferences`, `WorkMode` |
| `queue/` | 消息队列 | `GroupQueue`, `QueueTask`, `QueueStats` |
| `types/` | 共享类型定义 | 基础类型（无内部依赖） |

---

## 依赖流向

```
types (基础)
  ↓
container (独立)
  ↓
core ←── types + container
  ├── provider → client → tools → agent/agents/ultrawork
  ├── session → router → streaming
  ├── model → cache/caching
  ├── scheduler → task → queue
  ├── mcp → plugin → skills
  ├── memory → security → workspace
  ├── hooks → context → commands
  └── cost-tracker → preferences
```

## 非标准模式

1. **core 依赖 container** — 非典型（通常 container 独立），因为 core 需要 Docker 隔离能力
2. **Provider re-exports** — `ProviderStreamChunk` 重命名避免与 `streaming/StreamChunk` 冲突
3. **Agent re-exports** — `CommunicationMessageHandler` 重命名避免与 `router/MessageHandler` 冲突
4. **Ultrawork re-exports** — `UltraworkTaskContext` 重命名避免与 `task/TaskContext` 冲突
5. **ToolBridge 双 MCPToolConverter** — `provider/` 和 `tools/` 各有一个，tools 版本导出为 `ToolsMCPToolConverter`

## 工厂函数模式

几乎所有模块都有 `create*()` 工厂函数和 `createDefault*()` 便捷构造器：

```typescript
import { createProvider, createSessionMapper, createSmartRouter } from "@sacode/core";
```

## 测试

- 测试目录：`src/__tests__/` 及各模块下的 `__tests__/`
- 覆盖率阈值：行≥50%，函数≥50%，分支≥40%
- 自定义工具：`tests/setup.ts` 提供 `MockWebSocket`, `createMockMessage`, `createMockSession`
