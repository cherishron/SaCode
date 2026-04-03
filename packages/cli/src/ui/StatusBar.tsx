/**
 * StatusBar 组件 - 底部状态栏
 *
 * 使用 Spacer 实现响应式布局，显示更多状态信息
 */

import React from "react";
import { Box, Text, Spacer } from "ink";
import { getColors, toInkColor, type SemanticColors } from "./theme/index.js";

interface StatusBarProps {
  model: string;
  language: string;
  mode: string;
  cwd: string;
  thinkingEnabled?: boolean;
  tokenUsage?: number;
  memoryUsage?: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  language,
  mode,
  cwd,
  thinkingEnabled = true,
  tokenUsage = 0,
  memoryUsage = 0,
}) => {
  const colors = getColors();

  // 截断过长的路径
  const displayCwd = cwd.length > 40 ? "..." + cwd.slice(-37) : cwd;

  // 格式化 token 使用量
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return String(tokens);
  };

  return (
    <Box
      paddingX={1}
      borderStyle="single"
      borderColor={toInkColor(colors.border.default)}
      width="100%"
    >
      {/* 左侧：模型和路径 */}
      <Box>
        <Text bold color={toInkColor(colors.text.accent)}>
          {model}
        </Text>
        <Text dimColor>
          {" "}
          · {displayCwd}
        </Text>
      </Box>

      <Spacer />

      {/* 中间：状态指示器 */}
      <Box gap={2}>
        {thinkingEnabled && (
          <Text dimColor>
            💭 思考
          </Text>
        )}
        {tokenUsage > 0 && (
          <Text dimColor>
            📊 {formatTokens(tokenUsage)} tokens
          </Text>
        )}
      </Box>

      <Spacer />

      {/* 右侧：快捷键提示 */}
      <Box>
        <Text dimColor>
          <Text color={toInkColor(colors.text.user)}>[F1]</Text>帮助
        </Text>
        <Text dimColor>
          {" "}
          <Text color={toInkColor(colors.text.user)}>[Tab]</Text>补全
        </Text>
        <Text dimColor>
          {" "}
          <Text color={toInkColor(colors.text.user)}>[↑↓]</Text>历史
        </Text>
        <Text dimColor>
          {" "}
          <Text color={toInkColor(colors.text.user)}>[Esc]</Text>退出
        </Text>
      </Box>
    </Box>
  );
};

export default StatusBar;