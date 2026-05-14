import { describe, expect, it } from "vitest";
import {
  createAssistantDeltaEvent,
  createCompleteEvent,
  createStartEvent,
  createSystemEvent,
  getPrintOutputFormat,
  serializeJsonEvent,
} from "../print-output";
import type { ProviderConfig } from "@sacode/core";
import type { WorkspaceContextSummary } from "../workspace-context";

const providerConfig: ProviderConfig = {
  type: "openai",
  apiKey: "test-key",
  model: "gpt-test",
};

const workspace: WorkspaceContextSummary = {
  cwd: "/tmp/project",
  projectName: "project",
  scripts: ["build", "test"],
  workspacePackages: ["packages/cli"],
  configFiles: ["package.json"],
  topLevelEntries: ["package.json", "packages/"],
};

describe("print output", () => {
  it("chooses stream-json before json and falls back to text", () => {
    expect(getPrintOutputFormat({})).toBe("text");
    expect(getPrintOutputFormat({ json: true })).toBe("json");
    expect(getPrintOutputFormat({ streamJson: true })).toBe("stream-json");
    expect(getPrintOutputFormat({ json: true, streamJson: true })).toBe("stream-json");
  });

  it("creates stable start, delta, and system events", () => {
    expect(createStartEvent({ session: "s1", providerConfig, workspace })).toEqual({
      type: "start",
      session: "s1",
      model: "gpt-test",
      workspace,
    });
    expect(createAssistantDeltaEvent("hello")).toEqual({ type: "assistant_delta", text: "hello" });
    expect(createSystemEvent("warning")).toEqual({ type: "system", message: "warning" });
  });

  it("creates complete event with success and events", () => {
    const event = createCompleteEvent({
      content: "done",
      providerConfig,
      durationMs: 12,
      errors: [],
      workspace,
      events: [createAssistantDeltaEvent("done")],
    });

    expect(event).toMatchObject({
      type: "complete",
      content: "done",
      session: "default",
      model: "gpt-test",
      durationMs: 12,
      success: true,
      errors: [],
      workspace,
    });
    expect(event.events).toEqual([{ type: "assistant_delta", text: "done" }]);
  });

  it("marks complete event as failed when errors exist", () => {
    expect(createCompleteEvent({
      content: "",
      providerConfig,
      durationMs: 1,
      errors: ["failed"],
      workspace,
    }).success).toBe(false);
  });

  it("serializes events as newline-delimited JSON", () => {
    expect(serializeJsonEvent({ type: "system", message: "ok" })).toBe('{"type":"system","message":"ok"}\n');
  });
});
