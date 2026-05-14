import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectWorkspaceContext,
  formatWorkspaceContext,
  workspaceContextToPrompt,
} from "../workspace-context";

describe("workspace context", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sacode-context-"));
    await fs.mkdir(path.join(tempDir, "packages", "cli"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "README.md"), "# Test Project\n", "utf-8");
    await fs.writeFile(path.join(tempDir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({
      name: "test-project",
      packageManager: "pnpm@9.15.0",
      scripts: {
        build: "tsup",
        test: "vitest run",
      },
    }), "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("collects package, config, and top-level workspace metadata", async () => {
    const summary = await collectWorkspaceContext(tempDir);

    expect(summary.cwd).toBe(tempDir);
    expect(summary.projectName).toBe("test-project");
    expect(summary.packageManager).toBe("pnpm@9.15.0");
    expect(summary.scripts).toEqual(["build", "test"]);
    expect(summary.workspacePackages).toContain("packages/cli");
    expect(summary.configFiles).toEqual(expect.arrayContaining(["package.json", "pnpm-workspace.yaml", "README.md"]));
    expect(summary.topLevelEntries).toEqual(expect.arrayContaining(["README.md", "packages/"]));
  });

  it("formats context for TUI and prompt injection", async () => {
    const summary = await collectWorkspaceContext(tempDir);

    expect(formatWorkspaceContext(summary)).toContain("项目名称: test-project");
    expect(workspaceContextToPrompt(summary)).toContain("project: test-project");
  });
});
