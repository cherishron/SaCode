/**
 * 用户偏好类型定义
 */

/**
 * 用户偏好配置
 */
export interface UserPreferences {
  /** 语言偏好 */
  language: "zh-CN" | "en-US" | "ja-JP" | "ko-KR" | "auto";
  
  /** 默认模型 */
  defaultModel?: string;
  
  /** 默认 Provider */
  defaultProvider?: "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu";
  
  /** 自定义指令（自动注入到 system prompt） */
  customInstructions?: string;
  
  /** 输出风格 */
  outputStyle: "concise" | "detailed" | "verbose";
  
  /** 是否显示工具调用详情 */
  showToolDetails: boolean;
  
  /** 是否显示思考过程 */
  showThinking: boolean;
  
  /** 主题 */
  theme: "light" | "dark" | "auto";
  
  /** 时区 */
  timezone?: string;
  
  /** 创建时间 */
  createdAt: string;
  
  /** 更新时间 */
  updatedAt: string;
  
  /** 版本 */
  version: string;
}

/**
 * 默认偏好配置
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  language: "auto",
  outputStyle: "detailed",
  showToolDetails: true,
  showThinking: true,
  theme: "dark",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: "1.0.0",
};

/**
 * 偏好变更事件
 */
export interface PreferenceChangeEvent {
  key: keyof UserPreferences;
  oldValue: UserPreferences[keyof UserPreferences];
  newValue: UserPreferences[keyof UserPreferences];
  timestamp: Date;
}
