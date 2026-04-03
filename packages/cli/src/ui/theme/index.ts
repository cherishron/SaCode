/**
 * 主题系统入口
 *
 * 导出所有主题相关的类型和函数
 */

// 类型
export type {
  ColorValue,
  ThemeType,
  TextColors,
  BackgroundColors,
  BorderColors,
  StatusColors,
  UIColors,
  SyntaxColors,
  SemanticColors,
  ThemeDefinition,
} from "./semantic-tokens.js";

// 语义化颜色
export {
  defaultSemanticColors,
  createSemanticColors,
} from "./semantic-tokens.js";

// 颜色工具
export {
  cssColorNames,
  ansiColorNames,
  inkColorNames,
  type InkColorName,
  isInkColor,
  parseColor,
  toInkColor,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  getLuminance,
  isLightColor,
  isDarkColor,
  interpolateColor,
  blendColors,
  adjustBrightness,
  darken,
  lighten,
  getContrastColor,
  generateGradient,
} from "./colors.js";

// 主题管理器
export {
  ThemeManager,
  getThemeManager,
  getColors,
  getCurrentTheme,
  setTheme,
  detectTerminalBackground,
  getThemeTypeFromBackground,
  isNoColorEnabled,
} from "./theme-manager.js";

// 内置主题
export {
  defaultDarkTheme,
  defaultDarkColors,
  draculaTheme,
  draculaColors,
  nordTheme,
  nordColors,
  monokaiTheme,
  monokaiColors,
  builtInThemes,
  getBuiltInTheme,
} from "./themes/index.js";

// 便捷访问器
import { getThemeManager } from "./theme-manager.js";

/**
 * 获取当前主题的颜色
 * 这是最常用的访问方式
 */
export const colors = {
  get text() {
    return getThemeManager().getSemanticColors().text;
  },
  get background() {
    return getThemeManager().getSemanticColors().background;
  },
  get border() {
    return getThemeManager().getSemanticColors().border;
  },
  get status() {
    return getThemeManager().getSemanticColors().status;
  },
  get ui() {
    return getThemeManager().getSemanticColors().ui;
  },
  get syntax() {
    return getThemeManager().getSemanticColors().syntax;
  },
};

/**
 * 获取特定语义颜色的快捷方法
 */
export function getTextColor(type: keyof import("./semantic-tokens.js").TextColors): string {
  return getThemeManager().getSemanticColors().text[type];
}

export function getBackgroundColor(type: keyof import("./semantic-tokens.js").BackgroundColors): string {
  const bg = getThemeManager().getSemanticColors().background;
  return typeof bg[type] === "string" ? bg[type] as string : "";
}

export function getStatusColor(type: keyof import("./semantic-tokens.js").StatusColors): string {
  return getThemeManager().getSemanticColors().status[type];
}

export function getSyntaxColor(type: keyof import("./semantic-tokens.js").SyntaxColors): string {
  return getThemeManager().getSemanticColors().syntax[type];
}
