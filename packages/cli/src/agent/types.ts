/**
 * Agentic 引擎类型定义
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type StreamEvent =
  | { type: "content"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; success: boolean; duration?: number }
  | { type: "citation"; sources: string[] }
  | { type: "error"; message: string; code?: string }
  | { type: "finished"; usage: TokenUsage };

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgenticLoopConfig {
  maxIterations: number;
  tools: Tool[];
  contextWindow: number;
  autoApprove: string[];
  requireApproval: string[];
  onEvent?: (event: StreamEvent) => void;
}

export interface ProjectContext {
  rootDir: string;
  packageJson?: Record<string, unknown>;
  tsConfig?: Record<string, unknown>;
  directoryTree: string;
  gitStatus?: string;
  relevantFiles: Array<{ path: string; content: string }>;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}
