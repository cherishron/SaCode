import type { SACODEClient } from "@sacode/core";
import { AgenticLoop } from "./loop.js";
import type { AgentConfigEntry, AgentStoreData } from "../lib/agent-store.js";
import { buildAgentDispatchPlan } from "../lib/agent-store.js";
import type { AgenticLoopConfig, StreamEvent, Tool } from "./types.js";

export interface AgentRunnerToolResolverContext {
  agent: AgentConfigEntry;
  rootDir: string;
}

export interface AgentRunnerLoopFactoryContext {
  agent: AgentConfigEntry;
  rootDir: string;
  client?: SACODEClient;
  sessionId?: string;
  modelOverride?: string;
  tools: Tool[];
}

export interface AgentRunnerOptions {
  rootDir: string;
  agentStore: AgentStoreData;
  sessionId?: string;
  contextWindow?: number;
  maxIterations?: number;
  autoApprove?: string[];
  requireApproval?: string[];
  client?: SACODEClient;
  toolResolver?: (context: AgentRunnerToolResolverContext) => Tool[];
  loopFactory?: (context: AgentRunnerLoopFactoryContext) => Pick<AgenticLoop, "run">;
}

export type AgentRunnerEvent =
  | { type: "runner_plan"; enabled: boolean; primaryAgent?: string; subAgents: string[]; reason: string }
  | { type: "agent_start"; agentId: string; role: "primary" | "sub" }
  | { type: "agent_complete"; agentId: string; role: "primary" | "sub" }
  | { type: "agent_summary"; agentId: string; role: "primary" | "sub"; summary: string }
  | ({ agentId: string; role: "primary" | "sub" } & StreamEvent);

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_ITERATIONS = 25;

export class AgentRunner {
  private readonly rootDir: string;
  private readonly agentStore: AgentStoreData;
  private readonly sessionId?: string;
  private readonly contextWindow: number;
  private readonly maxIterations: number;
  private readonly autoApprove: string[];
  private readonly requireApproval: string[];
  private readonly client?: SACODEClient;
  private readonly toolResolver: (context: AgentRunnerToolResolverContext) => Tool[];
  private readonly loopFactory: (context: AgentRunnerLoopFactoryContext) => Pick<AgenticLoop, "run">;

  constructor(options: AgentRunnerOptions) {
    this.rootDir = options.rootDir;
    this.agentStore = options.agentStore;
    this.sessionId = options.sessionId;
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.autoApprove = options.autoApprove ?? ["file_read", "file_search", "code_search"];
    this.requireApproval = options.requireApproval ?? ["file_write", "shell_exec", "diff_apply"];
    this.client = options.client;
    this.toolResolver = options.toolResolver ?? (() => []);
    this.loopFactory = options.loopFactory ?? ((context) => this.createLoop(context));
  }

  async *run(prompt: string): AsyncGenerator<AgentRunnerEvent> {
    const plan = buildAgentDispatchPlan(this.agentStore, prompt);
    yield {
      type: "runner_plan",
      enabled: plan.enabled,
      subAgents: plan.subAgents.map((agent) => agent.id),
      reason: plan.reason,
      ...(plan.primaryAgent ? { primaryAgent: plan.primaryAgent.id } : {}),
    };

    if (!plan.primaryAgent) {
      yield {
        type: "error",
        agentId: "runner",
        role: "primary",
        message: "No enabled agent is available.",
      };
      return;
    }

    const summaries = await this.collectSubAgentSummaries(prompt, plan.subAgents);
    for (const summary of summaries) {
      yield summary;
    }

    const promptWithDelegation = this.composePrimaryPrompt(prompt, summaries);
    yield { type: "agent_start", agentId: plan.primaryAgent.id, role: "primary" };
    const primaryLoop = this.createAgentLoop(plan.primaryAgent);

    for await (const event of primaryLoop.run(promptWithDelegation)) {
      yield this.attachAgentContext(event, plan.primaryAgent.id, "primary");
    }

    yield { type: "agent_complete", agentId: plan.primaryAgent.id, role: "primary" };
  }

  private async collectSubAgentSummaries(
    prompt: string,
    subAgents: AgentConfigEntry[],
  ): Promise<AgentRunnerEvent[]> {
    if (subAgents.length === 0) {
      return [];
    }

    const results = await Promise.all(
      subAgents.map(async (agent) => {
        const events: AgentRunnerEvent[] = [{ type: "agent_start", agentId: agent.id, role: "sub" }];
        const loop = this.createAgentLoop(agent);
        let summary = "";

        for await (const event of loop.run(this.composeSubAgentPrompt(prompt, agent))) {
          events.push(this.attachAgentContext(event, agent.id, "sub"));
          if (event.type === "content") {
            summary += event.text;
          }
        }

        events.push({
          type: "agent_summary",
          agentId: agent.id,
          role: "sub",
          summary: summary.trim(),
        });
        events.push({ type: "agent_complete", agentId: agent.id, role: "sub" });
        return events;
      }),
    );

    return results.flat();
  }

  private createAgentLoop(agent: AgentConfigEntry): Pick<AgenticLoop, "run"> {
    const tools = this.toolResolver({ agent, rootDir: this.rootDir });
    return this.loopFactory({
      agent,
      rootDir: this.rootDir,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(agent.model ? { modelOverride: agent.model } : {}),
      tools,
      ...(this.client ? { client: this.client } : {}),
    });
  }

  private createLoop(context: AgentRunnerLoopFactoryContext): AgenticLoop {
    const config: AgenticLoopConfig = {
      maxIterations: this.maxIterations,
      tools: context.tools,
      contextWindow: this.contextWindow,
      autoApprove: this.autoApprove,
      requireApproval: this.requireApproval,
    };

    return new AgenticLoop(
      config,
      context.rootDir,
      context.client,
      context.sessionId,
      context.modelOverride,
    );
  }

  private composeSubAgentPrompt(prompt: string, agent: AgentConfigEntry): string {
    const lines = [
      `You are the sub-agent \"${agent.name}\" (${agent.id}).`,
      `Model preference: ${agent.model}.`,
      `Available tools: ${agent.tools.join(", ") || "none"}.`,
      "Provide a concise specialist result for the primary agent.",
      "Focus on your specialty and do not repeat generic explanations.",
      "",
      `User request: ${prompt}`,
    ];
    return lines.join("\n");
  }

  private composePrimaryPrompt(prompt: string, summaries: AgentRunnerEvent[]): string {
    const subAgentSummaries = summaries.filter(
      (event): event is Extract<AgentRunnerEvent, { type: "agent_summary" }> => event.type === "agent_summary",
    );

    if (subAgentSummaries.length === 0) {
      return prompt;
    }

    const lines = [prompt, "", "Sub-agent findings:"];
    for (const summary of subAgentSummaries) {
      lines.push(`- ${summary.agentId}: ${summary.summary || "(no summary)"}`);
    }
    return lines.join("\n");
  }

  private attachAgentContext(
    event: StreamEvent,
    agentId: string,
    role: "primary" | "sub",
  ): AgentRunnerEvent {
    return {
      ...event,
      agentId,
      role,
    } as AgentRunnerEvent;
  }
}
