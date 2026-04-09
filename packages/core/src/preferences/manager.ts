/**
 * 用户偏好管理器
 * 
 * 存储位置: ~/.sacode/preferences.json
 * 支持跨会话持久化用户偏好设置
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import EventEmitter from "eventemitter3";
import {
  type UserPreferences,
  type PreferenceChangeEvent,
  DEFAULT_PREFERENCES,
} from "./types";

/**
 * 偏好管理器事件
 */
export interface PreferenceManagerEvents {
  change: (event: PreferenceChangeEvent) => void;
  load: (preferences: UserPreferences) => void;
  save: (preferences: UserPreferences) => void;
  reset: (preferences: UserPreferences) => void;
}

/**
 * 用户偏好管理器
 */
export class PreferenceManager extends EventEmitter<PreferenceManagerEvents> {
  private preferences: UserPreferences;
  private configPath: string;
  private configDir: string;

  /**
   * 创建偏好管理器
   * @param configDir 配置目录，默认为 ~/.sacode/
   */
  constructor(configDir?: string) {
    super();
    
    this.configDir = configDir ?? join(homedir(), ".sacode");
    this.configPath = join(this.configDir, "preferences.json");
    this.preferences = { ...DEFAULT_PREFERENCES };
  }

  /**
   * 获取配置目录
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 加载偏好配置
   */
  load(): UserPreferences {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, "utf-8");
        const loaded = JSON.parse(content) as Partial<UserPreferences>;
        
        // 合并默认值和加载的值
        this.preferences = {
          ...DEFAULT_PREFERENCES,
          ...loaded,
          // 确保时间戳存在
          createdAt: loaded.createdAt ?? DEFAULT_PREFERENCES.createdAt,
          updatedAt: loaded.updatedAt ?? DEFAULT_PREFERENCES.updatedAt,
        };
        
        this.emit("load", this.preferences);
        return this.preferences;
      }
    } catch (error) {
      // 加载失败，使用默认值
      console.warn("[PreferenceManager] Failed to load preferences:", error);
    }
    
    // 文件不存在或加载失败，创建默认配置
    this.ensureConfigDir();
    this.save();
    return this.preferences;
  }

  /**
   * 保存偏好配置
   */
  save(): void {
    this.ensureConfigDir();
    
    this.preferences.updatedAt = new Date().toISOString();
    
    const content = JSON.stringify(this.preferences, null, 2);
    writeFileSync(this.configPath, content, "utf-8");
    
    this.emit("save", this.preferences);
  }

  /**
   * 获取所有偏好
   */
  getAll(): UserPreferences {
    return { ...this.preferences };
  }

  /**
   * 获取单个偏好值
   */
  get<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
    return this.preferences[key];
  }

  /**
   * 设置单个偏好值
   */
  set<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ): void {
    const oldValue = this.preferences[key];
    
    if (oldValue !== value) {
      (this.preferences as any)[key] = value;
      this.save();
      
      this.emit("change", {
        key,
        oldValue,
        newValue: value,
        timestamp: new Date(),
      });
    }
  }

  /**
   * 批量设置偏好
   */
  setMany(updates: Partial<UserPreferences>): void {
    const changes: PreferenceChangeEvent[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      const k = key as keyof UserPreferences;
      const oldValue = this.preferences[k];
      
      if (oldValue !== value) {
        (this.preferences as any)[k] = value;
        changes.push({
          key: k,
          oldValue,
          newValue: value as UserPreferences[typeof k],
          timestamp: new Date(),
        });
      }
    }
    
    if (changes.length > 0) {
      this.save();
      changes.forEach((change) => this.emit("change", change));
    }
  }

  /**
   * 重置为默认值
   */
  reset(): void {
    this.preferences = {
      ...DEFAULT_PREFERENCES,
      createdAt: this.preferences.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    this.emit("reset", this.preferences);
  }

  /**
   * 获取语言偏好（解析 auto）
   */
  getResolvedLanguage(): string {
    const lang = this.preferences.language;
    
    if (lang === "auto") {
      // 从系统环境变量检测语言
      const envLang = process.env.LANG ?? process.env.LC_ALL ?? "";
      
      if (envLang.startsWith("zh")) return "zh-CN";
      if (envLang.startsWith("ja")) return "ja-JP";
      if (envLang.startsWith("ko")) return "ko-KR";
      
      return "en-US";
    }
    
    return lang;
  }

  /**
   * 生成 System Prompt 附加内容
   */
  getSystemPromptAdditions(): string {
    const parts: string[] = [];
    
    // 语言偏好
    const lang = this.getResolvedLanguage();
    const langMap: Record<string, string> = {
      "zh-CN": "请使用中文回复用户消息。",
      "en-US": "Please respond in English.",
      "ja-JP": "日本語で返信してください。",
      "ko-KR": "한국어로 응답해 주세요.",
    };
    
    if (langMap[lang]) {
      parts.push(langMap[lang]);
    }
    
    // 自定义指令
    if (this.preferences.customInstructions) {
      parts.push(this.preferences.customInstructions);
    }
    
    return parts.join("\n\n");
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }
}

/**
 * 创建偏好管理器
 */
export function createPreferenceManager(configDir?: string): PreferenceManager {
  return new PreferenceManager(configDir);
}

/**
 * 全局单例
 */
let globalInstance: PreferenceManager | null = null;

/**
 * 获取全局偏好管理器实例
 */
export function getPreferenceManager(): PreferenceManager {
  if (!globalInstance) {
    globalInstance = new PreferenceManager();
    globalInstance.load();
  }
  return globalInstance;
}
