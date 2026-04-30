/**
 * SACODE Plugin System - Plugin Loader
 *
 * 插件加载器：负责加载、验证和执行插件
 */

import * as fs from "fs";
import * as path from "path";
import type {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginFactory,
  PluginLoadResult,
  PluginValidationResult,
} from "./types";

/**
 * 插件加载器类
 */
export class PluginLoader {
  private loadTimeout: number;

  constructor(options?: { loadTimeout?: number }) {
    this.loadTimeout = options?.loadTimeout ?? 30000;
  }

  /**
   * 加载插件清单 (plugin.json)
   */
  async loadManifest(pluginPath: string): Promise<PluginManifest> {
    const manifestPath = path.join(pluginPath, "plugin.json");

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Plugin manifest not found: ${manifestPath}`);
    }

    const content = await fs.promises.readFile(manifestPath, "utf-8");
    let manifest: PluginManifest;

    try {
      manifest = JSON.parse(content);
    } catch (e) {
      throw new Error(`Invalid plugin.json: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 验证必需字段
    if (!manifest.name) {
      throw new Error("Plugin manifest missing required field: name");
    }
    if (!manifest.version) {
      throw new Error("Plugin manifest missing required field: version");
    }
    if (!manifest.main) {
      throw new Error("Plugin manifest missing required field: main");
    }

    // 验证 name 格式 (kebab-case)
    if (!/^[a-z][a-z0-9-]*$/.test(manifest.name)) {
      throw new Error(
        `Invalid plugin name "${manifest.name}": must be kebab-case (lowercase letters, numbers, and hyphens)`
      );
    }

    // 验证 version 格式 (semver)
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(manifest.version)) {
      throw new Error(
        `Invalid plugin version "${manifest.version}": must be semver format (e.g., 1.0.0)`
      );
    }

    return manifest;
  }

  /**
   * 验证插件结构和配置
   */
  validate(plugin: Plugin): PluginValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证必需字段
    if (!plugin.name) {
      errors.push("Plugin missing required property: name");
    }
    if (!plugin.version) {
      errors.push("Plugin missing required property: version");
    }
    if (!plugin.manifest) {
      errors.push("Plugin missing required property: manifest");
    }

    // 验证入口文件存在 (仅当 manifest 存在时)
    if (plugin.manifest) {
      const mainPath = path.join(plugin.path, plugin.manifest.main);
      if (!fs.existsSync(mainPath)) {
        errors.push(`Plugin entry file not found: ${plugin.manifest.main}`);
      }

      // 检查配置完整性
      if (plugin.manifest.config) {
        const config = plugin.config || {};
        for (const [key, field] of Object.entries(plugin.manifest.config)) {
          if ("required" in field && field.required && config[key] === undefined) {
            if (field.default !== undefined) {
              warnings.push(`Required config "${key}" using default value`);
            } else {
              errors.push(`Required config "${key}" is missing`);
            }
          }
        }
      }
    }

    // 检查生命周期方法
    const lifecycleMethods = ["install", "uninstall", "enable", "disable"] as const;
    for (const method of lifecycleMethods) {
      if (plugin[method] !== undefined && typeof plugin[method] !== "function") {
        errors.push(`Plugin lifecycle method "${method}" must be a function`);
      }
    }

    // 检查能力定义
    if (plugin.capabilities) {
      if (plugin.capabilities.tools) {
        for (const tool of plugin.capabilities.tools) {
          if (!tool.name || !tool.execute) {
            errors.push(`Invalid tool definition: missing name or execute`);
          }
        }
      }
      if (plugin.capabilities.commands) {
        for (const cmd of plugin.capabilities.commands) {
          if (!cmd.name || !cmd.handler) {
            errors.push(`Invalid command definition: missing name or handler`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 加载并执行插件入口
   */
  async load(
    pluginPath: string,
    context: PluginContext
  ): Promise<PluginLoadResult> {
    const warnings: string[] = [];

    try {
      // 1. 加载清单
      const manifest = await this.loadManifest(pluginPath);

      // 2. 构建入口文件路径
      const mainPath = path.join(pluginPath, manifest.main);

      // 3. 检查入口文件
      if (!fs.existsSync(mainPath)) {
        return {
          success: false,
          error: new Error(`Entry file not found: ${mainPath}`),
          warnings,
        };
      }

      // 4. 加载模块（ESM 动态 import）
      let factory: PluginFactory;
      try {
        const moduleUrl = Bun.pathToFileURL(mainPath).href;
        const module = await import(moduleUrl);

        // 支持 export default 和 module.exports
        factory = module.default || module;

        if (typeof factory !== "function") {
          return {
            success: false,
            error: new Error(
              `Plugin entry must export a factory function, got ${typeof factory}`
            ),
            warnings,
          };
        }
      } catch (e) {
        return {
          success: false,
          error: new Error(
            `Failed to load plugin module: ${e instanceof Error ? e.message : String(e)}`
          ),
          warnings,
        };
      }

      // 5. 执行工厂函数（带超时）
      let plugin: Plugin;
      try {
        const result = await this.executeWithTimeout(
          () => Promise.resolve(factory(context)),
          this.loadTimeout,
          `Plugin "${manifest.name}" factory execution`
        );
        plugin = result;
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e : new Error(String(e)),
          warnings,
        };
      }

      // 6. 验证返回的插件对象
      const validation = this.validate(plugin);
      if (!validation.valid) {
        return {
          success: false,
          error: new Error(`Plugin validation failed: ${validation.errors.join(", ")}`),
          warnings: [...warnings, ...validation.warnings],
        };
      }

      warnings.push(...validation.warnings);

      // 7. 确保基本属性
      const finalPlugin: Plugin = {
        ...plugin,
        name: manifest.name,
        version: manifest.version,
        manifest,
        path: pluginPath,
        status: plugin.status || "discovered",
        config: plugin.config || manifest.defaultConfig || {},
      };

      return {
        success: true,
        plugin: finalPlugin,
        warnings,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e : new Error(String(e)),
        warnings,
      };
    }
  }

  /**
   * 带超时执行异步操作
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    operation: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeout}ms`));
      }, timeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 检查路径是否是有效的插件目录
   */
  async isPluginDirectory(dirPath: string): Promise<boolean> {
    const manifestPath = path.join(dirPath, "plugin.json");
    return fs.existsSync(manifestPath);
  }

  /**
   * 获取插件信息（不加载）
   */
  async getPluginInfo(pluginPath: string): Promise<{
    manifest: PluginManifest;
    path: string;
  } | null> {
    try {
      const manifest = await this.loadManifest(pluginPath);
      return { manifest, path: pluginPath };
    } catch {
      return null;
    }
  }

  /**
   * 合并配置（用户配置 + 默认配置）
   */
  mergeConfigs(
    defaultConfig: Record<string, unknown> | undefined,
    userConfig: Record<string, unknown> | undefined
  ): Record<string, unknown> {
    return {
      ...(defaultConfig || {}),
      ...(userConfig || {}),
    };
  }

  /**
   * 验证配置值
   */
  validateConfig(
    value: unknown,
    field: PluginManifest["config"] extends infer T
      ? T extends Record<string, infer F>
        ? F
        : never
      : never
  ): { valid: boolean; error?: string } {
    if (!field || typeof field !== "object") {
      return { valid: true };
    }

    const configField = field as {
      type?: string;
      required?: boolean;
      enum?: unknown[];
      min?: number;
      max?: number;
      pattern?: string;
    };

    // 检查类型
    if (configField.type) {
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (actualType !== configField.type) {
        return {
          valid: false,
          error: `Expected type "${configField.type}", got "${actualType}"`,
        };
      }
    }

    // 检查枚举值
    if (configField.enum && !configField.enum.includes(value)) {
      return {
        valid: false,
        error: `Value must be one of: ${configField.enum.join(", ")}`,
      };
    }

    // 检查数值范围
    if (typeof value === "number") {
      if (configField.min !== undefined && value < configField.min) {
        return {
          valid: false,
          error: `Value must be >= ${configField.min}`,
        };
      }
      if (configField.max !== undefined && value > configField.max) {
        return {
          valid: false,
          error: `Value must be <= ${configField.max}`,
        };
      }
    }

    // 检查字符串模式
    if (typeof value === "string" && configField.pattern) {
      const regex = new RegExp(configField.pattern);
      if (!regex.test(value)) {
        return {
          valid: false,
          error: `Value must match pattern: ${configField.pattern}`,
        };
      }
    }

    return { valid: true };
  }
}

/**
 * 创建插件加载器
 */
export function createPluginLoader(options?: { loadTimeout?: number }): PluginLoader {
  return new PluginLoader(options);
}
