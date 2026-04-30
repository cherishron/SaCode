import { useState, useCallback, useRef } from "react";
import type { StreamEvent, TokenUsage, ClarificationOption, ConfirmationDetail } from "../types.js";

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
  duration?: number;
}

interface ClarificationState {
  question: string;
  options: ClarificationOption[];
  toolCallId: string;
}

interface ConfirmationState {
  detail: ConfirmationDetail;
  toolCallId: string;
}

interface StreamingState {
  content: string;
  thoughts: string;
  toolCalls: ToolCallState[];
  isStreaming: boolean;
  isThinking: boolean;
  error?: string;
  tokenUsage?: TokenUsage;
  clarification?: ClarificationState;
  confirmation?: ConfirmationState;
}

export function useStreaming() {
  const [state, setState] = useState<StreamingState>({
    content: "",
    thoughts: "",
    toolCalls: [],
    isStreaming: false,
    isThinking: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const processEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "content":
        setState((prev) => ({
          ...prev,
          content: prev.content + event.text,
          isStreaming: true,
          isThinking: false,
        }));
        break;
      case "thought":
        setState((prev) => ({
          ...prev,
          thoughts: prev.thoughts + event.text,
          isThinking: true,
        }));
        break;
      case "tool_call":
        setState((prev) => ({
          ...prev,
          isThinking: false,
          toolCalls: [
            ...prev.toolCalls,
            { id: event.id, name: event.name, args: event.args, status: "running" },
          ],
        }));
        break;
      case "tool_result":
        setState((prev) => ({
          ...prev,
          toolCalls: prev.toolCalls.map((tc) =>
            tc.id === event.id
              ? {
                  ...tc,
                  status: event.success ? ("done" as const) : ("error" as const),
                  result: event.result,
                  ...(event.duration != null ? { duration: event.duration } : {}),
                }
              : tc
          ),
        }));
        break;
      case "error":
        setState((prev) => ({
          ...prev,
          error: event.message,
          isStreaming: false,
          isThinking: false,
        }));
        break;
      case "finished":
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          isThinking: false,
          tokenUsage: event.usage,
        }));
        break;
      case "clarification_request":
        setState((prev) => ({
          ...prev,
          clarification: {
            question: event.question,
            options: event.options,
            toolCallId: event.toolCallId,
          },
        }));
        break;
      case "confirmation_request":
        setState((prev) => ({
          ...prev,
          confirmation: {
            detail: event.detail,
            toolCallId: event.toolCallId,
          },
        }));
        break;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      content: "",
      thoughts: "",
      toolCalls: [],
      isStreaming: false,
      isThinking: false,
    });
  }, []);

  const resolveClarification = useCallback((value: string) => {
    setState((prev) => ({
      ...prev,
      clarification: undefined,
      toolCalls: prev.toolCalls.map((tc) =>
        tc.id === prev.clarification?.toolCallId
          ? { ...tc, status: "done" as const, result: value }
          : tc
      ),
    }));
  }, []);

  const resolveConfirmation = useCallback((allowed: boolean) => {
    setState((prev) => ({
      ...prev,
      confirmation: undefined,
      toolCalls: prev.toolCalls.map((tc) =>
        tc.id === prev.confirmation?.toolCallId
          ? {
              ...tc,
              status: allowed ? ("done" as const) : ("error" as const),
              result: allowed ? "confirmed" : "denied",
            }
          : tc
      ),
    }));
  }, []);

  return {
    ...state,
    processEvent,
    reset,
    resolveClarification,
    resolveConfirmation,
  };
}
