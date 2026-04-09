/**
 * WelcomeScreen 组件 — 消息列表为空时的欢迎内容
 *
 * 显示在 BrandHeader 下方、输入框上方
 * 包含分隔线和使用提示
 */

import React from "react";
import { Box, Text } from "ink";
import { getColors, toInkColor } from "../theme/index.js";

interface WelcomeScreenProps {
  terminalWidth?: number;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  terminalWidth: termWidth,
}) => {
  const colors = getColors();
  const tw = termWidth ?? process.stdout.columns ?? 80;
  const separatorWidth = Math.min(tw - 4, 60);

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* 分隔线 */}
      <Text color={toInkColor(colors.ui.comment)}>
        {"─".repeat(separatorWidth)}
      </Text>

      {/* 快速提示 */}
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color={toInkColor(colors.text.secondary)}>
          快速开始:
        </Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text color={toInkColor(colors.text.accent)}>/help</Text>
            <Text color={toInkColor(colors.text.secondary)}>    显示帮助信息</Text>
          </Text>
          <Text>
            <Text color={toInkColor(colors.text.accent)}>/model</Text>
            <Text color={toInkColor(colors.text.secondary)}>   切换 AI 模型</Text>
          </Text>
          <Text>
            <Text color={toInkColor(colors.text.accent)}>/session</Text>
            <Text color={toInkColor(colors.text.secondary)}> 管理会话</Text>
          </Text>
          <Text>
            <Text color={toInkColor(colors.text.accent)}>/theme</Text>
            <Text color={toInkColor(colors.text.secondary)}>   切换主题</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export default WelcomeScreen;
