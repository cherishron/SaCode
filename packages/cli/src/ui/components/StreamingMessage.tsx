import React from "react";
import { Text, Box } from "ink";
import { geminiTheme } from "../theme/gemini-theme.js";

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
  role: "user" | "assistant";
}

export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  content,
  isStreaming,
  role,
}) => {
  const roleLabel = role === "user" ? "You" : "SaCode";
  const roleColor = role === "user" ? geminiTheme.colors.primary : geminiTheme.colors.accent;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text bold color={roleColor}>
          {roleLabel}
        </Text>
        {isStreaming && role === "assistant" && (
          <Text color={geminiTheme.colors.muted}> ●</Text>
        )}
      </Box>
      <Box marginLeft={1} marginTop={0}>
        <Text>{content}</Text>
        {isStreaming && <Text color={geminiTheme.colors.accent}>▌</Text>}
      </Box>
    </Box>
  );
};
