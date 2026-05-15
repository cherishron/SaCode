import { describe, expect, it } from "vitest";
import { handleRunnerEvent } from "../events";
import type { Message } from "../../../ui/App";
import type { AgentRunnerEvent } from "../../../agent/runner";

function applyUpdate<T>(current: T, next: T | ((value: T) => T)): T {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

function createState(messages: Message[] = [], streamingContent = "") {
  let currentMessages = messages;
  let currentStreamingContent = streamingContent;

  return {
    refs: {
      createId: () => `id-${currentMessages.length + 1}`,
      setMessages: (next: Message[] | ((value: Message[]) => Message[])) => {
        currentMessages = applyUpdate(currentMessages, next);
      },
      setStreamingContent: (next: string | ((value: string) => string)) => {
        currentStreamingContent = applyUpdate(currentStreamingContent, next);
      },
      toolMessageIdsRef: { current: {} as Record<string, string> },
      toolStartTimesRef: { current: {} as Record<string, number> },
    },
    getMessages: () => currentMessages,
    getStreamingContent: () => currentStreamingContent,
  };
}

describe("handleRunnerEvent", () => {
  it("appends collaboration summary system message", () => {
    const state = createState();
    const event: AgentRunnerEvent = {
      type: "runner_plan",
      enabled: true,
      primaryAgent: "lead",
      subAgents: ["reviewer"],
      reason: "matched enabled sub agents",
    };

    handleRunnerEvent(event, state.refs, "", () => {});

    expect(state.getMessages()[0]?.content).toContain("已启用多 Agent 协作");
    expect(state.getMessages()[0]?.content).toContain("reviewer");
  });

  it("tracks tool call and tool result into tool message", () => {
    const state = createState();
    const toolCall: AgentRunnerEvent = {
      type: "tool_call",
      agentId: "lead",
      role: "primary",
      id: "call-1",
      name: "file_read",
      args: { path: "README.md" },
    };

    handleRunnerEvent(toolCall, state.refs, "", () => {});

    expect(state.getMessages()[0]?.role).toBe("tool");
    expect(state.getMessages()[0]?.toolStatus).toBe("running");

    const toolResult: AgentRunnerEvent = {
      type: "tool_result",
      agentId: "lead",
      role: "primary",
      id: "call-1",
      name: "file_read",
      result: "file content",
      success: true,
      duration: 12,
    };

    handleRunnerEvent(toolResult, state.refs, "", () => {});

    expect(state.getMessages()[0]?.toolStatus).toBe("success");
    expect(state.getMessages()[0]?.toolResult).toBe("file content");
  });

  it("updates streaming assistant content from content events", () => {
    const state = createState();
    let assistantContent = "";
    const event: AgentRunnerEvent = {
      type: "content",
      agentId: "lead",
      role: "primary",
      text: "hello",
    };

    handleRunnerEvent(event, state.refs, assistantContent, (value) => {
      assistantContent = value;
    });

    expect(assistantContent).toBe("hello");
    expect(state.getStreamingContent()).toBe("hello");
  });
});
