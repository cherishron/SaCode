/**
 * BrandHeader 组件 — SaCode 品牌启动画面
 *
 * 参考 Gemini CLI / Qwen Code 风格
 * 顶部 ASCII Art Logo + 版本 + 账户 + 模型 + 工作目录
 */

import React, { useMemo } from "react";
import { Text, Box } from "ink";
import { ThemedGradient } from "./ThemedGradient.js";
import { getColors, toInkColor } from "../theme/index.js";
import type { AccountInfo } from "../types.js";

// ============================================================================
// ASCII Art Logo
// ============================================================================

const LOGO_FULL = [
  "███████╗ █████╗  ██████╗ ██████╗ ██████╗ ███████╗",
  "██╔════╝██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝",
  "███████╗███████║██║     ██║   ██║██║  ██║█████╗  ",
  "╚════██║██╔══██║██║     ██║   ██║██║  ██║██╔══╝  ",
  "███████║██║  ██║╚██████╗╚██████╔╝██████╔╝███████╗",
  "╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
];

const LOGO_COMPACT = [
  "╔═╗┌─┐╔═╗┌─┐┌┬┐┌─┐",
  "╚═╗├─┤║  │ │ ││├┤ ",
  "╚═╝┴ ┴╚═╝└─┘─┴┘└─┘",
];

// ============================================================================
// Props
// ============================================================================

interface BrandHeaderProps {
  version: string;
  account?: AccountInfo | undefined;
  model?: string | undefined;
  cwd: string;
  terminalWidth?: number | undefined;
}

// ============================================================================
// BrandHeader 组件
// ============================================================================

export const GeminiHeader: React.FC<BrandHeaderProps> = ({
  account,
  model,
  cwd,
  version,
  terminalWidth: termWidth,
}) => {
  const colors = getColors();
  const tw = termWidth ?? process.stdout.columns ?? 80;
  const useCompact = tw < 60;

  const logo = useCompact ? LOGO_COMPACT : LOGO_FULL;

  // 计算 Logo 居中的左 padding
  const logoWidth = logo[0]?.length ?? 0;
  const padLeft = Math.max(0, Math.floor((tw - logoWidth) / 2));
  const padding = " ".repeat(padLeft);

  const accountText = useMemo(() => {
    if (account) {
      return `${account.provider}/${account.alias}`;
    }
    return "未配置";
  }, [account]);

  const modelText = model ?? "default";

  return (
    <Box flexDirection="column" width="100%" paddingTop={1}>
      {/* ASCII Art Logo — 渐变色 */}
      <Box flexDirection="column">
        {logo.map((line, idx) => (
          <Box key={idx}>
            <Text>{padding}</Text>
            <ThemedGradient bold colors={["#4285F4", "#A142F4"]}>
              {line}
            </ThemedGradient>
          </Box>
        ))}
      </Box>

      {/* 空行 */}
      <Text>{" "}</Text>

      {/* 版本行 */}
      <Box paddingLeft={Math.max(0, padLeft)}>
        <Text bold color={toInkColor(colors.text.primary)}>
          {">"}_
        </Text>
        <Text bold color={toInkColor(colors.text.primary)}>
          {" "}SaCode CLI
        </Text>
        <Text color={toInkColor(colors.text.secondary)}>
          {" "}(v{version})
        </Text>
      </Box>

      {/* 空行 */}
      <Text>{" "}</Text>

      {/* 账户行 */}
      <Box paddingLeft={Math.max(0, padLeft)}>
        <Text color={toInkColor(colors.text.secondary)}>
          CodingPlan: {accountText}
        </Text>
        <Text color={toInkColor(colors.text.accent)}>
          {" "}| /auth 管理账户
        </Text>
      </Box>

      {/* 模型行 */}
      <Box paddingLeft={Math.max(0, padLeft)}>
        <Text color={toInkColor(colors.text.secondary)}>
          模型: {modelText}
        </Text>
        <Text color={toInkColor(colors.text.accent)}>
          {" "}(/model 切换)
        </Text>
      </Box>

      {/* 工作目录 */}
      <Box paddingLeft={Math.max(0, padLeft)}>
        <Text color={toInkColor(colors.text.secondary)}>{cwd}</Text>
      </Box>

      {/* 空行 */}
      <Text>{" "}</Text>

      {/* 快捷键提示 — 右对齐 */}
      <Box width={tw} justifyContent="flex-end" paddingRight={2}>
        <Text color={toInkColor(colors.text.accent)}>? 查看快捷键</Text>
      </Box>
    </Box>
  );
};

// 兼容默认导出
export default GeminiHeader;
