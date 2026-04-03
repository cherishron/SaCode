/**
 * CLI UI 模块
 * 
 * 导出 Ink TUI 组件
 */

export {
  type Message,
  type AppState,
  type BannerProps,
  type StatusBarProps,
  type MessageItemProps,
  type MessageListProps,
  type InputBoxProps,
  type ToolCallProps,
  type ChatAppProps,
  Banner,
  StatusBar,
  ToolCall,
  MessageItem,
  MessageList,
  InputBox,
  ChatApp,
  default,
} from "./App.js";

// 保留原有的渲染函数（用于非 TUI 模式）
export {
  type ToolCallInfo,
  renderToolPanel,
  renderMarkdown,
  renderThinking,
  renderProgress,
  renderWelcome,
  renderPrompt,
  renderAssistantPrefix,
} from "./renderer.js";