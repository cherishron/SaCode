import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgentDispatchPlan, ensureAgentStore, formatAgents, getAgentStorePath, removeAgent, saveAgentStore, setAgentCollaboration, setSubAgentDispatch, setDefaultAgent, upsertAgent, validateAgentStore } from "../agent-store";

describe("agent store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "sacode-agent-store-"));
  });

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
  });

  it("creates a default agent store", async () => {
    const data = await ensureAgentStore({ configDir });

    expect(data.defaultAgent).toBe("general");
    expect(data.agents[0]?.model).toBe("openai/gpt-4o");
    await expect(fs.access(getAgentStorePath({ configDir }))).resolves.toBeUndefined();
  });

  it("formats configured agents", async () => {
    await saveAgentStore({
      defaultAgent: "coder",
      collaborationEnabled: false,
      subAgentDispatchEnabled: false,
      agents: [{
        id: "coder",
        name: "Coder",
        model: "deepseek/deepseek-coder",
        tools: ["read_file", "edit_file"],
        permissionProfile: "local-coding",
        enabled: true,
        subAgents: [],
      }],
    }, { configDir });

    const data = await ensureAgentStore({ configDir });
    expect(formatAgents(data)).toContain("* coder (Coder)");
    expect(formatAgents(data)).toContain("model: deepseek/deepseek-coder");
    expect(formatAgents(data)).toContain("status: enabled");
    expect(formatAgents(data)).toContain("referencedBy: none");
  });

  it("supports collaboration and sub-agent dispatch switches", async () => {
    await saveAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: false,
      subAgentDispatchEnabled: false,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: ["read_file"],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["reviewer"],
      }, {
        id: "reviewer",
        name: "Reviewer",
        model: "openai/gpt-4o",
        tools: ["read_file"],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: [],
        description: "review code changes",
      }],
    }, { configDir });

    expect(buildAgentDispatchPlan(await ensureAgentStore({ configDir }), "review code")).toMatchObject({ enabled: false });
    await setAgentCollaboration(true, { configDir });
    await setSubAgentDispatch(true, { configDir });
    const plan = buildAgentDispatchPlan(await ensureAgentStore({ configDir }), "please review code");

    expect(plan.enabled).toBe(true);
    expect(plan.primaryAgent?.id).toBe("lead");
    expect(plan.subAgents.map((agent) => agent.id)).toEqual(["reviewer"]);
  });

  it("rejects self-referencing sub-agents", () => {
    expect(() => validateAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["lead"],
      }],
    })).toThrow("Agent cannot reference itself as sub-agent: lead");
  });

  it("rejects unknown sub-agent references", () => {
    expect(() => validateAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["missing"],
      }],
    })).toThrow("Unknown sub-agent reference: lead -> missing");
  });

  it("rejects disabled sub-agent references", () => {
    expect(() => validateAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["reviewer"],
      }, {
        id: "reviewer",
        name: "Reviewer",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: false,
        subAgents: [],
      }],
    })).toThrow("Disabled sub-agent reference: lead -> reviewer");
  });

  it("rejects disabled default agent", () => {
    expect(() => validateAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: false,
      subAgentDispatchEnabled: false,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: false,
        subAgents: [],
      }],
    })).toThrow("Default agent is disabled: lead");
  });

  it("rejects removing referenced agents", async () => {
    await saveAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["reviewer"],
      }, {
        id: "reviewer",
        name: "Reviewer",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: [],
      }],
    }, { configDir });

    await expect(removeAgent("reviewer", { configDir })).rejects.toThrow("Agent is still referenced by: lead");
  });

  it("rejects short sub-agent cycles", () => {
    expect(() => validateAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["reviewer"],
      }, {
        id: "reviewer",
        name: "Reviewer",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["lead"],
      }],
    })).toThrow("Agent sub-agent cycle detected: lead -> reviewer -> lead");
  });

  it("rejects long sub-agent cycles", () => {
    expect(() => validateAgentStore({
      defaultAgent: "lead",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [{
        id: "lead",
        name: "Lead",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["reviewer"],
      }, {
        id: "reviewer",
        name: "Reviewer",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["planner"],
      }, {
        id: "planner",
        name: "Planner",
        model: "openai/gpt-4o",
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: ["lead"],
      }],
    })).toThrow("Agent sub-agent cycle detected: lead -> reviewer -> planner -> lead");
  });
});
