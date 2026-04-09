/**
 * ReverseSearchOverlay 组件 - 反向搜索界面
 *
 * 显示反向搜索的 UI 界面
 */

import React from "react";
import { Box, Text } from "ink";
import { getColors, toInkColor } from "../theme/index.js";
import type { ReverseSearchResult } from "../hooks/useReverseSearch.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface ReverseSearchOverlayProps {
  /** 搜索查询 */
  query: string;
  /** 匹配结果 */
  results: ReverseSearchResult[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 最大显示数量 */
  maxVisible?: number;
}

// ============================================================================
// ReverseSearchOverlay 组件
// ============================================================================

export const ReverseSearchOverlay: React.FC<ReverseSearchOverlayProps> = ({
  query,
  results,
  selectedIndex,
  maxVisible = 5,
}) => {
  const colors = getColors();

  if (results.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text dimColor>bck-i-search: </Text>
          <Text color={toInkColor(colors.text.accent)}>{query}_</Text>
        </Box>
        <Text dimColor>无匹配结果</Text>
      </Box>
    );
  }

  // 计算显示范围
  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), results.length - maxVisible));
  const visibleResults = results.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 搜索提示 */}
      <Box>
        <Text dimColor>bck-i-search: </Text>
        <Text color={toInkColor(colors.text.accent)}>{query}_</Text>
      </Box>

      {/* 结果列表 */}
      <Box flexDirection="column" marginLeft={2}>
        {visibleResults.map((result, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;

          // 高亮匹配部分
          const item = result.item;
          const queryLower = query.toLowerCase();
          const matchIndex = item.toLowerCase().indexOf(queryLower);

          return (
            <Box key={result.index}>
              <Text
                bold={isSelected}
                inverse={isSelected}
                color={isSelected ? toInkColor(colors.text.accent) : toInkColor(colors.text.primary)}
              >
                {isSelected ? ">" : " "}{" "}
                {matchIndex >= 0 ? (
                  <>
                    {item.slice(0, matchIndex)}
                    <Text bold color={toInkColor(colors.text.accent)}>
                      {item.slice(matchIndex, matchIndex + query.length)}
                    </Text>
                    {item.slice(matchIndex + query.length)}
                  </>
                ) : (
                  item
                )}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* 提示 */}
      <Box marginTop={1}>
        <Text dimColor>
          <Text color={toInkColor(colors.text.user)}>Ctrl+R</Text> 下一个{"  "}
          <Text color={toInkColor(colors.text.user)}>Enter</Text> 选择{"  "}
          <Text color={toInkColor(colors.text.user)}>Esc</Text> 取消
        </Text>
      </Box>
    </Box>
  );
};

export default ReverseSearchOverlay;
