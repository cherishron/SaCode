/**
 * SaCode CLI UI 导出
 */

// 主应用
export { ChatApp, default, type Message } from "./App.js";

// 组件
export { Header } from "./Header.js";
export { InputBox } from "./InputBox.js";
export { StatusBar } from "./StatusBar.js";

// 新组件
export * from "./components/index.js";

// 主题系统
export * from "./theme/index.js";
export { theme, colors, borders, toolIcons, statusIcons, spacing, separators, getToolIcon, getStatusColor, getStatusIcon, createSeparator } from "./theme.js";