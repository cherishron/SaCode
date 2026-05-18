import { describe, expect, it, vi } from "vitest";
import type { UserPreferences } from "@sacode/core";
import {
  shouldUseSharedSlashRouter,
  tryExecuteSharedSlashCommand,
} from "../shared-router";

vi.mock("../../../lib/command-router", () => ({
  routeSlashCommand: vi.fn(),
}));

import { routeSlashCommand } from "../../../lib/command-router";

function createPreferences(): UserPreferences {
  return {
    language: "zh-CN",
    defaultModel: "deepseek/deepseek-chat",
    defaultProvider: "deepseek",
    customInstructions: "",
    outputStyle: "concise",
    showToolDetails: true,
    showThinking: true,
    theme: "dark",
    timezone: "Asia/Shanghai",
    workMode: "smart",
    version: "1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("shared chat slash router", () => {
  it("detects commands that should use shared router", () => {
    expect(shouldUseSharedSlashRouter("/agent list")).toBe(true);
    expect(shouldUseSharedSlashRouter("/model use openai/gpt-4o")).toBe(true);
    expect(shouldUseSharedSlashRouter("/auth list")).toBe(true);
    expect(shouldUseSharedSlashRouter("/session list")).toBe(true);
    expect(shouldUseSharedSlashRouter("/recall 项目配置")).toBe(true);
    expect(shouldUseSharedSlashRouter("/remember 使用 TypeScript 严格模式")).toBe(true);
    expect(shouldUseSharedSlashRouter("/theme dark")).toBe(false);
    expect(shouldUseSharedSlashRouter("/auth add")).toBe(false);
    expect(shouldUseSharedSlashRouter("/session clear")).toBe(false);
  });

  it("maps shared message result into system output", async () => {
    vi.mocked(routeSlashCommand).mockResolvedValueOnce({
      type: "message",
      content: "共享命令输出",
    });

    const appendSystemMessage = vi.fn();
    const handled = await tryExecuteSharedSlashCommand({
      input: "/doctor",
      tools: ["read_file"],
      workspaceContext: "工作目录: /workspace/SaCode",
      model: "deepseek/deepseek-chat",
      language: "zh-CN",
      session: "s1",
      preferences: { ...createPreferences() },
      setLanguage: vi.fn(),
      setCurrentModel: vi.fn(),
      handleExit: vi.fn(),
      appendSystemMessage,
      clearMessages: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(appendSystemMessage).toHaveBeenCalledWith("共享命令输出");
  });

  it("maps clear and exit actions", async () => {
    const clearMessages = vi.fn();
    const handleExit = vi.fn();

    vi.mocked(routeSlashCommand).mockResolvedValueOnce({ type: "clear" });
    expect(await tryExecuteSharedSlashCommand({
      input: "/clear",
      tools: [],
      workspaceContext: "ctx",
      model: "m",
      language: "zh-CN",
      preferences: { ...createPreferences() },
      setLanguage: vi.fn(),
      setCurrentModel: vi.fn(),
      handleExit,
      appendSystemMessage: vi.fn(),
      clearMessages,
    })).toBe(true);
    expect(clearMessages).toHaveBeenCalled();

    vi.mocked(routeSlashCommand).mockResolvedValueOnce({ type: "exit" });
    expect(await tryExecuteSharedSlashCommand({
      input: "/exit",
      tools: [],
      workspaceContext: "ctx",
      model: "m",
      language: "zh-CN",
      preferences: { ...createPreferences() },
      setLanguage: vi.fn(),
      setCurrentModel: vi.fn(),
      handleExit,
      appendSystemMessage: vi.fn(),
      clearMessages,
    })).toBe(true);
    expect(handleExit).toHaveBeenCalled();
  });
});
