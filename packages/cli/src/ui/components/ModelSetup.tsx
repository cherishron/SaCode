/**
 * ModelSetup 组件 - 交互式模型选择
 *
 * 参考 iFlow CLI 的交互方式：
 * 1. 显示模型列表，上下选择
 * 2. 确认后切换模型
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { getColors, toInkColor } from "../theme/index.js";

// ============================================================================
// 类型定义
// ============================================================================

interface ModelSetupProps {
  /** 模型列表 */
  models: string[];
  /** 当前模型 */
  currentModel: string;
  /** 厂商名称 */
  providerName: string;
  /** 完成回调 */
  onComplete: (model: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

// ============================================================================
// ModelSetup 组件
// ============================================================================

export const ModelSetup: React.FC<ModelSetupProps> = ({
  models,
  currentModel,
  providerName,
  onComplete,
  onCancel,
}) => {
  const colors = getColors();

  // 状态
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = models.indexOf(currentModel);
    return idx >= 0 ? idx : 0;
  });

  // 键盘输入处理
  useInput(
    useCallback(
      (_input, key) => {
        if (key.upArrow) {
          setSelectedIndex((prev) => (prev - 1 + models.length) % models.length);
        } else if (key.downArrow) {
          setSelectedIndex((prev) => (prev + 1) % models.length);
        } else if (key.return) {
          onComplete(models[selectedIndex] ?? currentModel);
        } else if (key.escape) {
          onCancel();
        } else {
          // 数字键快速选择
          const num = parseInt(_input, 10);
          if (num >= 1 && num <= models.length) {
            onComplete(models[num - 1] ?? currentModel);
          }
        }
      },
      [selectedIndex, models, currentModel, onComplete, onCancel],
    ),
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={toInkColor(colors.ui.border)} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={toInkColor(colors.text.accent)}>
          选择模型
        </Text>
        <Text color={toInkColor(colors.text.muted)}>
          {" "}(厂商: {providerName})
        </Text>
      </Box>

      {models.map((model, index) => (
        <Box key={model}>
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
            {model}
          </Text>
          {model === currentModel && (
            <Text color={toInkColor(colors.status.success)}> (当前)</Text>
          )}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>  上下键选择 | 数字键快速选择 | 回车确认 | Esc 取消</Text>
      </Box>
    </Box>
  );
};

export default ModelSetup;
