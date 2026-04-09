/**
 * 流式事件类型 — 参考 Gemini CLI 的 ServerGeminiStreamEvent
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

export interface AccountInfo {
  alias: string;
  provider: string;
  model?: string;
}

export interface AppState {
  isThinking: boolean;
  isStreaming: boolean;
  currentToolCall?: { name: string; status: "running" | "done" | "error" };
  account?: AccountInfo;
  tokenUsage?: TokenUsage;
}
