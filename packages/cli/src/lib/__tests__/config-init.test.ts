import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiKeyEnvFor, initUserConfig, isSupportedProvider } from "../config-init";
import { loadProviderStore } from "../provider-store";

describe("config init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sacode-config-init-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates user-level provider config without writing .env", async () => {
    const previousHome = process.env.HOME;
    process.env.HOME = tempDir;
    const result = await initUserConfig({ provider: "anthropic", model: "claude-test", apiKeyEnv: "ANTHROPIC_TEST_KEY" });
    const loaded = await loadProviderStore();
    process.env.HOME = previousHome;

    expect(result).toMatchObject({ created: true, provider: "anthropic", apiKeyEnv: "ANTHROPIC_TEST_KEY" });
    expect(result.apiKeyEnv).toBe("ANTHROPIC_TEST_KEY");
    expect(loaded.defaultModel).toBe("anthropic/claude-test");
    await expect(fs.access(path.join(tempDir, ".env"))).rejects.toBeTruthy();
  });

  it("validates supported providers and env var names", () => {
    expect(isSupportedProvider("openai")).toBe(true);
    expect(isSupportedProvider("unknown")).toBe(false);
    expect(apiKeyEnvFor("zhipu")).toBe("ZHIPU_API_KEY");
  });
});
