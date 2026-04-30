/**
 * ToolCallDisplay 组件 - 思考过程可视化
 *
 * 展示工具调用的详细信息：
 * - 工具名称和状态
 * - 思考内容（如果有）
 * - 参数预览
 * - 执行结果
 * - 执行时长
 */

import React, { useState, memo } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { getColors, toInkColor, getToolIcon, toolLabels, statusIcons } from "../theme/index.js";

// ============================================================================
// 类型定义
// ============================================================================

export type ToolStatus = "pending" | "running" | "success" | "error";

export interface ToolCallDisplayProps {
  /** 工具名称 */
  name: string;
  /** 工具状态 */
  status: ToolStatus;
  /** 思考内容 */
  thought?: string;
  /** 工具参数 */
  args?: Record<string, unknown>;
  /** 执行结果 */
  result?: string;
  /** 执行时长 (ms) */
  duration?: number;
  /** 错误信息 */
  error?: string;
  /** 是否展开详情 */
  expanded?: boolean;
  /** 最大结果长度 */
  maxResultLength?: number;
}

// ============================================================================
// ToolCallDisplay 组件
// ============================================================================

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = memo(
  ({
    name,
    status,
    thought,
    args,
    result,
    duration,
    error,
    expanded = false,
    maxResultLength = 200,
  }) => {
    const colors = getColors();
    const [isExpanded, _setIsExpanded] = useState(expanded);

    const statusConfig = {
      pending: { icon: statusIcons.pending, color: colors.status.pending },
      running: { icon: statusIcons.running, color: colors.status.running },
      success: { icon: statusIcons.success, color: colors.status.success },
      error: { icon: statusIcons.error, color: colors.status.error },
    };

    const config = statusConfig[status];

    // 格式化参数预览
    const formatArgsPreview = (args: Record<string, unknown> | undefined): string => {
      if (!args || Object.keys(args).length === 0) return "";

      const entries = Object.entries(args).slice(0, 2);
      return entries
        .map(([k, v]) => {
          const strValue = typeof v === "string" ? v : JSON.stringify(v);
          const truncated = strValue.length > 25 ? strValue.slice(0, 25) + "..." : strValue;
          return `${k}=${truncated}`;
        })
        .join(" ");
    };

    // 格式化结果预览
    const formatResultPreview = (result: string | undefined): string => {
      if (!result) return "";
      if (result.length <= maxResultLength) return result;
      return result.slice(0, maxResultLength) + "...";
    };

    return (
      <Box flexDirection="column" marginLeft={2} marginY={0} paddingX={1} width="90%">
        {/* 标题行 */}
        <Box>
          {/* 状态图标 */}
          <Text color={toInkColor(config.color)} bold>
            {status === "running" ? <Spinner type="dots" /> : config.icon}
          </Text>

          {/* 工具图标和名称 */}
          <Text>
            {" "}
            {getToolIcon(name)}{" "}
            <Text color={toInkColor(colors.text.user)} bold>
              {name}
            </Text>
          </Text>

          {/* 参数预览 */}
          {args && Object.keys(args).length > 0 && !isExpanded && (
            <Text dimColor> {formatArgsPreview(args)}</Text>
          )}

          {/* 执行时长 */}
          {duration !== undefined && <Text dimColor> ({duration}ms)</Text>}
        </Box>

        {/* 思考内容 */}
        {thought && isExpanded && (
          <Box>
            <Text dimColor>├─ [TH] </Text>
            <Text dimColor wrap="wrap">
              {thought}
            </Text>
          </Box>
        )}

        {/* 完整参数 */}
        {args && isExpanded && (
          <Box flexDirection="column">
            <Text dimColor>├─ 参数:</Text>
            <Box marginLeft={4}>
              <Text dimColor>
                {JSON.stringify(args, null, 2).slice(0, 300)}
                {JSON.stringify(args).length > 300 ? "..." : ""}
              </Text>
            </Box>
          </Box>
        )}

        {/* 执行结果 */}
        {result && isExpanded && (
          <Box flexDirection="column">
            <Text dimColor>└─ 结果:</Text>
            <Box marginLeft={4}>
              <Text dimColor wrap="wrap">
                {formatResultPreview(result)}
              </Text>
            </Box>
          </Box>
        )}

        {/* 错误信息 */}
        {error && (
          <Box>
            <Text dimColor>└─ </Text>
            <Text color={toInkColor(colors.status.error)}>错误: {error}</Text>
          </Box>
        )}

        {/* 展开/折叠提示 */}
        {(thought || (args && Object.keys(args).length > 2) || (result && result.length > 100)) && (
          <Box>
            <Text dimColor>
              └─ [
              <Text
                color={toInkColor(colors.text.accent)}
              >
                {isExpanded ? "折叠" : "展开详情"}
              </Text>
              ]
            </Text>
          </Box>
        )}
      </Box>
    );
  }
);

ToolCallDisplay.displayName = "ToolCallDisplay";

export default ToolCallDisplay;
