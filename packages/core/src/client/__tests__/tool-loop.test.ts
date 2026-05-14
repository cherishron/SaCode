import { describe, expect, it, vi } from "vitest";
import { SACODEClient } from "../index";
import { registerProvider } from "../../provider";
import type { AIProvider, ChatCompletionOptions, ProviderConfig, StreamChunk, ToolCall, ToolCallResult, ToolDefinition } from "../../provider";

const chatCalls: ChatCompletionOptions[] = [];
const registeredTools: ToolDefinition[] = [];

function createFakeProvider(): AIProvider {
  return {
    type: "openai",
    model: "fake-model",
    isInitialized: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    registerTool: vi.fn((tool: ToolDefinition) => {
      registeredTools.push(tool);
    }),
    executeToolCall: vi.fn(),
    chat: vi.fn(fakeChat),
  };
}

async function* fakeChat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
  chatCalls.push(options);
  if (chatCalls.length === 1) {
    yield {
      type: "tool_call",
      toolCall: {
        id: "call_read",
        type: "function",
        function: {
          name: "read_file",
          arguments: JSON.stringify({ path: "package.json" }),
        },
      },
    } satisfies StreamChunk;
    yield { type: "done", stopReason: "tool_use" } satisfies StreamChunk;
    return;
  }

  yield { type: "text_delta", text: "tool result consumed" } satisfies StreamChunk;
  yield { type: "done", stopReason: "end_turn" } satisfies StreamChunk;
}

describe("SACODEClient tool loop", () => {
  it("emits tool events and appends tool result to provider history", async () => {
    chatCalls.length = 0;
    registeredTools.length = 0;
    registerProvider("openai", (_config: ProviderConfig) => createFakeProvider());

    const toolCallStart = vi.fn();
    const toolCallEnd = vi.fn();
    const executeReadFile = vi.fn(async () => "file content");
    const capabilitiesRegistry = {
      list: () => [{
        name: "read_file",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
        },
        execute: executeReadFile,
      }],
      has: (name: string) => name === "read_file",
      execute: vi.fn(async (_name: string, _input: unknown) => "file content"),
    };

    const client = new SACODEClient({
      provider: {
        type: "openai",
        apiKey: "fake-key",
        model: "fake-model",
      },
      maxToolLoopIterations: 3,
      toolBridge: {
        enableBuiltinTools: false,
        enableMCP: false,
        capabilitiesRegistry,
      },
    });
    client.on("tool_call_start", toolCallStart);
    client.on("tool_call_end", toolCallEnd);

    await client.connect();
    const chunks = [];
    for await (const chunk of client.chat("read package")) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.role === "assistant" && "chunk" in chunk && chunk.chunk.text === "tool result consumed")).toBe(true);
    expect(toolCallStart).toHaveBeenCalledWith(expect.objectContaining({ id: "call_read" } satisfies Partial<ToolCall>));
    expect(toolCallEnd).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: "call_read",
      name: "read_file",
      success: true,
      content: "file content",
    } satisfies Partial<ToolCallResult>));
    expect(executeReadFile).toHaveBeenCalledWith({ path: "package.json" });
    expect(registeredTools.map((tool) => tool.function.name)).toContain("read_file");
    expect(chatCalls).toHaveLength(2);
    expect(chatCalls[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", tool_calls: [expect.objectContaining({ id: "call_read" })] }),
      expect.objectContaining({ role: "tool", tool_call_id: "call_read", content: "file content" }),
    ]));
  });
});
