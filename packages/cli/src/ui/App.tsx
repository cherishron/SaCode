/**
 * SaCode CLI TUI 组件
 *
 * 1:1 还原 Gemini CLI 的 Composer 布局
 * 参考: google-gemini/gemini-cli/packages/cli/src/ui/components/Composer.tsx
 *
 * 布局结构 (Gemini CLI Composer):
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ [StatusRow]                                                      │
 * │   Row 1: Loading indicator / Tips                               │
 * │   Row 2: Modes · Context usage                                  │
 * ├──────────────────────────────────────────────────────────────────┤
 * │                                                                  │
 * │ [Messages]  (DetailedMessagesDisplay)                           │
 * │                                                                  │
 * ├──────────────────────────────────────────────────────────────────┤
 * │ [InputPrompt]  > Type your message or @path/to/file             │
 * │                [Suggestions]                                     │
 * ├──────────────────────────────────────────────────────────────────┤
 * │ [Footer]  ~/project · main · gpt-4o · 45% context · INSERT      │
 * └──────────────────────────────────────────────────────────────────┘
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { InputPrompt } from "./InputPrompt.js";
import { MarkdownDisplay } from "./components/MarkdownDisplay.js";
import { GeminiHeader } from "./components/GeminiHeader.js";
import { WelcomeScreen } from "./components/WelcomeScreen.js";
import { toInkColor, getColors, getToolIcon, statusIcons, type SemanticColors } from "./theme/index.js";
import type { SlashCommand } from "../commands/types.js";
import { useHistory } from "./hooks/useHistory.js";
import type { AccountInfo } from "./types.js";
import type { WorkMode } from "@sacode/core";
import { getCostTracker } from "@sacode/core";
import { ExitSummary } from "./components/ExitSummary.js";

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
// ToolCall 组件 - Gemini CLI 风格：紧凑内联
// ============================================================================

interface ToolCallProps {
  message: Message;
  colors: SemanticColors;
}

const ToolCall: React.FC<ToolCallProps> = ({ message, colors }) => {
  const statusIcon = statusIcons[message.toolStatus ?? "pending"];

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text color={toInkColor(colors.status[message.toolStatus ?? "pending"])}>{statusIcon}</Text>
        <Text> {getToolIcon(message.toolName ?? "")} </Text>
        <Text bold color={toInkColor(colors.text.secondary)}>
          {message.toolName}
        </Text>
        {message.toolDuration !== undefined && <Text dimColor> ({message.toolDuration}ms)</Text>}
      </Box>
      {message.toolResult && (
        <Text dimColor>
          {"  "}└ {message.toolResult.slice(0, 100)}
          {message.toolResult.length > 100 ? "..." : ""}
        </Text>
      )}
    </Box>
  );
};

// ============================================================================
// RoleLabel 组件 - 统一角色标识
// ============================================================================

const roleLabels: Record<string, { tag: string; color: keyof SemanticColors["text"] }> = {
  user: { tag: "[YOU]", color: "primary" },
  assistant: { tag: "[AI]", color: "accent" },
  system: { tag: "[SA]", color: "muted" },
  tool: { tag: "[T]", color: "secondary" },
};

const RoleLabel: React.FC<{ role: string; colors: SemanticColors }> = ({ role, colors }) => {
  const config = roleLabels[role] ?? roleLabels.system;
  return (
    <Text bold color={toInkColor(colors.text[config.color])}>
      {config.tag}
    </Text>
  );
};

// ============================================================================
// MessageItem 组件 - 带 RoleLabel 的消息展示
// ============================================================================

interface MessageItemProps {
  message: Message;
  colors: SemanticColors;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, colors }) => {
  if (message.role === "tool") {
    return <ToolCall message={message} colors={colors} />;
  }

  if (message.role === "system") {
    return (
      <Box>
        <RoleLabel role="system" colors={colors} />
        <Text> </Text>
        <Text dimColor>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === "user") {
    return (
      <Box flexDirection="column">
        <RoleLabel role="user" colors={colors} />
        <Box marginLeft={1}>
          <Text>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <RoleLabel role="assistant" colors={colors} />
      <Box marginLeft={1}>
        <MarkdownDisplay content={message.content} />
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
  colors: SemanticColors;
}

const MessageList: React.FC<MessageListProps> = ({ messages, streamingContent, colors }) => {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} colors={colors} />
      ))}

      {streamingContent && (
        <Box flexDirection="column">
          <MarkdownDisplay content={streamingContent} isPending />
          <Text color={toInkColor(colors.ui.cursor)}>▌</Text>
        </Box>
      )}
    </Box>
  );
};

// ============================================================================
// StatusRow 组件 - Gemini CLI 风格：两行状态
// Row 1: Loading / Tips
// Row 2: Modes · Context usage
// ============================================================================

interface StatusRowProps {
  model: string;
  contextTokens: number;
  contextMax: number;
  isLoading: boolean;
  colors: SemanticColors;
}

const StatusRow: React.FC<StatusRowProps> = ({
  model: _model,
  contextTokens,
  contextMax,
  isLoading,
  colors,
}) => {
  const contextPercent = contextMax > 0 ? Math.round((contextTokens / contextMax) * 100) : 0;

  return (
    <Box flexDirection="column" width="100%">
      {/* Row 1: Loading indicator */}
      {isLoading && (
        <Box width="100%" flexDirection="row" alignItems="center" marginLeft={1}>
          <Text color={toInkColor(colors.status.running)}>~</Text>
          <Text color={toInkColor(colors.text.secondary)}> Thinking...</Text>
        </Box>
      )}

      {/* Row 2: Context usage */}
      <Box width="100%" flexDirection="row" alignItems="center" marginLeft={1}>
        <Text color={toInkColor(colors.text.secondary)}>{contextPercent}% context</Text>
      </Box>
    </Box>
  );
};

// ============================================================================
// Footer 组件 - Gemini CLI 风格：多列布局，" · " 分隔
// ~/project · main · gpt-4o · 45% context · INSERT
// ============================================================================

interface FooterProps {
  model: string;
  cwd: string;
  colors: SemanticColors;
  terminalWidth: number;
  contextPercent: number;
  vimMode?: string | undefined;
  gitBranch?: string | undefined;
  workMode?: WorkMode;
  showThinking?: boolean;
}

const Footer: React.FC<FooterProps> = ({
  model: _model,
  cwd,
  colors,
  terminalWidth,
  contextPercent,
  vimMode,
  gitBranch,
  workMode,
  showThinking,
}) => {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const shortCwd = homeDir ? cwd.replace(homeDir, "~") : cwd;

  return (
    <Box width={terminalWidth} paddingX={1} overflow="hidden">
      <Text color={toInkColor(colors.text.secondary)}>{shortCwd}</Text>
      {gitBranch && (
        <>
          <Text color={toInkColor(colors.ui.comment)}> · </Text>
          <Text color={toInkColor(colors.text.secondary)}>{gitBranch}</Text>
        </>
      )}
      <Text color={toInkColor(colors.ui.comment)}> · </Text>
      <Text color={toInkColor(colors.text.secondary)}>{_model}</Text>
      <Text color={toInkColor(colors.ui.comment)}> · </Text>
      <Text color={toInkColor(colors.text.secondary)}>{contextPercent}% context</Text>
      {vimMode && vimMode !== "insert" && (
        <>
          <Text color={toInkColor(colors.ui.comment)}> · </Text>
          <Text color={toInkColor(colors.text.accent)}>{vimMode}</Text>
        </>
      )}
      {/* 工作模式指示 */}
      {workMode && (
        <>
          <Text color={toInkColor(colors.ui.comment)}> · </Text>
          <Text bold color={toInkColor(
            workMode === "smart" ? colors.status.warning :
            workMode === "yolo" ? colors.status.error :
            colors.status.success
          )}>
            [{workMode === "smart" ? "SMART" : workMode === "yolo" ? "YOLO" : "PLAN"}]
          </Text>
        </>
      )}
      {/* 思考模式指示 */}
      {showThinking && (
        <>
          <Text color={toInkColor(colors.ui.comment)}> · </Text>
          <Text bold color={toInkColor(colors.status.success)}>THINK</Text>
        </>
      )}
    </Box>
  );
};

// ============================================================================
// Main App 组件 - Gemini CLI Composer 布局
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
  accountInfo?: AccountInfo | undefined;
  gitBranch?: string | undefined;
  slashCommands?: SlashCommand[];
  isExiting?: boolean;
  onExit?: () => void;
  messageCount?: number;
  sessionStartTime?: number;
  initialWorkMode?: WorkMode;
  onWorkModeChange?: (mode: WorkMode) => void;
  contextMax?: number;
}

export const ChatApp: React.FC<ChatAppProps> = ({
  version,
  model,
  language: _language,
  cwd,
  onMessage,
  messages,
  isLoading,
  streamingContent,
  showHeader = true,
  accountInfo,
  gitBranch,
  slashCommands = [],
  isExiting = false,
  onExit,
  messageCount = 0,
  sessionStartTime,
  initialWorkMode = "smart",
  onWorkModeChange,
  contextMax = 8192,
}) => {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns ?? 80);
  const [workMode, setWorkMode] = useState<WorkMode>(initialWorkMode);
  const [showThinking, setShowThinking] = useState<boolean>(true);

  const colors = getColors();

  // 根据项目目录生成唯一的历史文件路径
  const projectHash = useMemo(() => {
    const crypto = require("crypto");
    return crypto.createHash("md5").update(cwd).digest("hex").slice(0, 8);
  }, [cwd]);

  const { history: savedHistory, add: addHistory } = useHistory({
    filePath: `${process.env.HOME ?? process.env.USERPROFILE ?? "."}/.sacode/history/${projectHash}.json`,
    maxSize: 500,
  });

  useEffect(() => {
    const onResize = () => setTerminalWidth(process.stdout.columns ?? 80);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  // slashCommands are now passed from ChatWrapper via props

  const historyItems = useMemo(() => {
    const sessionHistory = messages.filter((m) => m.role === "user").map((m) => m.content);
    return [...new Set([...sessionHistory, ...savedHistory])];
  }, [messages, savedHistory]);

  const cycleWorkMode = useCallback(() => {
    const modes: WorkMode[] = ["smart", "yolo", "plan"];
    const currentIndex = modes.indexOf(workMode);
    const nextMode = modes[(currentIndex + 1) % modes.length]!;
    setWorkMode(nextMode);
    onWorkModeChange?.(nextMode);
  }, [workMode]);

  const toggleThinking = useCallback(() => {
    setShowThinking((prev) => !prev);
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      // 保存到历史（命令和普通消息都要记录）
      addHistory(trimmed);
      setInput("");

      // 统一委托给 ChatWrapper 处理（slash 命令 + 普通消息）
      await onMessage(trimmed);
    },
    [onMessage, addHistory]
  );

  useInput(
    (input, key) => {
      if (key.escape) {
        if (onExit) {
          onExit();
        } else {
          exit();
        }
      }
      // Alt+M: 循环切换工作模式
      if (key.meta && input === "m") {
        cycleWorkMode();
      }
      // ?: 显示快捷键帮助
      if (input === "?") {
        const helpText = [
          "快捷键帮助:",
          "",
          "  ?        - 显示此帮助",
          "  Esc      - 退出",
          "  Alt+M    - 切换工作模式",
          "  Tab      - 切换思考模式",
          "  ↑↓       - 浏览历史记录",
          "  Ctrl+R   - 反向搜索",
          "",
          "Slash 命令:",
          "  /help    - 显示所有命令",
          "  /auth    - 管理账户",
          "  /models  - 管理模型",
          "  /theme   - 切换主题",
          "  /init    - 生成 AGENTS.md",
        ];
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "system" as const,
            content: helpText.join("\n"),
            timestamp: new Date(),
          },
        ]);
      }
    },
    { isActive: !isLoading && !isExiting }
  );

  // ============================================================
  // Gemini CLI Composer 布局:
  //
  // [StatusRow]        ← 加载状态 + 上下文使用
  // [Messages]         ← 消息列表
  // [InputPrompt]      ← 输入框 + Suggestions
  // [Footer]           ← 底部状态栏（cwd · model）
  // ============================================================

  const hasMessages = messages.length > 0 || streamingContent.length > 0;

  // 退出时渲染统计面板
  if (isExiting) {
    let costStats;
    try {
      costStats = getCostTracker()?.getStats();
    } catch {
      // CostTracker 未初始化
    }
    return (
      <Box flexDirection="column" height="100%">
        <ExitSummary
          messageCount={messageCount}
          sessionDuration={Date.now() - (sessionStartTime ?? Date.now())}
          workMode={workMode}
          showThinking={showThinking}
          model={model}
          costStats={costStats}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* BrandHeader — 仅在消息为空时显示完整启动画面 */}
      {showHeader && !hasMessages && (
        <GeminiHeader
          version={version}
          account={accountInfo}
          model={model}
          cwd={cwd}
          terminalWidth={terminalWidth}
        />
      )}

      {/* StatusRow - 顶部状态行 (有消息时显示) */}
      {showHeader && hasMessages && (
        <StatusRow
          model={model}
          contextTokens={messages.length * 50}
          contextMax={contextMax}
          isLoading={isLoading}
          colors={colors}
        />
      )}

      {/* WelcomeScreen — 消息为空时显示快速提示 */}
      {!hasMessages && (
        <WelcomeScreen terminalWidth={terminalWidth} />
      )}

      {/* Main Content - 消息列表 */}
      {hasMessages && (
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <MessageList messages={messages} streamingContent={streamingContent} colors={colors} />
        </Box>
      )}

      {/* InputPrompt - 输入框 (Gemini CLI 风格) */}
      <InputPrompt
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        commands={slashCommands}
        history={historyItems}
        isLoading={isLoading}
        vimMode="insert"
        onToggleThinking={toggleThinking}
      />

      {/* Footer - 底部状态栏 (Gemini CLI 风格：多列 " · " 分隔) */}
      <Footer
        model={model}
        cwd={cwd}
        colors={colors}
        terminalWidth={terminalWidth}
        contextPercent={messages.length > 0 ? Math.max(0, 100 - Math.round(((messages.length * 50) / contextMax) * 100)) : 100}
        vimMode="insert"
        gitBranch={gitBranch}
        workMode={workMode}
        showThinking={showThinking}
      />
    </Box>
  );
};

export default ChatApp;
