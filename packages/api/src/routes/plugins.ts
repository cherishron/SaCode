import { Hono } from "hono";
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

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

let pluginManager: PluginManager | null = null;

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

// GET /api/plugins/stats
router.get("/stats", authMiddleware, async (c) => {
  try {
    const manager = await getPluginManager();
    const stats: PluginStats = manager.getStats();
    return c.json(stats);
  } catch (error) {
    console.error("Get plugin stats error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/plugins/discover
router.get("/discover", authMiddleware, async (c) => {
  try {
    const manager = await getPluginManager();
    const plugins = await manager.discover();
    return c.json(
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
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/plugins
router.get("/", authMiddleware, async (c) => {
  try {
    const manager = await getPluginManager();
    const status = c.req.query("status");

    let plugins = manager.getAll();

    if (status && typeof status === "string") {
      plugins = plugins.filter((p) => p.status === status);
    }

    return c.json(
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
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/plugins/:name
router.get("/:name", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const manager = await getPluginManager();
    const plugin = manager.get(name);

    if (!plugin) {
      return c.json({ error: "Plugin not found" }, 404);
    }

    return c.json({
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
            commands: plugin.capabilities.commands?.map((cc) => ({
              name: cc.name,
              description: cc.description,
              aliases: cc.aliases,
            })),
            messageHandlers: plugin.capabilities.messageHandlers?.length || 0,
            scheduledTasks: plugin.capabilities.scheduledTasks?.length || 0,
          }
        : undefined,
    });
  } catch (error) {
    console.error("Get plugin error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/plugins
router.post("/", authMiddleware, async (c) => {
  try {
    const { name, source, config } = await c.req.json();

    if (!name) {
      return c.json({ error: "Plugin name is required" }, 400);
    }

    const manager = await getPluginManager();
    const plugin = await manager.install(name, source);

    if (config) {
      await manager.setConfig(name, config);
    }

    return c.json({
      name: plugin.name,
      version: plugin.version,
      status: plugin.status,
    }, 201);
  } catch (error) {
    console.error("Install plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 400);
  }
});

// POST /api/plugins/:name/enable
router.post("/:name/enable", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const manager = await getPluginManager();

    await manager.enable(name);

    const plugin = manager.get(name);
    return c.json({
      success: true,
      name,
      status: plugin?.status,
    });
  } catch (error) {
    console.error("Enable plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 400);
  }
});

// POST /api/plugins/:name/disable
router.post("/:name/disable", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const manager = await getPluginManager();

    await manager.disable(name);

    const plugin = manager.get(name);
    return c.json({
      success: true,
      name,
      status: plugin?.status,
    });
  } catch (error) {
    console.error("Disable plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 400);
  }
});

// POST /api/plugins/:name/reload
router.post("/:name/reload", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const manager = await getPluginManager();

    const plugin = await manager.reload(name);

    return c.json({
      success: true,
      name: plugin.name,
      version: plugin.version,
      status: plugin.status,
    });
  } catch (error) {
    console.error("Reload plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 400);
  }
});

// DELETE /api/plugins/:name
router.delete("/:name", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const manager = await getPluginManager();

    await manager.uninstall(name);

    return c.json({ success: true, name });
  } catch (error) {
    console.error("Uninstall plugin error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 400);
  }
});

// GET /api/plugins/:name/config
router.get("/:name/config", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const manager = await getPluginManager();

    const config = manager.getConfig(name);
    return c.json(config);
  } catch (error) {
    console.error("Get plugin config error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /api/plugins/:name/config
router.put("/:name/config", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const { config } = await c.req.json();

    if (!config || typeof config !== "object") {
      return c.json({ error: "Config object is required" }, 400);
    }

    const manager = await getPluginManager();

    const plugin = manager.get(name);
    if (plugin?.manifest.config) {
      const errors = validateConfig(config, plugin.manifest.config);
      if (errors.length > 0) {
        return c.json({ error: "Config validation failed", details: errors }, 400);
      }
    }

    await manager.setConfig(name, config);

    return c.json({ success: true, config });
  } catch (error) {
    console.error("Update plugin config error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 400);
  }
});

// POST /api/plugins/:name/validate
router.post("/:name/validate", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const { config } = await c.req.json();

    const manager = await getPluginManager();
    const plugin = manager.get(name);

    if (!plugin) {
      return c.json({ error: "Plugin not found" }, 404);
    }

    if (!plugin.manifest.config) {
      return c.json({ valid: true, warnings: ["Plugin has no config schema"] });
    }

    const errors = validateConfig(config || {}, plugin.manifest.config);
    const warnings: string[] = [];

    for (const [key, field] of Object.entries(plugin.manifest.config)) {
      if (
        "required" in (field as Record<string, unknown>) &&
        !(field as Record<string, unknown>).required &&
        config?.[key] === undefined &&
        (field as Record<string, unknown>).default === undefined
      ) {
        warnings.push(`Optional config "${key}" is not set`);
      }
    }

    return c.json({
      valid: errors.length === 0,
      errors,
      warnings,
    });
  } catch (error) {
    console.error("Validate plugin config error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

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

    if (configField.required && value === undefined) {
      errors.push(`Required config "${key}" is missing`);
      continue;
    }

    if (value === undefined) continue;

    if (configField.type) {
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (actualType !== configField.type) {
        errors.push(
          `Config "${key}" has wrong type: expected "${configField.type}", got "${actualType}"`
        );
        continue;
      }
    }

    if (configField.enum && !configField.enum.includes(value)) {
      errors.push(
        `Config "${key}" must be one of: ${configField.enum.join(", ")}`
      );
    }

    if (typeof value === "number") {
      if (configField.min !== undefined && value < configField.min) {
        errors.push(`Config "${key}" must be >= ${configField.min}`);
      }
      if (configField.max !== undefined && value > configField.max) {
        errors.push(`Config "${key}" must be <= ${configField.max}`);
      }
    }

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
