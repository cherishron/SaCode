/**
 * SaCode CLI TUI 组件
 *
 * 使用 Ink (React for CLI) 实现
 * 新布局：Header（条件显示）→ Main → InputBox → StatusBar（底部）
 */

import React, { useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { Header } from "./Header.js";
import { StatusBar as NewStatusBar } from "./StatusBar.js";
import { InputBox as NewInputBox } from "./InputBox.js";

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
}

// ============================================================================
// ToolCall 组件
// ============================================================================

interface ToolCallProps {
  message: Message;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "📖",
  write_file: "📝",
  replace: "✏️",
  edit_file: "✏️",
  delete_file: "🗑️",
  list_directory: "📁",
  glob: "🔍",
  grep_tool: "🔍",
  web_search: "🌐",
  web_fetch: "🌐",
  run_shell_command: "💻",
  think: "💭",
  plan: "📋",
  get_current_time: "🕐",
  save_memory: "💾",
  todo_read: "📋",
  todo_write: "✅",
  ask_user_question: "❓",
  image_read: "🖼️",
  task: "🤖",
};

const STATUS_COLORS: Record<string, "yellow" | "blue" | "green" | "red"> = {
  pending: "yellow",
  running: "blue",
  success: "green",
  error: "red",
};

export const ToolCall: React.FC<ToolCallProps> = ({ message }) => {
  const icon = TOOL_ICONS[message.toolName ?? ""] ?? "🔧";
  const statusColor = STATUS_COLORS[message.toolStatus ?? "pending"] ?? "yellow";

  return (
    <Box flexDirection="column" marginLeft={2} marginY={1}>
      <Box>
        <Text color={statusColor}>
          {message.toolStatus === "running" ? (
            <Spinner type="dots" />
          ) : message.toolStatus === "success" ? (
            "✓"
          ) : message.toolStatus === "error" ? (
            "✗"
          ) : (
            "○"
          )}
        </Text>
        <Text>
          {" "}
          {icon} <Text color="cyan" bold>{message.toolName}</Text>
        </Text>
        {message.toolArgs && (
          <Text dimColor>
            {" "}
            {Object.entries(message.toolArgs)
              .slice(0, 1)
              .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
              .join(", ")}
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
        <Box marginLeft={2}>
          <Text dimColor>└─ </Text>
          <Text dimColor>
            {message.toolResult.slice(0, 100)}
            {message.toolResult.length > 100 ? "..." : ""}
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
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  if (message.role === "tool") {
    return <ToolCall message={message} />;
  }

  if (message.role === "system") {
    return (
      <Box marginY={1}>
        <Text dimColor>┌─ System</Text>
        <Box marginLeft={2}>
          <Text dimColor>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box marginY={1} flexDirection="column">
      <Box>
        <Text bold color={message.role === "user" ? "cyan" : "green"}>
          {message.role === "user" ? "You: " : "AI:  "}
        </Text>
        <Text>{message.content}</Text>
      </Box>
    </Box>
  );
};

// ============================================================================
// MessageList 组件
// ============================================================================

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingContent,
}) => {
  const { stdout } = useStdout();
  const maxVisible = stdout.rows - 15;

  const visibleMessages = messages.slice(-maxVisible);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {visibleMessages.length === 0 && !streamingContent && (
        <Box justifyContent="center" alignItems="center" height="100%">
          <Box flexDirection="column" alignItems="center">
            <Text color="green" bold marginBottom={1}>
              ✨ Hi~今天想做点什么?
            </Text>
            <Text dimColor>
              输入消息开始对话，或输入 /help 获取帮助
            </Text>
          </Box>
        </Box>
      )}

      {visibleMessages.map((msg) => (
        <MessageItem key={`msg-${msg.id}`} message={msg} />
      ))}
      {streamingContent && (
        <Box key="streaming-content">
          <Text bold color="green">
            AI:
          </Text>
          <Text> {streamingContent}</Text>
        </Box>
      )}
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
  const [input, setInput] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  // 处理提交
  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // 检查是否是 /help 命令
    if (trimmed === "/help") {
      setShowHelp(true);
      setInput("");
      return;
    }

    // 检查是否是其他命令
    if (trimmed.startsWith("/")) {
      // 这里可以添加其他命令的处理
      setInput("");
      return;
    }

    // 开始对话，隐藏 Header
    setInput("");
    setShowHelp(false);
    await onMessage(trimmed);
  };

  // 全局快捷键
  useInput((input, key) => {
    if (key.escape) {
      exit();
    }
    if (key.ctrl && input === "l") {
      // Ctrl+L 清屏
      // TODO: 实现清屏功能
    }
  });

  // 判断是否显示 Header
  const shouldShowHeader = showHeader && messages.length === 0;

  return (
    <Box flexDirection="column" height="100%">
      {/* Header - 条件显示，无边框 */}
      {shouldShowHeader && (
        <Box paddingX={1} marginBottom={1}>
          <Header version={version} showHelp={!showHelp} />
        </Box>
      )}

      {/* 分隔线 */}
      {shouldShowHeader && (
        <Box paddingX={1}>
          <Text dimColor>──────────────────────────────────</Text>
        </Box>
      )}

      {/* Main Content - 消息列表（支持滚动） */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        <MessageList messages={messages} streamingContent={streamingContent} />
      </Box>

      {/* 分隔线 */}
      <Box paddingX={1}>
        <Text dimColor>──────────────────────────────────</Text>
      </Box>

      {/* InputBox */}
      <Box paddingX={1}>
        <NewInputBox
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          suggestions={["/help", "/clear", "/lang", "/prefs", "/exit"]}
          history={messages.map(m => m.content)}
        />
      </Box>

      {/* StatusBar - 底部状态栏，无边框 */}
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