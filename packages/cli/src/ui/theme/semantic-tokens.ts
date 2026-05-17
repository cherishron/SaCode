/**
 * 语义化颜色 Token 定义
 *
 * 参考 Gemini CLI 的主题系统设计
 * 提供语义化的颜色命名，便于主题切换和维护
 */

// ============================================================================
// 基础颜色类型
// ============================================================================

/**
 * 颜色值类型
 * - 十六进制: #ff0000
 * - RGB: rgb(255, 0, 0)
 * - Ink 颜色名: cyan, magenta, blue, etc.
 */
export type ColorValue = string;

/**
 * 主题类型
 */
export type ThemeType = "light" | "dark" | "ansi" | "custom";

// ============================================================================
// 文本颜色
// ============================================================================

export interface TextColors {
  /** 主文本颜色 - 用于主要内容 */
  primary: ColorValue;
  /** 次要文本颜色 - 用于辅助信息 */
  secondary: ColorValue;
  /** 兼容旧命名：静音文本颜色 */
  muted?: ColorValue;
  /** 链接颜色 */
  link: ColorValue;
  /** 强调文本颜色 */
  accent: ColorValue;
  /** AI 响应文本颜色 */
  response: ColorValue;
  /** 用户输入文本颜色 */
  user: ColorValue;
  /** 系统消息文本颜色 */
  system: ColorValue;
  /** 注释/提示文本颜色 */
  comment: ColorValue;
  /** 占位符文本颜色 */
  placeholder: ColorValue;
}

// ============================================================================
// 背景颜色
// ============================================================================

export interface BackgroundColors {
  /** 主背景色 */
  primary: ColorValue;
  /** 消息背景色 */
  message: ColorValue;
  /** 输入框背景色 */
  input: ColorValue;
  /** 焦点背景色 */
  focus: ColorValue;
  /** 选中背景色 */
  selection: ColorValue;
  /** Diff 背景色 */
  diff: {
    added: ColorValue;
    removed: ColorValue;
    modified: ColorValue;
  };
  /** 工具调用背景色 */
  tool: ColorValue;
  /** 错误背景色 */
  error: ColorValue;
  /** 警告背景色 */
  warning: ColorValue;
  /** 成功背景色 */
  success: ColorValue;
}

// ============================================================================
// 边框颜色
// ============================================================================

export interface BorderColors {
  /** 默认边框颜色 */
  default: ColorValue;
  /** 强调边框颜色 */
  accent: ColorValue;
  /** 焦点边框颜色 */
  focus: ColorValue;
  /** 错误边框颜色 */
  error: ColorValue;
  /** 成功边框颜色 */
  success: ColorValue;
}

// ============================================================================
// 状态颜色
// ============================================================================

export interface StatusColors {
  /** 错误状态 */
  error: ColorValue;
  /** 成功状态 */
  success: ColorValue;
  /** 警告状态 */
  warning: ColorValue;
  /** 信息状态 */
  info: ColorValue;
  /** 进行中状态 */
  pending: ColorValue;
  /** 运行中状态 */
  running: ColorValue;
}

// ============================================================================
// UI 颜色
// ============================================================================

export interface UIColors {
  /** 注释颜色 */
  comment: ColorValue;
  /** 兼容旧命名：边框颜色 */
  border?: ColorValue;
  /** 符号颜色 */
  symbol: ColorValue;
  /** 激活状态颜色 */
  active: ColorValue;
  /** 深色模式额外颜色 */
  dark: ColorValue;
  /** 焦点颜色 */
  focus: ColorValue;
  /** 渐变色数组 - 用于 Logo 等渐变效果 */
  gradient: ColorValue[] | undefined;
  /** 高亮颜色 */
  highlight: ColorValue;
  /** 指针/光标颜色 */
  cursor: ColorValue;
}

// ============================================================================
// 语法高亮颜色
// ============================================================================

export interface SyntaxColors {
  /** 关键字 */
  keyword: ColorValue;
  /** 字符串 */
  string: ColorValue;
  /** 数字 */
  number: ColorValue;
  /** 注释 */
  comment: ColorValue;
  /** 函数名 */
  function: ColorValue;
  /** 类名 */
  class: ColorValue;
  /** 变量 */
  variable: ColorValue;
  /** 操作符 */
  operator: ColorValue;
  /** 标点符号 */
  punctuation: ColorValue;
  /** 属性 */
  property: ColorValue;
  /** 标签（HTML/XML） */
  tag: ColorValue;
  /** 属性名 */
  attributeName: ColorValue;
  /** 属性值 */
  attributeValue: ColorValue;
  /** 正则表达式 */
  regex: ColorValue;
  /** 内置类型 */
  builtin: ColorValue;
  /** 常量 */
  constant: ColorValue;
  /** 删除文本 */
  deleted: ColorValue;
  /** 插入文本 */
  inserted: ColorValue;
  /** 修改文本 */
  changed: ColorValue;
}

// ============================================================================
// 完整语义化颜色接口
// ============================================================================

export interface SemanticColors {
  /** 文本颜色 */
  text: TextColors;
  /** 背景颜色 */
  background: BackgroundColors;
  /** 边框颜色 */
  border: BorderColors;
  /** 状态颜色 */
  status: StatusColors;
  /** UI 颜色 */
  ui: UIColors;
  /** 语法高亮颜色 */
  syntax: SyntaxColors;
}

// ============================================================================
// 主题定义接口
// ============================================================================

export interface ThemeDefinition {
  /** 主题名称 */
  name: string;
  /** 主题类型 */
  type: ThemeType;
  /** 是否为内置主题 */
  builtIn?: boolean;
  /** 语义化颜色 */
  colors: SemanticColors;
  /** 边框样式 */
  borderStyle?: "single" | "double" | "round" | "bold" | "none";
  /** 描述 */
  description?: string;
  /** 作者 */
  author?: string;
}

// ============================================================================
// 默认语义化颜色（深色主题）
// ============================================================================

export const defaultSemanticColors: SemanticColors = {
  text: {
    primary: "#e0e0e0",
    secondary: "#808080",
    muted: "#808080",
    link: "#6cb6ff",
    accent: "#ff7b72",
    response: "#7ee787",
    user: "#79c0ff",
    system: "#8b949e",
    comment: "#6e7681",
    placeholder: "#484f58",
  },
  background: {
    primary: "#0d1117",
    message: "#161b22",
    input: "#0d1117",
    focus: "#1f6feb33",
    selection: "#1f6feb55",
    diff: {
      added: "#23863633",
      removed: "#da363333",
      modified: "#d2992233",
    },
    tool: "#21262d",
    error: "#f8514925",
    warning: "#d2992225",
    success: "#23863625",
  },
  border: {
    default: "#30363d",
    accent: "#1f6feb",
    focus: "#1f6feb",
    error: "#f85149",
    success: "#238636",
  },
  status: {
    error: "#f85149",
    success: "#238636",
    warning: "#d29922",
    info: "#1f6feb",
    pending: "#d29922",
    running: "#1f6feb",
  },
  ui: {
    comment: "#6e7681",
    border: "#30363d",
    symbol: "#79c0ff",
    active: "#1f6feb",
    dark: "#010409",
    focus: "#1f6feb",
    gradient: ["#4796E4", "#847ACE", "#C3677F"],
    highlight: "#bb8009",
    cursor: "#58a6ff",
  },
  syntax: {
    keyword: "#ff7b72",
    string: "#a5d6ff",
    number: "#79c0ff",
    comment: "#8b949e",
    function: "#d2a8ff",
    class: "#7ee787",
    variable: "#ffa657",
    operator: "#ff7b72",
    punctuation: "#c9d1d9",
    property: "#79c0ff",
    tag: "#7ee787",
    attributeName: "#79c0ff",
    attributeValue: "#a5d6ff",
    regex: "#7ee787",
    builtin: "#ffa657",
    constant: "#79c0ff",
    deleted: "#ffa198",
    inserted: "#7ee787",
    changed: "#ffa657",
  },
};

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建部分语义化颜色（合并默认值）
 */
export function createSemanticColors(partial: Partial<SemanticColors>): SemanticColors {
  return {
    text: { ...defaultSemanticColors.text, ...partial.text },
    background: {
      ...defaultSemanticColors.background,
      ...partial.background,
      diff: { ...defaultSemanticColors.background.diff, ...partial.background?.diff },
    },
    border: { ...defaultSemanticColors.border, ...partial.border },
    status: { ...defaultSemanticColors.status, ...partial.status },
    ui: { ...defaultSemanticColors.ui, ...partial.ui },
    syntax: { ...defaultSemanticColors.syntax, ...partial.syntax },
  };
}
