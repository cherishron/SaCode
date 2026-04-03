/**
 * InputBox 组件 - 增强的输入框，支持 Tab 补全和历史记录
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  suggestions?: string[];
  history?: string[];
  isLoading?: boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  value,
  onChange,
  onSubmit,
  suggestions = ["/help", "/clear", "/lang", "/prefs", "/exit"],
  history = [],
  isLoading = false,
}) => {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);

  // 处理键盘输入
  useInput((input, key) => {
    if (key.tab) {
      // Tab 补全
      handleTabCompletion();
    } else if (key.upArrow) {
      // 上箭头：历史记录
      handleHistoryUp();
    } else if (key.downArrow) {
      // 下箭头：历史记录
      handleHistoryDown();
    } else if (key.return) {
      // 回车：提交
      if (value.trim()) {
        handleSubmit();
      }
    } else if (key.escape) {
      // Escape：清空输入
      onChange("");
      setShowSuggestions(false);
    }
  });

  const handleTabCompletion = () => {
    if (value.length === 0) return;

    // 过滤建议
    const filtered = suggestions.filter((s) =>
      s.toLowerCase().startsWith(value.toLowerCase())
    );

    if (filtered.length === 1) {
      // 只有一个匹配，直接补全
      onChange(filtered[0]);
      setShowSuggestions(false);
    } else if (filtered.length > 1) {
      // 多个匹配，显示建议
      setFilteredSuggestions(filtered);
      setShowSuggestions(true);
    }
  };

  const handleHistoryUp = () => {
    if (history.length === 0) return;

    if (historyIndex === -1) {
      // 第一次按上箭头，保存当前输入
      setTempInput(value);
      setHistoryIndex(history.length - 1);
      onChange(history[history.length - 1]);
    } else if (historyIndex > 0) {
      // 继续向上浏览
      setHistoryIndex(historyIndex - 1);
      onChange(history[historyIndex - 1]);
    }
  };

  const handleHistoryDown = () => {
    if (historyIndex === -1) return;

    if (historyIndex === history.length - 1) {
      // 回到当前输入
      setHistoryIndex(-1);
      onChange(tempInput);
    } else {
      // 继续向下浏览
      setHistoryIndex(historyIndex + 1);
      onChange(history[historyIndex + 1]);
    }
  };

  const handleSubmit = () => {
    onSubmit(value);
    setShowSuggestions(false);
    setHistoryIndex(-1);
    setTempInput("");
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box width="100%">
        <Text color="gray">➜ </Text>
        <TextInput
          value={value}
          onChange={onChange}
          placeholder={isLoading ? "处理中..." : "输入消息或 /help"}
          onSubmit={() => {}}
        />
      </Box>

      {/* 显示补全建议 - 改为紧凑显示 */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <Box flexDirection="row" paddingLeft={2} marginTop={0}>
          <Text color="gray">
            {filteredSuggestions.slice(0, 3).join(" · ")}
          </Text>
        </Box>
      )}
    </Box>
  );
};