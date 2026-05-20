/**
 * InputPrompt 组件 - Gemini CLI 风格增强输入框
 *
 * 支持：
 * - Tab 补全
 * - ↑↓ 选择命令
 * - 模糊搜索
 * - 历史记录
 * - 反向搜索 (Ctrl+R)
 * - Vim 模式指示器
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { getColors, toInkColor } from "./theme/index.js";
import { Suggestions } from "./components/Suggestions.js";
import { ReverseSearchOverlay } from "./components/ReverseSearchOverlay.js";
import { useReverseSearch } from "./hooks/useReverseSearch.js";
import type { SlashCommand } from "../commands/types.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface InputPromptProps {
  /** 当前输入值 */
  value: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
  /** 提交回调 */
  onSubmit: (value: string) => void;
  /** Slash 命令列表 */
  commands?: SlashCommand[];
  /** 历史记录 */
  history?: string[];
  /** 是否加载中 */
  isLoading?: boolean;
  /** Vim 模式 */
  vimMode?: "insert" | "normal";
  /** 占位符 */
  placeholder?: string;
  /** 是否显示建议 */
  showSuggestions?: boolean;
  /** 切换思考模式回调 */
  onToggleThinking?: () => void;
  /** 多行输入回调 */
  onMultilineChange?: (enabled: boolean) => void;
  /** Shell 命令执行回调 */
  onShellCommand?: (command: string) => void;
}

// ============================================================================
// VimModeIndicator 组件
// ============================================================================

interface VimModeIndicatorProps {
  mode: "insert" | "normal";
}

const VimModeIndicator: React.FC<VimModeIndicatorProps> = ({ mode }) => {
  const colors = getColors();

  return (
    <Box paddingX={1}>
      <Text
        bold
        color={toInkColor(mode === "insert" ? colors.status.success : colors.status.warning)}
      >
        [{mode === "insert" ? "INSERT" : "NORMAL"}]
      </Text>
    </Box>
  );
};

// ============================================================================
// InputPrompt 组件
// ============================================================================

export const InputPrompt: React.FC<InputPromptProps> = ({
  value,
  onChange,
  onSubmit,
  commands = [],
  history = [],
  isLoading = false,
  vimMode = "insert",
  placeholder,
  showSuggestions: externalShowSuggestions,
  onToggleThinking,
  onMultilineChange,
  onShellCommand,
}) => {
  const colors = getColors();

  const isMetaKeyDown = useRef(false);

  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [internalShowSuggestions, setInternalShowSuggestions] = useState(false);
  
  const [isMultilineMode, setIsMultilineMode] = useState(false);
  const [isShellMode, setIsShellMode] = useState(false);
  const [multilineBuffer, setMultilineBuffer] = useState<string[]>([]);

  // 反向搜索
  const reverseSearch = useReverseSearch({
    history,
    onSelect: (item) => {
      onChange(item);
      setIsReverseSearchMode(false);
    },
    onCancel: () => {
      setIsReverseSearchMode(false);
    },
  });

  const [isReverseSearchMode, setIsReverseSearchMode] = useState(false);

  // 显示建议的条件
  const showSuggestions = useMemo(() => {
    if (isReverseSearchMode) return false;
    if (externalShowSuggestions !== undefined) {
      return externalShowSuggestions;
    }
    return internalShowSuggestions && value.startsWith("/") && commands.length > 0;
  }, [externalShowSuggestions, internalShowSuggestions, value, commands, isReverseSearchMode]);

  // 过滤命令
  const filteredCommands = useMemo(() => {
    if (!value.startsWith("/")) return commands;

    const query = value.slice(1).toLowerCase();

    return commands
      .filter((cmd) => {
        if (cmd.hidden) return false;
        if (!query) return true;
        if (cmd.name.toLowerCase().includes(query)) return true;
        if (cmd.aliases?.some((a) => a.toLowerCase().includes(query))) return true;
        return false;
      })
      .sort((a, b) => {
        const aExact = a.name.toLowerCase().startsWith(query);
        const bExact = b.name.toLowerCase().startsWith(query);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [value, commands]);

  // 重置选中索引
  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [filteredCommands.length]);

  // Tab 补全
  const handleTabCompletion = useCallback(() => {
    if (filteredCommands.length === 0) return;
    const selectedCmd = filteredCommands[selectedSuggestionIndex];
    if (selectedCmd) {
      onChange(`/${selectedCmd.name} `);
      setInternalShowSuggestions(false);
    }
  }, [filteredCommands, selectedSuggestionIndex, onChange]);

  // 历史记录向上
  const handleHistoryUp = useCallback(() => {
    if (history.length === 0) return;
    if (historyIndex === -1) {
      setTempInput(value);
      setHistoryIndex(history.length - 1);
      onChange(history[history.length - 1] ?? "");
    } else if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      onChange(history[historyIndex - 1] ?? "");
    }
  }, [history, historyIndex, value, onChange]);

  // 历史记录向下
  const handleHistoryDown = useCallback(() => {
    if (historyIndex === -1) return;
    if (historyIndex >= history.length - 1) {
      setHistoryIndex(-1);
      onChange(tempInput);
    } else {
      setHistoryIndex(historyIndex + 1);
      onChange(history[historyIndex + 1] ?? "");
    }
  }, [history, historyIndex, tempInput, onChange]);

  // 处理提交
  const handleSubmit = useCallback(() => {
    if (!value.trim()) return;
    onSubmit(value);
    setInternalShowSuggestions(false);
    setHistoryIndex(-1);
    setTempInput("");
    setIsReverseSearchMode(false);
  }, [value, onSubmit]);

  // 键盘输入处理
  useInput(
    (input, key) => {
      if (isReverseSearchMode) {
        if (key.return) {
          reverseSearch.confirm();
        } else if (key.escape) {
          reverseSearch.cancel();
        } else if (key.ctrl && input === "r") {
          reverseSearch.next();
        } else if (key.backspace || key.delete) {
          const newQuery = reverseSearch.query.slice(0, -1);
          reverseSearch.updateQuery(newQuery);
        } else if (input && !key.ctrl && !key.meta) {
          reverseSearch.updateQuery(reverseSearch.query + input);
        }
        return;
      }

      if (key.ctrl && input === "r") {
        setIsReverseSearchMode(true);
        reverseSearch.start();
        return;
      }

      if (key.ctrl && input === "m") {
        const newMode = !isMultilineMode;
        setIsMultilineMode(newMode);
        if (!newMode) {
          const fullContent = [...multilineBuffer, value].join("\n");
          if (fullContent.trim()) {
            onSubmit(fullContent);
          }
          setMultilineBuffer([]);
          onChange("");
        } else {
          setMultilineBuffer([]);
        }
        onMultilineChange?.(newMode);
        return;
      }

      if (key.ctrl && input === "k") {
        const newMode = !isShellMode;
        setIsShellMode(newMode);
        if (!newMode && value.trim()) {
          onShellCommand?.(value);
          onChange("");
        }
        return;
      }

      if (key.meta) {
        isMetaKeyDown.current = true;
        setTimeout(() => { isMetaKeyDown.current = false; }, 50);
        return;
      }

      if (key.tab) {
        if (filteredCommands.length > 0 && value.startsWith("/")) {
          handleTabCompletion();
        } else {
          onToggleThinking?.();
        }
      } else if (key.upArrow) {
        if (showSuggestions && filteredCommands.length > 0) {
          setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
        } else {
          handleHistoryUp();
        }
      } else if (key.downArrow) {
        if (showSuggestions && filteredCommands.length > 0) {
          setSelectedSuggestionIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
        } else {
          handleHistoryDown();
        }
      } else if (key.return) {
        if (showSuggestions && filteredCommands.length > 0) {
          handleTabCompletion();
        } else if (isMultilineMode) {
          setMultilineBuffer((prev) => [...prev, value]);
          onChange("");
        } else if (isShellMode) {
          onShellCommand?.(value);
          onChange("");
        } else {
          handleSubmit();
        }
      } else if (key.escape) {
        if (showSuggestions) {
          setInternalShowSuggestions(false);
        } else if (isMultilineMode) {
          setIsMultilineMode(false);
          setMultilineBuffer([]);
          onChange("");
          onMultilineChange?.(false);
        } else if (isShellMode) {
          setIsShellMode(false);
          onChange("");
        } else {
          onChange("");
        }
      } else if (input === "?" && value === "") {
      } else {
        if (input === "/" || value.startsWith("/")) {
          setInternalShowSuggestions(true);
        } else {
          setInternalShowSuggestions(false);
        }
      }
    },
    { isActive: !isLoading }
  );

  // 默认占位符
  const defaultPlaceholder = useMemo(() => {
    if (isLoading) return "思考中...";
    if (isShellMode) return "Shell 模式: 输入命令执行";
    if (isMultilineMode) return `多行模式: 已输入 ${multilineBuffer.length} 行`;
    return "输入消息或 / 获取命令列表 | Ctrl+M 多行 | Ctrl+K Shell";
  }, [isLoading, isShellMode, isMultilineMode, multilineBuffer.length]);

  return (
    <Box flexDirection="column" width="100%">
      {/* 输入行 - Gemini CLI 风格：简洁的 > 提示符 */}
      <Box width="100%">
        {vimMode !== "insert" && <VimModeIndicator mode={vimMode} />}

        {isLoading ? (
          <Box>
            <Text color={toInkColor(colors.status.warning)}>
              <Spinner type="dots" />
            </Text>
            <Text color={toInkColor(colors.status.warning)}> </Text>
          </Box>
        ) : (
          <Text bold color={toInkColor(colors.text.accent)}>
            {"> "}
          </Text>
        )}

        <Box flexGrow={1}>
          {isReverseSearchMode ? (
            <Text dimColor>
              反向搜索: {reverseSearch.query}
              {reverseSearch.selected ? ` → ${reverseSearch.selected.item.slice(0, 50)}...` : ""}
            </Text>
          ) : (
            <TextInput
              value={value}
              onChange={(newValue: string) => {
                // 过滤 Meta/Alt 组合键产生的输入
                if (isMetaKeyDown.current) {
                  return;
                }
                onChange(newValue);
              }}
              placeholder={placeholder ?? defaultPlaceholder}
              showCursor={true}
            />
          )}
        </Box>
      </Box>

      {/* 反向搜索界面 */}
      {isReverseSearchMode && (
        <ReverseSearchOverlay
          query={reverseSearch.query}
          results={reverseSearch.results}
          selectedIndex={reverseSearch.selectedIndex}
        />
      )}

      {/* 命令建议 */}
      {showSuggestions && filteredCommands.length > 0 && (
        <Suggestions
          commands={filteredCommands}
          selectedIndex={selectedSuggestionIndex}
          visible={true}
          query={value.slice(1)}
          maxVisible={10}
        />
      )}
    </Box>
  );
};

export default InputPrompt;
