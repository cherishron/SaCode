/**
 * Header 组件 - 包含 ASCII Art Logo 和版本信息
 *
 * 使用现代化边框和渐变效果
 */

import React, { useEffect, useState } from "react";
import { Box, Text, Spacer } from "ink";
import figlet from "figlet";
import { ThemedGradient } from "./components/ThemedGradient.js";
import { getColors, toInkColor, type SemanticColors } from "./theme/index.js";

interface HeaderProps {
  version: string;
  showHelp?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ version, showHelp = true }) => {
  const [asciiLogo, setAsciiLogo] = useState<string>("");
  const colors = getColors();

  useEffect(() => {
    // 使用 figlet 生成 ASCII art
    figlet.text(
      "SaCode",
      {
        font: "Small", // 使用更紧凑的字体
        horizontalLayout: "default",
        verticalLayout: "default",
      },
      (err, data) => {
        if (err) {
          // Fallback 到简单文本
          setAsciiLogo(`
  ███████╗ █████╗  ██████╗ ██████╗ ███████╗
  ██╔════╝██╔══██╗██╔════╝██╔═══██╗██╔════╝
  ███████╗███████║██║     ██║   ██║███████╗
  ╚════██║██╔══██║██║     ██║   ██║╚════██║
  ███████║██║  ██║╚██████╗╚██████╔╝███████║
  ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝`);
          return;
        }
        if (data) {
          setAsciiLogo(data);
        }
      }
    );
  }, []);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={toInkColor(colors.border.accent)}
      paddingX={1}
      width="100%"
    >
      {/* ASCII Art Logo with gradient */}
      {asciiLogo && (
        <Box flexDirection="column">
          {asciiLogo.split("\n").map((line, idx) => (
            <ThemedGradient key={idx} bold>
              {line}
            </ThemedGradient>
          ))}
        </Box>
      )}

      {/* 版本和帮助信息 */}
      <Box justifyContent="space-between" width="100%">
        <Box>
          <Text bold color={toInkColor(colors.text.accent)}>
            v{version}
          </Text>
          <Text dimColor>
            {" "}
            · 多端 AI 助手
          </Text>
        </Box>
        {showHelp && (
          <Box>
            <Text color={toInkColor(colors.text.user)}>/help</Text>
            <Text dimColor>
              {" "}
              · Ctrl+C 退出
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default Header;