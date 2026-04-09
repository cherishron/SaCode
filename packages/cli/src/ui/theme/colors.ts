/**
 * 颜色工具函数
 *
 * 提供颜色解析、转换、插值等功能
 * 参考 Gemini CLI 的颜色处理实现
 */

import type { ColorValue } from "./semantic-tokens.js";

// ============================================================================
// CSS 颜色名到十六进制映射
// ============================================================================

/**
 * CSS 颜色名到十六进制值的映射
 * 来源: https://www.w3.org/TR/css-color-4/#named-colors
 */
export const cssColorNames: Record<string, string> = {
  // 基础颜色
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",

  // 灰度
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  dimgray: "#696969",
  dimgrey: "#696969",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  gainsboro: "#dcdcdc",

  // 红色系
  indianred: "#cd5c5c",
  lightcoral: "#f08080",
  salmon: "#fa8072",
  darksalmon: "#e9967a",
  lightsalmon: "#ffa07a",
  crimson: "#dc143c",
  firebrick: "#b22222",
  darkred: "#8b0000",
  orangered: "#ff4500",
  tomato: "#ff6347",
  coral: "#ff7f50",

  // 橙色系
  orange: "#ffa500",
  darkorange: "#ff8c00",
  chocolate: "#d2691e",
  peru: "#cd853f",
  sandybrown: "#f4a460",
  burlywood: "#deb887",
  tan: "#d2b48c",
  rosybrown: "#bc8f8f",

  // 黄色系
  gold: "#ffd700",
  khaki: "#f0e68c",
  darkkhaki: "#bdb76b",
  lemonchiffon: "#fffacd",
  lightgoldenrodyellow: "#fafad2",
  papayawhip: "#ffefd5",
  moccasin: "#ffe4b5",
  peachpuff: "#ffdab9",
  palegoldenrod: "#eee8aa",

  // 绿色系
  lime: "#00ff00",
  limegreen: "#32cd32",
  forestgreen: "#228b22",
  darkgreen: "#006400",
  greenyellow: "#adff2f",
  chartreuse: "#7fff00",
  lawngreen: "#7cfc00",
  springgreen: "#00ff7f",
  mediumspringgreen: "#00fa9a",
  lightgreen: "#90ee90",
  palegreen: "#98fb98",
  darkseagreen: "#8fbc8f",
  mediumseagreen: "#3cb371",
  seagreen: "#2e8b57",
  olive: "#808000",
  darkolivegreen: "#556b2f",
  olivedrab: "#6b8e23",
  yellowgreen: "#9acd32",

  // 青色系
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  lightseagreen: "#20b2aa",
  mediumaquamarine: "#66cdaa",
  turquoise: "#40e0d0",
  darkturquoise: "#00ced1",
  paleturquoise: "#afeeee",
  mediumturquoise: "#48d1cc",
  cadetblue: "#5f9ea0",
  darkcyan: "#008b8b",
  teal: "#008080",

  // 蓝色系
  lightblue: "#add8e6",
  powderblue: "#b0e0e6",
  lightskyblue: "#87cefa",
  skyblue: "#87ceeb",
  deepskyblue: "#00bfff",
  dodgerblue: "#1e90ff",
  cornflowerblue: "#6495ed",
  steelblue: "#4682b4",
  royalblue: "#4169e1",
  mediumblue: "#0000cd",
  navy: "#000080",
  midnightblue: "#191970",
  darkblue: "#00008b",
  slateblue: "#6a5acd",
  darkslateblue: "#483d8b",
  mediumslateblue: "#7b68ee",
  lightslateblue: "#8470ff",

  // 紫色系
  purple: "#800080",
  darkmagenta: "#8b008b",
  darkviolet: "#9400d3",
  darkorchid: "#9932cc",
  mediumorchid: "#ba55d3",
  orchid: "#da70d6",
  violet: "#ee82ee",
  plum: "#dda0dd",
  thistle: "#d8bfd8",
  lavender: "#e6e6fa",
  mediumvioletred: "#c71585",
  palevioletred: "#db7093",
  deeppurple: "#9932cc",
  blueviolet: "#8a2be2",
  mediumpurple: "#9370db",
  indigo: "#4b0082",

  // 粉色系
  pink: "#ffc0cb",
  lightpink: "#ffb6c1",
  hotpink: "#ff69b4",
  deeppink: "#ff1493",

  // 棕色系
  brown: "#a52a2a",
  saddlebrown: "#8b4513",
  sienna: "#a0522d",
  maroon: "#800000",
  darkbrown: "#654321",

  // 特殊颜色
  transparent: "transparent",
  currentcolor: "currentColor",
};

// ============================================================================
// ANSI 颜色名到十六进制映射
// ============================================================================

/**
 * ANSI 颜色名映射
 * 用于兼容终端 ANSI 颜色
 */
export const ansiColorNames: Record<string, string> = {
  // 标准颜色
  black: "#000000",
  red: "#cd0000",
  green: "#00cd00",
  yellow: "#cdcd00",
  blue: "#0000ee",
  magenta: "#cd00cd",
  cyan: "#00cdcd",
  white: "#e5e5e5",

  // 高亮颜色 (bright)
  blackbright: "#7f7f7f",
  redbright: "#ff0000",
  greenbright: "#00ff00",
  yellowbright: "#ffff00",
  bluebright: "#5c5cff",
  magentabright: "#ff00ff",
  cyanbright: "#00ffff",
  whitebright: "#ffffff",

  // 简写
  brightblack: "#7f7f7f",
  brightred: "#ff0000",
  brightgreen: "#00ff00",
  brightyellow: "#ffff00",
  brightblue: "#5c5cff",
  brightmagenta: "#ff00ff",
  brightcyan: "#00ffff",
  brightwhite: "#ffffff",
};

// ============================================================================
// Ink 支持的颜色名
// ============================================================================

/**
 * Ink 支持的内置颜色名
 * 这些颜色可以直接传递给 Ink 的 Text 组件
 */
export const inkColorNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "grey",
] as const;

export type InkColorName = (typeof inkColorNames)[number];

/**
 * 检查是否是 Ink 支持的颜色名
 */
export function isInkColor(color: string): color is InkColorName {
  return inkColorNames.includes(color as InkColorName);
}

// ============================================================================
// 颜色解析
// ============================================================================

/**
 * 解析颜色值，返回十六进制格式
 * 支持的格式:
 * - 十六进制: #ff0000, #f00
 * - RGB: rgb(255, 0, 0)
 * - CSS 颜色名: red, blue, etc.
 * - ANSI 颜色名: blackbright, redbright, etc.
 * - Ink 颜色名: cyan, magenta, etc. (原样返回)
 */
export function parseColor(color: ColorValue): string | undefined {
  if (!color) return undefined;

  const trimmed = color.trim().toLowerCase();

  // 空值或透明
  if (trimmed === "" || trimmed === "transparent" || trimmed === "none") {
    return undefined;
  }

  // 已经是十六进制格式
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    // 扩展短格式 #f00 -> #ff0000
    if (hex.length === 3) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (hex.length === 6) {
      return trimmed;
    }
    return undefined;
  }

  // RGB 格式
  const rgbMatch = trimmed.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1] ?? "0", 10);
    const g = parseInt(rgbMatch[2] ?? "0", 10);
    const b = parseInt(rgbMatch[3] ?? "0", 10);
    return rgbToHex(r, g, b);
  }

  // Ink 颜色名 - 原样返回
  if (isInkColor(trimmed)) {
    return trimmed;
  }

  // ANSI 颜色名
  if (ansiColorNames[trimmed]) {
    return ansiColorNames[trimmed];
  }

  // CSS 颜色名
  if (cssColorNames[trimmed]) {
    return cssColorNames[trimmed];
  }

  return undefined;
}

/**
 * 将颜色转换为 Ink 可用的格式
 * - 如果是 Ink 颜色名，原样返回
 * - 否则返回十六进制颜色
 */
export function toInkColor(color: ColorValue): string {
  if (!color) return "#ffffff";

  const trimmed = color.trim().toLowerCase();

  // Ink 颜色名 - 原样返回
  if (isInkColor(trimmed)) {
    return trimmed;
  }

  // 解析为十六进制，提供 fallback
  return parseColor(color) ?? "#ffffff";
}

// ============================================================================
// 颜色转换
// ============================================================================

/**
 * 十六进制转 RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | undefined {
  const parsed = parseColor(hex);
  if (!parsed || isInkColor(parsed)) return undefined;

  const result = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(parsed);
  if (!result) return undefined;

  return {
    r: parseInt(result[1] ?? "0", 16),
    g: parseInt(result[2] ?? "0", 16),
    b: parseInt(result[3] ?? "0", 16),
  };
}

/**
 * RGB 转十六进制
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * RGB 转 HSL
 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case rNorm:
        h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6;
        break;
      case gNorm:
        h = ((bNorm - rNorm) / d + 2) / 6;
        break;
      case bNorm:
        h = ((rNorm - gNorm) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * HSL 转 RGB
 */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hNorm = h / 360;
  const sNorm = s / 100;
  const lNorm = l / 100;

  let r: number, g: number, b: number;

  if (sNorm === 0) {
    r = g = b = lNorm;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      let tNorm = t;
      if (tNorm < 0) tNorm += 1;
      if (tNorm > 1) tNorm -= 1;
      if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm;
      if (tNorm < 1 / 2) return q;
      if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6;
      return p;
    };

    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;

    r = hue2rgb(p, q, hNorm + 1 / 3);
    g = hue2rgb(p, q, hNorm);
    b = hue2rgb(p, q, hNorm - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// ============================================================================
// 颜色操作
// ============================================================================

/**
 * 计算颜色亮度 (0-255)
 */
export function getLuminance(color: ColorValue): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;

  // 相对亮度公式
  const rLinear = rgb.r / 255;
  const gLinear = rgb.g / 255;
  const bLinear = rgb.b / 255;

  const r = rLinear <= 0.03928 ? rLinear / 12.92 : Math.pow((rLinear + 0.055) / 1.055, 2.4);
  const g = gLinear <= 0.03928 ? gLinear / 12.92 : Math.pow((gLinear + 0.055) / 1.055, 2.4);
  const b = bLinear <= 0.03928 ? bLinear / 12.92 : Math.pow((bLinear + 0.055) / 1.055, 2.4);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 判断颜色是否为浅色
 */
export function isLightColor(color: ColorValue): boolean {
  const luminance = getLuminance(color);
  return luminance > 0.5;
}

/**
 * 判断颜色是否为深色
 */
export function isDarkColor(color: ColorValue): boolean {
  return !isLightColor(color);
}

/**
 * 颜色插值
 * @param color1 起始颜色
 * @param color2 结束颜色
 * @param factor 插值因子 (0-1)
 */
export function interpolateColor(color1: ColorValue, color2: ColorValue, factor: number): string {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) {
    return parseColor(color1) ?? parseColor(color2) ?? "#000000";
  }

  const clampedFactor = Math.max(0, Math.min(1, factor));

  const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * clampedFactor);
  const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * clampedFactor);
  const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * clampedFactor);

  return rgbToHex(r, g, b);
}

/**
 * 混合颜色与透明度
 * 模拟在背景色上叠加半透明颜色
 * @param foreground 前景色（带透明度）
 * @param background 背景色
 * @param alpha 前景色透明度 (0-1)
 */
export function blendColors(
  foreground: ColorValue,
  background: ColorValue,
  alpha: number
): string {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);

  if (!fg || !bg) {
    return parseColor(foreground) ?? parseColor(background) ?? "#000000";
  }

  const clampedAlpha = Math.max(0, Math.min(1, alpha));

  const r = Math.round(fg.r * clampedAlpha + bg.r * (1 - clampedAlpha));
  const g = Math.round(fg.g * clampedAlpha + bg.g * (1 - clampedAlpha));
  const b = Math.round(fg.b * clampedAlpha + bg.b * (1 - clampedAlpha));

  return rgbToHex(r, g, b);
}

/**
 * 调整颜色亮度
 * @param color 原始颜色
 * @param amount 调整量 (-100 到 100)
 */
export function adjustBrightness(color: ColorValue, amount: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return parseColor(color) ?? "#000000";

  const adjust = (n: number) => Math.max(0, Math.min(255, n + amount));

  return rgbToHex(adjust(rgb.r), adjust(rgb.g), adjust(rgb.b));
}

/**
 * 使颜色变暗
 */
export function darken(color: ColorValue, amount: number): string {
  return adjustBrightness(color, -Math.abs(amount));
}

/**
 * 使颜色变亮
 */
export function lighten(color: ColorValue, amount: number): string {
  return adjustBrightness(color, Math.abs(amount));
}

/**
 * 获取对比色（黑或白）
 * 用于在背景上显示文字
 */
export function getContrastColor(background: ColorValue): "black" | "white" {
  return isLightColor(background) ? "black" : "white";
}

/**
 * 生成渐变色数组
 * @param colors 颜色数组
 * @param steps 步数
 */
export function generateGradient(colors: ColorValue[], steps: number): string[] {
  if (colors.length === 0) return [];
  if (colors.length === 1) return Array(steps).fill(parseColor(colors[0] ?? "#000000") ?? "#000000");

  const result: string[] = [];
  const segmentSteps = steps / (colors.length - 1);

  for (let i = 0; i < colors.length - 1; i++) {
    const startSteps = Math.round(i * segmentSteps);
    const endSteps = Math.round((i + 1) * segmentSteps);
    const segmentLength = endSteps - startSteps;

    for (let j = 0; j < segmentLength; j++) {
      const factor = j / segmentLength;
      result.push(interpolateColor(colors[i] ?? "#000000", colors[i + 1] ?? "#000000", factor));
    }
  }

  // 确保返回正确数量的颜色
  while (result.length < steps) {
    result.push(parseColor(colors[colors.length - 1] ?? "#000000") ?? "#000000");
  }

  return result.slice(0, steps);
}
