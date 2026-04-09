/**
 * 扩展配置管理器
 *
 * 在 ~/.sacode/cli-config.json 中存储扩展配置。
 * 与现有 PreferenceManager 独立（不修改 core 包）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  DEFAULT_EXTENDED_CONFIG,
  CONFIG_KEY_MAP,
  type ExtendedCLIConfig,
} from "./types.js";

export class ExtendedConfigManager {
  private configPath: string;
  private config: ExtendedCLIConfig;

  constructor() {
    const sacodeDir = join(homedir(), ".sacode");
    if (!existsSync(sacodeDir)) mkdirSync(sacodeDir, { recursive: true });
    this.configPath = join(sacodeDir, "cli-config.json");
    this.config = this.load();
  }

  private load(): ExtendedCLIConfig {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<ExtendedCLIConfig>;
        return { ...DEFAULT_EXTENDED_CONFIG, ...parsed };
      }
    } catch {
      // 文件损坏时回退默认值
    }
    return { ...DEFAULT_EXTENDED_CONFIG };
  }

  private save(): void {
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
  }

  get<K extends keyof ExtendedCLIConfig>(key: K): ExtendedCLIConfig[K] {
    return this.config[key];
  }

  set<K extends keyof ExtendedCLIConfig>(key: K, value: ExtendedCLIConfig[K]): void {
    this.config[key] = value;
    this.save();
  }

  /** 从 CLI key（如 "agent-mode"）获取值 */
  getByCliKey(cliKey: string): unknown {
    const field = CONFIG_KEY_MAP[cliKey];
    if (!field) return undefined;
    return this.config[field];
  }

  /** 从 CLI key 设置值，自动处理类型转换 */
  setByCliKey(cliKey: string, value: string): void {
    const field = CONFIG_KEY_MAP[cliKey];
    if (!field) return;

    // 根据字段类型做转换
    const defaultVal = DEFAULT_EXTENDED_CONFIG[field];

    if (typeof defaultVal === "number") {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`'${cliKey}' 需要一个数字值，收到: ${value}`);
      }
      (this.config as unknown as Record<string, unknown>)[field] = num;
    } else if (Array.isArray(defaultVal)) {
      // 逗号分隔转数组
      (this.config as unknown as Record<string, unknown>)[field] = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (typeof defaultVal === "string") {
      // 枚举类型验证
      if (field === "agentMode") {
        const valid = ["auto", "manual"];
        if (!valid.includes(value)) {
          throw new Error(
            `'${cliKey}' 的有效值为: ${valid.join(", ")}，收到: ${value}`
          );
        }
      }
      if (field === "uiStyle") {
        const valid = ["gemini", "classic"];
        if (!valid.includes(value)) {
          throw new Error(
            `'${cliKey}' 的有效值为: ${valid.join(", ")}，收到: ${value}`
          );
        }
      }
      (this.config as unknown as Record<string, unknown>)[field] = value;
    } else {
      // 可选字符串字段（如 codingplanDefaultAccount）
      (this.config as unknown as Record<string, unknown>)[field] = value || undefined;
    }

    this.save();
  }

  /** 列出所有扩展配置（CLI key -> 值） */
  listAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [cliKey, field] of Object.entries(CONFIG_KEY_MAP)) {
      const val = this.config[field];
      result[cliKey] = Array.isArray(val) ? val.join(", ") : val;
    }
    return result;
  }

  /** 重置为默认值 */
  reset(): void {
    this.config = { ...DEFAULT_EXTENDED_CONFIG };
    this.save();
  }

  /** 获取配置文件路径 */
  getConfigPath(): string {
    return this.configPath;
  }

  /** 解析 CLI key 到配置字段名 */
  static resolveCliKey(cliKey: string): keyof ExtendedCLIConfig | undefined {
    return CONFIG_KEY_MAP[cliKey];
  }

  /** 获取所有可用的 CLI key */
  static getAvailableKeys(): string[] {
    return Object.keys(CONFIG_KEY_MAP);
  }
}

// 单例
let _instance: ExtendedConfigManager | undefined;

export function getExtendedConfigManager(): ExtendedConfigManager {
  if (!_instance) {
    _instance = new ExtendedConfigManager();
  }
  return _instance;
}
