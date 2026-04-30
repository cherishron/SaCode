import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { getColors, toInkColor, type SemanticColors } from "../theme/index.js";

export interface ChoiceOption {
  label: string;
  value: string;
  description?: string;
}

export interface ChoicePromptProps {
  question: string;
  options: ChoiceOption[];
  onSelect: (value: string) => void;
  onCancel?: () => void;
  allowCustom?: boolean;
}

export const ChoicePrompt: React.FC<ChoicePromptProps> = ({
  question,
  options,
  onSelect,
  onCancel,
  allowCustom = false,
}) => {
  const colors = getColors();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);

  useInput(
    useCallback(
      (input, key) => {
        if (isCustomMode) {
          if (key.return) {
            if (customInput.trim()) {
              onSelect(customInput.trim());
            }
          } else if (key.escape) {
            setIsCustomMode(false);
            setCustomInput("");
          } else if (key.backspace || key.delete) {
            setCustomInput((prev) => prev.slice(0, -1));
          } else if (input && !key.ctrl && !key.meta) {
            setCustomInput((prev) => prev + input);
          }
          return;
        }

        if (key.upArrow) {
          setSelectedIndex((prev) => (prev - 1 + options.length) % options.length);
        } else if (key.downArrow) {
          setSelectedIndex((prev) => (prev + 1) % options.length);
        } else if (key.return) {
          onSelect(options[selectedIndex]?.value ?? "");
        } else if (key.escape) {
          onCancel?.();
        } else if (allowCustom && input === "c") {
          setIsCustomMode(true);
        } else {
          const num = parseInt(input, 10);
          if (num >= 1 && num <= options.length) {
            onSelect(options[num - 1]?.value ?? "");
          }
        }
      },
      [selectedIndex, options, onSelect, onCancel, isCustomMode, customInput, allowCustom],
    ),
  );

  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold color={toInkColor(colors.text.accent)}>
          [?]
        </Text>
        <Text> </Text>
        <Text bold>{question}</Text>
      </Box>

      {isCustomMode ? (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>输入自定义回答，按 Enter 确认，Esc 取消:</Text>
          <Box>
            <Text color={toInkColor(colors.text.accent)}>{">"} </Text>
            <Text>{customInput}</Text>
            <Text color={toInkColor(colors.text.accent)}>_</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2}>
          {options.map((option, index) => (
            <Box key={option.value}>
              <Text
                color={
                  index === selectedIndex
                    ? toInkColor(colors.text.accent)
                    : toInkColor(colors.text.muted)
                }
                bold={index === selectedIndex}
                inverse={index === selectedIndex}
              >
                {index === selectedIndex ? "> " : "  "}
                {String(index + 1).padStart(2, " ")}.
              </Text>
              <Text
                bold={index === selectedIndex}
                color={
                  index === selectedIndex
                    ? toInkColor(colors.text.primary)
                    : toInkColor(colors.text.secondary)
                }
              >
                {" "}
                {option.label}
              </Text>
              {option.description && (
                <Text dimColor> - {option.description}</Text>
              )}
            </Box>
          ))}
          {allowCustom && (
            <Box marginTop={1}>
              <Text dimColor>  按 c 输入自定义回答 | 数字键快速选择 | Esc 取消</Text>
            </Box>
          )}
          {!allowCustom && (
            <Box marginTop={1}>
              <Text dimColor>  数字键快速选择 | Esc 取消</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
