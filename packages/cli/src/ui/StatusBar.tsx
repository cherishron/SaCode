/**
 * StatusBar 组件 - 底部状态栏
 */

import React from "react";
import { Box, Text } from "ink";

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
  // 截断过长的路径
  const displayCwd = cwd.length > 50 ? "..." + cwd.slice(-47) : cwd;

  return (
    <Box
      paddingX={1}
      paddingY={0}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Box>
        <Text color="white">{model}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">{displayCwd}</Text>
      </Box>
      <Box>
        <Text color="gray">[F1]帮助 [Tab]补全 [↑↓]历史 [Ctrl+L]清屏 [Esc]退出</Text>
      </Box>
    </Box>
  );
};