/**
 * Header 组件 - 包含 ASCII Art Logo 和版本信息
 */

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import figlet from "figlet";

interface HeaderProps {
  version: string;
  showHelp?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ version, showHelp = true }) => {
  const [asciiLogo, setAsciiLogo] = useState<string>("");

  useEffect(() => {
    // 使用 figlet 生成 ASCII art，使用更简洁的 Standard 字体
    figlet.text("SaCode", { font: "Standard" }, (err, data) => {
      if (err) {
        console.error("Error generating ASCII art:", err);
        return;
      }
      if (data) {
        setAsciiLogo(data);
      }
    });
  }, []);

  return (
    <Box flexDirection="column" paddingX={0}>
      {/* ASCII Art Logo - 使用柔和的灰色 */}
      {asciiLogo && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray">
            {asciiLogo}
          </Text>
        </Box>
      )}

      {/* 版本和帮助信息 - 使用灰色系 */}
      <Box justifyContent="space-between">
        <Box>
          <Text color="white">v{version}</Text>
          <Text color="gray"> · </Text>
          <Text color="gray">多端 AI 助手</Text>
        </Box>
        {showHelp && (
          <Box>
            <Text color="white">/help</Text>
            <Text color="gray"> · </Text>
            <Text color="gray">Ctrl+C 退出</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};