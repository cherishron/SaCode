/**
 * ExitSummary 组件 - 退出时的会话统计面板
 *
 * 展示当前会话的消息数、工作模式、耗时、模型使用情况和成本
 */

import React from "react";
import { Box, Text } from "ink";
import { toInkColor, getColors } from "../theme/index.js";
import type { CostStats } from "@sacode/core";

// ============================================================================
// 类型定义
// ============================================================================

export interface ExitSummaryProps {
  /** 用户消息数 */
  messageCount: number;
  /** 会话持续时间（毫秒） */
  sessionDuration: number;
  /** 工作模式 */
  workMode: string;
  /** 是否开启思考模式 */
  showThinking: boolean;
  /** 当前模型 */
  model: string;
  /** 成本统计数据（可选） */
  costStats?: CostStats;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 格式化时长：毫秒 → Xm Xs
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * 格式化数字：添加千分位逗号
 */
function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

// ============================================================================
// ExitSummary 组件
// ============================================================================

export const ExitSummary: React.FC<ExitSummaryProps> = ({
  messageCount,
  sessionDuration,
  workMode,
  showThinking,
  model: _model,
  costStats,
}) => {
  const colors = getColors();
  const labelColor = toInkColor(colors.text.secondary);
  const valueColor = toInkColor(colors.text.primary);
  const headingColor = toInkColor(colors.text.accent);
  const borderColor = toInkColor(colors.border.default);
  const accentColor = toInkColor(colors.ui.symbol);

  // 判断是否有模型统计数据
  const hasModelStats = costStats && costStats.byModel.size > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={2}
      paddingY={1}
    >
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color={accentColor} bold>
          SaCode 正在关闭，再见！
        </Text>
      </Box>

      {/* 交互摘要 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={headingColor} bold>
          交互摘要
        </Text>
        <Box>
          <Box width={20}>
            <Text color={labelColor}>消息数：</Text>
          </Box>
          <Text color={valueColor}>{messageCount} 条</Text>
        </Box>
        <Box>
          <Box width={20}>
            <Text color={labelColor}>工作模式：</Text>
          </Box>
          <Text color={valueColor}>{workMode.toUpperCase()}</Text>
        </Box>
        <Box>
          <Box width={20}>
            <Text color={labelColor}>思考模式：</Text>
          </Box>
          <Text color={valueColor}>{showThinking ? "ON" : "OFF"}</Text>
        </Box>
      </Box>

      {/* 性能 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={headingColor} bold>
          性能
        </Text>
        <Box>
          <Box width={20}>
            <Text color={labelColor}>总耗时：</Text>
          </Box>
          <Text color={valueColor}>{formatDuration(sessionDuration)}</Text>
        </Box>
      </Box>

      {/* 模型使用情况 */}
      {hasModelStats ? (
        <Box flexDirection="column">
          {/* 表头 */}
          <Box>
            <Box width={22}>
              <Text color={headingColor} bold>
                模型使用情况
              </Text>
            </Box>
            <Box width={10}>
              <Text color={labelColor}>请求数</Text>
            </Box>
            <Box width={14}>
              <Text color={labelColor}>输入 token</Text>
            </Box>
            <Box width={14}>
              <Text color={labelColor}>输出 token</Text>
            </Box>
          </Box>
          {/* 每个模型一行 */}
          {Array.from(costStats!.byModel.values()).map((ms) => (
            <Box key={`${ms.provider}:${ms.model}`}>
              <Box width={22}>
                <Text color={valueColor}>{ms.model}</Text>
              </Box>
              <Box width={10}>
                <Text color={valueColor}>{formatNumber(ms.requests)}</Text>
              </Box>
              <Box width={14}>
                <Text color={valueColor}>{formatNumber(ms.inputTokens)}</Text>
              </Box>
              <Box width={14}>
                <Text color={valueColor}>{formatNumber(ms.outputTokens)}</Text>
              </Box>
            </Box>
          ))}
          {/* 总成本 */}
          <Box marginTop={1}>
            <Box width={20}>
              <Text color={labelColor}>总成本：</Text>
            </Box>
            <Text color={accentColor} bold>
              ${costStats!.totalCost.toFixed(2)}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box>
          <Text color={labelColor}>暂无统计数据</Text>
        </Box>
      )}
    </Box>
  );
};

export default ExitSummary;
