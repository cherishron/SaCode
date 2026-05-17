import { describe, expect, it } from "vitest";
import { AgentRunner } from "../runner";
import type { AgentRuntimeClient } from "../client";
import type { AgentConfigEntry, AgentStoreData } from "../../lib/agent-store";
import type { StreamEvent, Tool } from "../types";

function createAgent(id: string, overrides: Partial<AgentConfigEntry> = {}): AgentConfigEntry {
  return {
    id,
    name: id,
    model: "openai/gpt-4o",
    tools: ["file_read"],
    permissionProfile: "local-safe",
    enabled: true,
    subAgents: [],
    ...overrides,
  };
}

function createStore(overrides: Partial<AgentStoreData> = {}): AgentStoreData {
  return {
    defaultAgent: "lead",
    collaborationEnabled: false,
    subAgentDispatchEnabled: false,
    agents: [createAgent("lead")],
    ...overrides,
  };
}

async function collectEvents(runner: AgentRunner, prompt: string) {
  const events = [] as Array<Awaited<ReturnType<typeof runner.run>> extends AsyncGenerator<infer T> ? T : never>;
  for await (const event of runner.run(prompt)) {
    events.push(event);
  }
  return events;
}

describe("AgentRunner", () => {
  it("runs only the primary agent when collaboration is disabled", async () => {
    const seenPrompts: string[] = [];
    const runner = new AgentRunner({
      rootDir: "/workspace/SaCode",
      agentStore: createStore(),
      toolResolver: () => [] satisfies Tool[],
      loopFactory: ({ agent }) => ({
        run: async function* (prompt: string): AsyncGenerator<StreamEvent> {
          seenPrompts.push(`${agent.id}:${prompt}`);
          yield { type: "content", text: `reply:${agent.id}` };
          yield { type: "finished", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        },
      }),
    });

    const events = await collectEvents(runner, "implement feature");

    expect(events[0]).toMatchObject({ type: "runner_plan", enabled: false, primaryAgent: "lead" });
    expect(events.some((event) => event.type === "agent_summary")).toBe(false);
    expect(seenPrompts).toEqual(["lead:implement feature"]);
  });

  it("collects sub-agent summaries when collaboration and dispatch are enabled", async () => {
    const runner = new AgentRunner({
      rootDir: "/workspace/SaCode",
      agentStore: createStore({
        collaborationEnabled: true,
        subAgentDispatchEnabled: true,
        agents: [
          createAgent("lead", { subAgents: ["reviewer"] }),
          createAgent("reviewer", { description: "review code quality" }),
        ],
      }),
      toolResolver: () => [] satisfies Tool[],
      loopFactory: ({ agent }) => ({
        run: async function* (): AsyncGenerator<StreamEvent> {
          yield { type: "content", text: `${agent.id}-summary` };
          yield { type: "finished", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        },
      }),
    });

    const events = await collectEvents(runner, "please review code");

    expect(events[0]).toMatchObject({
      type: "runner_plan",
      enabled: true,
      primaryAgent: "lead",
      subAgents: ["reviewer"],
    });
    expect(events).toContainEqual({
      type: "agent_summary",
      agentId: "reviewer",
      role: "sub",
      summary: "reviewer-summary",
    });
  });

  it("passes sub-agent findings into the primary prompt", async () => {
    const seenPrompts: string[] = [];
    const runner = new AgentRunner({
      rootDir: "/workspace/SaCode",
      agentStore: createStore({
        collaborationEnabled: true,
        subAgentDispatchEnabled: true,
        agents: [
          createAgent("lead", { subAgents: ["reviewer"] }),
          createAgent("reviewer", { description: "review code quality" }),
        ],
      }),
      toolResolver: () => [] satisfies Tool[],
      loopFactory: ({ agent }) => ({
        run: async function* (prompt: string): AsyncGenerator<StreamEvent> {
          seenPrompts.push(`${agent.id}:${prompt}`);
          yield { type: "content", text: `${agent.id}-done` };
          yield { type: "finished", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        },
      }),
    });

    await collectEvents(runner, "please review code");

    const primaryPrompt = seenPrompts.find((item) => item.startsWith("lead:"));
    expect(primaryPrompt).toContain("Sub-agent findings:");
    expect(primaryPrompt).toContain("- reviewer: reviewer-done");
  });

  it("passes each agent model as modelOverride to loop factory", async () => {
    const seenOverrides: string[] = [];
    const runner = new AgentRunner({
      rootDir: "/workspace/SaCode",
      agentStore: createStore({
        collaborationEnabled: true,
        subAgentDispatchEnabled: true,
        agents: [
          createAgent("lead", { model: "openai/gpt-4o", subAgents: ["reviewer"] }),
          createAgent("reviewer", { model: "anthropic/claude-3-5-sonnet", description: "review code quality" }),
        ],
      }),
      toolResolver: () => [] satisfies Tool[],
      loopFactory: ({ agent, modelOverride }) => ({
        run: async function* (): AsyncGenerator<StreamEvent> {
          seenOverrides.push(`${agent.id}:${modelOverride ?? ""}`);
          yield { type: "content", text: `${agent.id}-done` };
          yield { type: "finished", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        },
      }),
    });

    await collectEvents(runner, "please review code");

    expect(seenOverrides).toContain("lead:openai/gpt-4o");
    expect(seenOverrides).toContain("reviewer:anthropic/claude-3-5-sonnet");
  });

  it("creates per-agent clients from model refs when clientFactory is provided", async () => {
    const createdClients: string[] = [];
    const runner = new AgentRunner({
      rootDir: "/workspace/SaCode",
      agentStore: createStore({
        collaborationEnabled: true,
        subAgentDispatchEnabled: true,
        agents: [
          createAgent("lead", { model: "openai/gpt-4o", subAgents: ["reviewer"] }),
          createAgent("reviewer", { model: "anthropic/claude-3-5-sonnet", description: "review code quality" }),
        ],
      }),
      toolResolver: () => [] satisfies Tool[],
      providerConfigResolver: async (modelRef) => {
        if (modelRef === "openai/gpt-4o") {
          return { type: "openai", apiKey: "test", model: "gpt-4o" };
        }
        return { type: "anthropic", apiKey: "test", model: "claude-3-5-sonnet" };
      },
      clientFactory: async (config) => {
        createdClients.push(`${config.type}/${config.model}`);
        return {
          isConnected: () => true,
          chatWithOptions: async function* (): AsyncGenerator<unknown> {
            yield { role: "assistant", content: "ok" };
          },
        } satisfies AgentRuntimeClient;
      },
      loopFactory: ({ client }) => ({
        run: async function* (): AsyncGenerator<StreamEvent> {
          expect(client).toBeDefined();
          yield { type: "content", text: "done" };
          yield { type: "finished", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        },
      }),
    });

    await collectEvents(runner, "please review code");

    expect(createdClients).toContain("openai/gpt-4o");
    expect(createdClients).toContain("anthropic/claude-3-5-sonnet");
  });
});
