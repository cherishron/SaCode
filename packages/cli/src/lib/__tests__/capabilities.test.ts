import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliToolRegistryAdapter } from "../capabilities";

describe("CLI capabilities registry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sacode-capabilities-"));
    await fs.writeFile(path.join(tempDir, "sample.txt"), "hello\nworld\n", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("allows safe read_file without confirmation", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const { capabilities, registry } = createCliToolRegistryAdapter(tempDir, { confirm });

    try {
      const result = await registry.execute("read_file", {
        path: path.join(tempDir, "sample.txt"),
        limit: 1,
      });

      expect(result).toBe("hello");
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      await capabilities.shutdown();
    }
  });

  it("denies dangerous write_file when confirmation rejects", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const { capabilities, registry } = createCliToolRegistryAdapter(tempDir, { confirm });
    const targetPath = path.join(tempDir, "denied.txt");

    try {
      await expect(registry.execute("write_file", {
        path: targetPath,
        content: "denied",
      })).rejects.toThrow("Tool execution denied: write_file");

      await expect(fs.access(targetPath)).rejects.toThrow();
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      await capabilities.shutdown();
    }
  });
});
