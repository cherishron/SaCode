import { useState, useCallback, useRef } from "react";
import type { StreamEvent, TokenUsage } from "../types.js";

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
  duration?: number;
}

interface StreamingState {
  content: string;
  thoughts: string;
  toolCalls: ToolCallState[];
  isStreaming: boolean;
  isThinking: boolean;
  error?: string;
  tokenUsage?: TokenUsage;
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

  return { ...state, processEvent, reset };
}
