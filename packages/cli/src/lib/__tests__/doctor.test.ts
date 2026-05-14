import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDoctorReport, getProviderDiagnostics, runDoctor } from "../doctor";

describe("doctor", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sacode-doctor-"));
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({
      name: "doctor-project",
      packageManager: "pnpm@9.15.0",
    }), "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("detects provider env without exposing key value", async () => {
    const provider = await getProviderDiagnostics({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-value",
      OPENAI_MODEL: "gpt-test",
      OPENAI_BASE_URL: "https://example.test/v1",
    });

    expect(provider).toEqual({
      type: "openai",
      model: "gpt-test",
      baseUrl: "https://example.test/v1",
      apiKeyPresent: true,
      apiKeyEnv: "OPENAI_API_KEY",
    });
    expect(JSON.stringify(provider)).not.toContain("secret-value");
  });

  it("reports missing provider key as blocking issue", async () => {
    const report = await runDoctor(tempDir, { AI_PROVIDER: "openai" });

    expect(report.ok).toBe(false);
    expect(report.provider.apiKeyPresent).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Provider API key", status: "fail" }),
      expect.objectContaining({ name: "Workspace", status: "pass" }),
      expect.objectContaining({ name: "Tools", status: "pass" }),
    ]));
  });

  it("passes provider key check when configured", async () => {
    const report = await runDoctor(tempDir, {
      AI_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "secret-value",
    });

    expect(report.provider).toMatchObject({
      type: "deepseek",
      model: "deepseek-chat",
      apiKeyPresent: true,
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Provider API key", status: "pass" }),
    ]));
    expect(JSON.stringify(report)).not.toContain("secret-value");
  });

  it("formats doctor report without exposing secrets", async () => {
    const report = await runDoctor(tempDir, {
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-value",
      OPENAI_MODEL: "gpt-test",
    });
    const output = formatDoctorReport(report);

    expect(output).toContain("SaCode Doctor");
    expect(output).toContain("OPENAI_API_KEY is set");
    expect(output).not.toContain("secret-value");
  });
});
