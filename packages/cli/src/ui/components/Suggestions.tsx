/**
 * Suggestions 组件 - Gemini CLI 风格命令补全
 *
 * 支持：
 * - Tab 补全
 * - ↑↓ 选择
 * - 模糊搜索
 * - 分页显示
 */

import React, { memo } from "react";
import { Box, Text } from "ink";
import { getColors, toInkColor } from "../theme/index.js";
import type { SlashCommand } from "../../commands/types.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface SuggestionsProps {
  /** 命令列表 */
  commands: SlashCommand[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 是否可见 */
  visible: boolean;
  /** 最大显示数量 */
  maxVisible?: number;
  /** 输入查询 */
  query?: string;
}

// ============================================================================
// SuggestionItem 组件
// ============================================================================

interface SuggestionItemProps {
  command: SlashCommand;
  isSelected: boolean;
  query: string;
}

const SuggestionItem: React.FC<SuggestionItemProps> = memo(
  ({ command, isSelected, query }) => {
    const colors = getColors();

    // 高亮匹配的文本
    const highlightMatch = (text: string, query: string) => {
      if (!query) return text;

      const lowerText = text.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const index = lowerText.indexOf(lowerQuery);

      if (index === -1) return text;

      return (
        <>
          {text.slice(0, index)}
          <Text bold color={toInkColor(colors.text.accent)}>
            {text.slice(index, index + query.length)}
          </Text>
          {text.slice(index + query.length)}
        </>
      );
    };

    return (
      <Box>
        <Text
          color={isSelected ? toInkColor(colors.text.accent) : toInkColor(colors.text.primary)}
          bold={isSelected}
          inverse={isSelected}
        >
          {isSelected ? "❯ " : "  "}/{highlightMatch(command.name, query)}
        </Text>
        {command.aliases && command.aliases.length > 0 && (
          <Text dimColor>
            {" "}
            ({command.aliases.map((a) => `/${a}`).join(", ")})
          </Text>
        )}
        <Text dimColor>
          {"  "}
          {command.description.slice(0, 40)}
          {command.description.length > 40 ? "..." : ""}
        </Text>
      </Box>
    );
  }
);

SuggestionItem.displayName = "SuggestionItem";

// ============================================================================
// Suggestions 组件
// ============================================================================

export const Suggestions: React.FC<SuggestionsProps> = ({
  commands,
  selectedIndex,
  visible,
  maxVisible = 10,
  query = "",
}) => {
  const colors = getColors();

  // commands are already filtered and sorted by InputPrompt;
  // no secondary filtering here to keep selectedIndex in sync.
  const displayCommands = commands;

  if (!visible || displayCommands.length === 0) {
    return null;
  }

  // 计算分页
  const startIndex = Math.floor(selectedIndex / maxVisible) * maxVisible;
  const visibleCommands = displayCommands.slice(
    startIndex,
    startIndex + maxVisible
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 命令列表 */}
      {visibleCommands.map((cmd, index) => {
        const actualIndex = startIndex + index;
        const isSelected = actualIndex === selectedIndex;

        return (
          <SuggestionItem
            key={cmd.name}
            command={cmd}
            isSelected={isSelected}
            query={query}
          />
        );
      })}

      {/* 分页提示 */}
      {displayCommands.length > maxVisible && (
        <Box marginTop={1}>
          <Text dimColor>
            显示 {startIndex + 1}-
            {Math.min(startIndex + maxVisible, displayCommands.length)} /{" "}
            {displayCommands.length} 个命令
          </Text>
        </Box>
      )}

      {/* 快捷键提示 */}
      <Box marginTop={1}>
        <Text dimColor>
          <Text color={toInkColor(colors.text.user)}>[Tab]</Text> 补全
          {"  "}
          <Text color={toInkColor(colors.text.user)}>[↑↓]</Text> 选择
          {"  "}
          <Text color={toInkColor(colors.text.user)}>[Enter]</Text> 执行
          {"  "}
          <Text color={toInkColor(colors.text.user)}>[Esc]</Text> 取消
        </Text>
      </Box>
    </Box>
  );
};

export default Suggestions;
