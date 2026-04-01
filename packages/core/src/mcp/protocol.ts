/**
 * MCP (Model Context Protocol) 兼容层
 *
 * 实现 Anthropic 的 Model Context Protocol 标准
 * 参考: https://modelcontextprotocol.io/
 */

import EventEmitter from "eventemitter3";
import { z } from "zod";

// ==================== MCP 基础类型 ====================

/**
 * MCP 版本
 */
export const MCP_VERSION = "2024-11-05";

/**
 * JSON-RPC 请求
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 响应
 */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 通知
 */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ==================== MCP 协议定义 ====================

/**
 * 实现信息
 */
export const ImplementationSchema = z.object({
  name: z.string(),
  version: z.string(),
});

export type Implementation = z.infer<typeof ImplementationSchema>;

/**
 * 服务器能力
 */
export const ServerCapabilitiesSchema = z.object({
  prompts: z
    .object({
      listChanged: z.boolean().optional(),
    })
    .optional(),
  resources: z
    .object({
      subscribe: z.boolean().optional(),
      listChanged: z.boolean().optional(),
    })
    .optional(),
  tools: z
    .object({
      listChanged: z.boolean().optional(),
    })
    .optional(),
  logging: z.object({}).optional(),
});

export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;

/**
 * 客户端能力
 */
export const ClientCapabilitiesSchema = z.object({
  prompts: z
    .object({
      listChanged: z.boolean().optional(),
    })
    .optional(),
  resources: z
    .object({
      subscribe: z.boolean().optional(),
      listChanged: z.boolean().optional(),
    })
    .optional(),
  tools: z
    .object({
      listChanged: z.boolean().optional(),
    })
    .optional(),
  logging: z.object({}).optional(),
});

export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;

/**
 * 初始化结果
 */
export const InitializeResultSchema = z.object({
  protocolVersion: z.string(),
  capabilities: ServerCapabilitiesSchema,
  serverInfo: ImplementationSchema,
});

export type InitializeResult = z.infer<typeof InitializeResultSchema>;

// ==================== 工具相关 ====================

/**
 * 工具输入模式
 */
export const ToolInputSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.unknown()).optional(),
  required: z.array(z.string()).optional(),
});

/**
 * 工具定义
 */
export const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: ToolInputSchema,
});

export type Tool = z.infer<typeof ToolSchema>;

/**
 * 工具调用结果
 */
export const ToolResultSchema = z.object({
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
      z.object({
        type: z.literal("image"),
        data: z.string(),
        mimeType: z.string(),
      }),
      z.object({
        type: z.literal("resource"),
        resource: z.unknown(),
      }),
    ])
  ),
  isError: z.boolean().optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

// ==================== 资源相关 ====================

/**
 * 资源定义
 */
export const ResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

export type Resource = z.infer<typeof ResourceSchema>;

/**
 * 资源内容
 */
export const ResourceContentsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("blob"),
    uri: z.string(),
    mimeType: z.string().optional(),
    blob: z.string(),
  }),
]);

export type ResourceContents = z.infer<typeof ResourceContentsSchema>;

// ==================== 提示词相关 ====================

/**
 * 提示词参数
 */
export const PromptArgumentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

/**
 * 提示词定义
 */
export const PromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(PromptArgumentSchema).optional(),
});

export type Prompt = z.infer<typeof PromptSchema>;

/**
 * 提示词消息
 */
export const PromptMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("text"),
      text: z.string(),
    }),
    z.object({
      type: z.literal("image"),
      data: z.string(),
      mimeType: z.string(),
    }),
    z.object({
      type: z.literal("resource"),
      resource: ResourceSchema,
    }),
  ]),
});

export type PromptMessage = z.infer<typeof PromptMessageSchema>;

/**
 * 获取提示词结果
 */
export const GetPromptResultSchema = z.object({
  description: z.string().optional(),
  messages: z.array(PromptMessageSchema),
});

export type GetPromptResult = z.infer<typeof GetPromptResultSchema>;

// ==================== MCP 服务器 ====================

/**
 * 工具处理器
 */
export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<ToolResult>;

/**
 * 资源处理器
 */
export type ResourceHandler = (uri: string) => Promise<ResourceContents>;

/**
 * 提示词处理器
 */
export type PromptHandler = (
  args: Record<string, string>
) => Promise<GetPromptResult>;

/**
 * MCP 服务器选项
 */
export interface MCPServerOptions {
  name: string;
  version: string;
  capabilities?: ServerCapabilities;
}

/**
 * MCP 服务器事件
 */
export interface MCPServerEvent {
  type: "initialized" | "tool_called" | "resource_read" | "prompt_get" | "error";
  data?: unknown;
  timestamp: Date;
}

/**
 * MCP 服务器实现
 */
export class MCPServer extends EventEmitter<{ event: (e: MCPServerEvent) => void }> {
  private name: string;
  private version: string;
  private capabilities: ServerCapabilities;
  private tools: Map<string, { tool: Tool; handler: ToolHandler }> = new Map();
  private resources: Map<string, { resource: Resource; handler: ResourceHandler }> = new Map();
  private prompts: Map<string, { prompt: Prompt; handler: PromptHandler }> = new Map();
  private _initialized = false;
  private _clientCapabilities?: ClientCapabilities;

  constructor(options: MCPServerOptions) {
    super();
    this.name = options.name;
    this.version = options.version;
    this.capabilities = options.capabilities ?? {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: true },
      prompts: { listChanged: true },
      logging: {},
    };
  }

  /**
   * 检查客户端是否已初始化
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * 获取客户端能力
   */
  get clientCapabilities(): ClientCapabilities | undefined {
    return this._clientCapabilities;
  }

  /**
   * 注册工具
   */
  registerTool(tool: Tool, handler: ToolHandler): void {
    this.tools.set(tool.name, { tool, handler });
  }

  /**
   * 注销工具
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
  }

  /**
   * 注册资源
   */
  registerResource(resource: Resource, handler: ResourceHandler): void {
    this.resources.set(resource.uri, { resource, handler });
  }

  /**
   * 注销资源
   */
  unregisterResource(uri: string): void {
    this.resources.delete(uri);
  }

  /**
   * 注册提示词
   */
  registerPrompt(prompt: Prompt, handler: PromptHandler): void {
    this.prompts.set(prompt.name, { prompt, handler });
  }

  /**
   * 注销提示词
   */
  unregisterPrompt(name: string): void {
    this.prompts.delete(name);
  }

  /**
   * 处理 JSON-RPC 请求
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const result = await this.executeMethod(request.method, request.params);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
          data: error,
        },
      };
    }
  }

  /**
   * 执行方法
   */
  private async executeMethod(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.handleInitialize(params);

      case "initialized":
        this._initialized = true;
        this.emit("event", { type: "initialized", timestamp: new Date() });
        return {};

      case "tools/list":
        return this.handleToolsList();

      case "tools/call":
        return this.handleToolsCall(params);

      case "resources/list":
        return this.handleResourcesList();

      case "resources/read":
        return this.handleResourcesRead(params);

      case "prompts/list":
        return this.handlePromptsList();

      case "prompts/get":
        return this.handlePromptsGet(params);

      case "logging/setLevel":
        return {};

      case "ping":
        return {};

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * 处理初始化
   */
  private handleInitialize(params?: Record<string, unknown>): InitializeResult {
    if (params?.capabilities) {
      this._clientCapabilities = ClientCapabilitiesSchema.parse(params.capabilities);
    }

    return {
      protocolVersion: MCP_VERSION,
      capabilities: this.capabilities,
      serverInfo: {
        name: this.name,
        version: this.version,
      },
    };
  }

  /**
   * 处理工具列表
   */
  private handleToolsList(): { tools: Tool[] } {
    return {
      tools: Array.from(this.tools.values()).map((t) => t.tool),
    };
  }

  /**
   * 处理工具调用
   */
  private async handleToolsCall(
    params?: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!params || typeof params.name !== "string") {
      throw new Error("Invalid tool call parameters");
    }

    const entry = this.tools.get(params.name);
    if (!entry) {
      throw new Error(`Tool not found: ${params.name}`);
    }

    const args = (params.arguments as Record<string, unknown>) ?? {};

    try {
      const result = await entry.handler(args);
      this.emit("event", {
        type: "tool_called",
        data: { name: params.name, args, result },
        timestamp: new Date(),
      });
      return result;
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Tool execution failed",
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * 处理资源列表
   */
  private handleResourcesList(): { resources: Resource[] } {
    return {
      resources: Array.from(this.resources.values()).map((r) => r.resource),
    };
  }

  /**
   * 处理资源读取
   */
  private async handleResourcesRead(
    params?: Record<string, unknown>
  ): Promise<{ contents: ResourceContents[] }> {
    if (!params || typeof params.uri !== "string") {
      throw new Error("Invalid resource read parameters");
    }

    const entry = this.resources.get(params.uri);
    if (!entry) {
      throw new Error(`Resource not found: ${params.uri}`);
    }

    const contents = await entry.handler(params.uri);
    this.emit("event", {
      type: "resource_read",
      data: { uri: params.uri },
      timestamp: new Date(),
    });

    return { contents: [contents] };
  }

  /**
   * 处理提示词列表
   */
  private handlePromptsList(): { prompts: Prompt[] } {
    return {
      prompts: Array.from(this.prompts.values()).map((p) => p.prompt),
    };
  }

  /**
   * 处理提示词获取
   */
  private async handlePromptsGet(
    params?: Record<string, unknown>
  ): Promise<GetPromptResult> {
    if (!params || typeof params.name !== "string") {
      throw new Error("Invalid prompt get parameters");
    }

    const entry = this.prompts.get(params.name);
    if (!entry) {
      throw new Error(`Prompt not found: ${params.name}`);
    }

    const args = (params.arguments as Record<string, string>) ?? {};
    const result = await entry.handler(args);

    this.emit("event", {
      type: "prompt_get",
      data: { name: params.name, args },
      timestamp: new Date(),
    });

    return result;
  }

  /**
   * 创建通知
   */
  createNotification(
    method: string,
    params?: Record<string, unknown>
  ): JsonRpcNotification {
    if (params !== undefined) {
      return {
        jsonrpc: "2.0",
        method,
        params,
      };
    }
    return {
      jsonrpc: "2.0",
      method,
    };
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): { name: string; version: string; capabilities: ServerCapabilities } {
    return {
      name: this.name,
      version: this.version,
      capabilities: this.capabilities,
    };
  }
}

// ==================== MCP 客户端 ====================

/**
 * MCP 客户端选项
 */
export interface MCPClientOptions {
  name: string;
  version: string;
  capabilities?: ClientCapabilities;
}

/**
 * MCP 客户端实现
 */
export class MCPClient {
  private name: string;
  private version: string;
  private capabilities: ClientCapabilities;
  private serverCapabilities?: ServerCapabilities;
  private serverInfo?: Implementation;
  private transport?: MCPTransport;
  private requestId = 0;

  constructor(options: MCPClientOptions) {
    this.name = options.name;
    this.version = options.version;
    this.capabilities = options.capabilities ?? {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: true },
      prompts: { listChanged: true },
    };
  }

  /**
   * 设置传输层
   */
  setTransport(transport: MCPTransport): void {
    this.transport = transport;
  }

  /**
   * 连接到服务器
   */
  async connect(): Promise<void> {
    if (!this.transport) {
      throw new Error("Transport not set");
    }

    await this.transport.connect();

    // 发送初始化请求
    const result = await this.sendRequest("initialize", {
      protocolVersion: MCP_VERSION,
      capabilities: this.capabilities,
      clientInfo: {
        name: this.name,
        version: this.version,
      },
    });

    const initResult = InitializeResultSchema.parse(result);
    this.serverCapabilities = initResult.capabilities;
    this.serverInfo = initResult.serverInfo;

    // 发送初始化完成通知
    await this.sendNotification("initialized", {});
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
    }
  }

  /**
   * 列出工具
   */
  async listTools(): Promise<Tool[]> {
    const result = await this.sendRequest("tools/list", {});
    const parsed = z.object({ tools: z.array(ToolSchema) }).parse(result);
    return parsed.tools;
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args,
    });
    return ToolResultSchema.parse(result);
  }

  /**
   * 列出资源
   */
  async listResources(): Promise<Resource[]> {
    const result = await this.sendRequest("resources/list", {});
    const parsed = z.object({ resources: z.array(ResourceSchema) }).parse(result);
    return parsed.resources;
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<ResourceContents[]> {
    const result = await this.sendRequest("resources/read", { uri });
    const parsed = z.object({ contents: z.array(ResourceContentsSchema) }).parse(result);
    return parsed.contents;
  }

  /**
   * 列出提示词
   */
  async listPrompts(): Promise<Prompt[]> {
    const result = await this.sendRequest("prompts/list", {});
    const parsed = z.object({ prompts: z.array(PromptSchema) }).parse(result);
    return parsed.prompts;
  }

  /**
   * 获取提示词
   */
  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<GetPromptResult> {
    const result = await this.sendRequest("prompts/get", {
      name,
      arguments: args,
    });
    return GetPromptResultSchema.parse(result);
  }

  /**
   * 发送请求
   */
  private async sendRequest(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.transport) {
      throw new Error("Transport not set");
    }

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    };

    const response = await this.transport.sendRequest(request);

    if (response.error) {
      throw new Error(`MCP Error: ${response.error.message}`);
    }

    return response.result;
  }

  /**
   * 发送通知
   */
  private async sendNotification(
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    if (!this.transport) {
      throw new Error("Transport not set");
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params: params ?? undefined,
    };

    await this.transport.sendNotification(notification);
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): { info?: Implementation; capabilities?: ServerCapabilities } {
    const result: { info?: Implementation; capabilities?: ServerCapabilities } = {};
    if (this.serverInfo !== undefined) {
      result.info = this.serverInfo;
    }
    if (this.serverCapabilities !== undefined) {
      result.capabilities = this.serverCapabilities;
    }
    return result;
  }
}

// ==================== 传输层接口 ====================

/**
 * MCP 传输层接口
 */
export interface MCPTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  sendNotification(notification: JsonRpcNotification): Promise<void>;
}

/**
 * 创建 MCP 服务器
 */
export function createMCPServer(options: MCPServerOptions): MCPServer {
  return new MCPServer(options);
}

/**
 * 创建 MCP 客户端
 */
export function createMCPClient(options: MCPClientOptions): MCPClient {
  return new MCPClient(options);
}

/**
 * 内置工具定义
 */
export const BuiltInTools = {
  /**
   * 执行命令工具
   */
  executeCommand: (): Tool => ({
    name: "execute_command",
    description: "Execute a shell command",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds" },
      },
      required: ["command"],
    },
  }),

  /**
   * 读取文件工具
   */
  readFile: (): Tool => ({
    name: "read_file",
    description: "Read the contents of a file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file path to read" },
        encoding: { type: "string", description: "File encoding (default: utf-8)" },
      },
      required: ["path"],
    },
  }),

  /**
   * 写入文件工具
   */
  writeFile: (): Tool => ({
    name: "write_file",
    description: "Write content to a file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file path to write" },
        content: { type: "string", description: "The content to write" },
        encoding: { type: "string", description: "File encoding (default: utf-8)" },
      },
      required: ["path", "content"],
    },
  }),

  /**
   * 搜索文件工具
   */
  searchFiles: (): Tool => ({
    name: "search_files",
    description: "Search for files matching a pattern",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The search pattern (glob or regex)" },
        path: { type: "string", description: "The directory to search in" },
      },
      required: ["pattern"],
    },
  }),

  /**
   * HTTP 请求工具
   */
  httpRequest: (): Tool => ({
    name: "http_request",
    description: "Make an HTTP request",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to request" },
        method: { type: "string", description: "HTTP method (GET, POST, etc.)" },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body" },
      },
      required: ["url"],
    },
  }),
};
