/**
 * SaCode CLI TUI 组件
 *
 * 使用 Ink (React for CLI) 实现
 * 参考 Gemini CLI 和 Claude Code 的 UI 设计
 */

import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout, Static, Spacer } from "ink";
import Spinner from "ink-spinner";
import { Header } from "./Header.js";
import { StatusBar as NewStatusBar } from "./StatusBar.js";
import { InputBox as NewInputBox } from "./InputBox.js";
import { MarkdownDisplay } from "./components/MarkdownDisplay.js";
import {
  getThemeManager,
  toInkColor,
  getColors,
  type SemanticColors,
} from "./theme/index.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: "pending" | "running" | "success" | "error";
  toolDuration?: number;
  timestamp: Date;
  /** 是否已完成（用于 Static 组件分离） */
  completed?: boolean;
}

// ============================================================================
// 工具图标映射
// ============================================================================

const toolIcons: Record<string, string> = {
  // 文件操作
  read_file: "📄",
  write_file: "📝",
  replace: "✏️",
  edit_file: "✏️",
  delete_file: "🗑️",
  list_directory: "📁",
  glob: "🔍",
  grep_tool: "🔍",

  // Web 操作
  web_search: "🌐",
  web_fetch: "🌐",
  http_request: "🔗",

  // 系统操作
  run_shell_command: "💻",

  // AI 功能
  think: "💭",
  plan: "📋",

  // 时间
  get_current_time: "🕐",

  // 内存/存储
  save_memory: "💾",

  // 任务管理
  todo_read: "📋",
  todo_write: "✅",

  // 用户交互
  ask_user_question: "❓",

  // 多媒体
  image_read: "🖼️",

  // Agent
  task: "🤖",

  // 默认
  default: "🔧",
};

function getToolIcon(toolName: string): string {
  return toolIcons[toolName] ?? toolIcons.default;
}

// ============================================================================
// ToolCall 组件
// ============================================================================

interface ToolCallProps {
  message: Message;
  colors: SemanticColors;
}

export const ToolCall: React.FC<ToolCallProps> = ({ message, colors }) => {
  const statusColorMap: Record<string, string> = {
    pending: colors.status.pending,
    running: colors.status.running,
    success: colors.status.success,
    error: colors.status.error,
  };

  const statusIconMap: Record<string, string> = {
    pending: "○",
    running: "◐",
    success: "✓",
    error: "✗",
  };

  const statusColor = statusColorMap[message.toolStatus ?? "pending"];
  const statusIcon = statusIconMap[message.toolStatus ?? "pending"];

  return (
    <Box
      flexDirection="column"
      marginLeft={2}
      marginY={0}
      borderStyle="round"
      borderColor={toInkColor(colors.border.default)}
      paddingX={1}
      width="90%"
    >
      <Box>
        <Text color={toInkColor(statusColor)} bold>
          {message.toolStatus === "running" ? (
            <Spinner type="dots" />
          ) : (
            statusIcon
          )}
        </Text>
        <Text>
          {" "}
          {getToolIcon(message.toolName ?? "")}{" "}
          <Text color={toInkColor(colors.text.user)} bold>
            {message.toolName}
          </Text>
        </Text>
        {message.toolArgs && Object.keys(message.toolArgs).length > 0 && (
          <Text dimColor>
            {" "}
            {Object.entries(message.toolArgs)
              .slice(0, 2)
              .map(([k, v]) => {
                const strValue = String(v);
                return `${k}=${strValue.length > 25 ? strValue.slice(0, 25) + "..." : strValue}`;
              })
              .join(" ")}
          </Text>
        )}
        {message.toolDuration !== undefined && (
          <Text dimColor>
            {" "}
            ({message.toolDuration}ms)
          </Text>
        )}
      </Box>
      {message.toolResult && (
        <Box marginTop={0}>
          <Text dimColor>├─ </Text>
          <Text dimColor>
            {message.toolResult.slice(0, 150)}
            {message.toolResult.length > 150 ? "..." : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
};

// ============================================================================
// MessageItem 组件
// ============================================================================

interface MessageItemProps {
  message: Message;
  colors: SemanticColors;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, colors }) => {
  if (message.role === "tool") {
    return <ToolCall message={message} colors={colors} />;
  }

  if (message.role === "system") {
    return (
      <Box
        marginY={0}
        paddingX={1}
        borderStyle="round"
        borderColor={toInkColor(colors.border.default)}
        width="100%"
      >
        <Text dimColor bold>
          ⚙ System:
        </Text>
        <Text dimColor> {message.content}</Text>
      </Box>
    );
  }

  const isUser = message.role === "user";
  const roleColor = isUser ? colors.text.user : colors.text.response;
  const roleLabel = isUser ? "You" : "AI";
  const roleIcon = isUser ? "👤" : "🤖";

  // AI 消息使用 Markdown 渲染
  if (!isUser) {
    return (
      <Box
        marginY={0}
        paddingX={1}
        borderStyle="round"
        borderColor={toInkColor(roleColor)}
        width="100%"
        flexDirection="column"
      >
        <Box>
          <Text bold color={toInkColor(roleColor)}>
            {roleIcon} {roleLabel}:
          </Text>
        </Box>
        <MarkdownDisplay content={message.content} />
      </Box>
    );
  }

  return (
    <Box
      marginY={0}
      paddingX={1}
      borderStyle="round"
      borderColor={toInkColor(roleColor)}
      width="100%"
    >
      <Text bold color={toInkColor(roleColor)}>
        {roleIcon} {roleLabel}:
      </Text>
      <Text> {message.content}</Text>
    </Box>
  );
};

// ============================================================================
// MessageList 组件 - 使用 Static 优化渲染
// ============================================================================

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  colors: SemanticColors;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingContent,
  colors,
}) => {
  // 分离已完成的消息（静态）和正在流式输出的内容（动态）
  const staticMessages = useMemo(
    () => messages.filter((m) => m.completed !== false),
    [messages]
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {/* 静态消息 - 使用 Static 组件避免重复渲染 */}
      <Static items={staticMessages}>
        {(message) => (
          <MessageItem key={message.id} message={message} colors={colors} />
        )}
      </Static>

      {/* 流式输出内容 - 动态渲染 */}
      {streamingContent && (
        <Box
          borderStyle="round"
          borderColor={toInkColor(colors.text.response)}
          paddingX={1}
          width="100%"
          flexDirection="column"
        >
          <Box>
            <Text bold color={toInkColor(colors.text.response)}>
              🤖 AI:
            </Text>
          </Box>
          <MarkdownDisplay content={streamingContent} isPending />
          <Text color={toInkColor(colors.ui.cursor)}>▌</Text>
        </Box>
      )}
    </Box>
  );
};

// ============================================================================
// WelcomeScreen 组件
// ============================================================================

interface WelcomeScreenProps {
  version: string;
  colors: SemanticColors;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ version, colors }) => {
  return (
    <Box
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      height="100%"
      padding={2}
    >
      <Box
        borderStyle="double"
        borderColor={toInkColor(colors.border.accent)}
        paddingX={3}
        paddingY={1}
        flexDirection="column"
        alignItems="center"
      >
        <Text color={toInkColor(colors.text.accent)} bold>
          ✨ SaCode v{version}
        </Text>
        <Text color={toInkColor(colors.text.secondary)}>多端 AI 助手</Text>
      </Box>
      <Box marginTop={2} flexDirection="column" alignItems="center">
        <Text color={toInkColor(colors.text.primary)} bold>
          Hi~ 今天想做点什么?
        </Text>
        <Box marginTop={1}>
          <Text dimColor>输入消息开始对话，或输入 /help 获取帮助</Text>
        </Box>
      </Box>
      <Box marginTop={2} flexDirection="column" gap={0}>
        <Text dimColor>
          <Text color={toInkColor(colors.text.user)}>/help</Text> - 查看帮助
        </Text>
        <Text dimColor>
          <Text color={toInkColor(colors.text.user)}>/clear</Text> - 清除对话
        </Text>
        <Text dimColor>
          <Text color={toInkColor(colors.text.user)}>/exit</Text> - 退出程序
        </Text>
        <Text dimColor>
          <Text color={toInkColor(colors.text.user)}>/theme</Text> - 切换主题
        </Text>
      </Box>
    </Box>
  );
};

// ============================================================================
// Main App 组件
// ============================================================================

interface ChatAppProps {
  version: string;
  model: string;
  language: string;
  cwd: string;
  onMessage: (message: string) => Promise<void>;
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  showHeader?: boolean;
}

export const ChatApp: React.FC<ChatAppProps> = ({
  version,
  model,
  language,
  cwd,
  onMessage,
  messages,
  isLoading,
  streamingContent,
  showHeader = true,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  // 获取主题颜色
  const colors = getColors();

  // 处理提交
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      // 检查是否是 /help 命令
      if (trimmed === "/help") {
        setShowHelp(true);
        setInput("");
        return;
      }

      // 检查是否是 /clear 命令
      if (trimmed === "/clear") {
        // TODO: 实现清屏
        setInput("");
        return;
      }

      // 检查是否是 /exit 命令
      if (trimmed === "/exit" || trimmed === "/quit") {
        exit();
        return;
      }

      // 检查是否是 /theme 命令
      if (trimmed.startsWith("/theme")) {
        const parts = trimmed.split(" ");
        const themeName = parts[1];
        if (themeName) {
          const success = getThemeManager().setTheme(themeName);
          if (!success) {
            // 显示可用主题
            const themes = getThemeManager()
              .getAvailableThemes()
              .map((t) => t.name)
              .join(", ");
            console.log(`Available themes: ${themes}`);
          }
        }
        setInput("");
        return;
      }

      // 检查是否是其他命令
      if (trimmed.startsWith("/")) {
        setInput("");
        return;
      }

      // 开始对话
      setInput("");
      setShowHelp(false);
      await onMessage(trimmed);
    },
    [exit, onMessage]
  );

  // 全局快捷键
  useInput(
    (input, key) => {
      if (key.escape) {
        exit();
      }
    },
    { isActive: !isLoading }
  );

  // 判断是否显示欢迎屏幕
  const showWelcome = showHeader && messages.length === 0 && !streamingContent;

  return (
    <Box flexDirection="column" height="100%">
      {/* 欢迎屏幕或消息列表 */}
      {showWelcome ? (
        <WelcomeScreen version={version} colors={colors} />
      ) : (
        <>
          {/* Header - 简洁的顶部栏 */}
          {showHeader && messages.length > 0 && (
            <Box
              paddingX={1}
              borderStyle="round"
              borderColor={toInkColor(colors.border.accent)}
              width="100%"
            >
              <Text bold color={toInkColor(colors.text.accent)}>
                🦞 SaCode
              </Text>
              <Text dimColor>
                {" "}
                v{version} · {model}
              </Text>
              <Spacer />
              <Text dimColor>
                <Text color={toInkColor(colors.text.user)}>/help</Text> ·{" "}
                <Text color={toInkColor(colors.text.secondary)}>Esc 退出</Text>
              </Text>
            </Box>
          )}

          {/* Main Content - 消息列表 */}
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            <MessageList
              messages={messages}
              streamingContent={streamingContent}
              colors={colors}
            />
          </Box>
        </>
      )}

      {/* 输入区域 */}
      <Box
        paddingX={1}
        borderStyle="round"
        borderColor={toInkColor(isLoading ? colors.status.warning : colors.border.accent)}
        width="100%"
      >
        <NewInputBox
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          suggestions={["/help", "/clear", "/lang", "/prefs", "/theme", "/exit"]}
          history={messages.filter((m) => m.role === "user").map((m) => m.content)}
        />
      </Box>

      {/* StatusBar - 底部状态栏 */}
      <NewStatusBar
        model={model}
        language={language}
        mode="Chat"
        cwd={cwd}
        thinkingEnabled={true}
      />
    </Box>
  );
};

export default ChatApp;
