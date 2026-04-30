/**
 * PluginManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { PluginManager } from "../index";
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

// Mock dependencies
function createMockDependencies() {
  return {
    adapters: {
      getAdapter: vi.fn(),
      getConnectedAdapters: vi.fn(() => []),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    scheduler: {
      addTask: vi.fn(),
      removeTask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as never,
    database: {
      plugin: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    } as never,
    client: {} as never,
  };
}

// Test plugin factory
function createTestPluginFactory(overrides: Partial<Plugin> = {}): () => Plugin {
  return () => ({
    name: "test-plugin",
    version: "1.0.0",
    manifest: {
      name: "test-plugin",
      version: "1.0.0",
      main: "index.js",
      description: "Test plugin",
    },
    status: "discovered",
    path: "",
    config: {},
    install: vi.fn(),
    uninstall: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    ...overrides,
  });
}

describe("PluginManager", () => {
  let manager: PluginManager;
  let mockDeps: ReturnType<typeof createMockDependencies>;
  const testPluginsDir = "/test/plugins";

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeps = createMockDependencies();

    manager = new PluginManager(
      {
        pluginsDir: testPluginsDir,
        autoDiscover: false,
        autoEnable: false,
        loadTimeout: 5000,
        hotReload: false,
      },
      mockDeps
    );
  });

  afterEach(() => {
    manager.removeAllListeners();
    vi.resetAllMocks();
  });

  // =========================================================================
  // 初始化测试
  // =========================================================================

  describe("initialize", () => {
    it("should create plugins directory if not exists", async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (fs.promises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await manager.initialize();

      expect(fs.promises.mkdir).toHaveBeenCalledWith(testPluginsDir, { recursive: true });
    });

    it("should auto-discover plugins when enabled", async () => {
      const discoverManager = new PluginManager(
        {
          pluginsDir: testPluginsDir,
          autoDiscover: true,
          autoEnable: false,
        },
        mockDeps
      );

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.promises.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await discoverManager.initialize();

      expect(fs.promises.readdir).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // discover 测试
  // =========================================================================

  describe("discover", () => {
    it("should discover valid plugins", async () => {
      const manifest: PluginManifest = {
        name: "discovered-plugin",
        version: "1.0.0",
        main: "index.js",
        description: "Discovered plugin",
      };

      (fs.existsSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(true) // plugins dir
        .mockReturnValueOnce(true); // plugin.json

      (fs.promises.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: "discovered-plugin", isDirectory: () => true } as fs.Dirent,
      ]);

      (fs.promises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(manifest));

      const plugins = await manager.discover();

      expect(plugins).toHaveLength(1);
      expect(plugins[0]?.name).toBe("discovered-plugin");
      expect(plugins[0]?.status).toBe("discovered");
    });

    it("should skip non-directory entries", async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.promises.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: "file.txt", isDirectory: () => false } as fs.Dirent,
      ]);

      const plugins = await manager.discover();

      expect(plugins).toHaveLength(0);
    });

    it("should skip directories without plugin.json", async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(true) // plugins dir
        .mockReturnValueOnce(false); // plugin.json not found

      (fs.promises.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: "non-plugin-dir", isDirectory: () => true } as fs.Dirent,
      ]);

      const plugins = await manager.discover();

      expect(plugins).toHaveLength(0);
    });

    it("should emit plugin:discovered event", async () => {
      const manifest: PluginManifest = {
        name: "event-plugin",
        version: "1.0.0",
        main: "index.js",
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.promises.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: "event-plugin", isDirectory: () => true } as fs.Dirent,
      ]);
      (fs.promises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(manifest));

      const handler = vi.fn();
      manager.on("plugin:discovered", handler);

      await manager.discover();

      expect(handler).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // install 测试
  // =========================================================================

  describe("install", () => {
    it("should throw if plugin not found", async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      await expect(manager.install("non-existent")).rejects.toThrow("Plugin not found");
    });

    it("should throw if already installed", async () => {
      // 模拟已安装的插件
      const plugin: Plugin = {
        name: "installed-plugin",
        version: "1.0.0",
        manifest: { name: "installed-plugin", version: "1.0.0", main: "index.js" },
        status: "installed",
        path: "/plugins/installed-plugin",
        config: {},
      };

      // 直接设置内部 plugins map
      (manager as unknown as { plugins: Map<string, Plugin> }).plugins.set(
        "installed-plugin",
        plugin
      );

      await expect(manager.install("installed-plugin")).rejects.toThrow("already installed");
    });
  });

  // =========================================================================
  // get/getAll/getEnabled 测试
  // =========================================================================

  describe("get/getAll/getEnabled", () => {
    beforeEach(() => {
      const plugins = (manager as unknown as { plugins: Map<string, Plugin> }).plugins;

      plugins.set("plugin1", {
        name: "plugin1",
        version: "1.0.0",
        manifest: { name: "plugin1", version: "1.0.0", main: "index.js" },
        status: "enabled",
        path: "/plugins/plugin1",
        config: {},
      });

      plugins.set("plugin2", {
        name: "plugin2",
        version: "1.0.0",
        manifest: { name: "plugin2", version: "1.0.0", main: "index.js" },
        status: "disabled",
        path: "/plugins/plugin2",
        config: {},
      });

      plugins.set("plugin3", {
        name: "plugin3",
        version: "1.0.0",
        manifest: { name: "plugin3", version: "1.0.0", main: "index.js" },
        status: "enabled",
        path: "/plugins/plugin3",
        config: {},
      });
    });

    it("should get plugin by name", () => {
      const plugin = manager.get("plugin1");
      expect(plugin?.name).toBe("plugin1");
    });

    it("should return undefined for non-existent plugin", () => {
      expect(manager.get("non-existent")).toBeUndefined();
    });

    it("should get all plugins", () => {
      const plugins = manager.getAll();
      expect(plugins).toHaveLength(3);
    });

    it("should get only enabled plugins", () => {
      const enabled = manager.getEnabled();
      expect(enabled).toHaveLength(2);
      expect(enabled.every((p) => p.status === "enabled")).toBe(true);
    });
  });

  // =========================================================================
  // getStats 测试
  // =========================================================================

  describe("getStats", () => {
    beforeEach(() => {
      const plugins = (manager as unknown as { plugins: Map<string, Plugin> }).plugins;

      plugins.set("plugin1", {
        name: "plugin1",
        version: "1.0.0",
        manifest: { name: "plugin1", version: "1.0.0", main: "index.js" },
        status: "enabled",
        path: "",
        config: {},
      });

      plugins.set("plugin2", {
        name: "plugin2",
        version: "1.0.0",
        manifest: { name: "plugin2", version: "1.0.0", main: "index.js" },
        status: "disabled",
        path: "",
        config: {},
      });

      plugins.set("plugin3", {
        name: "plugin3",
        version: "1.0.0",
        manifest: { name: "plugin3", version: "1.0.0", main: "index.js" },
        status: "error",
        path: "",
        config: {},
        error: new Error("Test error"),
      });
    });

    it("should return correct statistics", () => {
      const stats = manager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.enabled).toBe(1);
      expect(stats.disabled).toBe(1);
      expect(stats.error).toBe(1);
      expect(stats.installed).toBe(0);
    });
  });

  // =========================================================================
  // 事件测试
  // =========================================================================

  describe("events", () => {
    it("should be an EventEmitter", () => {
      expect(manager).toBeInstanceOf(EventEmitter);
    });

    it("should support typed event handlers", () => {
      const handler = vi.fn();
      manager.on("plugin:discovered", handler);

      expect(manager.listenerCount("plugin:discovered")).toBe(1);
    });
  });

  // =========================================================================
  // 配置测试
  // =========================================================================

  describe("config management", () => {
    beforeEach(() => {
      const plugins = (manager as unknown as { plugins: Map<string, Plugin> }).plugins;

      plugins.set("test-plugin", {
        name: "test-plugin",
        version: "1.0.0",
        manifest: {
          name: "test-plugin",
          version: "1.0.0",
          main: "index.js",
          config: {
            timeout: { type: "number", default: 30000 },
          },
        },
        status: "installed",
        path: "/plugins/test-plugin",
        config: { timeout: 30000 },
      });
    });

    it("should get plugin config", () => {
      const config = manager.getConfig("test-plugin");
      expect(config.timeout).toBe(30000);
    });

    it("should throw for non-existent plugin config", () => {
      expect(() => manager.getConfig("non-existent")).toThrow("Plugin not found");
    });

    it("should update plugin config", async () => {
      await manager.setConfig("test-plugin", { timeout: 60000 });

      const config = manager.getConfig("test-plugin");
      expect(config.timeout).toBe(60000);
    });

    it("should emit config-changed event", async () => {
      const handler = vi.fn();
      manager.on("plugin:config-changed", handler);

      await manager.setConfig("test-plugin", { timeout: 60000 });

      expect(handler).toHaveBeenCalled();
    });
  });
});
