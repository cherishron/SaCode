import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultProviderStore,
  ensureProviderStore,
  formatModels,
  formatProviders,
  getProviderStorePath,
  providerConfigForModelRef,
  providerConfigFromStore,
  testModelConfiguration,
  loadProviderStore,
  saveProviderStore,
  setDefaultModel,
  upsertProviderModel,
} from "../provider-store";

describe("provider store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "sacode-provider-store-"));
  });

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
  });

  it("creates default provider store", async () => {
    const data = await ensureProviderStore({ configDir });
    const storePath = getProviderStorePath({ configDir });

    expect(data.defaultModel).toBe("openai/gpt-4o");
    expect(data.providers[0]?.adapter).toBe("openai-compatible");
    await expect(fs.access(storePath)).resolves.toBeUndefined();
  });

  it("saves and loads custom provider model lists", async () => {
    await saveProviderStore({
      providers: [{
        id: "deepseek",
        name: "DeepSeek",
        adapter: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        models: [
          { id: "deepseek-chat", label: "DeepSeek Chat", capabilities: ["chat", "tool_calling"] },
        ],
      }],
      defaultModel: "deepseek/deepseek-chat",
    }, { configDir });

    const loaded = await loadProviderStore({ configDir });
    expect(loaded.defaultModel).toBe("deepseek/deepseek-chat");
    expect(formatProviders(loaded)).toContain("deepseek");
    expect(formatModels(loaded)).toContain("* deepseek/deepseek-chat");
  });

  it("sets and tests default model configuration", async () => {
    await ensureProviderStore({ configDir });
    const updated = await setDefaultModel("openai/gpt-4o", { configDir });

    expect(updated.defaultModel).toBe("openai/gpt-4o");
    expect(testModelConfiguration(updated, "openai/gpt-4o")).toMatchObject({ ok: true });
    expect(testModelConfiguration(updated, "openai/missing")).toMatchObject({ ok: false });
  });

  it("upserts provider models and converts to provider config", async () => {
    const updated = await upsertProviderModel({
      provider: "deepseek",
      name: "DeepSeek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    }, { configDir });

    expect(updated.defaultModel).toBe("deepseek/deepseek-chat");
    expect(providerConfigFromStore(updated, { DEEPSEEK_API_KEY: "secret" })).toEqual({
      type: "deepseek",
      apiKey: "secret",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
    });
    expect(providerConfigForModelRef(updated, "deepseek/deepseek-chat", { DEEPSEEK_API_KEY: "secret" })).toEqual({
      type: "deepseek",
      apiKey: "secret",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
    });
  });

  it("falls back to default store for invalid data", async () => {
    await fs.writeFile(getProviderStorePath({ configDir }), "{}", "utf-8");
    expect(await loadProviderStore({ configDir })).toEqual({ providers: [] });
    expect(createDefaultProviderStore().providers.length).toBeGreaterThan(0);
  });
});
