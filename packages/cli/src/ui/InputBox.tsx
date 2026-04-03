/**
 * InputBox 组件 - 增强的输入框，支持 Tab 补全和历史记录
 *
 * 使用主题配置，支持加载状态指示
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { getColors, toInkColor, type SemanticColors } from "./theme/index.js";

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
  const colors = getColors();
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);

  // 过滤建议（memoized）
  const currentFilteredSuggestions = useMemo(() => {
    if (!value) return [];
    return suggestions.filter((s) =>
      s.toLowerCase().startsWith(value.toLowerCase())
    );
  }, [value, suggestions]);

  // 处理 Tab 补全
  const handleTabCompletion = useCallback(() => {
    if (value.length === 0) return;

    if (currentFilteredSuggestions.length === 1) {
      // 只有一个匹配，直接补全
      onChange(currentFilteredSuggestions[0]!);
      setShowSuggestions(false);
    } else if (currentFilteredSuggestions.length > 1) {
      // 多个匹配，显示建议
      setFilteredSuggestions(currentFilteredSuggestions);
      setShowSuggestions((prev) => !prev);
    }
  }, [value, currentFilteredSuggestions, onChange]);

  // 处理历史记录向上
  const handleHistoryUp = useCallback(() => {
    if (history.length === 0) return;

    if (historyIndex === -1) {
      // 第一次按上箭头，保存当前输入
      setTempInput(value);
      setHistoryIndex(history.length - 1);
      onChange(history[history.length - 1] ?? "");
    } else if (historyIndex > 0) {
      // 继续向上浏览
      setHistoryIndex(historyIndex - 1);
      onChange(history[historyIndex - 1] ?? "");
    }
  }, [history, historyIndex, value, onChange]);

  // 处理历史记录向下
  const handleHistoryDown = useCallback(() => {
    if (historyIndex === -1) return;

    if (historyIndex >= history.length - 1) {
      // 回到当前输入
      setHistoryIndex(-1);
      onChange(tempInput);
    } else {
      // 继续向下浏览
      setHistoryIndex(historyIndex + 1);
      onChange(history[historyIndex + 1] ?? "");
    }
  }, [history, historyIndex, tempInput, onChange]);

  // 处理提交
  const handleSubmit = useCallback(() => {
    if (!value.trim()) return;
    onSubmit(value);
    setShowSuggestions(false);
    setHistoryIndex(-1);
    setTempInput("");
  }, [value, onSubmit]);

  // 处理键盘输入
  useInput(
    (input, key) => {
      if (key.tab) {
        handleTabCompletion();
      } else if (key.upArrow) {
        handleHistoryUp();
      } else if (key.downArrow) {
        handleHistoryDown();
      } else if (key.return) {
        handleSubmit();
      } else if (key.escape) {
        onChange("");
        setShowSuggestions(false);
        setHistoryIndex(-1);
      } else {
        // 输入时隐藏建议
        setShowSuggestions(false);
      }
    },
    { isActive: !isLoading }
  );

  // 生成 placeholder
  const placeholder = useMemo(() => {
    if (isLoading) {
      return "AI 正在思考...";
    }
    return "输入消息或 /help 获取帮助";
  }, [isLoading]);

  return (
    <Box flexDirection="column" width="100%">
      <Box width="100%">
        {/* 输入提示符 */}
        {isLoading ? (
          <Box>
            <Text color={toInkColor(colors.status.warning)}>
              <Spinner type="dots" />
            </Text>
            <Text color={toInkColor(colors.status.warning)}> </Text>
          </Box>
        ) : (
          <Text bold color={toInkColor(colors.text.accent)}>
            ➜{" "}
          </Text>
        )}

        {/* 输入框 */}
        <Box flexGrow={1}>
          <TextInput
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            onSubmit={handleSubmit}
            showCursor={true}
          />
        </Box>
      </Box>

      {/* 显示补全建议 */}
      {showSuggestions && filteredSuggestions.length > 1 && (
        <Box paddingLeft={2} marginTop={0}>
          <Text dimColor>
            建议:{" "}
            {filteredSuggestions
              .slice(0, 5)
              .map((s, i) => (
                <Text key={s}>
                  {i > 0 ? " · " : ""}
                  <Text color={toInkColor(colors.text.user)}>{s}</Text>
                </Text>
              ))}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default InputBox;