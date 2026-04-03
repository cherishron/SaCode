/**
 * 主题管理器
 *
 * 参考 Gemini CLI 的 ThemeManager 设计
 * 提供主题切换、自动检测、缓存等功能
 */

import type { ThemeDefinition, SemanticColors, ThemeType } from "./semantic-tokens.js";
import { builtInThemes, getBuiltInTheme } from "./themes/index.js";
import { isLightColor, parseColor, blendColors } from "./colors.js";

// ============================================================================
// 终端背景检测
// ============================================================================

/**
 * 尝试获取终端背景色
 * 注意：这需要在终端支持的情况下才能工作
 */
export function detectTerminalBackground(): string | undefined {
  // 检查环境变量
  const envBg = process.env.TERM_BACKGROUND ?? process.env.COLORSCHEME;
  if (envBg) {
    return envBg.toLowerCase() === "dark" ? "#000000" : "#ffffff";
  }

  // 检查终端是否支持查询背景色
  // 注意：大多数终端不支持这个功能
  // 这里返回 undefined 表示无法检测
  return undefined;
}

/**
 * 根据背景色判断应该使用深色还是浅色主题
 */
export function getThemeTypeFromBackground(backgroundColor: string | undefined): ThemeType {
  if (!backgroundColor) {
    // 默认使用深色主题
    return "dark";
  }

  const color = parseColor(backgroundColor);
  if (!color) {
    return "dark";
  }

  return isLightColor(color) ? "light" : "dark";
}

// ============================================================================
// NO_COLOR 支持
// ============================================================================

/**
 * 检查是否启用了 NO_COLOR
 * https://no-color.org/
 */
export function isNoColorEnabled(): boolean {
  return process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
}

// ============================================================================
// ThemeManager 类
// ============================================================================

/**
 * 主题管理器 - 单例模式
 */
export class ThemeManager {
  private static instance: ThemeManager | undefined;

  /** 当前活动主题 */
  private activeTheme: ThemeDefinition;

  /** 用户自定义主题 */
  private customThemes: Map<string, ThemeDefinition> = new Map();

  /** 缓存的语义化颜色 */
  private cachedSemanticColors: SemanticColors | undefined;

  /** 终端背景色 */
  private terminalBackground: string | undefined;

  /** 是否禁用颜色 */
  private noColor: boolean;

  private constructor() {
    this.noColor = isNoColorEnabled();
    this.terminalBackground = detectTerminalBackground();
    this.activeTheme = builtInThemes[0]!; // 默认使用第一个内置主题
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  /**
   * 重置单例（用于测试）
   */
  public static resetInstance(): void {
    ThemeManager.instance = undefined;
  }

  // ============================================================================
  // 主题获取
  // ============================================================================

  /**
   * 获取当前主题
   */
  getTheme(): ThemeDefinition {
    return this.activeTheme;
  }

  /**
   * 获取当前主题名称
   */
  getThemeName(): string {
    return this.activeTheme.name;
  }

  /**
   * 获取当前主题类型
   */
  getThemeType(): ThemeType {
    return this.activeTheme.type;
  }

  /**
   * 获取语义化颜色
   */
  getSemanticColors(): SemanticColors {
    // 使用缓存
    if (this.cachedSemanticColors) {
      return this.cachedSemanticColors;
    }

    const colors = this.activeTheme.colors;

    // 如果禁用颜色，返回灰度版本
    if (this.noColor) {
      this.cachedSemanticColors = this.convertToGrayscale(colors);
      return this.cachedSemanticColors;
    }

    this.cachedSemanticColors = colors;
    return this.cachedSemanticColors;
  }

  /**
   * 获取所有可用主题列表
   */
  getAvailableThemes(): ThemeDefinition[] {
    return [...builtInThemes, ...Array.from(this.customThemes.values())];
  }

  /**
   * 获取内置主题列表
   */
  getBuiltInThemes(): ThemeDefinition[] {
    return [...builtInThemes];
  }

  /**
   * 获取自定义主题列表
   */
  getCustomThemes(): ThemeDefinition[] {
    return Array.from(this.customThemes.values());
  }

  // ============================================================================
  // 主题设置
  // ============================================================================

  /**
   * 设置主题
   * @param name 主题名称
   */
  setTheme(name: string): boolean {
    // 先查找内置主题
    const builtIn = getBuiltInTheme(name);
    if (builtIn) {
      this.activeTheme = builtIn;
      this.clearCache();
      return true;
    }

    // 再查找自定义主题
    const custom = this.customThemes.get(name.toLowerCase());
    if (custom) {
      this.activeTheme = custom;
      this.clearCache();
      return true;
    }

    return false;
  }

  /**
   * 直接设置主题定义
   */
  setThemeDefinition(theme: ThemeDefinition): void {
    this.activeTheme = theme;
    this.clearCache();
  }

  /**
   * 注册自定义主题
   */
  registerTheme(theme: ThemeDefinition): void {
    this.customThemes.set(theme.name.toLowerCase(), theme);
  }

  /**
   * 移除自定义主题
   */
  unregisterTheme(name: string): boolean {
    return this.customThemes.delete(name.toLowerCase());
  }

  // ============================================================================
  // 终端背景适配
  // ============================================================================

  /**
   * 设置终端背景色
   * 会自动选择合适的主题
   */
  setTerminalBackground(color: string | undefined): void {
    this.terminalBackground = color ? parseColor(color) : undefined;
    this.clearCache();
  }

  /**
   * 获取终端背景色
   */
  getTerminalBackground(): string | undefined {
    return this.terminalBackground;
  }

  /**
   * 根据终端背景自动选择主题
   */
  autoSelectTheme(): void {
    const type = getThemeTypeFromBackground(this.terminalBackground);
    const themes = this.getAvailableThemes().filter((t) => t.type === type);
    if (themes.length > 0) {
      this.activeTheme = themes[0]!;
      this.clearCache();
    }
  }

  // ============================================================================
  // 颜色处理
  // ============================================================================

  /**
   * 获取带有背景混合的颜色
   * 用于模拟半透明效果
   */
  getBlendedColor(
    foregroundColor: string,
    backgroundColor: string | undefined,
    alpha: number
  ): string {
    const bg = backgroundColor ?? this.terminalBackground ?? this.activeTheme.colors.background.primary;
    return blendColors(foregroundColor, bg, alpha);
  }

  /**
   * 清除缓存
   */
  private clearCache(): void {
    this.cachedSemanticColors = undefined;
  }

  /**
   * 将颜色转换为灰度（NO_COLOR 模式）
   */
  private convertToGrayscale(colors: SemanticColors): SemanticColors {
    const toGray = (hex: string): string => {
      const parsed = parseColor(hex);
      if (!parsed) return hex;

      // 使用 RGB 计算灰度
      const r = parseInt(parsed.slice(1, 3), 16);
      const g = parseInt(parsed.slice(3, 5), 16);
      const b = parseInt(parsed.slice(5, 7), 16);

      // 使用 ITU-R BT.601 公式
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

      return `#${gray.toString(16).padStart(2, "0").repeat(3)}`;
    };

    return {
      text: {
        primary: toGray(colors.text.primary),
        secondary: toGray(colors.text.secondary),
        link: toGray(colors.text.link),
        accent: toGray(colors.text.accent),
        response: toGray(colors.text.response),
        user: toGray(colors.text.user),
        system: toGray(colors.text.system),
        comment: toGray(colors.text.comment),
        placeholder: toGray(colors.text.placeholder),
      },
      background: {
        primary: colors.background.primary,
        message: colors.background.message,
        input: colors.background.input,
        focus: colors.background.focus,
        selection: colors.background.selection,
        diff: {
          added: colors.background.diff.added,
          removed: colors.background.diff.removed,
          modified: colors.background.diff.modified,
        },
        tool: colors.background.tool,
        error: colors.background.error,
        warning: colors.background.warning,
        success: colors.background.success,
      },
      border: {
        default: toGray(colors.border.default),
        accent: toGray(colors.border.accent),
        focus: toGray(colors.border.focus),
        error: toGray(colors.border.error),
        success: toGray(colors.border.success),
      },
      status: {
        error: toGray(colors.status.error),
        success: toGray(colors.status.success),
        warning: toGray(colors.status.warning),
        info: toGray(colors.status.info),
        pending: toGray(colors.status.pending),
        running: toGray(colors.status.running),
      },
      ui: {
        comment: toGray(colors.ui.comment),
        symbol: toGray(colors.ui.symbol),
        active: toGray(colors.ui.active),
        dark: colors.ui.dark,
        focus: toGray(colors.ui.focus),
        gradient: colors.ui.gradient ? colors.ui.gradient.map(toGray) : undefined,
        highlight: toGray(colors.ui.highlight),
        cursor: toGray(colors.ui.cursor),
      },
      syntax: {
        keyword: toGray(colors.syntax.keyword),
        string: toGray(colors.syntax.string),
        number: toGray(colors.syntax.number),
        comment: toGray(colors.syntax.comment),
        function: toGray(colors.syntax.function),
        class: toGray(colors.syntax.class),
        variable: toGray(colors.syntax.variable),
        operator: toGray(colors.syntax.operator),
        punctuation: toGray(colors.syntax.punctuation),
        property: toGray(colors.syntax.property),
        tag: toGray(colors.syntax.tag),
        attributeName: toGray(colors.syntax.attributeName),
        attributeValue: toGray(colors.syntax.attributeValue),
        regex: toGray(colors.syntax.regex),
        builtin: toGray(colors.syntax.builtin),
        constant: toGray(colors.syntax.constant),
        deleted: toGray(colors.syntax.deleted),
        inserted: toGray(colors.syntax.inserted),
        changed: toGray(colors.syntax.changed),
      },
    };
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 获取 ThemeManager 实例
 */
export function getThemeManager(): ThemeManager {
  return ThemeManager.getInstance();
}

/**
 * 获取当前语义化颜色
 */
export function getColors(): SemanticColors {
  return getThemeManager().getSemanticColors();
}

/**
 * 获取当前主题
 */
export function getCurrentTheme(): ThemeDefinition {
  return getThemeManager().getTheme();
}

/**
 * 设置主题
 */
export function setTheme(name: string): boolean {
  return getThemeManager().setTheme(name);
}
