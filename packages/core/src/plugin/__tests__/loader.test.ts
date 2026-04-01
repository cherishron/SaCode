/**
 * PluginLoader 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PluginLoader } from "../loader";
import type { Plugin, PluginContext, PluginManifest } from "../types";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock Plugin Context
function createMockContext(): PluginContext {
  return {
    pluginName: "test-plugin",
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    config: {
      get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(() => false),
      getAll: vi.fn(() => ({})),
    },
    adapters: {
      getAdapter: vi.fn(),
      getConnectedAdapters: vi.fn(() => []),
      sendMessage: vi.fn(),
    },
    scheduler: {
      addTask: vi.fn(),
      removeTask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as never,
    database: {} as never,
    client: {} as never,
    storage: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      getAll: vi.fn(() => ({})),
    },
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerMessageHandler: vi.fn(),
    sendMessage: vi.fn(),
  };
}

describe("PluginLoader", () => {
  let loader: PluginLoader;

  beforeEach(() => {
    loader = new PluginLoader({ loadTimeout: 5000 });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // =========================================================================
  // loadManifest 测试
  // =========================================================================

  describe("loadManifest", () => {
    it("should load valid manifest", async () => {
      const validManifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        main: "index.js",
        description: "A test plugin",
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(validManifest));

      const manifest = await loader.loadManifest("/plugins/test-plugin");

      expect(manifest.name).toBe("test-plugin");
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.main).toBe("index.js");
    });

    it("should throw if manifest file not found", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(loader.loadManifest("/plugins/missing")).rejects.toThrow(
        "Plugin manifest not found"
      );
    });

    it("should throw if manifest has invalid JSON", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue("not valid json");

      await expect(loader.loadManifest("/plugins/invalid")).rejects.toThrow(
        "Invalid plugin.json"
      );
    });

    it("should throw if name is missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({ version: "1.0.0", main: "index.js" })
      );

      await expect(loader.loadManifest("/plugins/no-name")).rejects.toThrow(
        "missing required field: name"
      );
    });

    it("should throw if version is missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({ name: "test-plugin", main: "index.js" })
      );

      await expect(loader.loadManifest("/plugins/no-version")).rejects.toThrow(
        "missing required field: version"
      );
    });

    it("should throw if main is missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({ name: "test-plugin", version: "1.0.0" })
      );

      await expect(loader.loadManifest("/plugins/no-main")).rejects.toThrow(
        "missing required field: main"
      );
    });

    it("should validate plugin name format (kebab-case)", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({ name: "InvalidName", version: "1.0.0", main: "index.js" })
      );

      await expect(loader.loadManifest("/plugins/invalid-name")).rejects.toThrow(
        "must be kebab-case"
      );
    });

    it("should validate version format (semver)", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({ name: "test-plugin", version: "invalid", main: "index.js" })
      );

      await expect(loader.loadManifest("/plugins/invalid-version")).rejects.toThrow(
        "must be semver format"
      );
    });

    it("should accept valid semver formats", async () => {
      const versions = ["1.0.0", "0.1.0", "1.0.0-beta", "1.0.0-alpha.1", "1.0.0+build.123"];

      for (const version of versions) {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          JSON.stringify({ name: "test-plugin", version, main: "index.js" })
        );

        const manifest = await loader.loadManifest(`/plugins/${version}`);
        expect(manifest.version).toBe(version);
      }
    });
  });

  // =========================================================================
  // validate 测试
  // =========================================================================

  describe("validate", () => {
    function createTestPlugin(overrides: Partial<Plugin> = {}): Plugin {
      return {
        name: "test-plugin",
        version: "1.0.0",
        manifest: {
          name: "test-plugin",
          version: "1.0.0",
          main: "index.js",
        },
        status: "discovered",
        path: "/plugins/test-plugin",
        config: {},
        ...overrides,
      };
    }

    it("should validate a valid plugin", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const plugin = createTestPlugin();

      const result = loader.validate(plugin);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing name", () => {
      const plugin = createTestPlugin({ name: undefined as never });

      const result = loader.validate(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Plugin missing required property: name");
    });

    it("should detect missing version", () => {
      const plugin = createTestPlugin({ version: undefined as never });

      const result = loader.validate(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Plugin missing required property: version");
    });

    it("should detect missing manifest", () => {
      const plugin = createTestPlugin({ manifest: undefined as never });

      const result = loader.validate(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Plugin missing required property: manifest");
    });

    it("should detect non-function lifecycle methods", () => {
      const plugin = createTestPlugin({
        install: "not a function" as unknown as () => Promise<void>,
      });

      const result = loader.validate(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("lifecycle method"))).toBe(true);
    });

    it("should detect invalid tool definitions", () => {
      const plugin = createTestPlugin({
        capabilities: {
          tools: [
            { name: "tool1", description: "", parameters: {}, execute: vi.fn() },
            { name: "", description: "", parameters: {}, execute: vi.fn() }, // invalid: empty name
            { name: "tool3", description: "", parameters: {}, execute: undefined as never }, // invalid: no execute
          ],
        },
      });

      const result = loader.validate(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid tool definition"))).toBe(true);
    });

    it("should detect invalid command definitions", () => {
      const plugin = createTestPlugin({
        capabilities: {
          commands: [
            { name: "", description: "", handler: vi.fn() }, // invalid: empty name
          ],
        },
      });

      const result = loader.validate(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid command definition"))).toBe(true);
    });

    it("should warn about missing required config with default", () => {
      const plugin = createTestPlugin({
        manifest: {
          name: "test-plugin",
          version: "1.0.0",
          main: "index.js",
          config: {
            apiKey: { type: "string", required: true, default: "default-key" },
          },
        },
        config: {},
      });

      const result = loader.validate(plugin);

      expect(result.warnings.some((w) => w.includes("using default value"))).toBe(true);
    });

    it("should error on missing required config without default", () => {
      const plugin = createTestPlugin({
        manifest: {
          name: "test-plugin",
          version: "1.0.0",
          main: "index.js",
          config: {
            apiKey: { type: "string", required: true },
          },
        },
        config: {},
      });

      const result = loader.validate(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Required config") && e.includes("missing"))).toBe(true);
    });
  });

  // =========================================================================
  // isPluginDirectory 测试
  // =========================================================================

  describe("isPluginDirectory", () => {
    it("should return true for valid plugin directory", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = await loader.isPluginDirectory("/plugins/test-plugin");

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(
        path.join("/plugins/test-plugin", "plugin.json")
      );
    });

    it("should return false for non-plugin directory", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await loader.isPluginDirectory("/plugins/non-plugin");

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // mergeConfigs 测试
  // =========================================================================

  describe("mergeConfigs", () => {
    it("should merge default and user configs", () => {
      const defaultConfig = { timeout: 30000, debug: false };
      const userConfig = { timeout: 60000, apiKey: "abc123" };

      const result = loader.mergeConfigs(defaultConfig, userConfig);

      expect(result).toEqual({
        timeout: 60000, // user override
        debug: false, // from default
        apiKey: "abc123", // from user
      });
    });

    it("should handle undefined configs", () => {
      expect(loader.mergeConfigs(undefined, undefined)).toEqual({});
      expect(loader.mergeConfigs({ a: 1 }, undefined)).toEqual({ a: 1 });
      expect(loader.mergeConfigs(undefined, { b: 2 })).toEqual({ b: 2 });
    });
  });

  // =========================================================================
  // validateConfig 测试
  // =========================================================================

  describe("validateConfig", () => {
    it("should validate correct type", () => {
      const result = loader.validateConfig("test", { type: "string" });
      expect(result.valid).toBe(true);
    });

    it("should detect wrong type", () => {
      const result = loader.validateConfig(123, { type: "string" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Expected type");
    });

    it("should validate array type", () => {
      const result = loader.validateConfig([1, 2, 3], { type: "array" });
      expect(result.valid).toBe(true);
    });

    it("should validate enum values", () => {
      const result = loader.validateConfig("option1", { enum: ["option1", "option2"] });
      expect(result.valid).toBe(true);

      const invalidResult = loader.validateConfig("option3", { enum: ["option1", "option2"] });
      expect(invalidResult.valid).toBe(false);
    });

    it("should validate number range (min/max)", () => {
      const validResult = loader.validateConfig(50, { type: "number", min: 0, max: 100 });
      expect(validResult.valid).toBe(true);

      const tooSmall = loader.validateConfig(-1, { type: "number", min: 0 });
      expect(tooSmall.valid).toBe(false);
      expect(tooSmall.error).toContain(">=");

      const tooLarge = loader.validateConfig(101, { type: "number", max: 100 });
      expect(tooLarge.valid).toBe(false);
      expect(tooLarge.error).toContain("<=");
    });

    it("should validate string pattern", () => {
      const result = loader.validateConfig("abc123", { pattern: "^[a-z]+[0-9]+$" });
      expect(result.valid).toBe(true);

      const invalidResult = loader.validateConfig("invalid", { pattern: "^[a-z]+[0-9]+$" });
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toContain("must match pattern");
    });
  });
});
