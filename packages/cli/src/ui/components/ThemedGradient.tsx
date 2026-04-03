/**
 * 渐变文本组件
 *
 * 参考 Gemini CLI 的 ThemedGradient 实现
 * 为文本添加渐变色效果
 */

import React, { memo, useMemo } from "react";
import { Text, Box } from "ink";
import {
  getThemeManager,
  parseColor,
  interpolateColor,
  generateGradient,
  type ColorValue,
} from "../theme/index.js";

// ============================================================================
// 渐变文本组件
// ============================================================================

export interface ThemedGradientProps {
  /** 文本内容 */
  children: string;
  /** 渐变色数组（覆盖主题默认渐变） */
  colors?: ColorValue[];
  /** 是否水平渐变（字符间渐变） */
  horizontal?: boolean;
  /** 是否粗体 */
  bold?: boolean;
}

/**
 * 渐变文本组件
 *
 * 注意：终端不支持真正的渐变效果
 * 这里通过为每个字符应用不同颜色来模拟渐变
 */
export const ThemedGradient: React.FC<ThemedGradientProps> = memo(
  ({ children, colors: customColors, horizontal = true, bold = false }) => {
    const themeColors = getThemeManager().getSemanticColors();
    const gradientColors = customColors ?? themeColors.ui.gradient;

    // 如果没有渐变色配置，使用主题主色
    if (!gradientColors || gradientColors.length === 0) {
      return (
        <Text bold={bold} color={themeColors.text.primary}>
          {children}
        </Text>
      );
    }

    // 解析渐变色
    const parsedColors = useMemo(() => {
      return gradientColors.map((c) => parseColor(c) ?? c).filter(Boolean);
    }, [gradientColors]);

    // 为每个字符生成颜色
    const charColors = useMemo(() => {
      if (!horizontal || children.length <= 1) {
        return parsedColors;
      }

      // 生成足够多的渐变色
      return generateGradient(parsedColors, children.length);
    }, [parsedColors, children.length, horizontal]);

    // 如果颜色数量不足，回退到单一颜色
    if (charColors.length < children.length && horizontal) {
      return (
        <Text bold={bold} color={charColors[0] ?? themeColors.text.primary}>
          {children}
        </Text>
      );
    }

    // 渲染每个字符
    return (
      <Box>
        {children.split("").map((char, idx) => (
          <Text
            key={idx}
            bold={bold}
            color={charColors[idx % charColors.length] ?? themeColors.text.primary}
          >
            {char}
          </Text>
        ))}
      </Box>
    );
  }
);

ThemedGradient.displayName = "ThemedGradient";

// ============================================================================
// Logo 渐变组件
// ============================================================================

export interface GradientLogoProps {
  /** Logo 文本 */
  text?: string;
  /** 渐变色 */
  colors?: ColorValue[];
}

/**
 * 渐变 Logo 组件
 */
export const GradientLogo: React.FC<GradientLogoProps> = memo(
  ({ text = "SaCode", colors }) => {
    return (
      <ThemedGradient bold colors={colors}>
        {text}
      </ThemedGradient>
    );
  }
);

GradientLogo.displayName = "GradientLogo";

// ============================================================================
// 状态指示器渐变
// ============================================================================

export interface GradientSpinnerProps {
  /** 加载文本 */
  text?: string;
}

/**
 * 渐变加载指示器
 */
export const GradientSpinner: React.FC<GradientSpinnerProps> = memo(
  ({ text = "Thinking" }) => {
    const themeColors = getThemeManager().getSemanticColors();
    const [frame, setFrame] = React.useState(0);
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    React.useEffect(() => {
      const timer = setInterval(() => {
        setFrame((f) => (f + 1) % frames.length);
      }, 80);
      return () => clearInterval(timer);
    }, []);

    return (
      <Box>
        <Text color={themeColors.status.running}>{frames[frame]}</Text>
        <Text color={themeColors.text.secondary}> {text}...</Text>
      </Box>
    );
  }
);

GradientSpinner.displayName = "GradientSpinner";

export default ThemedGradient;
