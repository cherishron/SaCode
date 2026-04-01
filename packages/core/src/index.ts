// Types
export * from "./types";

// Provider (AI 服务提供商抽象层)
export {
  // Types
  APIKeyError,
  ModelNotAvailableError,
  PROVIDER_TYPES,
  ProviderError,
  RateLimitError,
  defaultMCPToolConverter,
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  streamChunkToMessage,
  // Base
  BaseProvider,
  DEFAULT_RETRY_CONFIG,
  // OpenAI
  createOpenAIProvider,
  OpenAIProvider,
  // Anthropic
  createAnthropicProvider,
  AnthropicProvider,
  // Factory
  createProvider,
  createProviderFromEnv,
  getRegisteredProviderTypes,
  isProviderRegistered,
  registerProvider,
} from "./provider";
export type {
  AIProvider,
  AnthropicProviderConfig,
  BaseProviderConfig,
  ChatCompletionOptions,
  ChatMessage,
  ChatMessageContent,
  EnvConfig,
  MCPToolConverter,
  OpenAIProviderConfig,
  ProviderConfig,
  ProviderEvents,
  ProviderType,
  RetryConfig,
  ToolCall,
  ToolCallResult,
  ToolDefinition,
  ProviderFactory,
} from "./provider";
// Provider StreamChunk (重命名以避免与 streaming 模块的 StreamChunk 冲突)
export type { StreamChunk as ProviderStreamChunk, StreamChunkType as ProviderStreamChunkType } from "./provider";

// Client
export { SaClawClient } from "./client";
export type { SaClawClientOptions, SaClawClientEvents } from "./client";

// Model
export {
  ModelManager,
  createModelManager,
  createDefaultModelManager,
  ModelConfigSchema,
  ModelManagerConfigSchema,
  ModelTemplates,
} from "./model";
export type {
  ModelProvider,
  ModelConfig,
  ModelSelectionStrategy,
  ModelManagerConfig,
  ModelSwitchEvent,
  ModelCapabilityRequirement,
} from "./model";

// Session
export {
  SessionManager,
  SessionMapper,
  createSessionMapper,
  createSessionManager,
} from "./session";
// Session types
export type {
  SessionStatus,
  Session,
  SessionCreateOptions,
  SessionUpdateOptions,
  ChannelIdentifier,
  Platform,
  SessionMappingEntry,
  SessionMapperConfig,
  SessionMapperEvents,
  SessionManagerConfig,
  SessionManagerEvents,
} from "./session";

// Router
export { MessageRouter } from "./router";
export type { RouterOptions, MessageHandler } from "./router";

// Smart Router
export {
  SmartRouter,
  createSmartRouter,
  RuleTemplates,
} from "./router";
export type {
  SmartRouterOptions,
  SmartRouterEvent,
  RoutingRule,
  RoutingCondition,
  RoutingAction,
  RoutingResult,
  ConditionOperator,
  ConditionField,
  ActionType,
  RuleStorage,
} from "./router";

// Skills
export {
  SkillLoader,
  createSkillLoader,
  SkillRegistry,
  createSkillRegistry,
  SkillInstaller,
  createSkillInstaller,
  RegistrySecurityError,
  InstallerSecurityError,
  NetworkError,
  DEFAULT_CLAWHUB_CONFIG,
  DEFAULT_SKILLHUB_CONFIG,
  getDefaultConfig,
} from "./skills";
export {
  SkillHubAdapter,
  createSkillHubAdapter,
} from "./skills/adapters/skillhub";
export type {
  Skill,
  SkillSchema,
  SkillVersion,
  SkillRegistryEntry,
  SkillLoadResult,
  SkillLoaderOptions,
  SkillDiscoveryEvent,
  SkillInstallOptions,
  SkillSearchParams,
  SkillSearchResult,
  ClawHubConfig,
  SkillLockEntry,
  SkillLockfile,
  SkillRegistryConfig,
  SkillInstallerConfig,
  RegistryType,
} from "./skills";
export type { SkillHubConfig } from "./skills/adapters/skillhub";

// Memory
export { MemoryManager, createMemoryManager } from "./memory";
export {
  EnhancedMemoryManager,
  createEnhancedMemoryManager,
  OpenAIEmbeddingService,
  createOpenAIEmbeddingService,
} from "./memory";
export type {
  MemoryConfig,
  SessionMemory,
  MemoryUpdateEvent,
  EnhancedMemoryConfig,
  MemorySearchResult,
  EmbeddingService,
} from "./memory";

// Scheduler
export { TaskScheduler, createTaskScheduler, calculateNextRunTime } from "./scheduler";
export type {
  CronTask,
  CreateTaskInput,
  TaskType,
  TaskConfig,
  TaskSchedulerConfig,
  TaskExecutionResult,
  TaskEvent,
  TaskEventCallback,
  TaskExecutor,
  TaskExecutionLog,
  TaskStats,
} from "./scheduler";

// Queue
export { GroupQueue, createGroupQueue } from "./queue";
export type {
  QueueTask,
  QueueTaskStatusType,
  GroupQueueConfig,
  QueueStats,
  QueueEvent,
} from "./queue";

// Plugin
export { PluginManager, createPluginManager, PluginLoader, createPluginLoader } from "./plugin";
export type {
  PluginManifest,
  PluginConfig,
  PluginConfigField,
  Plugin,
  PluginStatus,
  PluginLifecycle,
  PluginCapabilities,
  PluginTool,
  PluginCommand,
  PluginMessageHandler,
  PluginMessage,
  PluginMessageResult,
  PluginScheduledTask,
  PluginSkill,
  PluginContext,
  PluginStorage,
  Logger,
  ConfigManager,
  AdapterManager,
  PluginFactory,
  PluginModule,
  PluginManagerConfig,
  PluginManagerEvents,
  PluginLoadResult,
  PluginValidationResult,
  PluginStats,
} from "./plugin";

// Streaming
export { StreamingManager, createStreamingManager } from "./streaming";
export {
  StreamChatController,
  createStreamChatController,
} from "./streaming/chat-controller.js";
export type {
  StreamChatOptions,
  StreamChatResult,
  StreamChatEvents,
} from "./streaming/chat-controller.js";
export type {
  StreamChunk,
  StreamingSession,
  StreamingConfig,
  StreamingEvent,
  StreamSender,
  StreamingCallback,
} from "./streaming";
export { defaultStreamingConfig } from "./streaming";

// Security
export {
  SecurityManager,
  createSecurityManager,
  parseSessionTypeIdentifier,
  createSessionTypeIdentifier,
  DEFAULT_PERMISSIONS,
  SessionSecurityTypeSchema,
  SandboxModeSchema,
  SessionPermissionsSchema,
} from "./security";
export type {
  SessionSecurityType,
  SessionTypeIdentifier,
  SandboxMode,
  SessionPermissions,
  SecurityManagerConfig,
} from "./security";

// Workspace
export {
  WorkspaceManager,
  createWorkspaceManager,
  TemplateRegistry,
  createTemplateRegistry,
  MemoryLoader,
  createMemoryLoader,
} from "./workspace";
export type {
  WorkspaceConfig,
  WorkspaceTemplate,
  WorkspaceFile,
  WorkspaceContext,
  WorkspaceManagerOptions,
  WorkspaceEvent,
  MemoryLoaderOptions,
} from "./workspace";

// Long Task
export {
  LongTaskManager,
  createLongTaskManager,
  TaskTypes,
} from "./task";
export type {
  LongTask,
  TaskStep,
  TaskStatus,
  TaskPriority,
  LongTaskExecutor,
  TaskContext,
  LongTaskEvent,
  LongTaskManagerOptions,
  TaskPersistence,
} from "./task";

// MCP (Model Context Protocol)
export {
  // Server and Client
  MCPServer,
  MCPClient,
  createMCPServer,
  createMCPClient,
  BuiltInTools,
  MCP_VERSION,
  // JSON-RPC Types
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  // MCP Types
  type Implementation,
  type ServerCapabilities,
  type ClientCapabilities,
  type InitializeResult,
  type Tool,
  type ToolResult,
  type Resource,
  type ResourceContents,
  type Prompt,
  type PromptMessage,
  type GetPromptResult,
  // Handler Types
  type ToolHandler,
  type ResourceHandler,
  type PromptHandler,
  type MCPTransport,
  type MCPServerOptions,
  type MCPClientOptions,
} from "./mcp";

// Cache
export {
  CacheManager,
  createCacheManager,
  MemoryCache,
  RedisCache,
  createRedisCache,
} from "./cache";
export type {
  CacheConfig,
  CacheOptions,
  CacheEntry,
  CacheStats,
  CacheBackend,
  CacheEvent,
  CacheEventHandler,
  CacheBackendType,
  RedisConfig,
  MemoryCacheConfig,
  CacheEventType,
} from "./cache";

// Tools Bridge
export {
  ToolBridge,
  createToolBridge,
  zodToJsonSchema,
  CapabilitiesToolConverter,
  MCPToolConverter as ToolsMCPToolConverter,
  convertCapabilitiesTools,
  convertMCPTools,
  toProviderToolDefinitions,
  BUILTIN_TOOLS,
  getBuiltinToolNames,
  getBuiltinTool,
  isBuiltinTool,
} from "./tools";
export type {
  UnifiedToolDefinition,
  ToolParameterSchema,
  ToolHandler as ToolsToolHandler,
  ToolExecutionResult,
  ToolBridgeConfig,
  ToolBridgeEvents,
  CapabilitiesToolDefinition,
  MCPToolDefinition,
  CapabilitiesRegistryLike,
  MCPClientLike,
  ToolCallPlan,
  ToolOrchestrationResult,
  ToolDefinitionConverter,
} from "./tools";

// Agent (Agentic 规划与编排)
export {
  AgentRegistry,
  createAgentRegistry,
  Planner,
  createPlanner,
  Orchestrator,
  createOrchestrator,
  AgentChannel,
  createAgentChannel,
  SisyphusLoop,
  createSisyphusLoop,
} from "./agent";
export type {
  AgentType,
  AgentStatus,
  AgentConfig,
  Agent,
  StepStatus,
  TaskStep as AgentTaskStep,
  ExecutionPlan,
  PlannerOptions,
  OrchestrationEventType,
  OrchestrationEvent,
  OrchestrationResult,
  OrchestratorConfig,
  AgentMessageType,
  AgentMessage,
  ComplexityLevel,
  ComplexityAssessment,
  TaskCategory,
  AgentRegistryEvents,
  AgentRegistryConfig,
  PlannerEvents,
  OrchestratorEvents,
  CommunicationEvents,
  HandlerRegistration,
  RoutingStrategy,
  CommunicationConfig,
  LoopMode,
  CompletionStatus,
  LazyDetectionResult,
  CompletionAssessment,
  SisyphusConfig,
  SisyphusEvents,
  SisyphusResult,
} from "./agent";
// 重命名避免与 router 模块的 MessageHandler 冲突
export type { MessageHandler as CommunicationMessageHandler } from "./agent";

// Model (扩展 - Category Router)
export {
  CategoryRouter,
  createCategoryRouter,
  classifyTask,
  routeTask,
  DefaultCategoryDescriptors,
} from "./model";
export type {
  CategoryDescriptor,
  CategoryRouterConfig,
} from "./model";

// Specialist Agents (OMO 设计)
export {
  DefaultSpecialistConfigs,
  getSpecialistConfig,
  createSpecialistAgent,
  AgentsManager,
  createAgentsManager,
} from "./agents";
export type {
  SpecialistRole,
  AgentExecutionMode,
  SpecialistAgentConfig,
  SpecialistAgentState,
  SpecialistAgent,
  DelegationRequest,
  DelegationResponse,
  AgentsManagerEvents,
  TaskAssignmentStrategy,
  AgentsManagerConfig,
} from "./agents";

// Ultrawork (OMO 设计 - 自动化执行)
export {
  TodoEnforcer,
  createTodoEnforcer,
  IntentGate,
  createIntentGate,
  RalphLoop,
  createRalphLoop,
} from "./ultrawork";
export type {
  TodoStatus,
  TodoItem,
  TodoValidationResult,
  TodoIssue,
  TodoEnforcerEvents,
  TodoEnforcerConfig,
  IntentVerdict,
  IntentCheckResult,
  ActionRecord,
  IntentGateEvents,
  IntentGateConfig,
  LoopState,
  StepOutcome,
  LoopIteration,
  LazyDetection,
  RalphLoopEvents,
  RalphLoopConfig,
  RalphLoopSummary,
} from "./ultrawork";
// 重命名避免与其他模块的 TaskContext 冲突
export type { TaskContext as UltraworkTaskContext } from "./ultrawork";

// Hooks (事件驱动钩子系统)
export {
  HookManager,
  createHookManager,
  HookExecutor,
  createHookExecutor,
  DEFAULT_HOOK_MANAGER_CONFIG,
  // 内置钩子
  builtinHooks,
  registerBuiltinHooks,
  confirmDangerousHook,
  auditLogHook,
  rateLimiterHook,
  fileBackupHook,
  sessionStatsHook,
  DANGEROUS_TOOLS,
  DANGEROUS_COMMANDS,
} from "./hooks";
export type {
  HookEvent,
  HookContext,
  HookResult,
  HookDefinition,
  HookRegisterOptions,
  HookStats,
  HookExecutionLog,
  HookManagerConfig,
  HookEventDataMap,
  EventData,
  HookFileMetadata,
  HookExecutorConfig,
} from "./hooks";

// Context (多层级上下文管理)
export {
  ContextLoader,
  createContextLoader,
  DEFAULT_CONTEXT_LOADER_CONFIG,
  // 上下文管理器
  ContextManager,
  ContextCompressor,
  SimpleTokenCounter,
  createContextManager,
  createTokenCounter,
  DEFAULT_COMPRESSOR_CONFIG,
  DEFAULT_CONTEXT_MANAGER_CONFIG,
} from "./context";
export type {
  ContextLevel,
  ContextFile,
  ContextLoadResult,
  ContextLoaderConfig,
  ContextLoaderEvents,
  // 管理器类型
  TokenCounter,
  Summarizer,
  ContextCompressorConfig,
  CompressionResult,
  ContextManagerConfig,
} from "./context";

// Caching (Prompt Caching 架构)
export {
  PromptCachingManager,
  createPromptCachingManager,
  DEFAULT_PROMPT_CACHING_CONFIG,
  isCacheableMessage,
  estimateTokens,
} from "./caching";
export type {
  CacheControl,
  CachedMessage,
  CachedToolDefinition,
  CacheStrategy,
  PromptCachingConfig,
  CacheStats,
} from "./caching";

// Commands (斜杠命令自动发现)
export {
  CommandDiscovery,
  createCommandDiscovery,
  DEFAULT_COMMAND_DISCOVERY_CONFIG,
} from "./commands";
export type {
  CommandDefinition,
  CommandFileMetadata,
  CommandDiscoveryConfig,
  CommandDiscoveryEvents,
} from "./commands";
