import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgentDispatchPlan, ensureAgentStore, formatAgents, getAgentStorePath, saveAgentStore, setAgentCollaboration, setSubAgentDispatch } from "../agent-store";

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
});
