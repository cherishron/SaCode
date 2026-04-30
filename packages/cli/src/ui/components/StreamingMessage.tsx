import React from "react";
import { Text, Box } from "ink";
import { getColors, toInkColor } from "../theme/index.js";

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
  role: "user" | "assistant";
}

const roleConfig = {
  user: { tag: "[YOU]", colorKey: "primary" as const },
  assistant: { tag: "[AI]", colorKey: "accent" as const },
};

export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  content,
  isStreaming,
  role,
}) => {
  const colors = getColors();
  const config = roleConfig[role];

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text bold color={toInkColor(colors.text[config.colorKey])}>
          {config.tag}
        </Text>
        {isStreaming && role === "assistant" && (
          <Text color={toInkColor(colors.text.muted)}> *</Text>
        )}
      </Box>
      <Box marginLeft={1} marginTop={0}>
        <Text>{content}</Text>
        {isStreaming && <Text color={toInkColor(colors.text.accent)}>▌</Text>}
      </Box>
    </Box>
  );
};
