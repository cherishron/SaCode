/**
 * 流式事件类型 — 参考 Gemini CLI 的 ServerGeminiStreamEvent
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ClarificationOption {
  label: string;
  value: string;
  description?: string;
}

export interface ConfirmationDetail {
  title: string;
  message: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  details?: string[];
}

export type StreamEvent =
  | { type: "content"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; success: boolean; duration?: number }
  | { type: "citation"; sources: string[] }
  | { type: "error"; message: string; code?: string }
  | { type: "finished"; usage: TokenUsage }
  | { type: "clarification_request"; question: string; options: ClarificationOption[]; toolCallId: string }
  | { type: "confirmation_request"; detail: ConfirmationDetail; toolCallId: string };

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
