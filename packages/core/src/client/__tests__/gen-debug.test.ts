import { describe, it, expect, vi } from "vitest";

describe("Generator Debug", () => {
  it("direct async generator", async () => {
    async function* gen() {
      yield { type: "text_delta", text: "Hello" };
      yield { type: "done", stopReason: "end_turn" };
    }
    const stream = gen();
    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
  });

  it("vi.fn wrapped async generator", async () => {
    const chatFn = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "Hello" };
      yield { type: "done" as const, stopReason: "end_turn" };
    });
    const stream = chatFn({ messages: [] });
    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
  });

  it("object with vi.fn chat", async () => {
    const provider = {
      type: "openai",
      model: "gpt-4o",
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Hello" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };
    const stream = provider.chat({ messages: [] });
    console.log("stream type:", typeof stream);
    console.log("has asyncIterator:", stream?.[Symbol.asyncIterator] !== undefined);
    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
  });
});
