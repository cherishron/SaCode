import type React from "react";
import type { AgentRunnerEvent } from "../../agent/runner.js";
import type { Message } from "../../ui/App.js";

export function createSystemMessage(createId: () => string, content: string): Message {
  return {
    id: createId(),
    role: "system",
    content,
    timestamp: new Date(),
  };
}

export function createToolMessage(
  createId: () => string,
  name: string,
  args: Record<string, unknown>,
): Message {
  return {
    id: createId(),
    role: "tool",
    content: "",
    toolName: name,
    toolArgs: args,
    toolStatus: "running",
    timestamp: new Date(),
  };
}

export function handleRunnerEvent(
  event: AgentRunnerEvent,
  state: {
    createId: () => string;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
    toolMessageIdsRef: React.MutableRefObject<Record<string, string>>;
    toolStartTimesRef: React.MutableRefObject<Record<string, number>>;
  },
  assistantContent: string,
  setAssistantContent: (value: string) => void,
): void {
  switch (event.type) {
    case "runner_plan": {
      if (event.enabled && event.subAgents.length > 0) {
        state.setMessages((prev) => [
          ...prev,
          createSystemMessage(
            state.createId,
            `已启用多 Agent 协作: primary=${event.primaryAgent ?? "unknown"}, sub-agents=${event.subAgents.join(", ")}`,
          ),
        ]);
      }
      return;
    }
    case "agent_summary": {
      state.setMessages((prev) => [
        ...prev,
        createSystemMessage(state.createId, `[${event.agentId}] 摘要: ${event.summary || "(empty)"}`),
      ]);
      return;
    }
    case "content": {
      const nextContent = assistantContent + event.text;
      setAssistantContent(nextContent);
      state.setStreamingContent(nextContent);
      return;
    }
    case "tool_call": {
      const toolMessage = createToolMessage(state.createId, event.name, event.args);
      state.toolMessageIdsRef.current[event.id] = toolMessage.id;
      state.toolStartTimesRef.current[event.id] = Date.now();
      state.setMessages((prev) => [...prev, toolMessage]);
      return;
    }
    case "tool_result": {
      const messageId = state.toolMessageIdsRef.current[event.id];
      const startedAt = state.toolStartTimesRef.current[event.id] ?? Date.now();
      if (!messageId) {
        return;
      }
      state.setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) {
            return message;
          }
          return {
            ...message,
            toolStatus: event.success ? "success" : "error",
            toolDuration: Date.now() - startedAt,
            toolResult: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
          };
        }),
      );
      delete state.toolMessageIdsRef.current[event.id];
      delete state.toolStartTimesRef.current[event.id];
      return;
    }
    case "error": {
      state.setMessages((prev) => [...prev, createSystemMessage(state.createId, `错误: ${event.message}`)]);
      return;
    }
    case "thought":
    case "citation":
    case "finished":
    case "agent_start":
    case "agent_complete":
      return;
  }
}
