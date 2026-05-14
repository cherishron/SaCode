import { Router, type Request, type Response } from "express";
import { getPrismaClient } from "@sacode/database";
import {
  PluginManager,
  createPluginManager,
  type Plugin,
  type PluginManifest,
  type PluginStats,
} from "@sacode/core";
import * as path from "path";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 插件管理器实例（延迟初始化）
let pluginManager: PluginManager | null = null;

/**
 * 获取或初始化插件管理器
 */
async function getPluginManager(): Promise<PluginManager> {
  if (pluginManager) return pluginManager;

  const pluginsDir = path.resolve(process.cwd(), ".SACODE/plugins");

  pluginManager = createPluginManager(
    {
      pluginsDir,
      autoDiscover: true,
      autoEnable: false,
      loadTimeout: 30000,
      hotReload: process.env.NODE_ENV === "development",
    },
    {
      adapters: {
        getAdapter: () => null,
        getConnectedAdapters: () => [],
        sendMessage: async () => {},
      },
      scheduler: {
        addTask: async () => {},
        removeTask: async () => {},
        start: async () => {},
        stop: async () => {},
      } as never,
      database: getPrismaClient(),
      client: {} as never,
    }
  );

  await pluginManager.initialize();
  return pluginManager;
}

// ============================================================================
// 插件统计和发现
// ============================================================================

// GET /api/plugins/stats - 获取插件统计
router.get("/stats", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const manager = await getPluginManager();
    const stats: PluginStats = manager.getStats();
    res.json(stats);
  } catch (error) {
    console.error("Get plugin stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/plugins/discover - 发现可用插件
router.get("/discover", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const manager = await getPluginManager();
    const plugins = await manager.discover();
    res.json(
      plugins.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.manifest.description,
        author: p.manifest.author,
        status: p.status,
        tags: p.manifest.tags,
      }))
    );
  } catch (error) {
    console.error("Discover plugins error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// 插件 CRUD
// ============================================================================

// GET /api/plugins - 获取插件列表
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const manager = await getPluginManager();
    const { status } = req.query;

    let plugins = manager.getAll();

    if (status && typeof status === "string") {
      plugins = plugins.filter((p) => p.status === status);
    }

    res.json(
      plugins.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.manifest.description,
        author: p.manifest.author,
        status: p.status,
        enabled: p.status === "enabled",
        config: p.config,
        tags: p.manifest.tags,
        error: p.error?.message,
      }))
    );
  } catch (error) {
    console.error("Get plugins error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/plugins/:name - 获取单个插件详情
router.get("/:name", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const manager = await getPluginManager();
    const plugin = manager.get(name);

    if (!plugin) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }

    res.json({
      name: plugin.name,
      version: plugin.version,
      manifest: plugin.manifest,
      status: plugin.status,
      enabled: plugin.status === "enabled",
      config: plugin.config,
      path: plugin.path,
      error: plugin.error?.message,
      capabilities: plugin.capabilities
        ? {
            tools: plugin.capabilities.tools?.map((t) => ({
              name: t.name,
              description: t.description,
            })),
            commands: plugin.capabilities.commands?.map((c) => ({
              name: c.name,
              description: c.description,
              aliases: c.aliases,
            })),
            messageHandlers: plugin.capabilities.messageHandlers?.length || 0,
            scheduledTasks: plugin.capabilities.scheduledTasks?.length || 0,
          }
        : undefined,
    });
  } catch (error) {
    console.error("Get plugin error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plugins - 安装插件
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, source, config } = req.body;

    if (!name) {
      res.status(400).json({ error: "Plugin name is required" });
      return;
    }

    const manager = await getPluginManager();
    const plugin = await manager.install(name, source);

    if (config) {
      await manager.setConfig(name, config);
    }

    res.status(201).json({
      name: plugin.name,
      version: plugin.version,
      status: plugin.status,
    });
  } catch (error) {
    console.error("Install plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// 插件生命周期控制
// ============================================================================

// POST /api/plugins/:name/enable - 启用插件
router.post("/:name/enable", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const manager = await getPluginManager();

    await manager.enable(name);

    const plugin = manager.get(name);
    res.json({
      success: true,
      name,
      status: plugin?.status,
    });
  } catch (error) {
    console.error("Enable plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
});

// POST /api/plugins/:name/disable - 禁用插件
router.post("/:name/disable", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const manager = await getPluginManager();

    await manager.disable(name);

    const plugin = manager.get(name);
    res.json({
      success: true,
      name,
      status: plugin?.status,
    });
  } catch (error) {
    console.error("Disable plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
});

// POST /api/plugins/:name/reload - 重载插件
router.post("/:name/reload", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const manager = await getPluginManager();

    const plugin = await manager.reload(name);

    res.json({
      success: true,
      name: plugin.name,
      version: plugin.version,
      status: plugin.status,
    });
  } catch (error) {
    console.error("Reload plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
});

// DELETE /api/plugins/:name - 卸载插件
router.delete("/:name", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const manager = await getPluginManager();

    await manager.uninstall(name);

    res.json({ success: true, name });
  } catch (error) {
    console.error("Uninstall plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// 插件配置管理
// ============================================================================

// GET /api/plugins/:name/config - 获取插件配置
router.get("/:name/config", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const manager = await getPluginManager();

    const config = manager.getConfig(name);
    res.json(config);
  } catch (error) {
    console.error("Get plugin config error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/plugins/:name/config - 更新插件配置
router.put("/:name/config", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { config } = req.body;

    if (!config || typeof config !== "object") {
      res.status(400).json({ error: "Config object is required" });
      return;
    }

    const manager = await getPluginManager();

    // 验证配置
    const plugin = manager.get(name);
    if (plugin?.manifest.config) {
      const errors = validateConfig(config, plugin.manifest.config);
      if (errors.length > 0) {
        res.status(400).json({ error: "Config validation failed", details: errors });
        return;
      }
    }

    await manager.setConfig(name, config);

    res.json({ success: true, config });
  } catch (error) {
    console.error("Update plugin config error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
});

// POST /api/plugins/:name/validate - 验证插件配置
router.post("/:name/validate", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { config } = req.body;

    const manager = await getPluginManager();
    const plugin = manager.get(name);

    if (!plugin) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }

    if (!plugin.manifest.config) {
      res.json({ valid: true, warnings: ["Plugin has no config schema"] });
      return;
    }

    const errors = validateConfig(config || {}, plugin.manifest.config);
    const warnings: string[] = [];

    // 检查可选配置项缺失
    for (const [key, field] of Object.entries(plugin.manifest.config)) {
      if (
        "required" in field &&
        !field.required &&
        config?.[key] === undefined &&
        field.default === undefined
      ) {
        warnings.push(`Optional config "${key}" is not set`);
      }
    }

    res.json({
      valid: errors.length === 0,
      errors,
      warnings,
    });
  } catch (error) {
    console.error("Validate plugin config error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 验证配置值
 */
function validateConfig(
  config: Record<string, unknown>,
  schema: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  for (const [key, field] of Object.entries(schema)) {
    if (typeof field !== "object" || field === null) continue;

    const configField = field as {
      type?: string;
      required?: boolean;
      enum?: unknown[];
      min?: number;
      max?: number;
      pattern?: string;
      description?: string;
    };

    const value = config[key];

    // 检查必需字段
    if (configField.required && value === undefined) {
      errors.push(`Required config "${key}" is missing`);
      continue;
    }

    if (value === undefined) continue;

    // 检查类型
    if (configField.type) {
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (actualType !== configField.type) {
        errors.push(
          `Config "${key}" has wrong type: expected "${configField.type}", got "${actualType}"`
        );
        continue;
      }
    }

    // 检查枚举值
    if (configField.enum && !configField.enum.includes(value)) {
      errors.push(
        `Config "${key}" must be one of: ${configField.enum.join(", ")}`
      );
    }

    // 检查数值范围
    if (typeof value === "number") {
      if (configField.min !== undefined && value < configField.min) {
        errors.push(`Config "${key}" must be >= ${configField.min}`);
      }
      if (configField.max !== undefined && value > configField.max) {
        errors.push(`Config "${key}" must be <= ${configField.max}`);
      }
    }

    // 检查字符串模式
    if (typeof value === "string" && configField.pattern) {
      const regex = new RegExp(configField.pattern);
      if (!regex.test(value)) {
        errors.push(`Config "${key}" must match pattern: ${configField.pattern}`);
      }
    }
  }

  return errors;
}

export default router;
