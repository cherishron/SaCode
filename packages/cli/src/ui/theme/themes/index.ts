/**
 * 内置主题导出
 */

export { defaultDarkTheme, defaultDarkColors } from "./default-dark.js";
export { draculaTheme, draculaColors } from "./dracula.js";
export { nordTheme, nordColors } from "./nord.js";
export { monokaiTheme, monokaiColors } from "./monokai.js";

import type { ThemeDefinition } from "../semantic-tokens.js";
import { defaultDarkTheme } from "./default-dark.js";
import { draculaTheme } from "./dracula.js";
import { nordTheme } from "./nord.js";
import { monokaiTheme } from "./monokai.js";

/**
 * 所有内置主题列表
 */
export const builtInThemes: ThemeDefinition[] = [
  defaultDarkTheme,
  draculaTheme,
  nordTheme,
  monokaiTheme,
];

/**
 * 根据名称获取内置主题
 */
export function getBuiltInTheme(name: string): ThemeDefinition | undefined {
  return builtInThemes.find((t) => t.name.toLowerCase() === name.toLowerCase());
}
